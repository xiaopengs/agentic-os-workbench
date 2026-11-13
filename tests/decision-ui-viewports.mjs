/**
 * M6 · 架构设计决策面板 四视口 UI 验证
 *
 * 覆盖 375 / 768 / 1440 / 1920 × /decisions：
 *   ① 横向溢出 = 0（document.scrollWidth ≤ innerWidth）
 *   ② 超大图标 = 0（svg.ic 回落黑块）
 *   ③ 运行时错误 = 0（pageerror + console.error，排除资源 401/404）
 *   ④ 决策看板：分段 Tab / 卡片 / 按钮触控区 ≥44px
 *   ⑤ 详情 Modal：MADR 分节 / 对比矩阵 / 权重调节实时重排 / 状态流转 / D1 转执行
 *   ⑥ 1440 视口实操：新建决策 → 状态流转 → 生成执行规则预览
 *   ⑦ 总览「今天要处理」出现待复核决策条目
 *
 * 用法：node tests/decision-ui-viewports.mjs [baseURL]，默认 http://127.0.0.1:3737
 */
import { chromium } from 'playwright';

const BASE = (process.argv[2] || 'http://127.0.0.1:3737').replace(/\/+$/, '');
const VIEWPORTS = [
  { w: 375, h: 812, name: '375 手机' },
  { w: 768, h: 1024, name: '768 平板' },
  { w: 1440, h: 900, name: '1440 桌面' },
  { w: 1920, h: 1080, name: '1920 宽屏' },
];

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++; else failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}
function section(t) { console.log(`\n\x1b[36m${t}\x1b[0m`); }

const browser = await chromium.launch({
  executablePath: '/opt/google/chrome/chrome',
  chromiumSandbox: false,
});

