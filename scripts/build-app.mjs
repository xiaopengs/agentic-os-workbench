#!/usr/bin/env node
/**
 * 单端口部署单元构建脚本
 *
 * 产出 app-dist/：一个自包含的、只暴露单个 HTTP 端口的可运行应用
 * （Next.js 前端 + REST 后端同进程），适用于沙箱 / 容器 / Serverless。
 *
 *   node scripts/build-app.mjs
 *
 * 蒸馏流程：
 *   1. next build（output: 'standalone'）→ frontend/.next/standalone
 *   2. 复制 standalone 产物         → app-dist/
 *   3. 复制 .next/static            → app-dist/.next/static   （Next 不自动带）
 *   4. 复制 public/（若存在）        → app-dist/public
 *   5. 复制 backend/ shared/        → app-dist/                （保持 ../../ 相对路径）
 *   6. 复制 frontend/server.mjs     → app-dist/server.mjs      （单端口入口）
 *   7. 组装 package.json：
 *        dependencies  = 前端 deps + 后端 deps + tsx（TS 运行期需要）
 *        scripts.start = node --import tsx/esm server.mjs
 *   8. 写 .env.example
 *
 * ⚠️ standalone 自带的 node_modules 是裁剪版，不含 tsx 与后端依赖，
 *    因此部署时仍需在 app-dist/ 内执行一次 npm install（见输出提示）。
 */
