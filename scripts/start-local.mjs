#!/usr/bin/env node
/**
 * 本地最小化部署 · 一条命令启动完整工作台（无需 EdgeOne、无需数据库、无需联网）
 *
 *   node scripts/start-local.mjs
 *
 * 小白友好：本脚本会自动完成所有准备步骤，直接跑即可 ——
 *   0. 检查 Node.js 版本（需 ≥ 20.9，LTS 更佳）
 *   1. 根目录 / frontend 缺依赖时自动 npm install（首次运行约 1-2 分钟）
 *   2. 启动两个进程：
 *        ① 后端 API  http://127.0.0.1:8787/api  （Node 标准库 HTTP + 本地 JSON 持久化）
 *        ② 前端应用  http://127.0.0.1:3737      （Next.js，API 指向 ①）
 *   3. 前端就绪后自动打开浏览器（NO_OPEN=1 关闭此行为）
 *
 * 数据落在 ./.data/store.json，删掉即恢复初始状态。
 * 停止：Ctrl+C（两个子进程一并退出）
 */
import { spawn, spawnSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = path.join(ROOT, 'frontend');

const API_PORT = process.env.API_PORT || '8787';
const WEB_PORT = process.env.WEB_PORT || '3737';
const API_BASE = `http://127.0.0.1:${API_PORT}/api`;

const children = [];

/* ── 0) Node 版本检查 ─────────────────────────────────────── */
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 20) {
  console.error(`❌ 需要 Node.js ≥ 20.9，当前 ${process.versions.node}`);
  console.error('   下载安装（LTS）：https://nodejs.org/zh-cn');
  process.exit(1);
}

/* ── 1) 依赖自动安装（缺才装，已装秒过）──────────────────── */
function ensureDeps(dir, label, hint) {
  if (existsSync(path.join(dir, 'node_modules'))) return;
  console.log(`[依赖] 首次运行：正在安装 ${label}（约 1-2 分钟，仅需一次）…`);
  const r = spawnSync('npm install --no-audit --no-fund', {
    cwd: dir,
    stdio: 'inherit',
    shell: true, // Windows 下 npm 是 .cmd，必须走 shell
  });
  if (r.status !== 0) {
    console.error(`\n❌ ${label}依赖安装失败。请手动执行后重试：\n   ${hint}`);
    process.exit(1);
  }
}
ensureDeps(ROOT, '后端依赖', 'npm install');
ensureDeps(FRONTEND, '前端依赖', 'cd frontend && npm install');

/* ── 2) 启动服务 ──────────────────────────────────────────── */
function run(name, cmd, args, cwd, extraEnv) {
  const child = spawn(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...extraEnv },
  });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`\n[${name}] 进程退出，code=${code}`);
    }
  });
  children.push(child);
  return child;
}

console.log('\n── Agentic OS 工作台 · 本地最小化部署 ──\n');
console.log(`后端 API : ${API_BASE}`);
console.log(`前端应用 : http://127.0.0.1:${WEB_PORT}`);
console.log(`数据文件 : ${path.join(ROOT, '.data/store.json')}`);
console.log('\n启动中… 首次访问前端需编译约 20-40 秒，属正常现象。\n');

/* ① 后端：Node 适配器 + 本地文件存储 */
run('api', 'npx', ['tsx', 'backend/adapter/server.ts'], ROOT, {
  PORT: API_PORT,
  LOCAL_STORE: 'file',
  // 未配置 AI Gateway 时用本地模拟流，保证 AI Copilot 链路可完整演示（不联网）
  LOCAL_AI_MOCK: process.env.LOCAL_AI_MOCK || '1',
  NODE_ENV: process.env.NODE_ENV || 'development',
});

/* ② 前端：Next.js（API 指向本地后端） */
run('web', 'npx', ['next', 'dev', '-p', WEB_PORT], FRONTEND, {
  NEXT_PUBLIC_API_BASE: API_BASE,
  NODE_ENV: 'development',
});

/* ── 3) 前端就绪后自动打开浏览器 ─────────────────────────── */
function openBrowser(url) {
  if (process.env.NO_OPEN) return;
  try {
    const cmd =
      process.platform === 'win32'
        ? `start "" "${url}"`
        : process.platform === 'darwin'
          ? `open "${url}"`
          : `xdg-open "${url}"`;
    execSync(cmd, { stdio: 'ignore' });
    console.log(`\n✅ 已在浏览器打开 ${url}`);
  } catch {
    // 无桌面环境（服务器/容器）属正常，忽略
    console.log(`\n✅ 前端已就绪：${url}`);
  }
}

const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const t0 = Date.now();
(async () => {
  while (Date.now() - t0 < 90_000) {
    try {
      const r = await fetch(WEB_URL);
      if (r.ok) {
        openBrowser(WEB_URL);
        return;
      }
    } catch {
      /* 服务未就绪，继续等 */
    }
    await new Promise((r) => setTimeout(r, 800));
  }
})();

function shutdown() {
  console.log('\n[local] 正在停止所有进程 …');
  for (const c of children) {
    try {
      c.kill('SIGTERM');
    } catch {
      /* 已退出 */
    }
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
