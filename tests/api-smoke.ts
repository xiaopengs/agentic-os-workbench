/**
 * 本地冒烟测试 · 后端全链路（不依赖 EdgeOne 平台）
 *
 * 原理：backend/lib/store.ts 的驱动解析规则是「若 globalThis[my_kv] 存在 get/put
 * 则用 KV 驱动」，因此这里注入一个内存 KV mock，即可让真实业务逻辑（鉴权、
 * 配额、审计、CRUD）完整跑通，无需平台环境、无需登录、无需网络。
 *
 * 用法：npx tsx tests/api-smoke.ts
 */
import { handleRequest } from '../backend/functions/router';

/* ── 内存 KV mock（实现平台 KV 的 get/put/delete/list 契约） ── */
class MockKV {
  private data = new Map<string, string>();

  async get(key: string, type?: string): Promise<any> {
    const v = this.data.get(key);
    if (v === undefined) return null;
    return type === 'json' ? JSON.parse(v) : v;
  }
  async put(key: string, value: string): Promise<void> {
    this.data.set(key, String(value));
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
  async list(opts: { prefix?: string; limit?: number; cursor?: string } = {}): Promise<any> {
    const keys = [...this.data.keys()]
      .filter((k) => !opts.prefix || k.startsWith(opts.prefix))
      .sort();
    const limit = opts.limit || 1000;
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const page = keys.slice(start, start + limit);
    const complete = start + limit >= keys.length;
    return {
      keys: page.map((name) => ({ name })),
      complete,
      cursor: complete ? undefined : String(start + limit),
    };
  }
}
(globalThis as any).my_kv = new MockKV();

const ENV = { JWT_SECRET: 'test-secret-for-smoke-only-32bytes-min' };

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

interface CallResult {
  status: number;
  body: any;
  headers: Headers;
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<CallResult> {
  const ctx = {
    env: ENV,
    request: {
      url: `http://localhost/api${path}`,
      method,
      headers: {
        get: (k: string) => headers[k.toLowerCase()] ?? null,
      },
      json: async () => body,
      text: async () => (body == null ? '' : JSON.stringify(body)),
    },
  };
  const res = await handleRequest(ctx);
  let parsed: any = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

const email = `smoke_${Date.now()}@test.local`;
const password = 'Test123456';

async function main(): Promise<void> {
  console.log('── 后端全链路冒烟测试（mock KV，真实业务逻辑）──\n');

  /* 1. 健康检查 */
  const health = await call('GET', '/health');
  check('GET /health 返回 200', health.status === 200, `实际 ${health.status}`);

  /* 2. 未登录访问受保护资源 */
  const anon = await call('GET', '/workflows');
  check('未登录访问 workflows → 401', anon.status === 401, `实际 ${anon.status}`);

  /* 3. 注册 */
  const reg = await call('POST', '/auth/register', { email, password });
  check('注册成功', reg.status === 200 || reg.status === 201, `实际 ${reg.status}`);
  check('注册返回 ok 信封', reg.body?.ok === true, JSON.stringify(reg.body?.error || ''));
  check('注册返回 user.email', reg.body?.data?.user?.email === email);
  const token: string = reg.body?.data?.token;
  check('注册返回 token', typeof token === 'string' && token.length > 20);

  /* 4. 弱密码 */
  const weak = await call('POST', '/auth/register', { email: `w${Date.now()}@t.local`, password: '123' });
  check('弱密码 → 400', weak.status === 400, `实际 ${weak.status}`);
  check('错误码 VALIDATION_ERROR', weak.body?.error?.code === 'VALIDATION_ERROR', weak.body?.error?.code);

  /* 5. 重复注册 */
  const dup = await call('POST', '/auth/register', { email, password });
  check('重复注册 → 409', dup.status === 409, `实际 ${dup.status}`);

  /* 6. 登录 */
  const login = await call('POST', '/auth/login', { email, password });
  check('登录成功', login.body?.ok === true, JSON.stringify(login.body?.error || ''));
  const loginToken: string = login.body?.data?.token;
  check('登录返回 token', typeof loginToken === 'string' && loginToken.length > 20);

  /* 7. 错误密码 */
  const badPwd = await call('POST', '/auth/login', { email, password: 'WrongPass123' });
  check('错误密码 → 401', badPwd.status === 401, `实际 ${badPwd.status}`);

  const auth = { authorization: `Bearer ${loginToken}` };

  /* 8. 鉴权后访问 */
  const me = await call('GET', '/auth/me', undefined, auth);
  // 契约：GET /auth/me → data: { user: User }（与前端 api-client request<{user:User}> 一致）
  check('GET /auth/me 返回当前用户', me.body?.data?.user?.email === email, JSON.stringify(me.body?.data));

  /* 9. 无效 token */
  const bad = await call('GET', '/workflows', undefined, { authorization: 'Bearer invalid.token.x' });
  check('无效 token → 401', bad.status === 401, `实际 ${bad.status}`);

  /* 10. 创建工作流 */
  const wfName = `冒烟工作流 ${Date.now()}`;
  const created = await call(
    'POST',
    '/workflows',
    {
      name: wfName,
      category: '回归测试',
      description: '冒烟测试创建',
      devices: 4,
      steps: 12,
      coverage: 88,
      duration: 30,
      status: 'queued',
      env: 'staging',
    },
    auth,
  );
  check('创建工作流成功', created.body?.ok === true, JSON.stringify(created.body?.error || ''));
  const wfId: string = created.body?.data?.id;
  check('返回工作流 id', !!wfId);

  /* 11. 持久化校验 */
  const list = await call('GET', '/workflows', undefined, auth);
  const hit = list.body?.data?.find?.((w: any) => w.id === wfId);
  check('列表中能查到新建工作流（已持久化）', !!hit);

  /* 12. 多租户隔离：另一用户看不到 */
  const other = await call('POST', '/auth/register', { email: `other_${Date.now()}@test.local`, password });
  const otherAuth = { authorization: `Bearer ${other.body?.data?.token}` };
  const otherList = await call('GET', '/workflows', undefined, otherAuth);
  const leaked = otherList.body?.data?.find?.((w: any) => w.id === wfId);
  check('其他用户看不到该工作流（多租户隔离）', !leaked);

  /* 13. 更新 */
  const patched = await call('PATCH', `/workflows/${wfId}`, { status: 'running', coverage: 92 }, auth);
  check('更新工作流成功', patched.body?.ok === true);
  check('更新字段生效', patched.body?.data?.status === 'running', patched.body?.data?.status);

  /* 14. Trace 写入与查询 */
  const trace = await call(
    'POST',
    '/traces',
    { kind: 'Agent', name: 'smoke.plan', cost: 120, status: 'Success', time: '00:00:03' },
    auth,
  );
  check('写入 Trace 成功', trace.body?.ok === true, JSON.stringify(trace.body?.error || ''));
  const traces = await call('GET', '/traces', undefined, auth);
  check('Trace 列表非空', Array.isArray(traces.body?.data) && traces.body.data.length > 0);

  /* 15. 资产列表（新用户播种） */
  for (const [name, path] of [
    ['技能列表', '/skills'],
    ['合同列表', '/contracts'],
    ['设备列表', '/devices'],
  ] as const) {
    const r = await call('GET', path, undefined, auth);
    check(`${name}返回数组`, Array.isArray(r.body?.data), `实际 ${r.status}`);
  }

  /* 16. 用量统计 */
  const usage = await call('GET', '/usage', undefined, auth);
  check(
    '用量接口返回 runs/limit',
    typeof usage.body?.data?.runs === 'number' && typeof usage.body?.data?.limit === 'number',
    JSON.stringify(usage.body?.data),
  );
  check('免费版配额上限为 100', usage.body?.data?.limit === 100, String(usage.body?.data?.limit));

  /* 17. 审计日志 */
  const audit = await call('GET', '/audit', undefined, auth);
  check('审计日志有记录', Array.isArray(audit.body?.data) && audit.body.data.length > 0);

  /* 18. AI Copilot 优雅降级（本地无 AI Gateway） */
  const cop = await call('POST', '/ai/copilot', { messages: [{ role: 'user', content: '你好' }] }, auth);
  check(
    'AI Copilot 无 Gateway 时优雅降级（401/503，非 500 崩溃）',
    [401, 503].includes(cop.status),
    `实际 ${cop.status} ${JSON.stringify(cop.body?.error || '')}`,
  );

  /* 19. 删除 */
  const del = await call('DELETE', `/workflows/${wfId}`, undefined, auth);
  check('删除工作流成功', del.body?.ok === true);
  const after = await call('GET', '/workflows', undefined, auth);
  check('删除后列表中不再出现', !after.body?.data?.find?.((w: any) => w.id === wfId));

  /* 20. 登出后失效 */
  const logout = await call('POST', '/auth/logout', undefined, auth);
  check('登出成功', logout.body?.ok === true, `实际 ${logout.status}`);
  const afterLogout = await call('GET', '/workflows', undefined, auth);
  check('登出后原 token 失效 → 401', afterLogout.status === 401, `实际 ${afterLogout.status}`);

  /* 21. 未知路由 */
  const nf = await call('GET', '/does-not-exist');
  check('未知路由 → 404', nf.status === 404, `实际 ${nf.status}`);

  console.log('\n' + '─'.repeat(52));
  console.log(`总计 ${passed + failed} 项，通过 ${passed}，失败 ${failed}`);
  console.log('─'.repeat(52));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('测试执行异常:', e);
  process.exit(1);
});