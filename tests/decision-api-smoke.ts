/**
 * M6 · 架构设计决策面板 REST 全链路冒烟
 *
 * 运行：npx tsx tests/decision-api-smoke.ts
 * 与 tests/loop-api-smoke.ts 同构：真实 handleRequest 路由 + 内存 KV，不依赖服务器/网络。
 *
 * 覆盖：鉴权 / 独立播种 / CRUD / 输入校验 / 状态机 / 权衡显式化 /
 *       确定性评分 / D1 规则草案 / 多租户隔离 / 审计 / **loop 事实日志零回归**。
 */
import { handleRequest } from '../backend/functions/router';

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
(globalThis as any).my_kv = new MockKV();

const ENV = { JWT_SECRET: 'test-secret-for-smoke-only-32bytes-min' };

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { failed++; console.log(`  \x1b[31m✗ ${name}\x1b[0m ${detail ? ' — ' + detail : ''}`); }
}
function section(t: string): void { console.log(`\n\x1b[36m${t}\x1b[0m`); }

interface CallResult { status: number; body: any }
async function call(
  method: string, path: string, body?: unknown,
  headers: Record<string, string> = {},
): Promise<CallResult> {
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
  return { status: res.status, body: parsed };
}

const NOW = '2026-11-13T02:00:00.000Z';

