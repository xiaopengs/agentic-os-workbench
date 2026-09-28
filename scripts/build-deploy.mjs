#!/usr/bin/env node
/**
 * 部署单元构建脚本（方案 A：同仓库逻辑分离 + 统一部署）
 *
 * 源码态（开发时关注点分离）：
 *   frontend/          Next.js 16 前端应用
 *   backend/           后端业务实现（Cloud Functions 逻辑）
 *   shared/            前后端共享契约
 *   cloud-functions/   平台函数入口（薄转发）
 *
 * 部署态（平台要求 cloud-functions/ 与依赖声明必须位于部署单元根目录）：
 *   dist/  ← 本脚本生成的自包含部署单元
 *     ├── app/ components/ lib/ styles/   (前端源码)
 *     ├── next.config.ts  package.json    (合并后的依赖)
 *     ├── cloud-functions/api/[[default]].ts
 *     ├── backend/   shared/
 *
 * 相对路径一致性：cloud-functions/api/[[default]].ts 内 `../../backend/...`
 * 在 dist/ 下解析为 dist/backend/...，与源码态一致，无需改写。
 *
 * 用法：node scripts/build-deploy.mjs
 */
import { cp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const EXCLUDE = new Set(['node_modules', '.next', 'dist', '.git', 'coverage']);

async function copyDir(src, dest) {
  await cp(src, dest, {
    recursive: true,
    filter: (p) => !EXCLUDE.has(path.basename(p)),
  });
}

async function main() {
  console.log('[build] 清理旧的部署单元 …');
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  // 1) 前端源码 → dist 根目录（Next.js 要求 app/、next.config 位于项目根）
  const frontend = path.join(ROOT, 'frontend');
  if (!existsSync(frontend)) throw new Error('缺少 frontend/ 目录');
  console.log('[build] 复制 frontend/ → dist/');
  for (const entry of ['app', 'components', 'lib', 'styles', 'public']) {
    const src = path.join(frontend, entry);
    if (existsSync(src)) await copyDir(src, path.join(DIST, entry));
  }
  for (const f of [
    'next.config.ts',
    'next.config.js',
    'tsconfig.json',
    'postcss.config.mjs',
    'tailwind.config.ts',
    '.env.example',
  ]) {
    const src = path.join(frontend, f);
    if (existsSync(src)) await cp(src, path.join(DIST, f));
  }

  // 2) 后端与共享契约（保持相对路径不变）
  console.log('[build] 复制 backend/ shared/ cloud-functions/');
  await copyDir(path.join(ROOT, 'backend'), path.join(DIST, 'backend'));
  await copyDir(path.join(ROOT, 'shared'), path.join(DIST, 'shared'));
  await copyDir(path.join(ROOT, 'cloud-functions'), path.join(DIST, 'cloud-functions'));

  // 3) 合并 package.json：前端依赖 + 后端依赖
  const fe = JSON.parse(await readFile(path.join(frontend, 'package.json'), 'utf8'));
  const root = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const merged = {
    name: 'agentic-os-workbench',
    version: fe.version || '0.1.0',
    private: true,
    description: 'Agentic OS 自动化开发工作台 · 部署单元（前端 + Cloud Functions 后端）',
    scripts: {
      ...(fe.scripts || {}),
      'typecheck:backend': 'tsc --noEmit -p backend/tsconfig.json',
      'build:deploy': 'node scripts/build-deploy.mjs',
    },
    dependencies: { ...(fe.dependencies || {}), ...(root.dependencies || {}) },
    devDependencies: { ...(fe.devDependencies || {}), ...(root.devDependencies || {}) },
    engines: fe.engines || root.engines || { node: '>=20' },
  };
  await writeFile(path.join(DIST, 'package.json'), JSON.stringify(merged, null, 2) + '\n', 'utf8');

  // 4) 部署单元 .gitignore
  await writeFile(
    path.join(DIST, '.gitignore'),
    'node_modules/\n.next/\n.env\n.env.local\n.edgeone/\n',
    'utf8',
  );

  console.log('\n[build] ✅ 部署单元已生成:', DIST);
  console.log('  · 前端依赖:', Object.keys(fe.dependencies || {}).join(', '));
  console.log('  · 后端依赖:', Object.keys(root.dependencies || {}).join(', '));
  console.log('\n下一步：');
  console.log('  cd dist && npm install');
  console.log('  edgeone makers dev --name <项目名> --skip-env-sync   # 本地预览');
  console.log('  edgeone makers deploy -n <项目名> --json            # 部署上线');
}

main().catch((err) => {
  console.error('[build] ❌ 失败:', err.message);
  process.exit(1);
});
