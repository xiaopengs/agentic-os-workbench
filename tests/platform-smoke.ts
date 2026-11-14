/**
 * 平台层深度边界冒烟 · HTTP 全链路（内存 KV，零外部依赖）
 *
 * 与 tests/api-smoke.ts 的分工：
 *   - api-smoke 覆盖「happy path + 主要错误码」（34 项）；
 *   - 本文件专攻**未被覆盖的边界**：CORS 预检与错误响应、认证脏输入与账号枚举、
 *     配额 402 拦截、workflows/traces 输入边界、decisions 端点校验与编号分配、路由匹配。
 *
 * 用法：npx tsx tests/platform-smoke.ts
 */
import { handleRequest } from '../backend/functions/router';
import { Repo } from '../backend/lib/kv';
import { monthKey, setUsage } from '../backend/lib/quota';

/* ── 内存 KV mock（与 api-smoke 同契约） ─────────────────────── */
class MockKV {
  private data = new Map<string, string>();
  async get(key: string, type?: string): Promise<any> {
    const v = this.data.get(key);
    if (v === undefined) return null;
    return type === 'json' ? JSON.parse(v) : v;
  }
  async put(key: string, value: string): Promise<void> { this.data.set(key, String(value)); }
  async delete(key: string): Promise<void> { this.data.delete(key); }
  async list(opts: { prefix?: string; limit?: number; cursor?: string } = {}): Promise<any> {
    const keys = [...this.data.keys()].filter((k) => !opts.prefix || k.startsWith(opts.prefix)).sort();
    const limit = opts.limit || 1000;
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const page = keys.slice(start, start + limit);
    const complete = start + limit >= keys.length;
    return { keys: page.map((name) => ({ name })), complete, cursor: complete ? undefined : String(start + limit) };
  }
}
const kv = new MockKV();
(globalThis as any).my_kv = kv;

const ENV = { JWT_SECRET: 'test-secret-for-platform-smoke-32bytes-min' };
const PASSWORD = 'Test123456';
const ORIGIN = 'https://third-party.example';

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++; else failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

interface Res { status: number; body: any; headers: Headers }
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const ctx = {
    env: ENV,
    request: {
      url: `http://localhost/api${path}`,
      method,
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
      json: async () => body,
      text: async () => (body == null ? '' : JSON.stringify(body)),
    },
  };
  const res = await handleRequest(ctx);
  let parsed: any = null;
  try { parsed = await res.json(); } catch { parsed = null; }
  return { status: res.status, body: parsed, headers: res.headers };
}

const A = (token: string) => ({ authorization: `Bearer ${token}` });
const withOrigin = (h: Record<string, string>) => ({ ...h, origin: ORIGIN });
const uniq = (tag: string) => `${tag}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@test.local`;

async function register(tag: string): Promise<{ email: string; token: string; id: string; status: number }> {
  const email = uniq(tag);
  const r = await call('POST', '/auth/register', { email, password: PASSWORD });
  const token = r.body?.data?.token ?? '';
  const me = await call('GET', '/auth/me', undefined, A(token));
  return { email, token, id: me.body?.data?.user?.id ?? '', status: r.status };
}

/** 只改用量、不改业务数据：用于把配额推到边界，避免 100 次写工作流 */
async function forceUsage(uid: string, runs: number): Promise<void> {
  const driver = {
    name: 'mock',
    async get<T>(key: string): Promise<T | null> { return (await kv.get(key, 'json')) as T | null; },
    async put(key: string, value: unknown): Promise<void> { await kv.put(key, JSON.stringify(value)); },
    async del(key: string): Promise<void> { await kv.delete(key); },
    async list(prefix: string): Promise<string[]> {
      return (await kv.list({ prefix })).keys.map((x: any) => x.name);
    },
  };
  await setUsage(new Repo(driver), uid, { runs, tokens: 0, costCents: 0 }, monthKey());
}

