/**
 * M2/M3/M4 前端接线 · 四视口 UI 验证
 *
 * 覆盖 375 / 768 / 1440 / 1920 四种视口 × 4 个页面（总览 / 规则 / 插件 / 设置）：
 *   ① 横向溢出 = 0（document.scrollWidth ≤ innerWidth）
 *   ② 超大图标 = 0（svg.ic 回落成 300×150 黑块的典型 bug）
 *   ③ 页面运行时错误 = 0（pageerror + console.error，排除资源 401/404）
 *   ④ 总览展示真实内核数据（KPI 数值来自 /loop/state、事实日志、最近轮次）
 *   ⑤ M3 审批台：各视口卡片 + 选项按钮触控区 + 拍板续跑实操
 *   ⑥ M4 新 UI：规则页预演面板 / 插件页启停按钮各视口存在且不溢出；
 *      1440 视口实操「溯源 Modal / emit 预演 / 插件停用启用」
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

  // 造一张 open 的 ask 卡片：让四视口都能验证「有卡片」的审批台布局
  const apiPost = async (path, body) => fetch(`${BASE}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).then((r) => r.json().catch(() => ({})));
  const stForRun = await fetch(`${BASE}/api/loop/state`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).then((r) => r.json().catch(() => ({})));
  const queued = (stForRun?.data?.runs ?? []).filter((r) => r.state === 'queued').sort((a, b) => b.seq - a.seq)[0];
  if (queued) {
    const rec = await apiPost(`/loop/runs/${queued.id}/result`, {
      outcome: 'done', summary: 'UI 验证：Agent 请求拍板',
      ask: [{ title: '是否合并这条修复？', text: '等待你确认下一步。', options: ['合并到 main', '先放着', '关闭'], recommend: 0 }],
    });
    check('M3 造出一张待拍板卡片', (rec?.data?.cards?.length ?? 0) === 1,
      `cards=${JSON.stringify(rec?.data?.cards ?? [])}`);
  } else {
    check('M3 造出一张待拍板卡片', false, '未找到 queued run');
  }

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

      // M3 审批台：总览页各视口都要有卡片 + 选项按钮触控区达标、不溢出
      if (p.path === '/') {
        const approval = await page.evaluate(() => {
          const root = document.getElementById('approval');
          if (!root) return { exists: false };
          const btns = [...root.querySelectorAll('button')];
          const cardBox = root.getBoundingClientRect();
          const optBtns = btns.filter((b) => /合并|先放|关闭|演示/.test(b.textContent || ''));
          return {
            exists: true,
            hasTitle: (root.textContent || '').includes('审批卡片台'),
            cardCount: root.querySelectorAll('.wf-card').length,
            optCount: optBtns.length,
            minOptHeight: optBtns.length ? Math.min(...optBtns.map((b) => b.getBoundingClientRect().height)) : 0,
            withinViewport: cardBox.right <= window.innerWidth + 2,
          };
        });
        check(`${tag} 审批台存在且含卡片`, approval.exists && approval.hasTitle && approval.cardCount >= 1,
          `exists=${approval.exists} cards=${approval.cardCount}`);
        check(`${tag} 审批台选项按钮 ≥3 且触控区 ≥44px`,
          approval.optCount >= 3 && approval.minOptHeight >= 44,
          `opt=${approval.optCount} minH=${approval.minOptHeight}`);
        check(`${tag} 审批台不溢出视口`, approval.withinViewport === true);
      }

      // M4 规则页：预演面板存在 + 表单 + 按钮触控区达标、不溢出
      if (p.path === '/workflows') {
        const preview = await page.evaluate(() => {
          const cards = [...document.querySelectorAll('.card')];
          const root = cards.find((c) => (c.textContent || '').includes('规则预演'));
          if (!root) return { exists: false };
          const form = root.querySelector('form.wf-form');
          const btns = [...root.querySelectorAll('button')];
          return {
            exists: true,
            hasForm: !!form,
            btnCount: btns.length,
            minBtnHeight: btns.length ? Math.min(...btns.map((b) => b.getBoundingClientRect().height)) : 0,
            withinViewport: root.getBoundingClientRect().right <= window.innerWidth + 2,
          };
        });
        check(`${tag} 规则预演面板存在且含表单`, preview.exists && preview.hasForm,
          `exists=${preview.exists} form=${preview.hasForm}`);
        check(`${tag} 规则预演按钮 ≥2 且触控区 ≥36px`,
          preview.btnCount >= 2 && preview.minBtnHeight >= 36,
          `btn=${preview.btnCount} minH=${preview.minBtnHeight}`);
        check(`${tag} 规则预演面板不溢出视口`, preview.withinViewport === true);
      }

      // M4 插件页：注册表 +「登记插件」按钮 + 启停按钮，各视口存在且不溢出
      if (p.path === '/skills') {
        const plugins = await page.evaluate(() => {
          const text = document.body.innerText;
          const regBtn = [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('登记插件'));
          const toggleBtns = [...document.querySelectorAll('.icon-btn')].filter((b) =>
            /停用|启用/.test(b.getAttribute('aria-label') || b.getAttribute('title') || ''));
          const rows = document.querySelectorAll('.tbl tbody tr').length;
          return { hasRegBtn: regBtn, toggleCount: toggleBtns.length, rows, hasTable: text.includes('插件注册表') };
        });
        check(`${tag} 插件页含注册表与登记按钮`, plugins.hasTable && plugins.hasRegBtn,
          `table=${plugins.hasTable} regBtn=${plugins.hasRegBtn}`);
        check(`${tag} 插件页启停按钮 ≥1（4 条规则下至少 7 插件）`, plugins.toggleCount >= 1,
          `toggle=${plugins.toggleCount} rows=${plugins.rows}`);
      }
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

  /* ── M3 实操闭环：点选项拍板 → 续跑（1440 视口）── */
  const beforeAnswer = await page.evaluate(() => ({
    openBadges: document.querySelectorAll('#approval .wf-status.running').length,
    hasPendingTip: document.body.innerText.includes('张卡片待拍板'),
  }));
  check('M3 拍板前有「待拍板」状态卡片', beforeAnswer.openBadges >= 1,
    `running-badges=${beforeAnswer.openBadges}`);
  const optBtn = page.locator('#approval button', { hasText: '合并到 main' }).first();
  if (await optBtn.count()) {
    await optBtn.click();
    await page.waitForTimeout(1200); // 等 answer → revalidateLoop → 各 SWR 重渲染
  }
  const afterAnswer = await page.evaluate(() => {
    const root = document.getElementById('approval');
    const text = root ? (root.innerText || root.textContent || '') : '';
    return {
      decided: text.includes('已回答') || text.includes('已结案'),
      resumed: text.includes('已续跑'),
      openBadges: document.querySelectorAll('#approval .wf-status.running').length,
      factLogHasAnswer: document.body.innerText.includes('卡片回答'),
    };
  });
  check('M3 拍板后卡片转「已回答」', afterAnswer.decided, `decided=${afterAnswer.decided}`);
  check('M3 拍板后出现续跑轮次标记', afterAnswer.resumed, `resumed=${afterAnswer.resumed}`);
  check('M3 拍板后「待拍板」状态归零', afterAnswer.openBadges === 0,
    `running-badges=${afterAnswer.openBadges}`);
  check('M3 事实日志出现「卡片回答」', afterAnswer.factLogHasAnswer);

  /* ── M4 实操 A：总览「溯源」按钮 → Modal 事实时间线（1440 视口）── */
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const whyBtn = page.locator('button[aria-label^="溯源轮次"]').first();
  const whyBtnCount = await whyBtn.count();
  check('M4 总览 Recent Runs 有「溯源」按钮', whyBtnCount >= 1, `count=${whyBtnCount}`);
  if (whyBtnCount) {
    await whyBtn.click();
    await page.waitForTimeout(900);
    const modal = await page.evaluate(() => {
      const box = document.querySelector('.modal-box');
      if (!box) return { open: false };
      return {
        open: true,
        hasTitle: (box.textContent || '').includes('溯源'),
        timelineRows: box.querySelectorAll('.trace-row').length,
        withinViewport: box.getBoundingClientRect().right <= window.innerWidth + 2,
      };
    });
    check('M4 点溯源打开 Modal 且含事实时间线（≥1 行）',
      modal.open && modal.hasTitle && modal.timelineRows >= 1,
      `open=${modal.open} rows=${modal.timelineRows}`);
    check('M4 溯源 Modal 不溢出视口', modal.withinViewport === true);
    // 关闭
    const closeBtn = page.locator('.modal-close').first();
    if (await closeBtn.count()) await closeBtn.click();
    await page.waitForTimeout(300);
  }

  /* ── M4 实操 B：规则页 emit 预演 → 命中结果 chip（1440 视口）── */
  await page.goto(`${BASE}/workflows`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  const previewSubmit = page.locator('button', { hasText: '预演这条事件' }).first();
  check('M4 规则页预演按钮存在', (await previewSubmit.count()) >= 1);
  if (await previewSubmit.count()) {
    await previewSubmit.click();
    await page.waitForTimeout(800);
    const emitResult = await page.evaluate(() => document.body.innerText.includes('命中') && /命中\s*\d+\s*条规则/.test(document.body.innerText));
    check('M4 emit 预演展示命中规则结果', emitResult);
  }

  /* ── M4 实操 C：插件页停用 → 已停用 chip → 启用恢复（1440 视口）── */
  await page.goto(`${BASE}/skills`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  const disableBtn = page.locator('button[aria-label^="停用插件"]').first();
  check('M4 插件页存在可停用按钮', (await disableBtn.count()) >= 1);
  if (await disableBtn.count()) {
    await disableBtn.click();
    await page.waitForTimeout(1000);
    const disabledChip = await page.evaluate(() => document.body.innerText.includes('已停用'));
    check('M4 停用后展示「已停用」状态', disabledChip);
    const enableBtn = page.locator('button[aria-label^="启用插件"]').first();
    check('M4 停用后出现「启用」按钮', (await enableBtn.count()) >= 1);
    if (await enableBtn.count()) {
      await enableBtn.click();
      await page.waitForTimeout(1000);
    }
  }

  await ctx.close();
} finally {
  await browser.close();
}

console.log(`\n========================================================`);
console.log(`结果：${passed} 通过 / ${failed} 失败`);
console.log(`========================================================`);
if (failed > 0) process.exitCode = 1;
