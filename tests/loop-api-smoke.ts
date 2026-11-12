/**
 * REST 全链路冒烟 · Agent Autoloop `/loop/*` 端点
 *
 * 与 tests/loop-kernel.test.ts（纯内核函数）互补：本文件通过真实
 * `handleRequest` 路由层跑通「鉴权 → 路由匹配 → 播种 → commit → 读快照 → 信封」，
 * 验证 M1 的 HTTP 接线是否正确，不依赖服务器、不依赖网络。
 *
 * 用法：npx tsx tests/loop-api-smoke.ts
 */
import { handleRequest } from '../backend/functions/router';

/* ── 内存 KV mock（实现平台 get/put/delete/list 契约） ──
 * slow 模式：在 get/put 上注入一次宏任务让出，模拟生产 file/KV 驱动的真实 IO 间隙，
 * 使「并发首访播种」用例能真正复现竞态（否则单线程微任务调度下会假绿）。 */
class MockKV {
  private data = new Map<string, string>();
  static slow = false;
  private async io(): Promise<void> {
    if (MockKV.slow) await new Promise<void>((res) => setImmediate(res));
  }
  async get(key: string, type?: string): Promise<any> {
    await this.io();
    const v = this.data.get(key);
    if (v === undefined) return null;
    return type === 'json' ? JSON.parse(v) : v;
  }
  async put(key: string, value: string): Promise<void> { await this.io(); this.data.set(key, String(value)); }
  async delete(key: string): Promise<void> { await this.io(); this.data.delete(key); }
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
  if (ok) passed++; else failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

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

async function main(): Promise<void> {
  console.log('── /loop/* REST 全链路冒烟测试（mock KV，真实路由/鉴权/信封）──\n');

  /* 1. 健康检查（无需鉴权） */
  const hz = await call('GET', '/loop/healthz');
  check('GET /loop/healthz → 200 且 kernel 标识', hz.status === 200 && hz.body?.data?.status === 'ok', `实际 ${hz.status}`);

  /* 2. 未登录访问受保护资源 */
  const anon = await call('GET', '/loop/state');
  check('未登录 GET /loop/state → 401', anon.status === 401, `实际 ${anon.status}`);

  /* 3. 注册拿 token */
  const email = `loop_${Date.now()}@test.local`;
  const reg = await call('POST', '/auth/register', { email, password: 'Test123456' });
  const token: string = reg.body?.data?.token;
  check('注册返回 token', typeof token === 'string' && token.length > 20);
  const auth = { authorization: `Bearer ${token}` };

  /* 4. 首次访问自动播种：4 条规则 + 插件，事实日志非空 */
  const s0 = await call('GET', '/loop/state', undefined, auth);
  check('GET /loop/state → 200 ok 信封', s0.status === 200 && s0.body?.ok === true, `实际 ${s0.status}`);
  check('自动播种 4 条规则', s0.body?.data?.totals?.rules === 4, `实际 ${s0.body?.data?.totals?.rules}`);
  check('自动播种 Agent ≥ 2', (s0.body?.data?.agents?.length ?? 0) >= 2);
  check('事实日志已产生（seq > 0）', (s0.body?.data?.seq ?? 0) > 0, `seq=${s0.body?.data?.seq}`);
  const baseSeq: number = s0.body?.data?.seq ?? 0;

  /* 5. 规则 / 事实 / 卡片 只读端点 */
  const rules = await call('GET', '/loop/rules', undefined, auth);
  check('GET /loop/rules → 数组且 4 条', Array.isArray(rules.body?.data) && rules.body.data.length === 4);
  const facts0 = await call('GET', '/loop/facts', undefined, auth);
  check('GET /loop/facts → 事实数组非空', Array.isArray(facts0.body?.data) && facts0.body.data.length > 0);
  const cards0 = await call('GET', '/loop/cards', undefined, auth);
  check('GET /loop/cards → 数组', Array.isArray(cards0.body?.data));

  /* 6. 指令数据分离：事件携带 cwd 指令字段 → 400 */
  const illegal = await call('POST', '/loop/events', {
    id: 'evt-illegal-1', source: 'github', type: 'issues.opened', cwd: '~/pwn',
  }, auth);
  check('事件携带指令字段 cwd → 400（指令数据分离）', illegal.status === 400, `实际 ${illegal.status}`);

  /* 7. 合法事件 → 命中规则 → 派发轮次 */
  const ev = await call('POST', '/loop/events', {
    id: 'evt-issue-1', source: 'github', type: 'issues.opened',
    subject: 'xiaopengs/repo#42', summary: '新 Issue 待跟进',
  }, auth);
  check('POST /loop/events → 201', ev.status === 201, `实际 ${ev.status}`);
  check('事件被路由（routed 非空）', Array.isArray(ev.body?.data?.routed) && ev.body.data.routed.length > 0,
    JSON.stringify(ev.body?.data?.routed));
  const runs1 = await call('GET', '/loop/runs', undefined, auth);
  check('事件派生出轮次', Array.isArray(runs1.body?.data?.runs) && runs1.body.data.runs.length > 0,
    `runs=${runs1.body?.data?.runs?.length}`);

  /* 8. 重复事件 id → duplicate 且不重复累计（幂等） */
  const dup = await call('POST', '/loop/events', {
    id: 'evt-issue-1', source: 'github', type: 'issues.opened',
  }, auth);
  check('重复事件 id → duplicate:true', dup.body?.data?.duplicate === true, JSON.stringify(dup.body?.data));
  const s1 = await call('GET', '/loop/state', undefined, auth);
  check('重复事件不新增轮次', s1.body?.data?.totals?.runs === 1, `runs=${s1.body?.data?.totals?.runs}`);

  /* 9. 跳数熔断：hops > 8 只记录不派活 */
  const hop = await call('POST', '/loop/events', {
    id: 'evt-hop-99', source: 'github', type: 'issues.opened', hops: 99,
  }, auth);
  check('hops 超限 → hopBlocked:true', hop.body?.data?.hopBlocked === true, JSON.stringify(hop.body?.data));
  const s2 = await call('GET', '/loop/state', undefined, auth);
  check('熔断不新增轮次', s2.body?.data?.totals?.runs === 1, `runs=${s2.body?.data?.totals?.runs}`);

  /* 10. emit 预演不落库 */
  const before = await call('GET', '/loop/state', undefined, auth);
  const emitted = await call('POST', '/loop/emit', {
    id: 'evt-dry-1', source: 'shop', type: 'alert.cpu',
  }, auth);
  check('POST /loop/emit → 200 且返回 matched', emitted.status === 200 && Array.isArray(emitted.body?.data?.matched),
    JSON.stringify(emitted.body?.data));
  const after = await call('GET', '/loop/state', undefined, auth);
  check('emit 预演不改变 seq（不落库）', before.body?.data?.seq === after.body?.data?.seq,
    `${before.body?.data?.seq} → ${after.body?.data?.seq}`);

  /* 11. 规则校验 / 暂停 / 恢复 */
  const checkOk = await call('POST', '/loop/rules/check', {
    name: '临时规则', to: 'claude', cwd: '~/x', group: 'g', tell: 'needed',
    when: { source: 'shop', types: ['order.created'] },
  }, auth);
  check('rules/check 合法草稿 → valid:true', checkOk.body?.data?.valid === true, JSON.stringify(checkOk.body?.data?.issues));
  const checkBad = await call('POST', '/loop/rules/check', {
    name: '坏规则', to: 'not-registered', cwd: '', when: {},
  }, auth);
  check('rules/check 非法草稿 → valid:false', checkBad.body?.data?.valid === false);
  const paused = await call('POST', '/loop/rules/%E8%B7%9F%E8%BF%9B%20GitHub%20Issue/pause', { reason: '冒烟' }, auth);
  check('POST /loop/rules/:name/pause → 200', paused.status === 200, `实际 ${paused.status}`);
  const sPause = await call('GET', '/loop/state', undefined, auth);
  check('暂停后 activeRules 减少', sPause.body?.data?.totals?.activeRules === 3,
    `activeRules=${sPause.body?.data?.totals?.activeRules}`);
  const resumed = await call('POST', '/loop/rules/%E8%B7%9F%E8%BF%9B%20GitHub%20Issue/resume', {}, auth);
  check('POST /loop/rules/:name/resume → 200', resumed.status === 200, `实际 ${resumed.status}`);

  /* 12. 轮次领活 + 回执幂等 + why 溯源 */
  const runId: string | undefined = runs1.body?.data?.runs?.[0]?.id;
  if (runId) {
    const claim = await call('POST', `/loop/runs/${runId}/claim`, {}, auth);
    check('POST /loop/runs/:id/claim → 200', claim.status === 200, `实际 ${claim.status}`);
    const receipt = { outcome: 'done', summary: '已处理' };
    const r1 = await call('POST', `/loop/runs/${runId}/result`, receipt, auth);
    check('POST /loop/runs/:id/result → 201', r1.status === 201, `实际 ${r1.status}`);
    const r2 = await call('POST', `/loop/runs/${runId}/result`, receipt, auth);
    check('相同回执重交 → duplicate:true（幂等）', r2.body?.data?.duplicate === true, JSON.stringify(r2.body?.data));
    const r3 = await call('POST', `/loop/runs/${runId}/result`, { outcome: 'failed' }, auth);
    check('不同内容回执重交 → 409 冲突', r3.status === 409, `实际 ${r3.status}`);
    const why = await call('GET', `/loop/runs/${runId}/why`, undefined, auth);
    check('GET /loop/runs/:id/why → 溯源时间线非空', why.status === 200 && Array.isArray(why.body?.data?.timeline) && why.body.data.timeline.length > 0,
      `timeline=${why.body?.data?.timeline?.length}`);
  } else {
    check('取得轮次 id 用于后续用例', false, '未找到 run');
  }

  /* 13. tick 幂等（同一天重复不重复触发 cron） */
  const tick = await call('POST', '/loop/tick', {}, auth);
  check('POST /loop/tick → 200', tick.status === 200, `实际 ${tick.status}`);

  /* 14. 插件登记 */
  const plugin = await call('POST', '/loop/plugins', {
    kind: 'source', id: 'webhook', name: '自定义 Webhook', adapter: 'webhook',
  }, auth);
  check('POST /loop/plugins → 201', plugin.status === 201, `实际 ${plugin.status}`);

  /* 15. 多租户隔离：另一用户看到独立播种，不共享事实 */
  const other = await call('POST', '/auth/register', { email: `other_${Date.now()}@test.local`, password: 'Test123456' });
  const otherAuth = { authorization: `Bearer ${other.body?.data?.token}` };
  const otherState = await call('GET', '/loop/state', undefined, otherAuth);
  check('另一用户独立播种（rules=4）', otherState.body?.data?.totals?.rules === 4);
  const mine = await call('GET', '/loop/state', undefined, auth);
  check('我的 seq 不受他人影响且持续增长', mine.body?.data?.seq > baseSeq,
    `baseSeq=${baseSeq} now=${mine.body?.data?.seq}`);
  check('他人看不到我的额外事件', otherState.body?.data?.totals?.events === 0,
    `others events=${otherState.body?.data?.totals?.events}`);

  /* 16. 并发首访「结果契约」检查：总览同时发 state + facts，两个只读请求都必须
   *     返回完整数据（4 规则 / 11 事实），且首次响应不能是半成品。
   *     注意：本文件用内存 KV + 同步调度，无法稳定复现竞态写入（是否重复播种取决于
   *     事件循环调度）。真正能抓「种子写两遍」的权威回归见 loop-concurrency-e2e.mjs
   *     （连真实 file 驱动服务、真实 HTTP 并发）。
   */
  const conc = await call('POST', '/auth/register', {
    email: `conc_${Date.now()}@test.local`, password: 'Test123456',
  });
  const concAuth = { authorization: `Bearer ${conc.body?.data?.token}` };
  MockKV.slow = true; // 打开 IO 让出，制造真实并发窗口
  const [cs, cf] = await Promise.all([
    call('GET', '/loop/state', undefined, concAuth),
    call('GET', '/loop/facts', undefined, concAuth),
  ]);
  MockKV.slow = false;
  const concState = await call('GET', '/loop/state', undefined, concAuth);
  const concFacts: any[] = cf.body?.data ?? [];
  check('并发首访：两个请求都返回 200', cs.status === 200 && cf.status === 200,
    `state=${cs.status} facts=${cf.status}`);
  check('并发首访：规则恰好 4 条（不重复播种）',
    cs.body?.data?.totals?.rules === 4 && concState.body?.data?.totals?.rules === 4,
    `首次=${cs.body?.data?.totals?.rules} 最终=${concState.body?.data?.totals?.rules}`);
  check('并发首访：事实日志恰好 11 条（种子只写一遍）', concFacts.length === 11,
    `facts=${concFacts.length} seq=${concState.body?.data?.seq}`);
  check('并发首访：首次响应即含完整规则（不读半成品）',
    Array.isArray(cs.body?.data?.rules) && cs.body.data.rules.length === 4,
    `首次 rules=${cs.body?.data?.rules?.length}`);

  /* 17. M4 插件启停端点（事实化 / 幂等 / 停用后预演不派活） */
  const dis1 = await call('POST', '/loop/plugins/github/disable', { reason: '维护中' }, auth);
  check('POST /loop/plugins/:id/disable → 200', dis1.status === 200 && dis1.body?.data?.disabled === true,
    `实际 ${dis1.status}`);
  const sDis = await call('GET', '/loop/state', undefined, auth);
  check('停用后 state.disabledPlugins 含 github', !!sDis.body?.data?.disabledPlugins?.github);
  const preDis = await call('POST', '/loop/emit', {
    id: 'm4-emit-dis', source: 'github', type: 'issues.opened',
  }, auth);
  check('停用 Source 后预演 matched 为空', Array.isArray(preDis.body?.data?.matched) && preDis.body.data.matched.length === 0,
    JSON.stringify(preDis.body?.data?.matched));
  const dis2 = await call('POST', '/loop/plugins/github/disable', {}, auth);
  check('重复停用 → 404（幂等，不产事实）', dis2.status === 404, `实际 ${dis2.status}`);
  const disNo = await call('POST', '/loop/plugins/no_such/disable', {}, auth);
  check('停用不存在插件 → 404', disNo.status === 404, `实际 ${disNo.status}`);
  const en1 = await call('POST', '/loop/plugins/github/enable', {}, auth);
  check('POST /loop/plugins/:id/enable → 200', en1.status === 200 && en1.body?.data?.disabled === false,
    `实际 ${en1.status}`);
  const sEn = await call('GET', '/loop/state', undefined, auth);
  check('启用后 state.disabledPlugins 移除 github', !sEn.body?.data?.disabledPlugins?.github);
  const preEn = await call('POST', '/loop/emit', {
    id: 'm4-emit-en', source: 'github', type: 'issues.opened',
  }, auth);
  check('启用后预演恢复命中', Array.isArray(preEn.body?.data?.matched) && preEn.body.data.matched.length > 0,
    JSON.stringify(preEn.body?.data?.matched));
  const en2 = await call('POST', '/loop/plugins/github/enable', {}, auth);
  check('重复启用 → 404（幂等）', en2.status === 404, `实际 ${en2.status}`);

  /* 18. M4 通道级应答身份校验（越权 403 / 名单内 200 / M3 无名单零回归） */
  // 造一张带 channel=feishu（种子 answerers=['ou_owner']）的受限卡片
  const m4ev = await call('POST', '/loop/events', {
    id: 'm4-restricted-ev', source: 'github', type: 'issues.opened', subject: 'repo#88',
  }, auth);
  check('受限卡片：接入事件 201', m4ev.status === 201, `实际 ${m4ev.status}`);
  const m4runs = await call('GET', '/loop/runs', undefined, auth);
  const m4run = (m4runs.body?.data?.runs ?? []).find((r: any) =>
    r.eventSeqs?.includes(m4ev.body?.data?.event));
  const m4res = await call('POST', `/loop/runs/${m4run?.id}/result`, {
    outcome: 'done', summary: '请求拍板（受限通道）',
    ask: [{ title: '是否合并？', text: '需 feishu 应答者确认', options: ['合并', '暂缓'], channel: 'feishu' }],
  }, auth);
  check('受限卡片：交回执产卡片', m4res.status === 201 && (m4res.body?.data?.cards?.length ?? 0) > 0,
    `实际 ${m4res.status}`);
  const m4cardId = m4res.body?.data?.cards?.[0];
  const m4cards = await call('GET', '/loop/cards', undefined, auth);
  const m4card = (m4cards.body?.data ?? []).find((c: any) => c.id === m4cardId);
  check('受限卡片快照 answerers 与 channel', m4card?.channel === 'feishu' && m4card?.answerers?.includes('ou_owner'),
    JSON.stringify({ channel: m4card?.channel, answerers: m4card?.answerers }));
  const deny = await call('POST', `/loop/cards/${m4cardId}/answer`, { choice: 0 }, auth);
  check('越权：会话 email 不在名单 → 403', deny.status === 403, `实际 ${deny.status}`);
  check('越权：返回 FORBIDDEN 错误码', deny.body?.error?.code === 'FORBIDDEN', JSON.stringify(deny.body?.error));
  const afterDeny = await call('GET', '/loop/cards', undefined, auth);
  const afterDenyCard = (afterDeny.body?.data ?? []).find((c: any) => c.id === m4cardId);
  check('越权不改变卡片状态（仍 open）', afterDenyCard?.state === 'open', `state=${afterDenyCard?.state}`);
  // 把当前会话 email 加进 feishu 通道白名单（登记同名 channel 覆盖），再回答 → 200
  await call('POST', '/loop/plugins', {
    kind: 'channel', id: 'feishu', name: '飞书', answerers: ['ou_owner', email],
  }, auth);
  // 卡片白名单是创建时快照，改通道不影响既有卡片；再建一张新卡片验证名单内放行
  const m4ev2 = await call('POST', '/loop/events', {
    id: 'm4-allowed-ev', source: 'shop', type: 'site.check', subject: 'home',
  }, auth);
  const m4runs2 = await call('GET', '/loop/runs', undefined, auth);
  const m4run2 = (m4runs2.body?.data?.runs ?? []).find((r: any) =>
    r.eventSeqs?.includes(m4ev2.body?.data?.event));
  const m4res2 = await call('POST', `/loop/runs/${m4run2?.id}/result`, {
    outcome: 'done', ask: [{ title: '确认巡检结果？', options: ['通过', '复检'], channel: 'feishu' }],
  }, auth);
  const m4card2Id = m4res2.body?.data?.cards?.[0];
  const allow = await call('POST', `/loop/cards/${m4card2Id}/answer`, { choice: 0 }, auth);
  check('名单内：会话 email 在白名单 → 200', allow.status === 200, `实际 ${allow.status}`);
  check('名单内：回答触发续跑（resumedRun 非空）', !!allow.body?.data?.resumedRun,
    `resumedRun=${allow.body?.data?.resumedRun}`);
  // 未带 channel 的卡片（M3 演示路径）→ 无名单 → 任何登录本人可答
  const m4ev3 = await call('POST', '/loop/events', {
    id: 'm4-free-ev', source: 'shop', type: 'alert.cpu', subject: 'svc',
  }, auth);
  const m4runs3 = await call('GET', '/loop/runs', undefined, auth);
  const m4run3 = (m4runs3.body?.data?.runs ?? []).find((r: any) =>
    r.eventSeqs?.includes(m4ev3.body?.data?.event));
  const m4res3 = await call('POST', `/loop/runs/${m4run3?.id}/result`, {
    outcome: 'done', ask: [{ title: '是否处理告警？', options: ['处理', '忽略'] }],
  }, auth);
  const m4card3Id = m4res3.body?.data?.cards?.[0];
  const freeAns = await call('POST', `/loop/cards/${m4card3Id}/answer`, { choice: 0 }, auth);
  check('无名单卡片登录本人可答（M3 零回归）→ 200', freeAns.status === 200, `实际 ${freeAns.status}`);

  /* 19. M4 why 溯源 / emit 预演端点契约（check 契约已由第 10 段覆盖） */
  const why = await call('GET', `/loop/runs/${m4run?.id}/why`, undefined, auth);
  check('GET /loop/runs/:id/why → { run, timeline }',
    why.status === 200 && why.body?.data?.run === m4run?.id && Array.isArray(why.body?.data?.timeline)
    && why.body.data.timeline.length > 0,
    `status=${why.status} timeline=${why.body?.data?.timeline?.length}`);
  const whyBad = await call('GET', '/loop/runs/no_such_run/why', undefined, auth);
  check('why 不存在的轮次 → 404', whyBad.status === 404, `实际 ${whyBad.status}`);
  const seqBefore = (await call('GET', '/loop/state', undefined, auth)).body?.data?.seq;
  const emitDry = await call('POST', '/loop/emit', {
    id: 'm4-dry', source: 'github', type: 'issues.opened',
  }, auth);
  const seqAfter = (await call('GET', '/loop/state', undefined, auth)).body?.data?.seq;
  check('emit 预演 → 200 且 matched 非空', emitDry.status === 200 && (emitDry.body?.data?.matched?.length ?? 0) > 0,
    JSON.stringify(emitDry.body?.data));
  check('emit 预演不落库（seq 不变）', seqBefore === seqAfter, `${seqBefore} → ${seqAfter}`);

  console.log(`\n========================================================`);
  console.log(`结果：${passed} 通过 / ${failed} 失败`);
  console.log(`========================================================`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
