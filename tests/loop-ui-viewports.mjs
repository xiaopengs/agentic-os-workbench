/**
 * M2 前端接线 · 四视口 UI 验证
 *
 * 覆盖 375 / 768 / 1440 / 1920 四种视口 × 4 个页面（总览 / 规则 / 插件 / 设置）：
 *   ① 横向溢出 = 0（document.scrollWidth ≤ innerWidth）
 *   ② 超大图标 = 0（svg.ic 回落成 300×150 黑块的典型 bug）
 *   ③ 页面运行时错误 = 0（pageerror + console.error，排除资源 401/404）
 *   ④ 总览展示真实内核数据（KPI 数值来自 /loop/state、事实日志、最近轮次）
 *
 * 用法：node tests/loop-ui-viewports.mjs [baseURL]
 *   默认 http://127.0.0.1:3737
 */
import { chromium } from 'playwright';

const BASE = (process.argv[2] || 'http://127.0.0.1:3737').replace(/\/+$/, '');
const VIEWPORTS = [
  { w: 375, h: 812, name: '375 手机' },
  { w: 768, h: 1024, name: '768 平板' },
  { w: 1440, h: 900, name: '1440 桌面' },
  { w: 1920, h: 1080, name: '1920 宽屏' },
];
const PAGES = [
  { path: '/', name: '总览' },
  { path: '/workflows', name: '规则' },
  { path: '/skills', name: '插件' },
  { path: '/settings', name: '设置' },
];

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++; else failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch({
  executablePath: '/opt/google/chrome/chrome',
  chromiumSandbox: false,
});

try {
  /* ── 注册 + 登录（复用浏览器 context 的 cookie 会话）── */
  const email = `m2_${Date.now()}@test.local`;
  const password = 'Test123456';
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const regBody = await reg.json().catch(() => ({}));
  check('注册测试账号', reg.status === 200 || reg.status === 201, `HTTP ${reg.status}`);
  const token = regBody?.data?.token;

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.href.includes('/login'), { timeout: 15000 }).catch(() => {});
  check('登录后进入工作台', !page.url().includes('/login'), page.url());

  // 触发懒播种 + 发一条事件命中规则（产生轮次，让 Recent Runs 有真实数据）
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const ev = await fetch(`${BASE}/api/loop/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ id: 'ui-issue-1', source: 'github', type: 'issues.opened', subject: 'repo#1', summary: 'UI 验证事件' }),
  });
  const evBody = await ev.json().catch(() => ({}));
  check('接入事件命中规则派活', ev.status === 201 && (evBody?.data?.routed?.length ?? 0) > 0,
    `routed=${JSON.stringify(evBody?.data?.routed ?? evBody?.error)}`);

  /* ── 四视口逐页验证 ── */
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    for (const p of PAGES) {
      const errors = [];
      const onPageErr = (e) => errors.push('pageerror: ' + String(e));
      const onConsole = (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        if (/Failed to load resource/i.test(t)) return; // 401/404 业务响应不计 JS 错误
        errors.push('console: ' + t);
      };
      page.on('pageerror', onPageErr);
      page.on('console', onConsole);

      await page.goto(`${BASE}${p.path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(700); // 等 SWR 拉数据 + 布局稳定

      const metrics = await page.evaluate(() => {
        const de = document.documentElement;
        const overflow = Math.max(0, de.scrollWidth - window.innerWidth);
        // 超大图标：.ic 或任意 svg 的渲染宽高 > 80px 视为回落黑块
        const hugeIcons = [...document.querySelectorAll('svg')].filter((s) => {
          const r = s.getBoundingClientRect();
          return r.width > 80 || r.height > 80;
        }).length;
        return { overflow, hugeIcons, scrollWidth: de.scrollWidth, innerWidth: window.innerWidth };
      });

      page.off('pageerror', onPageErr);
      page.off('console', onConsole);

      const tag = `${vp.name} · ${p.name} ${p.path}`;
      check(`${tag} 横向溢出=0`, metrics.overflow <= 2,
        `scrollW=${metrics.scrollWidth} innerW=${metrics.innerWidth} 溢出=${metrics.overflow}`);
      check(`${tag} 超大图标=0`, metrics.hugeIcons === 0, `命中 ${metrics.hugeIcons} 个`);
      check(`${tag} 运行时错误=0`, errors.length === 0, errors.slice(0, 2).join(' | '));
    }
  }

  /* ── 总览真实内核数据（1440 视口）── */
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const overview = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      hasKpiRules: text.includes('活跃规则'),
      hasKpiPlugins: text.includes('已登记插件'),
      hasFactLog: text.includes('事实日志'),
      hasRecentRuns: text.includes('Recent Runs'),
      kpiNums: [...document.querySelectorAll('.kpi-num')].map((e) => (e.textContent || '').trim()),
      traceRows: document.querySelectorAll('.trace-row').length,
      wfCards: document.querySelectorAll('.wf-card').length,
      todayBlock: text.includes('今天要处理'),
    };
  });
  check('总览 KPI 显示「活跃规则 / 已登记插件」', overview.hasKpiRules && overview.hasKpiPlugins);
  check('总览 KPI 数值来自内核且 > 0', overview.kpiNums.length === 2 && overview.kpiNums.every((n) => /^\d+$/.test(n) && Number(n) > 0),
    `kpi=${JSON.stringify(overview.kpiNums)}`);
  check('总览「今天要处理」块存在', overview.todayBlock);
  check('LiveTrace 显示真实事实日志（≥1 行）', overview.hasFactLog && overview.traceRows >= 1,
    `trace-rows=${overview.traceRows}`);
  check('Recent Runs 显示真实轮次（≥1 卡）', overview.hasRecentRuns && overview.wfCards >= 1,
    `wf-cards=${overview.wfCards}`);

  await ctx.close();
} finally {
  await browser.close();
}

console.log(`\n========================================================`);
console.log(`结果：${passed} 通过 / ${failed} 失败`);
console.log(`========================================================`);
if (failed > 0) process.exitCode = 1;