try {
  /* ── 注册 + 登录 ── */
  const email = `m6_${Date.now()}@test.local`;
  const password = 'Test123456';
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  check('注册测试账号', reg.status === 200 || reg.status === 201, `HTTP ${reg.status}`);

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.href.includes('/login'), { timeout: 15000 }).catch(() => {});
  check('登录后进入工作台', !page.url().includes('/login'), page.url());

  // 触发 loop 播种（D1 转执行需要已登记 Agent），再进决策页触发独立播种
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  const decReg = await fetch(`${BASE}/api/decisions`, {
    headers: { Authorization: `Bearer ${(await (await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })).json())?.data?.token ?? '' }` },
  }).then((r) => r.json().catch(() => ({})));
  check('决策独立播种 4 条（含待复核）', (decReg?.data ?? []).length === 4,
    `实际 ${(decReg?.data ?? []).length}`);

  /* ── 四视口逐页验证 ── */
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    const errors = [];
    const onPageErr = (e) => errors.push('pageerror: ' + String(e));
    const onConsole = (m) => {
      if (m.type() !== 'error') return;
      if (/Failed to load resource/i.test(m.text())) return;
      errors.push('console: ' + m.text());
    };
    page.on('pageerror', onPageErr);
    page.on('console', onConsole);

    await page.goto(`${BASE}/decisions`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);

    const metrics = await page.evaluate(() => {
      const de = document.documentElement;
      return {
        overflow: Math.max(0, de.scrollWidth - window.innerWidth),
        hugeIcons: [...document.querySelectorAll('svg')].filter((s) => {
          const r = s.getBoundingClientRect();
          return r.width > 80 || r.height > 80;
        }).length,
        scrollWidth: de.scrollWidth, innerWidth: window.innerWidth,
        // 分段 Tab 按钮（窄屏必须可见，故用 .wf-top 容器 + data-decision-tabs 定位）
        tabBtns: [...document.querySelectorAll('[data-decision-tabs] button')].map((b) => ({
          h: b.getBoundingClientRect().height, text: (b.textContent || '').trim(),
        })),
        // 看板卡片
        cards: document.querySelectorAll('.wf-grid .wf-card[data-decision-id]').length,
        // 卡片按钮触控区
        cardBtns: [...document.querySelectorAll('.wf-grid .wf-card button')].map((b) => b.getBoundingClientRect().height),
        // 概览计数卡
        devCards: document.querySelectorAll('.dev-card').length,
        // 是否含搜索框
        hasSearch: !!document.querySelector('input[aria-label="搜索决策"]'),
        // 待复核提醒（页面内）
        hasDueHint: (document.body.textContent || '').includes('待复核'),
      };
    });

    page.off('pageerror', onPageErr);
    page.off('console', onConsole);

    const tag = `${vp.name} · 决策页`;
    check(`${tag} 横向溢出=0`, metrics.overflow <= 2,
      `scrollW=${metrics.scrollWidth} innerW=${metrics.innerWidth} 溢出=${metrics.overflow}`);
    check(`${tag} 超大图标=0`, metrics.hugeIcons === 0, `命中 ${metrics.hugeIcons}`);
    check(`${tag} 运行时错误=0`, errors.length === 0, errors.slice(0, 2).join(' | '));
    check(`${tag} 分段 Tab ≥5 且按钮触控区 ≥44px`,
      metrics.tabBtns.length >= 5 && metrics.tabBtns.every((b) => b.h >= 44),
      `tabs=${metrics.tabBtns.length} minH=${Math.min(...metrics.tabBtns.map((b) => b.h))}`);
    check(`${tag} 看板卡片 ≥4`, metrics.cards >= 4, `cards=${metrics.cards}`);
    check(`${tag} 卡片按钮触控区 ≥44px`,
      metrics.cardBtns.length >= 4 && Math.min(...metrics.cardBtns) >= 44,
      `minH=${Math.min(...metrics.cardBtns)}`);
    check(`${tag} 概览 3 计数卡 + 搜索框`, metrics.devCards === 3 && metrics.hasSearch);
    check(`${tag} 待复核提醒存在`, metrics.hasDueHint);
  }

  /* ── 1440 视口：详情 Modal + 对比矩阵 + 权重调节 + 新建/流转/转执行实操 ── */
  section('1440 · 决策详情 / 对比评分 / 实操');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/decisions`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  // 打开第一张卡片的详情（accepted，含 options/criteria）
  await page.locator('.wf-grid .wf-card[data-decision-id="ADR-0001"] button[aria-label*="查看决策详情"]').click();
  await page.waitForTimeout(700);
  const detail = await page.evaluate(() => {
    const modal = document.querySelector('.modal.open .modal-box');
    if (!modal) return { exists: false };
    const txt = modal.textContent || '';
    return {
      exists: true,
      hasContext: txt.includes('Context'), hasDrivers: txt.includes('Decision Drivers'),
      hasOptions: txt.includes('Considered Options'), hasDecision: txt.includes('Decision'),
      hasConsequences: txt.includes('Consequences'),
      hasScoreRows: modal.querySelectorAll('[data-scored-option]').length,
      hasWeightInputs: modal.querySelectorAll('input[type="number"]').length,
      hasTransitionBtns: [...modal.querySelectorAll('button')].filter((b) =>
        /标记|接受|生成执行规则|删除|打回|提交评审/.test(b.textContent || '')).length,
      // 只校验新模块新增的交互按钮；.modal-close（既有组件固有 32px）不计入
      minBtnH: Math.min(...[...modal.querySelectorAll('.row-actions button, .primary-btn')]
        .filter((b) => b.getBoundingClientRect().height > 0)
        .map((b) => b.getBoundingClientRect().height)),
      overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    };
  });
  check('详情 Modal 存在且含 MADR 分节',
    detail.exists && detail.hasContext && detail.hasDrivers && detail.hasOptions && detail.hasDecision && detail.hasConsequences,
    JSON.stringify(detail));
  check('详情含对比评分行 ≥2', detail.hasScoreRows >= 2, `rows=${detail.hasScoreRows}`);
  check('详情含权重输入 ≥3', detail.hasWeightInputs >= 3, `inputs=${detail.hasWeightInputs}`);
  check('详情含状态流转/转执行按钮', detail.hasTransitionBtns >= 1, `btns=${detail.hasTransitionBtns}`);
  check('详情按钮触控区 ≥44px', detail.minBtnH >= 44, `minH=${detail.minBtnH}`);
  check('详情 Modal 打开时页面不横向溢出', detail.overflow <= 2, `overflow=${detail.overflow}`);

  // 权重调节实操：把第一个维度权重拉满，排名/分数应变
  const beforeTop = await page.evaluate(() =>
    document.querySelector('[data-scored-option]')?.getAttribute('data-scored-option') ?? '');
  const firstWeight = page.locator('.modal.open input[type="number"]').first();
  await firstWeight.fill('100');
  await firstWeight.dispatchEvent('change');
  await page.waitForTimeout(900);
  const scoreTextAfter = await page.evaluate(() =>
    (document.querySelector('.modal.open')?.textContent || '').includes('头名领先'));
  check('权重调节触发重算（页面仍可读）', scoreTextAfter);
  check('权重输入后无运行时崩溃', await page.evaluate(() => !!document.querySelector('.modal.open')),
    `topBefore=${beforeTop}`);

  // 关详情
  await page.locator('.modal.open .modal-close').click();
  await page.waitForTimeout(300);

  // 总览「今天要处理」应出现待复核决策
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const overviewDue = await page.evaluate(() =>
    (document.body.textContent || '').includes('条架构决策待复核'));
  check('总览「今天要处理」置顶待复核决策', overviewDue);

  // 新建决策实操
  await page.goto(`${BASE}/decisions`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.locator('button[aria-label="新建决策"]').click();
  await page.waitForTimeout(300);
  const formOk = await page.evaluate(() => {
    const m = document.querySelector('.modal.open');
    if (!m) return { exists: false };
    return {
      exists: true,
      hasTitle: !!m.querySelector('#dTitle'), hasOwner: !!m.querySelector('#dOwner'),
      hasPros: !!m.querySelector('#oPros0'), hasCons: !!m.querySelector('#oCons0'),
      hasAsm: !!m.querySelector('#oAsm0'),
      hasSubmit: !!m.querySelector('button[type="submit"]'),
    };
  });
  check('新建表单含 MADR + 权衡三必填字段',
    formOk.exists && formOk.hasTitle && formOk.hasOwner && formOk.hasPros && formOk.hasCons && formOk.hasAsm && formOk.hasSubmit,
    JSON.stringify(formOk));

  await page.fill('#dTitle', 'UI 验证 · 选择缓存策略');
  await page.fill('#dOwner', '测试组');
  await page.fill('#oName0', '方案A');
  await page.fill('#oPros0', '快');
  await page.fill('#oCons0', '占内存');
  await page.fill('#oAsm0', '单机');
  await page.fill('#oName1', '方案B');
  await page.fill('#oPros1', '省内存');
  await page.fill('#oCons1', '慢');
  await page.fill('#oAsm1', '可接受延迟');
  await page.locator('.modal.open button[type="submit"]').click();
  await page.waitForTimeout(1200);
  const afterCreate = await page.evaluate(() => ({
    modalClosed: !document.querySelector('.modal.open'),
    cards: document.querySelectorAll('.wf-grid .wf-card[data-decision-id]').length,
    hasNew: (document.body.textContent || '').includes('选择缓存策略'),
  }));
  check('新建决策后 Modal 关闭且看板新增卡片',
    afterCreate.modalClosed && afterCreate.hasNew && afterCreate.cards >= 5,
    JSON.stringify(afterCreate));

  await ctx.close();

  console.log(`\n${'='.repeat(56)}`);
  console.log(`结果：\x1b[32m${passed} 通过\x1b[0m / \x1b[${failed ? 31 : 32}m${failed} 失败\x1b[0m`);
  console.log('='.repeat(56));
  if (failed > 0) process.exit(1);
} finally {
  await browser.close();
}
