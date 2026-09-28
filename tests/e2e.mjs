/**
 * 端到端测试 · Agentic OS 工作台
 *
 * 覆盖全链路：注册 → 自动登录 → 会话保持 → 创建工作流 → 持久化校验
 *            → 配额统计 → Trace 写入 → 登出 → 越权访问拦截
 *
 * 用法：
 *   1) 先启动服务：cd dist && edgeone makers dev --name <项目> --skip-env-sync
 *   2) 运行测试：node tests/e2e.mjs [baseURL]
 *      默认 baseURL = http://127.0.0.1:8088
 */
import { chromium } from 'playwright';

/**
 * 参数：
 *   argv[2] = 前端地址（默认 http://127.0.0.1:8088）
 *   argv[3] = 后端地址（默认同前端；分离部署时传 http://127.0.0.1:8787）
 *
 * 说明：下面的用例路径已自带 /api 前缀，因此这里统一剥掉传入地址尾部的
 *       /api，避免写成 /api/api/xxx —— 两种写法都要能跑。
 */
const BASE = process.argv[2] || 'http://127.0.0.1:8088';
const API_ROOT = String(process.argv[3] || BASE).replace(/\/api\/?$/, '').replace(/\/+$/, '');
const results = [];
let failed = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function api(ctx, path, options = {}) {
  const r = await ctx.request.fetch(`${API_ROOT}${path}`, options);
  let body = null;
  try {
    body = await r.json();
  } catch {
    body = null;
  }
  return { status: r.status(), body };
}

const browser = await chromium.launch({
  executablePath: '/opt/google/chrome/chrome',
  chromiumSandbox: false, // root 环境必需
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const text = m.text();
  // 网络资源返回 401/404 是预期的业务响应（如未登录探测 /auth/me），
  // 属于 HTTP 状态而非 JS 异常，不计入 JS 错误统计。
  if (/Failed to load resource/i.test(text)) return;
  pageErrors.push('console: ' + text);
});

const email = `e2e_${Date.now()}@test.local`;
const password = 'Test123456';

