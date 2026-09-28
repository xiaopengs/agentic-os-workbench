#!/usr/bin/env node
/**
 * 本地最小化部署 · 一条命令启动完整工作台（无需 EdgeOne、无需登录、无需联网）
 *
 *   node scripts/start-local.mjs
 *
 * 启动两个进程：
 *   ① 后端 API    http://127.0.0.1:8787/api   （Node 标准库 HTTP + 本地 JSON 文件持久化）
 *   ② 前端应用    http://127.0.0.1:3000       （Next.js，API 指向 ①）
 *
 * 数据落在 ./.data/store.json，删掉即恢复初始状态。
 * 停止：Ctrl+C（两个子进程一并退出）
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = path.join(ROOT, 'frontend');

const API_PORT = process.env.API_PORT || '8787';
const WEB_PORT = process.env.WEB_PORT || '3000';
const API_BASE = `http://127.0.0.1:${API_PORT}/api`;

const children = [];

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

console.log('── Agentic OS 工作台 · 本地最小化部署 ──\n');
console.log(`后端 API : ${API_BASE}`);
console.log(`前端应用 : http://127.0.0.1:${WEB_PORT}`);
console.log(`数据文件 : ${path.join(ROOT, '.data/store.json')}\n`);

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