import { cp, rm, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = path.join(ROOT, 'frontend');
const DIST = path.join(ROOT, 'app-dist');
const STANDALONE = path.join(FRONTEND, '.next', 'standalone');

const asyncExists = async (p) => access(p).then(() => true, () => false);

async function copyDir(src, dest) {
  await cp(src, dest, {
    recursive: true,
    filter: (p) => !['node_modules', '.next', 'dist', 'app-dist', '.git'].includes(path.basename(p)),
  });
}

async function main() {
  /* 1) 前端生产构建 */
  console.log('[build-app] ① 执行 next build（standalone）…');
  execFileSync('npx', ['next', 'build'], { cwd: FRONTEND, stdio: 'inherit' });

  if (!existsSync(STANDALONE)) {
    throw new Error(
      '未找到 .next/standalone —— 请确认 frontend/next.config.ts 中已设置 output: "standalone"',
    );
  }

  /* standalone 的产物层级取决于 Next 推断的 monorepo 根：
   *   项目根 = 仓库根时 → .next/standalone/{server.js, node_modules, .next}
   *   项目根 = frontend/ 时 → .next/standalone/frontend/{server.js, ...}
   * 这里自动探测出真正的产物根，避免把多出来的一层目录带进部署单元。 */
  const inner = path.join(STANDALONE, 'frontend');
  const standaloneRoot =
    existsSync(path.join(inner, 'server.js')) && existsSync(path.join(inner, 'node_modules'))
      ? inner
      : STANDALONE;
  console.log(
    '[build-app]    standalone 产物根:',
    path.relative(ROOT, standaloneRoot) || '.',
  );

  /* 2) 组装部署单元 */
  console.log('[build-app] ② 组装 app-dist/ …');
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  await cp(standaloneRoot, DIST, { recursive: true });

  // Next 不会把 static 与 public 放进 standalone，必须手工补
  const staticSrc = path.join(FRONTEND, '.next', 'static');
  if (existsSync(staticSrc)) {
    await cp(staticSrc, path.join(DIST, '.next', 'static'), { recursive: true });
  }
  const publicSrc = path.join(FRONTEND, 'public');
  if (existsSync(publicSrc)) {
    await cp(publicSrc, path.join(DIST, 'public'), { recursive: true });
  }

  /* 3) 后端与共享契约（保持 backend/ shared/ 相对结构，导入路径无需改写） */
  await copyDir(path.join(ROOT, 'backend'), path.join(DIST, 'backend'));
  await copyDir(path.join(ROOT, 'shared'), path.join(DIST, 'shared'));

  /* 4) 单端口入口 */
  await cp(path.join(FRONTEND, 'server.mjs'), path.join(DIST, 'server.mjs'));

  /* 4.1) 配置文件降级为 .mjs
   * next.config.ts 在运行时需要 Next 自带的 webpack 编译器（loadWebpackHook）来加载，
   * 但 standalone 的 next/dist/compiled/ 已剔除 webpack，生产启动会直接
   * MODULE_NOT_FOUND: 'next/dist/compiled/webpack/webpack-lib'。
   * 这里写出等价的 ESM 配置，让运行时零编译依赖。
   * 注意：此内容必须与 frontend/next.config.ts 保持一致。 */
  await writeFile(
    path.join(DIST, 'next.config.mjs'),
    `/**
 * 单端口部署单元的 Next 配置（由 build-app.mjs 依据 frontend/next.config.ts 生成）。
 * 这里刻意使用 .mjs 而非 .ts：standalone 运行时的 next/dist/compiled/ 不含 webpack，
 * 加载 TS 配置会抛 MODULE_NOT_FOUND。
 */
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
`,
    'utf8',
  );
  console.log('[build-app]    已生成 next.config.mjs（运行时免 TS 编译链）');

  /* 4.2) 补齐 Next 运行时缺失的编译期别名目标
   * standalone 会裁掉 next/dist/compiled/ 下仅构建期使用的目录（webpack、@babel）。
   * 但 next/dist/server/config-utils.js 的 loadWebpackHook() 在启动时会
   * 无条件 require.resolve('next/dist/compiled/webpack/webpack-lib')，
   * 裁剪后直接 MODULE_NOT_FOUND，服务起不来。
   * 这里从完整版 next 补齐这两个目录（约 3.7 MB），保证运行时启动链路完整。 */
  const COMPILED = path.join(DIST, 'node_modules', 'next', 'dist', 'compiled');
  const FULL_COMPILED = path.join(FRONTEND, 'node_modules', 'next', 'dist', 'compiled');
  for (const name of ['webpack', '@babel']) {
    const src = path.join(FULL_COMPILED, name);
    const dest = path.join(COMPILED, name);
    if (existsSync(src) && !existsSync(dest)) {
      await mkdir(path.dirname(dest), { recursive: true });
      await cp(src, dest, { recursive: true });
      console.log(`[build-app]    已补齐运行时依赖: dist/compiled/${name}`);
    }
  }

  /* 4.3) 补齐 standalone 缺失的运行时依赖
   * standalone 只收录 Next 自身构建时用到的包，tsx（TS 运行器）与后端依赖
   * bcryptjs / jose 都不在其中，直接启动会 MODULE_NOT_FOUND。
   * 这里优先从仓库已有的 node_modules 拷贝（零网络、零 lock 改写），
   * 避免在部署单元内执行 npm install —— 那会把裁剪版 next 覆盖成完整包。 */
  const NEEDED = [
    'tsx',
    'esbuild', // tsx 的运行依赖
    '@esbuild',
    'bcryptjs',
    'jose',
    'dequal', // swr 的运行依赖
  ];
  const CANDIDATE_ROOTS = [
    path.join(ROOT, 'node_modules'),
    path.join(FRONTEND, 'node_modules'),
  ];
  for (const name of NEEDED) {
    const dest = path.join(DIST, 'node_modules', name);
    if (existsSync(dest)) continue;
    const src = CANDIDATE_ROOTS.map((r) => path.join(r, name)).find(existsSync);
    if (!src) {
      console.warn(`[build-app]    ⚠ 未找到依赖 ${name}，部署时需手工补齐`);
      continue;
    }
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(src, dest, { recursive: true });
  }
  console.log('[build-app]    已补齐运行时依赖（tsx / bcryptjs / jose 等）');

  /* 5) 合并 package.json */
  const fe = JSON.parse(await readFile(path.join(FRONTEND, 'package.json'), 'utf8'));
  const root = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));

  const merged = {
    name: 'agentic-os-workbench-app',
    version: root.version || '0.1.0',
    private: true,
    description: 'Agentic OS 自动化开发工作台 · 单端口自包含部署单元',
    scripts: {
      // 必须显式带 NODE_ENV=production：server.mjs 用它决定走构建产物还是 dev 模式，
      // 而 dev 模式要求存在真实的 app/ 目录 —— standalone 里没有，会直接启动失败。
      start: 'NODE_ENV=production node --import tsx/esm server.mjs',
      dev: 'NODE_ENV=development node --import tsx/esm server.mjs',
    },
    dependencies: {
      ...(fe.dependencies || {}),
      ...(root.dependencies || {}),
      // tsx 从 devDependencies 提升：生产启动需要它编译 backend/*.ts
      tsx: root.devDependencies?.tsx || '^4.23.15',
    },
    engines: fe.engines || root.engines || { node: '>=20' },
  };
  await writeFile(path.join(DIST, 'package.json'), JSON.stringify(merged, null, 2) + '\n', 'utf8');

  /* 6) 环境变量模板 */
  await writeFile(
    path.join(DIST, '.env.example'),
    [
      '# 单端口自包含部署单元 · 环境变量',
      '# 平台通常会注入 PORT，无需手工设置。',
      '',
      '# 必填：JWT 签名密钥（≥32 位随机串）。缺失时生产环境所有鉴权接口返回 500 SERVER_MISCONFIG。',
      '# 生成：node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
      'JWT_SECRET=',
      '',
      '# 存储：file = 本地 JSON 文件（单机自包含）；留空则自动选择 KV/Blob',
      'LOCAL_STORE=file',
      'LOCAL_STORE_PATH=.data/store.json',
      '',
      '# AI：未配置 Gateway 时设为 1 走本地模拟流，便于离线演示',
      'LOCAL_AI_MOCK=1',
      'AI_GATEWAY_API_KEY=',
      'AI_GATEWAY_BASE_URL=',
      'AI_GATEWAY_MODEL=',
      '',
      '# 监听（默认 3737 / 0.0.0.0）',
      'PORT=3737',
      'HOST=0.0.0.0',
      '',
    ].join('\n'),
    'utf8',
  );

  await writeFile(
    path.join(DIST, '.gitignore'),
    'node_modules/\n.next/\n.data/\n.env\n.env.local\n',
    'utf8',
  );

  /* 7) 生成运行时 .env（含随机 JWT_SECRET）——已存在则不覆盖，避免每次构建换密钥导致旧登录态失效 */
  const envFile = path.join(DIST, '.env');
  if (!existsSync(envFile)) {
    const secret = randomBytes(32).toString('base64url');
    await writeFile(
      envFile,
      [
        '# 单端口部署单元 · 运行时环境变量',
        '# 由 scripts/build-app.mjs 生成，已被 .gitignore 排除，不入库。',
        '# server.mjs 启动时自动加载；真实环境变量优先级高于本文件。',
        '',
        'PORT=3737',
        'HOST=0.0.0.0',
        '',
        '# 鉴权签名密钥（生产必填，缺失时鉴权接口返回 500 SERVER_MISCONFIG）',
        `JWT_SECRET=${secret}`,
        '',
        '# 存储：file = 本地 JSON（单机自包含）',
        'LOCAL_STORE=file',
        'LOCAL_STORE_PATH=.data/store.json',
        '',
        '# AI：未配置 Gateway 时走本地模拟流',
        'LOCAL_AI_MOCK=1',
        'AI_GATEWAY_API_KEY=',
        'AI_GATEWAY_BASE_URL=',
        'AI_GATEWAY_MODEL=',
        '',
      ].join('\n'),
      'utf8',
    );
    console.log('[build-app]    已生成 .env（含随机 JWT_SECRET）');
  } else {
    console.log('[build-app]    .env 已存在，保留原密钥');
  }

  console.log('\n[build-app] ✅ 单端口部署单元已生成:', DIST);
  console.log('  · 前端依赖:', Object.keys(fe.dependencies || {}).join(', '));
  console.log('  · 后端依赖:', Object.keys(root.dependencies || {}).join(', '));
  console.log('\n下一步：');
  console.log('  cd app-dist');
  console.log('  JWT_SECRET=<32位随机串> npm start      # 默认监听 0.0.0.0:3737');
  console.log('  （start 已内置 NODE_ENV=production，依赖已自包含，无需 npm install）');
  console.log('\n⚠️  切勿在 app-dist 内执行裸 npm install：');
  console.log('    它会把 standalone 的裁剪版 next 覆盖成完整包，导致启动报');
  console.log('    "Couldn\'t find any pages or app directory"。');
  console.log('    如需新增依赖，请改 scripts/build-app.mjs 的 NEEDED 列表后重新构建。');
}

main().catch((err) => {
  console.error('[build-app] ❌ 失败:', err.message);
  process.exit(1);
});