try {
  /* ── 1. 未登录访问受保护页面应被拦截 ─────────────────────── */
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  check('未登录访问首页重定向到 /login', page.url().includes('/login'), page.url());

  /* ── 2. 未登录调用业务 API 应 401 ────────────────────────── */
  const anon = await api(ctx, '/api/workflows', { method: 'GET' });
  check('未登录调用 /api/workflows 返回 401', anon.status === 401, `实际 ${anon.status}`);

  /* ── 3. 注册 ────────────────────────────────────────────── */
  const reg = await api(ctx, '/api/auth/register', {
    method: 'POST',
    data: { email, password },
  });
  check('注册成功返回 200/201', [200, 201].includes(reg.status), `实际 ${reg.status}`);
  check('注册返回 ok 信封与 user', reg.body?.ok === true && !!reg.body?.data?.user);
  const token = reg.body?.data?.token;
  check('注册返回 token', !!token);

  /* ── 4. 弱密码应被拒绝 ──────────────────────────────────── */
  const weak = await api(ctx, '/api/auth/register', {
    method: 'POST',
    data: { email: `weak_${Date.now()}@test.local`, password: '123' },
  });
  check('弱密码注册被拒绝(400)', weak.status === 400, `实际 ${weak.status}`);
  check('弱密码错误码为 VALIDATION_ERROR', weak.body?.error?.code === 'VALIDATION_ERROR', weak.body?.error?.code);

  /* ── 5. 重复注册应冲突 ──────────────────────────────────── */
  const dup = await api(ctx, '/api/auth/register', {
    method: 'POST',
    data: { email, password },
  });
  check('重复注册返回 409', dup.status === 409, `实际 ${dup.status}`);

  /* ── 6. 登录后会话可用（走浏览器 Cookie） ────────────────── */
  // 注意：上面的注册走了 ctx.request，Set-Cookie 会写进共享的 ctx。
  // 若复用主 page 访问 /login，前端守卫会认为已登录并重定向到工作台，
  // 登录表单根本不会出现（dev 模式水合快、生产模式水合慢，表现不稳定）。
  // 因此这里用独立干净上下文，模拟“一台新设备来登录”。
  const loginCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const loginPage = await loginCtx.newPage();
    await loginPage.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await loginPage.fill('input[type="email"]', email);
    await loginPage.fill('input[type="password"]', password);
    await loginPage.click('button[type="submit"]');
    await loginPage.waitForTimeout(2500);
    check('登录后进入工作台（非 /login）', !loginPage.url().includes('/login'), loginPage.url());

    // 把登录态同步回主 ctx，供后续浏览器侧用例复用。
    const cookies = await loginCtx.cookies();
    if (cookies.length) await ctx.addCookies(cookies);
  } finally {
    await loginCtx.close();
  }

  /* ── 7. 创建工作流（真实持久化） ────────────────────────── */
  const wfName = `E2E 工作流 ${Date.now()}`;
  const created = await api(ctx, '/api/workflows', {
    method: 'POST',
    data: {
      name: wfName,
      category: '回归测试',
      description: '端到端测试创建',
      devices: 4,
      steps: 12,
      coverage: 88,
      duration: 30,
      status: 'queued',
      env: 'staging',
    },
  });
  check('创建工作流成功', created.body?.ok === true, JSON.stringify(created.body?.error || ''));
  const wfId = created.body?.data?.id;
  check('返回工作流 id', !!wfId);

  /* ── 8. 列表可查到新建工作流（持久化校验） ────────────────── */
  const list = await api(ctx, '/api/workflows', { method: 'GET' });
  const hit = list.body?.data?.find?.((w) => w.id === wfId);
  check('列表中能查到新建工作流（已持久化）', !!hit);

  /* ── 9. 更新工作流 ──────────────────────────────────────── */
  const patched = await api(ctx, `/api/workflows/${wfId}`, {
    method: 'PATCH',
    data: { status: 'running', coverage: 92 },
  });
  check('更新工作流成功', patched.body?.ok === true);
  check('更新后字段生效', patched.body?.data?.status === 'running', patched.body?.data?.status);

  /* ── 10. Trace 写入 ─────────────────────────────────────── */
  const trace = await api(ctx, '/api/traces', {
    method: 'POST',
    data: { kind: 'Agent', name: 'e2e.plan', cost: 120, status: 'Success', time: '00:00:03' },
  });
  check('写入 Trace 成功', trace.body?.ok === true);

  /* ── 11. 用量统计 ───────────────────────────────────────── */
  const usage = await api(ctx, '/api/usage', { method: 'GET' });
  check(
    '用量接口返回 runs/limit',
    typeof usage.body?.data?.runs === 'number' && typeof usage.body?.data?.limit === 'number',
    JSON.stringify(usage.body?.data),
  );

  /* ── 12. 审计日志 ───────────────────────────────────────── */
  const audit = await api(ctx, '/api/audit', { method: 'GET' });
  check('审计日志有记录', Array.isArray(audit.body?.data) && audit.body.data.length > 0);

  /* ── 13. 删除工作流 ─────────────────────────────────────── */
  const del = await api(ctx, `/api/workflows/${wfId}`, { method: 'DELETE' });
  check('删除工作流成功', del.body?.ok === true);
  const after = await api(ctx, '/api/workflows', { method: 'GET' });
  check(
    '删除后列表中不再出现',
    !after.body?.data?.find?.((w) => w.id === wfId),
  );

  /* ── 14. 无效 token 应被拒 ─────────────────────────────────── */
  // 必须用「干净上下文」：后端鉴权是 Cookie 优先、Bearer 兜底，
  // 若沿用已登录的 ctx 会命中有效 Cookie 而通过，测不出无效 token。
  const cleanCtx = await browser.newContext();
  const bad = await api(cleanCtx, '/api/workflows', {
    method: 'GET',
    headers: { Authorization: 'Bearer invalid.token.here' },
  });
  check('无效 token 返回 401', bad.status === 401, `实际 ${bad.status}`);
  await cleanCtx.close();

  /* ── 15. 登出后会话失效 ─────────────────────────────────── */
  await api(ctx, '/api/auth/logout', { method: 'POST' });
  const afterLogout = await api(ctx, '/api/workflows', { method: 'GET' });
  check('登出后业务接口返回 401', afterLogout.status === 401, `实际 ${afterLogout.status}`);

  /* ── 16. 运行时零 JS 错误 ───────────────────────────────── */
  check('页面运行无 JS 错误', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (err) {
  check('测试执行未抛异常', false, String(err).slice(0, 200));
} finally {
  await browser.close();
}

console.log('\n' + '─'.repeat(56));
console.log(`总计 ${results.length} 项，通过 ${results.length - failed} 项，失败 ${failed} 项`);
console.log('─'.repeat(56));
process.exit(failed === 0 ? 0 : 1);