async function main(): Promise<void> {
  console.log('── 平台层深度边界测试（HTTP 全链路 · 内存 KV）──\n');

  /* ══ 1. CORS / 预检 / 错误信封 ══════════════════════════════ */
  const preflight = await call('OPTIONS', '/workflows', undefined, withOrigin({}));
  check('OPTIONS 预检返回 204', preflight.status === 204, `实际 ${preflight.status}`);
  check('预检返回 Allow-Methods', /GET,POST,PATCH,DELETE,OPTIONS/.test(preflight.headers.get('access-control-allow-methods') || ''));
  check('预检返回 Allow-Headers', /Authorization/i.test(preflight.headers.get('access-control-allow-headers') || ''));
  check('预检返回 Max-Age=86400', preflight.headers.get('access-control-max-age') === '86400');
  check('预检回显 Origin', preflight.headers.get('access-control-allow-origin') === ORIGIN);

  const corsOk = await call('GET', '/health', undefined, withOrigin({}));
  check('成功响应带 CORS 头（有 Origin 时）', corsOk.headers.get('access-control-allow-origin') === ORIGIN);
  check('成功响应 Vary: Origin', corsOk.headers.get('vary') === 'Origin');

  const corsErr = await call('GET', '/workflows', undefined, withOrigin({}));
  check('401 错误响应同样带 CORS 头', corsErr.status === 401 && corsErr.headers.get('access-control-allow-origin') === ORIGIN,
    `status=${corsErr.status}`);

  const noOrigin = await call('GET', '/health');
  check('无 Origin 时不产生 CORS 头（同域部署无副作用）', noOrigin.headers.get('access-control-allow-origin') === null);

  const nf = await call('GET', '/not-a-route');
  check('未知路由 → 404 + 结构化错误信封', nf.status === 404 && nf.body?.ok === false
    && nf.body?.error?.code === 'NOT_FOUND' && typeof nf.body?.error?.message === 'string');
  const wrongMethod = await call('PUT', '/health');
  check('方法不匹配 → 404（路由按 method+path 匹配）', wrongMethod.status === 404, `实际 ${wrongMethod.status}`);

  /* ══ 2. 认证脏输入与账号枚举 ═══════════════════════════════ */
  const authUser = await register('auth');
  check('注册返回 201', authUser.status === 201, `实际 ${authUser.status}`);
  check('注册返回 user.id', /^usr_/.test(authUser.id), authUser.id);

  for (const [name, email] of [
    ['缺 @ 的邮箱', 'not-an-email'],
    ['空邮箱', ''],
    ['含空格的邮箱', 'a b@c.com'],
    ['超长邮箱', 'a'.repeat(251) + '@b.c'],
  ] as const) {
    const r = await call('POST', '/auth/register', { email, password: PASSWORD });
    check(`${name} → 400 VALIDATION_ERROR`, r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR', `实际 ${r.status}`);
  }
  const noBody = await call('POST', '/auth/register');
  check('注册空 body → 400', noBody.status === 400, `实际 ${noBody.status}`);
  const longPwd = await call('POST', '/auth/register', { email: uniq('lp'), password: 'x'.repeat(201) });
  check('密码 >200 → 400', longPwd.status === 400, `实际 ${longPwd.status}`);

  const unknownLogin = await call('POST', '/auth/login', { email: uniq('ghost'), password: PASSWORD });
  const wrongPwd = await call('POST', '/auth/login', { email: authUser.email, password: 'WrongPass123' });
  check('未知邮箱登录 → 401', unknownLogin.status === 401, `实际 ${unknownLogin.status}`);
  check('账号枚举防护：未知邮箱与错误密码返回相同 message',
    unknownLogin.body?.error?.message === wrongPwd.body?.error?.message,
    `${unknownLogin.body?.error?.message} / ${wrongPwd.body?.error?.message}`);

  const caseVariant = await call('POST', '/auth/register', { email: 'MixedCase@Test.Local', password: PASSWORD });
  check('混合大小写邮箱注册成功', caseVariant.status === 201, `实际 ${caseVariant.status}`);
  const lowerLogin = await call('POST', '/auth/login', { email: 'mixedcase@test.local', password: PASSWORD });
  check('邮箱归一化：小写可登录大写注册的账号', lowerLogin.body?.ok === true, `实际 ${lowerLogin.status}`);
  const dupCase = await call('POST', '/auth/register', { email: 'MIXEDCASE@TEST.LOCAL', password: PASSWORD });
  check('大小写变体重复注册 → 409', dupCase.status === 409, `实际 ${dupCase.status}`);

  const meAnon = await call('GET', '/auth/me');
  check('GET /auth/me 未登录 → 401', meAnon.status === 401, `实际 ${meAnon.status}`);
  const logoutAnon = await call('POST', '/auth/logout');
  check('无 token 登出仍幂等返回 200', logoutAnon.status === 200 && logoutAnon.body?.ok === true);
  const tampered = await call('GET', '/workflows', undefined, A(authUser.token.slice(0, -3) + 'xxx'));
  check('篡改签名的 token → 401', tampered.status === 401, `实际 ${tampered.status}`);

  /* ══ 3. workflows / traces 输入边界 ════════════════════════ */
  const crud = await register('crud');
  const H = A(crud.token);
  const validWf = { name: '边界测试工作流', category: 'QA', devices: 2, steps: 3, coverage: 50, duration: 10, status: 'queued' };

  const created = await call('POST', '/workflows', validWf, H);
  check('创建工作流 → 201', created.status === 201, `实际 ${created.status}`);
  const wfId: string = created.body?.data?.id;
  check('创建返回 id / createdAt / updatedAt', !!wfId && !!created.body?.data?.createdAt && !!created.body?.data?.updatedAt);
  check('创建不回传客户端伪造的 userId', created.body?.data?.userId === undefined);

  const badInputs: Array<[string, Record<string, unknown>, string]> = [
    ['缺 name', { ...validWf, name: undefined }, 'VALIDATION_ERROR'],
    ['name 超长', { ...validWf, name: 'x'.repeat(201) }, 'VALIDATION_ERROR'],
    ['devices 负数', { ...validWf, devices: -1 }, 'VALIDATION_ERROR'],
    ['devices 非整数', { ...validWf, devices: 1.5 }, 'VALIDATION_ERROR'],
    ['devices 布尔 true', { ...validWf, devices: true }, 'VALIDATION_ERROR'],
    ['coverage > 100', { ...validWf, coverage: 101 }, 'VALIDATION_ERROR'],
    ['非法 status', { ...validWf, status: 'flying' }, 'VALIDATION_ERROR'],
    ['steps 非数字字符串', { ...validWf, steps: 'abc' }, 'VALIDATION_ERROR'],
  ];
  for (const [name, body, code] of badInputs) {
    const r = await call('POST', '/workflows', body, H);
    check(`创建校验 ${name} → 400`, r.status === 400 && r.body?.error?.code === code, `实际 ${r.status} ${r.body?.error?.code}`);
  }
  const strNum = await call('POST', '/workflows', { ...validWf, name: '字符串数字', devices: '4' }, H);
  check('数字字符串仍允许（表单兼容）', strNum.status === 201 && strNum.body?.data?.devices === 4,
    `实际 ${strNum.status} devices=${strNum.body?.data?.devices}`);

  const missingGet = await call('GET', '/workflows/wf_not_exist', undefined, H);
  check('GET 不存在的工作流 → 404', missingGet.status === 404, `实际 ${missingGet.status}`);
  const missingPatch = await call('PATCH', '/workflows/wf_not_exist', { status: 'running' }, H);
  check('PATCH 不存在 → 404', missingPatch.status === 404, `实际 ${missingPatch.status}`);
  const missingDel = await call('DELETE', '/workflows/wf_not_exist', undefined, H);
  check('DELETE 不存在 → 404', missingDel.status === 404, `实际 ${missingDel.status}`);
  const badPatch = await call('PATCH', `/workflows/${wfId}`, { status: 'flying' }, H);
  check('PATCH 非法 status → 400', badPatch.status === 400, `实际 ${badPatch.status}`);

  const patched = await call('PATCH', `/workflows/${wfId}`, { status: 'running', coverage: 77 }, H);
  check('PATCH 生效', patched.body?.data?.status === 'running' && patched.body?.data?.coverage === 77);
  check('PATCH 保持 id / createdAt 不变', patched.body?.data?.id === wfId
    && patched.body?.data?.createdAt === created.body?.data?.createdAt);

  const trailing = await call('GET', '/workflows/', undefined, H);
  check('尾斜杠路径与无斜杠等价', trailing.status === 200 && Array.isArray(trailing.body?.data), `实际 ${trailing.status}`);
  const single = await call('GET', `/workflows/${wfId}`, undefined, H);
  check('GET 单条返回该工作流', single.body?.data?.id === wfId);

  for (const [name, body] of [
    ['time 格式错误', { kind: 'Agent', name: 't', cost: 10, status: 'Success', time: '99:99' }],
    ['cost 负数', { kind: 'Agent', name: 't', cost: -1, status: 'Success', time: '00:00:01' }],
    ['cost 为 null', { kind: 'Agent', name: 't', cost: null, status: 'Success', time: '00:00:01' }],
    ['cost 布尔', { kind: 'Agent', name: 't', cost: true, status: 'Success', time: '00:00:01' }],
    ['非法 kind', { kind: 'Alien', name: 't', cost: 10, status: 'Success', time: '00:00:01' }],
    ['非法 status', { kind: 'Agent', name: 't', cost: 10, status: 'Maybe', time: '00:00:01' }],
  ] as const) {
    const r = await call('POST', '/traces', body, H);
    check(`Trace 校验 ${name} → 400`, r.status === 400, `实际 ${r.status}`);
  }
  const goodTrace = await call('POST', '/traces', { kind: 'Agent', name: 't.ok', cost: 120, status: 'Success', time: '00:00:03' }, H);
  check('合法 Trace → 201', goodTrace.status === 201, `实际 ${goodTrace.status}`);

  const other = await register('other');
  const otherList = await call('GET', '/workflows', undefined, A(other.token));
  check('多租户隔离：其他用户看不到该工作流',
    !(otherList.body?.data ?? []).some((w: any) => w.id === wfId));

  /* ══ 4. 配额 402 拦截与用量记账 ════════════════════════════ */
  const quotaUser = await register('quota');
  const QH = A(quotaUser.token);
  const u0 = await call('GET', '/usage', undefined, QH);
  // 播种会写入演示用量基线（1 run / 4800 tokens / 36 分），这是设计行为，不是脏数据
  check('新用户演示用量基线 runs=1 / tokens=4800 / costCents=36 / limit=100',
    u0.body?.data?.runs === 1 && u0.body?.data?.tokens === 4800
    && u0.body?.data?.costCents === 36 && u0.body?.data?.limit === 100,
    JSON.stringify(u0.body?.data));
  const qCreate = await call('POST', '/workflows', validWf, QH);
  check('配额用户创建工作流成功', qCreate.status === 201, `实际 ${qCreate.status}`);
  const u1 = await call('GET', '/usage', undefined, QH);
  check('创建工作流量累加 runs+1 / tokens+1200 / costCents+9',
    u1.body?.data?.runs === 2 && u1.body?.data?.tokens === 6000 && u1.body?.data?.costCents === 45,
    JSON.stringify(u1.body?.data));
  await call('POST', '/traces', { kind: 'Agent', name: 't.q', cost: 40, status: 'Success', time: '00:00:02' }, QH);
  const u2 = await call('GET', '/usage', undefined, QH);
  check('Trace 只计 tokens，不占 run 配额',
    u2.body?.data?.runs === u1.body?.data?.runs && u2.body?.data?.tokens > u1.body?.data?.tokens,
    JSON.stringify(u2.body?.data));

  await forceUsage(quotaUser.id, 100);
  const blocked = await call('POST', '/workflows', validWf, QH);
  check('配额用满后创建 → 402 QUOTA_EXCEEDED',
    blocked.status === 402 && blocked.body?.error?.code === 'QUOTA_EXCEEDED', `实际 ${blocked.status} ${blocked.body?.error?.code}`);
  const stillRead = await call('GET', '/workflows', undefined, QH);
  check('配额用满不影响只读接口', stillRead.status === 200, `实际 ${stillRead.status}`);
  const stillDelete = await call('DELETE', `/workflows/${qCreate.body?.data?.id}`, undefined, QH);
  check('配额用满不影响删除接口', stillDelete.status === 200, `实际 ${stillDelete.status}`);
  const u3 = await call('GET', '/usage', undefined, QH);
  check('超额请求不写入用量', u3.body?.data?.runs === 100, String(u3.body?.data?.runs));

  /* ══ 5. decisions 端点边界 ════════════════════════════════ */
  const dec = await register('dec');
  const DH = A(dec.token);
  const seed = await call('GET', '/decisions', undefined, DH);
  check('决策首访播种 4 条', Array.isArray(seed.body?.data) && seed.body?.data?.length === 4,
    `实际 ${seed.body?.data?.length}`);
  check('决策未登录 → 401', (await call('GET', '/decisions')).status === 401);

  const decAnon = await call('GET', '/decisions/ADR-0001/score', undefined, DH);
  check('score 返回评分与 gap', decAnon.status === 200 && Array.isArray(decAnon.body?.data?.scores)
    && typeof decAnon.body?.data?.gap === 'number', `实际 ${decAnon.status}`);

  const scoreBadCases: Array<[string, string]> = [
    ['weights=null（对象为 null）', 'null'],
    ['weights=[]（数组不是对象）', '[]'],
    ['weights 非法 JSON', '{oops'],
    ['weights 含负权重', '{"perf":-5}'],
    ['weights 含非数字', '{"perf":"abc"}'],
  ];
  for (const [name, w] of scoreBadCases) {
    const r = await call('GET', `/decisions/ADR-0001/score?weights=${encodeURIComponent(w)}`, undefined, DH);
    check(`score ${name} → 400（不得 500）`,
      r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR', `实际 ${r.status} ${r.body?.error?.code}`);
  }
  const scoreGood = await call('GET', `/decisions/ADR-0001/score?weights=${encodeURIComponent('{"perf":100,"maint":0,"cost":0}')}`, undefined, DH);
  check('score 合法权重覆盖 → 200 且重算', scoreGood.status === 200
    && scoreGood.body?.data?.criteria?.[0]?.weight === 100, `实际 ${scoreGood.status}`);

  const badCreate = await call('POST', '/decisions', { title: '缺 owner' }, DH);
  check('创建决策缺 owner → 400', badCreate.status === 400, `实际 ${badCreate.status}`);
  const badWeight = await call('POST', '/decisions', {
    title: '权重越界', owner: 'QA', criteria: [{ id: 'c1', name: 'C', weight: 101 }], options: [],
  }, DH);
  check('创建决策权重 >100 → 400', badWeight.status === 400, `实际 ${badWeight.status}`);
  const badScoreVal = await call('POST', '/decisions', {
    title: '评分越界', owner: 'QA',
    criteria: [{ id: 'c1', name: 'C', weight: 50 }],
    options: [{ id: 'o1', name: 'O', scores: { c1: 9 } }],
  }, DH);
  check('创建决策方案评分 >5 → 400', badScoreVal.status === 400, `实际 ${badScoreVal.status}`);
  const badDate = await call('POST', '/decisions', { title: '日期', owner: 'QA', reviewAt: '2026/01/01' }, DH);
  check('创建决策 reviewAt 格式错误 → 400', badDate.status === 400, `实际 ${badDate.status}`);

  const newDec = await call('POST', '/decisions', {
    title: '测试决策：编号分配', owner: 'QA', context: 'ctx', decision: '结论',
    criteria: [{ id: 'c1', name: '成本', weight: 100 }],
    options: [{ id: 'o1', name: '方案A', scores: { c1: 4 }, pros: ['快'], cons: ['贵'], assumptions: ['有预算'] }],
    chosenOptionId: 'o1',
    consequences: { positive: ['快'], negative: ['贵'], risks: ['预算'] },
    reviewAt: '2026-12-01',
  }, DH);
  check('创建决策 → 201 且状态 draft',
    newDec.status === 201 && newDec.body?.data?.status === 'draft', `实际 ${newDec.status}`);
  const newId: string = newDec.body?.data?.id;
  check('新建决策分配 ADR-0005', newId === 'ADR-0005', `实际 ${newId}`);

  const patchStatus = await call('PATCH', `/decisions/${newId}`, { status: 'accepted' }, DH);
  check('PATCH 改状态 → 400（必须走 /review）', patchStatus.status === 400, `实际 ${patchStatus.status}`);
  const illegal = await call('POST', `/decisions/${newId}/review`, { to: 'accepted' }, DH);
  check('跨级流转 draft→accepted → 400', illegal.status === 400, `实际 ${illegal.status}`);
  const toRuleDraft = await call('POST', `/decisions/${newId}/to-rule`, {}, DH);
  check('未接受决策 to-rule → 400', toRuleDraft.status === 400, `实际 ${toRuleDraft.status}`);

  const toReview = await call('POST', `/decisions/${newId}/review`, { to: 'review' }, DH);
  check('draft→review 合法流转', toReview.status === 200 && toReview.body?.data?.status === 'review',
    `实际 ${toReview.status}`);
  const accepted = await call('POST', `/decisions/${newId}/review`, { to: 'accepted', note: '通过' }, DH);
  check('review→accepted 合法流转并留痕',
    accepted.status === 200 && accepted.body?.data?.status === 'accepted'
    && accepted.body?.data?.history?.some((h: any) => h.action === 'status' && h.to === 'accepted'),
    `实际 ${accepted.status}`);
  check('accepted 写入 acceptedAt', !!accepted.body?.data?.acceptedAt);
  const terminal = await call('POST', `/decisions/${newId}/review`, { to: 'draft' }, DH);
  check('accepted→draft 非法流转 → 400', terminal.status === 400, `实际 ${terminal.status}`);

  const ruleDraft = await call('POST', `/decisions/${newId}/to-rule`, {}, DH);
  check('已接受决策 to-rule → 200 且 valid',
    ruleDraft.status === 200 && ruleDraft.body?.data?.valid === true,
    `实际 ${ruleDraft.status} valid=${ruleDraft.body?.data?.valid}`);
  check('to-rule 生成 decision.accepted 事件源',
    ruleDraft.body?.data?.draft?.when?.source === 'decision'
    && ruleDraft.body?.data?.draft?.when?.types?.includes('decision.accepted'));

  /* B3 权衡门禁：方案缺 cons/assumptions 时不得接受 */
  const thin = await call('POST', '/decisions', {
    title: '权衡不全', owner: 'QA',
    criteria: [{ id: 'c1', name: 'C', weight: 100 }],
    options: [{ id: 'o1', name: '只有优点', scores: { c1: 5 }, pros: ['好'], cons: [], assumptions: [] }],
  }, DH);
  const thinId = thin.body?.data?.id;
  await call('POST', `/decisions/${thinId}/review`, { to: 'review' }, DH);
  const thinAccept = await call('POST', `/decisions/${thinId}/review`, { to: 'accepted' }, DH);
  check('B3 权衡未补全 → 400（禁止接受）', thinAccept.status === 400
    && /补全权衡/.test(thinAccept.body?.error?.message || ''), `实际 ${thinAccept.status}`);

  /* 编号分配：删除最大编号后不得复用（thinId = ADR-0006 为当前最大） */
  await call('DELETE', `/decisions/${thinId}`, undefined, DH);
  const afterDelete = await call('POST', '/decisions', { title: '删除最大编号后新建', owner: 'QA' }, DH);
  check('删除最大编号后新建不复用旧 ADR 编号',
    afterDelete.status === 201 && afterDelete.body?.data?.id === 'ADR-0007',
    `实际 ${afterDelete.status} id=${afterDelete.body?.data?.id}`);

  /* 并发创建：编号分配必须串行化，不能两个请求拿到同一个 ADR 号 */
  const [c1, c2] = await Promise.all([
    call('POST', '/decisions', { title: '并发A', owner: 'QA' }, DH),
    call('POST', '/decisions', { title: '并发B', owner: 'QA' }, DH),
  ]);
  check('并发创建决策均成功', c1.status === 201 && c2.status === 201,
    `实际 ${c1.status}/${c2.status}`);
  check('并发创建决策编号不冲突',
    !!c1.body?.data?.id && !!c2.body?.data?.id && c1.body?.data?.id !== c2.body?.data?.id,
    `${c1.body?.data?.id} / ${c2.body?.data?.id}`);

  /* 到期复核派生字段 */
  const due = await call('GET', '/decisions?now=2030-01-01T00:00:00Z', undefined, DH);
  check('指定 now 时到期复核派生字段生效',
    Array.isArray(due.body?.data) && due.body?.data?.some((d: any) => d.reviewDue === true),
    `实际 ${due.status}`);
  const filtered = await call('GET', '/decisions?status=accepted&tag=部署', undefined, DH);
  check('status + tag 组合筛选生效',
    Array.isArray(filtered.body?.data) && filtered.body?.data?.every((d: any) => d.status === 'accepted' && d.tags?.includes('部署')));

  /* 审计留痕 */
  const audit = await call('GET', '/audit', undefined, DH);
  check('审计日志包含决策创建/流转动作',
    Array.isArray(audit.body?.data) && audit.body?.data?.some((a: any) => String(a.action).startsWith('decision.')),
    `实际 ${audit.status}`);

  console.log('\n' + '─'.repeat(52));
  console.log(`总计 ${passed + failed} 项，通过 ${passed}，失败 ${failed}`);
  console.log('─'.repeat(52));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('测试执行异常:', e);
  process.exit(1);
});