async function main(): Promise<void> {
  console.log('── /decisions/* REST 全链路冒烟（mock KV，真实路由/鉴权/信封）──\n');

  /* 1. 鉴权 */
  section('① 鉴权与独立播种');
  const anon = await call('GET', '/decisions');
  check('未登录 GET /decisions → 401', anon.status === 401, `实际 ${anon.status}`);

  const email = `decision_${Date.now()}@test.local`;
  const reg = await call('POST', '/auth/register', { email, password: 'Test123456' });
  const token: string = reg.body?.data?.token;
  check('注册返回 token', typeof token === 'string' && token.length > 20);
  const auth = { authorization: `Bearer ${token}` };

  // 先触发 loop 播种（模拟用户先访问总览），用于记录基线 seq，且让 to-rule 能拿到已登记 agents
  const loopBase = await call('GET', '/loop/state', undefined, auth);
  const baseSeq: number = loopBase.body?.data?.seq ?? 0;
  check('loop 基线已播种（seq > 0）', baseSeq > 0, `seq=${baseSeq}`);

  const list0 = await call('GET', `/decisions?now=${encodeURIComponent(NOW)}`, undefined, auth);
  check('GET /decisions → 200 ok 信封', list0.status === 200 && list0.body?.ok === true, `实际 ${list0.status}`);
  check('独立播种 4 条示例决策', Array.isArray(list0.body?.data) && list0.body.data.length === 4,
    `实际 ${list0.body?.data?.length}`);
  const statuses = (list0.body?.data ?? []).map((d: any) => d.status);
  check('覆盖 accepted/review/deprecated 多状态',
    statuses.includes('accepted') && statuses.includes('review') && statuses.includes('deprecated'),
    statuses.join(','));
  const due = (list0.body?.data ?? []).filter((d: any) => d.reviewDue);
  check('含 1 条到期复核（reviewDue，供今天要处理）', due.length === 1, `due=${due.length}`);
  check('列表按 seq 升序', (list0.body?.data ?? []).every((d: any, i: number, a: any[]) => i === 0 || a[i - 1].seq < d.seq));

  const loopAfterList = await call('GET', '/loop/state', undefined, auth);
  check('决策列表不写 loop 事实（seq 不变）', loopAfterList.body?.data?.seq === baseSeq,
    `base=${baseSeq} now=${loopAfterList.body?.data?.seq}`);

  /* 2. 筛选 */
  section('② 筛选 status / tag / q');
  const byStatus = await call('GET', '/decisions?status=accepted', undefined, auth);
  check('status=accepted 过滤生效', (byStatus.body?.data ?? []).length === 2 &&
    (byStatus.body?.data ?? []).every((d: any) => d.status === 'accepted'));
  const byTag = await call('GET', '/decisions?tag=内核', undefined, auth);
  check('tag=内核 过滤生效', (byTag.body?.data ?? []).length === 1);
  const byQ = await call('GET', '/decisions?q=SQLite', undefined, auth);
  check('q 全文检索命中标题/背景', (byQ.body?.data ?? []).length === 1);
  const noHit = await call('GET', '/decisions?q=不存在的关键词xyz', undefined, auth);
  check('q 无命中返回空数组', Array.isArray(noHit.body?.data) && noHit.body.data.length === 0);

  /* 3. 单条 / 创建 / 编号 */
  section('③ 单条读取 / 创建 / ADR 编号');
  const d1 = await call('GET', '/decisions/ADR-0001', undefined, auth);
  check('GET /decisions/ADR-0001 → 200', d1.status === 200 && d1.body?.data?.id === 'ADR-0001');
  const d404 = await call('GET', '/decisions/ADR-9999', undefined, auth);
  check('不存在的决策 → 404', d404.status === 404, `实际 ${d404.status}`);

  const created = await call('POST', '/decisions', {
    title: '选择日志采样策略', context: '需要在成本与可观测性间权衡',
    owner: '平台组', tags: ['可观测'],
    criteria: [{ id: 'perf', name: '性能', weight: 60 }, { id: 'cost', name: '成本', weight: 40 }],
    options: [
      { id: 'head', name: '头部采样', summary: '固定比例', scores: { perf: 3, cost: 5 }, pros: ['便宜'], cons: ['可能漏异常'], assumptions: ['流量稳定'] },
      { id: 'tail', name: '尾部采样', summary: '按结果决定', scores: { perf: 5, cost: 2 }, pros: ['不漏异常'], cons: ['缓冲成本高'], assumptions: ['可缓存'] },
    ],
    decision: '倾向尾部采样', chosenOptionId: 'tail',
  }, auth);
  check('POST /decisions → 201', created.status === 201, `实际 ${created.status}`);
  check('新决策编号递增为 ADR-0005', created.body?.data?.id === 'ADR-0005', `实际 ${created.body?.data?.id}`);
  check('新决策初始状态 draft', created.body?.data?.status === 'draft');
  check('history 记录 created', created.body?.data?.history?.[0]?.action === 'created');
  check('owner 取自入参', created.body?.data?.owner === '平台组');

  /* 4. 输入校验 */
  section('④ 输入校验（400 边界）');
  check('缺 title → 400', (await call('POST', '/decisions', { owner: 'x' }, auth)).status === 400);
  check('缺 owner → 400', (await call('POST', '/decisions', { title: 'x' }, auth)).status === 400);
  check('权重 >100 → 400', (await call('POST', '/decisions', {
    title: 'x', owner: 'x', criteria: [{ id: 'a', name: 'A', weight: 999 }],
  }, auth)).status === 400);
  check('评分 >5 → 400', (await call('POST', '/decisions', {
    title: 'x', owner: 'x', criteria: [{ id: 'a', name: 'A', weight: 50 }],
    options: [{ id: 'o', name: 'O', scores: { a: 9 } }],
  }, auth)).status === 400);
  check('方案 id 重复 → 400', (await call('POST', '/decisions', {
    title: 'x', owner: 'x', options: [{ id: 'o', name: 'O' }, { id: 'o', name: 'P' }],
  }, auth)).status === 400);
  check('reviewAt 格式非法 → 400', (await call('POST', '/decisions', {
    title: 'x', owner: 'x', reviewAt: '2026/13/01',
  }, auth)).status === 400);

  /* 5. 编辑 */
  section('⑤ 编辑（状态不可经 PATCH 改）');
  const edited = await call('PATCH', '/decisions/ADR-0005', { title: '选择日志采样策略（修订）', tags: ['可观测', '成本'] }, auth);
  check('PATCH → 200 且标题更新', edited.status === 200 && edited.body?.data?.title?.includes('修订'));
  check('PATCH 保留原状态 draft', edited.body?.data?.status === 'draft');
  check('PATCH 追加 edit 留痕', edited.body?.data?.history?.some((h: any) => h.action === 'edit') === true);
  const patchStatus = await call('PATCH', '/decisions/ADR-0005', { status: 'accepted' }, auth);
  check('PATCH 试图改 status → 400', patchStatus.status === 400, `实际 ${patchStatus.status}`);
  check('未授权状态未被写入', (await call('GET', '/decisions/ADR-0005', undefined, auth)).body?.data?.status === 'draft');

  /* 6. 确定性评分 */
  section('⑥ 确定性加权评分 / 可调权重预演');
  const sc = await call('GET', '/decisions/ADR-0005/score', undefined, auth);
  check('GET score → 200', sc.status === 200, `实际 ${sc.status}`);
  check('返回 2 个方案评分且降序', sc.body?.data?.scores?.length === 2 &&
    sc.body?.data?.scores[0].score >= sc.body?.data?.scores[1].score);
  check('排名连续', sc.body?.data?.scores?.every((s: any, i: number) => s.rank === i + 1) === true);
  const sc2 = await call('GET', '/decisions/ADR-0005/score', undefined, auth);
  check('同输入重放一致', JSON.stringify(sc.body?.data?.scores) === JSON.stringify(sc2.body?.data?.scores));
  const w = encodeURIComponent(JSON.stringify({ perf: 0, cost: 100 }));
  const scW = await call('GET', `/decisions/ADR-0005/score?weights=${w}`, undefined, auth);
  check('权重覆盖改变排名（只读预演）', scW.body?.data?.scores?.[0]?.id === 'head',
    `top=${scW.body?.data?.scores?.[0]?.id}`);
  check('权重预演不落库', JSON.stringify((await call('GET', '/decisions/ADR-0005/score', undefined, auth)).body?.data?.scores)
    === JSON.stringify(sc.body?.data?.scores));
  const badW = await call('GET', '/decisions/ADR-0005/score?weights=notjson', undefined, auth);
  check('非法 weights → 400', badW.status === 400, `实际 ${badW.status}`);

  /* 7. 状态机流转 + 权衡显式化 */
  section('⑦ 状态机流转 / B3 权衡门禁');
  const illegal = await call('POST', '/decisions/ADR-0005/review', { to: 'accepted' }, auth);
  check('draft → accepted 越级 → 400', illegal.status === 400, `实际 ${illegal.status}`);
  const toReview = await call('POST', '/decisions/ADR-0005/review', { to: 'review', note: '提交评审' }, auth);
  check('draft → review → 200', toReview.status === 200 && toReview.body?.data?.status === 'review');
  check('流转留痕含 from/to', toReview.body?.data?.history?.some((h: any) => h.action === 'status' && h.from === 'draft' && h.to === 'review') === true);
  const toAccepted = await call('POST', '/decisions/ADR-0005/review', { to: 'accepted' }, auth);
  check('review → accepted → 200', toAccepted.status === 200 && toAccepted.body?.data?.status === 'accepted');
  check('acceptedAt 已写入', !!toAccepted.body?.data?.acceptedAt);
  const rollback = await call('POST', '/decisions/ADR-0005/review', { to: 'review' }, auth);
  check('accepted → review 回退 → 400', rollback.status === 400, `实际 ${rollback.status}`);

  // 权衡门禁：造一条 options 缺 cons/assumptions 的决策
  const weak = await call('POST', '/decisions', {
    title: '只写优点的决策', owner: 'x',
    criteria: [{ id: 'perf', name: '性能', weight: 100 }],
    options: [{ id: 'o', name: 'O', scores: { perf: 5 }, pros: ['快'] }],
  }, auth);
  const weakId: string = weak.body?.data?.id;
  await call('POST', `/decisions/${weakId}/review`, { to: 'review' }, auth);
  const weakAccept = await call('POST', `/decisions/${weakId}/review`, { to: 'accepted' }, auth);
  check('缺「失去/假设」的决策不能 accepted → 400', weakAccept.status === 400, `实际 ${weakAccept.status}`);
  check('错误文案提示补全权衡', String(weakAccept.body?.error?.message ?? '').includes('权衡'));

  /* 8. D1 决策 → 规则草案 */
  section('⑧ D1 决策 → autoloop 规则草案（不落库）');
  const rule = await call('POST', '/decisions/ADR-0005/to-rule', {}, auth);
  check('已接受决策 to-rule → 200', rule.status === 200, `实际 ${rule.status}`);
  check('草案 name 带 adr 前缀', String(rule.body?.data?.draft?.name ?? '').startsWith('adr-adr-'));
  check('草案 to 为已登记 Agent', (rule.body?.data?.agents ?? []).includes(rule.body?.data?.draft?.to));
  check('草案通过 validateRule（valid:true）', rule.body?.data?.valid === true,
    `issues=${JSON.stringify(rule.body?.data?.issues)}`);
  const draftRule = await call('POST', '/decisions/ADR-0003/to-rule', {}, auth);
  check('非 accepted 决策 to-rule → 400', draftRule.status === 400, `实际 ${draftRule.status}`);
  const loopAfterRule = await call('GET', '/loop/state', undefined, auth);
  check('to-rule 不改 loop 事实日志（seq 不变）', loopAfterRule.body?.data?.seq === baseSeq,
    `base=${baseSeq} now=${loopAfterRule.body?.data?.seq}`);
  check('to-rule 不擅自创建规则', !Object.keys(loopAfterRule.body?.data?.rules ?? {}).some((n: string) => n.startsWith('adr-')));

  /* 9. 删除 / 审计 */
  section('⑨ 删除 / 审计 / 结束状态');
  const del = await call('DELETE', `/decisions/${weakId}`, undefined, auth);
  check('DELETE → 200', del.status === 200 && del.body?.data?.ok === true);
  check('删除后 GET → 404', (await call('GET', `/decisions/${weakId}`, undefined, auth)).status === 404);
  const audit = await call('GET', '/audit', undefined, auth);
  const actions = (audit.body?.data ?? []).map((a: any) => a.action);
  check('审计含 decision.create', actions.includes('decision.create'));
  check('审计含 decision.status.accepted', actions.includes('decision.status.accepted'));
  check('审计含 decision.to-rule', actions.includes('decision.to-rule'));

  /* 10. 多租户隔离 */
  section('⑩ 多租户隔离 / 全局零回归');
  const email2 = `decision2_${Date.now()}@test.local`;
  const reg2 = await call('POST', '/auth/register', { email: email2, password: 'Test123456' });
  const auth2 = { authorization: `Bearer ${reg2.body?.data?.token}` };
  const list2 = await call('GET', '/decisions', undefined, auth2);
  check('用户2 只看到自己的 4 条种子', (list2.body?.data ?? []).length === 4, `实际 ${list2.body?.data?.length}`);
  check('用户2 看不到用户1 创建的 ADR-0005',
    !(list2.body?.data ?? []).some((d: any) => d.id === 'ADR-0005'));
  const cross = await call('GET', '/decisions/ADR-0005', undefined, auth2);
  check('用户2 直接读用户1 决策 → 404', cross.status === 404, `实际 ${cross.status}`);

  const loopFinal = await call('GET', '/loop/state', undefined, auth);
  check('全程 loop 事实日志 seq 保持基线（零回归）', loopFinal.body?.data?.seq === baseSeq,
    `base=${baseSeq} final=${loopFinal.body?.data?.seq}`);
  const hz = await call('GET', '/loop/healthz');
  check('healthz 仍 0.4.0（内核未被改动）', hz.body?.data?.kernel === 'autoloop-web-0.4.0');

  console.log(`\n${'='.repeat(56)}`);
  console.log(`结果：\x1b[32m${passed} 通过\x1b[0m / \x1b[${failed ? 31 : 32}m${failed} 失败\x1b[0m`);
  console.log('='.repeat(56));
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
