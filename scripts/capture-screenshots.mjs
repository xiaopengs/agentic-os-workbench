#!/usr/bin/env node
/**
 * 截取 README 用页面截图
 *
 *   node scripts/capture-screenshots.mjs [前端地址] [后端地址]
 *
 * 前置：本地服务已启动（node scripts/start-local.mjs）
 * 产出：docs/screenshots/ 下的 PNG（首屏视口，1440×900）
 *
 * 注意：ctx.request 与浏览器上下文共享 Cookie，注册即登录。
 *       登录页必须用独立干净上下文截取。
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const BASE = process.argv[2] || 'http://127.0.0.1:3737';
const API = String(process.argv[3] || BASE).replace(/\/api\/?$/, '').replace(/\/+$/, '');

const email = `shot_${Date.now()}@demo.local`;
const password = 'Demo123456';

const browser = await chromium.launch({
  executablePath: '/opt/google/chrome/chrome',
  chromiumSandbox: false,
});

/* ① 登录页（干净上下文，未登录） */
const anonCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const anonPage = await anonCtx.newPage();
await anonPage.goto(`${BASE}/login`, { waitUntil: 'networkidle' }).catch(() => {});
await anonPage.waitForTimeout(1500);
await anonPage.screenshot({ path: path.join(OUT, 'login.png') });
console.log('· login.png');
await anonCtx.close();

/* ② 已登录页面 */
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const reg = await ctx.request.post(`${API}/api/auth/register`, {
  data: { email, password, name: '演示账号' },
});
if (!reg.ok() && reg.status() !== 409) {
  console.error('注册演示账号失败:', reg.status(), await reg.text());
  process.exit(1);
}

const shots = [
  ['/', 'home-dashboard.png', 2800],
  ['/workflows', 'workflows.png', 1800],
  ['/skills', 'skills.png', 1500],
  ['/contracts', 'contracts.png', 1500],
  ['/devices', 'devices.png', 1500],
];

for (const [route, file, wait] of shots) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(wait);
  await page.screenshot({ path: path.join(OUT, file) });
  console.log('·', file, `(${route})`);
}

/* AI Copilot：点击「生成 Skill」发起对话，等流式渲染后截图 */
try {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  const btn = page.getByText('生成 Skill', { exact: false }).first();
  if (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(6500);
    await page.screenshot({ path: path.join(OUT, 'ai-copilot.png') });
    console.log('· ai-copilot.png');
  } else {
    console.warn('· ai-copilot.png 跳过：未找到入口按钮');
  }
} catch (e) {
  console.warn('· ai-copilot.png 跳过:', e.message.split('\n')[0]);
}

await browser.close();
console.log('\n截图输出目录:', OUT);