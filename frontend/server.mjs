#!/usr/bin/env node
/**
 * 单端口自定义 server · 前端页面 + 后端 API 同进程同端口
 *
 * 用途：
 *   沙箱/容器/Serverless 等「只暴露一个端口」的环境下，把 Next.js 前端与
 *   REST 后端合并到一个 HTTP 服务上，对外只有一个 PORT。
 *
 * 路由分流：
 *   /api/*      → backend/adapter/node.ts 的 serveApiRequest（复用全部业务逻辑）
 *   其余路径    → Next.js request handler（SSR / 静态资源 / RSC）
 *
 * 启动（开发）：
 *   node --import tsx/esm frontend/server.mjs
 * 启动（生产，需先 next build）：
 *   node --import tsx/esm server.mjs          # 在 app-dist/ 内
 *
 * 环境变量：
 *   PORT        监听端口（默认 3737）—— 平台通常会注入
 *   HOST        监听地址（默认 0.0.0.0）
 *   NODE_ENV    production 时走构建产物；否则走 dev 模式
 *   LOCAL_STORE file 时数据落本地 JSON；缺省自动选择
 *   LOCAL_AI_MOCK 1 时 AI 走本地模拟流
 *   JWT_SECRET  鉴权签名密钥（≥32 位随机串），生产环境必填
 *
 * 环境变量也可写在同目录的 .env 文件里（见 .env.example）。
 * 优先级：真实环境变量 > .env，便于平台注入覆盖本地默认值。
 */
import { createServer } from 'node:http';
import { parse } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ── .env 加载（零依赖）────────────────────────────────────────
 * 部署单元需要在「不把密钥写进仓库、也不依赖平台注入」的前提下拿到 JWT_SECRET。
 * 这里读取同目录 .env 并填充 process.env（已存在的真实环境变量优先，不覆盖）。
 * 仅做 KEY=VALUE 解析，支持 # 注释与单/双引号包裹，够用且无第三方依赖。
 * ------------------------------------------------------------ */
(function loadDotEnv() {
  const file = path.join(HERE, '.env');
  if (!existsSync(file)) return;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // 去掉成对的引号
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // 真实环境变量优先：平台上注入的值不应被文件覆盖
    if (process.env[key] === undefined) process.env[key] = value;
  }
})();

/* ── 路径探测 ────────────────────────────────────────────────
 * 两种运行位置，探测方式统一：看本文件同级有没有 backend/
 *
 *   源码态：node --import tsx/esm frontend/server.mjs
 *           本文件在 frontend/，backend 在上一级，Next 根 = frontend/
 *   构建态：node --import tsx/esm server.mjs   （cwd = app-dist/）
 *           本文件在 app-dist/ 根，backend 就在同级，Next 根 = app-dist/
 *
 * 两种情况下 Next 根都等于「本文件所在目录」，差异只在 backend 的位置。
 * ------------------------------------------------------------ */
const BACKEND_ENTRY = [
  path.join(HERE, 'backend', 'adapter', 'node.ts'),
  path.resolve(HERE, '..', 'backend', 'adapter', 'node.ts'),
].find(existsSync);

if (!BACKEND_ENTRY) {
  console.error('[server] 找不到 backend/adapter/node.ts，无法启动 API 层。');
  process.exit(1);
}

const NEXT_DIR = HERE;
const PORT = Number(process.env.PORT || 3737);
const HOST = process.env.HOST || '0.0.0.0';
const DEV = process.env.NODE_ENV !== 'production';

/* ── 动态加载：tsx 负责编译 TS，Node 负责跑 JS ───────────────── */
const { default: next } = await import('next');
const { serveApiRequest } = await import(BACKEND_ENTRY);

/* M7 · 常驻真实 Agent 执行器：把 queued 轮次自动领走并交给本机 CLI Agent 执行。
   路径按 backend 入口推导，源码态/构建态都能定位到 backend/lib/loop/scheduler.ts。 */
const BACKEND_ROOT = BACKEND_ENTRY.endsWith(path.join('backend', 'adapter', 'node.ts'))
  ? BACKEND_ENTRY.slice(0, -path.join('adapter', 'node.ts').length)
  : path.resolve(HERE, '..', 'backend') + path.sep;
const SCHEDULER_ENTRY = path.join(BACKEND_ROOT, 'lib', 'loop', 'scheduler.ts');
let loopScheduler = null;
if (existsSync(SCHEDULER_ENTRY) && process.env.LOOP_WORKER_DISABLE !== '1') {
  try {
    const { startLoopScheduler } = await import(SCHEDULER_ENTRY);
    loopScheduler = startLoopScheduler(process.env);
  } catch (err) {
    console.error('[worker] 自动执行器加载失败（不影响 Web/API）:', err.message);
  }
} else if (!existsSync(SCHEDULER_ENTRY)) {
  console.warn('[worker] 未找到 scheduler.ts，自动执行器未启用');
}

const app = next({ dev: DEV, dir: NEXT_DIR });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer((req, res) => {
  const url = req.url || '/';

  /* ① 后端 API：同进程直连，不经网络、无 CORS */
  if (url === '/api' || url.startsWith('/api/') || url.startsWith('/api?')) {
    void serveApiRequest(req, res);
    return;
  }

  /* ② 其余交给 Next.js */
  try {
    void handle(req, res, parse(url, true));
  } catch (err) {
    console.error('[server] Next 处理请求失败:', err);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
});

server.listen(PORT, HOST, () => {
  console.log('── Agentic OS 工作台 · 单端口服务 ──');
  console.log(`  模式     : ${DEV ? 'development' : 'production'}`);
  console.log(`  地址     : http://${HOST}:${PORT}`);
  console.log(`  API      : http://${HOST}:${PORT}/api`);
  console.log(`  Next 根  : ${NEXT_DIR}`);
  console.log(
    `  存储驱动 : ${process.env.LOCAL_STORE === 'file' ? '本地文件' : '自动选择'}`,
  );
  if (process.env.LOCAL_AI_MOCK === '1') console.log('  AI Copilot: 本地模拟流（Autoloop 执行器走真实 CLI Agent，不受此开关影响）');
  console.log(`  Worker   : ${loopScheduler ? '常驻自动执行（真实 Agent）' : '未启用'}`);
});

function shutdown(signal) {
  console.log(`\n[server] 收到 ${signal}，正在关闭 …`);
  loopScheduler?.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
