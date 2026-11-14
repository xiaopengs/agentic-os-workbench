/**
 * M6 D1 闭环 · 决策 → 规则 → 事件 → 轮次 全链路 e2e（真实服务）
 *
 * 目的：M6 之前的测试只验证到「to-rule 生成草案」，没有验证草案能否真正
 * 落库、能否被事件命中、能否派一轮、以及决策域与 loop 事实域是否互不污染。
 * 本脚本把这些断点连成一条完整链路，跑在独立的 3738 预览服务上。
 *
 * 用法：node tests/decision-loop-integration.mjs [baseURL]
 *   默认 http://127.0.0.1:3738
 *   启动：PORT=3738 HOST=127.0.0.1 LOCAL_STORE=file \
 *         LOCAL_STORE_PATH=.data/store-test-3738.json LOCAL_AI_MOCK=1 \
 *         JWT_SECRET='...' NODE_ENV=production node --import tsx/esm frontend/server.mjs
 */
const BASE = (process.argv[2] || 'http://127.0.0.1:3738').replace(/\/+$/, '');

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++; else failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function req(method, path, token, body) {
  const r = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const get = (p, t) => req('GET', p, t);
const post = (p, t, b) => req('POST', p, t, b ?? {});
const del = (p, t) => req('DELETE', p, t);

async function register(tag) {
  const email = `${tag}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@test.local`;
  const r = await post('/auth/register', null, { email, password: 'Test123456' });
  return { email, token: r.body?.data?.token, status: r.status };
}

console.log('── M6 D1 闭环 · 决策 → 规则 → 事件 → 轮次（真实服务）──\n');

/* ── 0. 准备两个独立账号 ─────────────────────────────────────── */
const u1 = await register('integ1');
const u2 = await register('integ2');
check('账号注册成功', !!u1.token && !!u2.token, `${u1.status}/${u2.status}`);
if (!u1.token || !u2.token) { console.log('账号注册失败，终止'); process.exit(1); }

/* ── 1. 双域基线 ─────────────────────────────────────────────── */
const loop0 = await get('/loop/state', u1.token);
check('loop 首访自动播种（4 规则）', loop0.body?.data?.totals?.rules === 4,
  `rules=${loop0.body?.data?.totals?.rules}`);
const baseSeq = loop0.body?.data?.seq ?? 0;
check('loop 基线 seq > 0', baseSeq > 0, `seq=${baseSeq}`);
const dec0 = await get('/decisions', u1.token);
check('决策首访独立播种（4 条）', Array.isArray(dec0.body?.data) && dec0.body?.data?.length === 4,
  `count=${dec0.body?.data?.length}`);
check('决策播种不写 loop 事实', (await get('/loop/state', u1.token)).body?.data?.seq === baseSeq);

/* ── 2. 创建并接受一条 ADR ───────────────────────────────────── */
const created = await post('/decisions', u1.token, {
  title: '闭环测试：把决策变成可执行规则', owner: '集成测试', context: '验证 D1 全链路',
  decision: '采用规则草案落地', drivers: ['可追溯', '可执行'],
  criteria: [{ id: 'cost', name: '成本', weight: 100 }],
  options: [{
    id: 'rule', name: '生成 LoopRule', scores: { cost: 5 },
    pros: ['可自动执行'], cons: ['多一条规则'], assumptions: ['Agent 已登记'],
  }],
  chosenOptionId: 'rule',
  consequences: { positive: ['可追溯'], negative: ['规则数量增加'], risks: ['规则需复核'] },
  tags: ['集成'], reviewAt: '2026-12-31',
});
check('创建 ADR → 201 draft', created.status === 201 && created.body?.data?.status === 'draft',
  `status=${created.status}`);
const ADR = created.body?.data?.id;
check('分配 ADR-0005', ADR === 'ADR-0005', `id=${ADR}`);

const r1 = await post(`/decisions/${ADR}/review`, u1.token, { to: 'review' });
check('draft → review', r1.status === 200 && r1.body?.data?.status === 'review');
const r2 = await post(`/decisions/${ADR}/review`, u1.token, { to: 'accepted', note: '闭环验证' });
check('review → accepted', r2.status === 200 && r2.body?.data?.status === 'accepted');

/* ── 3. to-rule：草案 + 校验 ─────────────────────────────────── */
const toRule = await post(`/decisions/${ADR}/to-rule`, u1.token, {});
check('to-rule → 200', toRule.status === 200, `status=${toRule.status}`);
const draft = toRule.body?.data?.draft;
check('草案 valid:true', toRule.body?.data?.valid === true,
  `issues=${JSON.stringify(toRule.body?.data?.issues)}`);
check('草案 to 是已登记 Agent',
  (toRule.body?.data?.agents ?? []).includes(draft?.to), `to=${draft?.to}`);
check('草案监听 decision.accepted',
  draft?.when?.source === 'decision' && draft?.when?.types?.includes('decision.accepted'));
check('草案 title 带 ADR 编号', String(draft?.title ?? '').includes(ADR));
check('to-rule 不擅自落库规则',
  !((await get('/loop/state', u1.token)).body?.data?.rules ?? []).some((r) => r.name?.startsWith('adr-')));
check('to-rule 不改 loop 事实日志', (await get('/loop/state', u1.token)).body?.data?.seq === baseSeq);

/* ── 4. 前端等价的两步：checkRule → postRule ────────────────── */
const chk = await post('/loop/rules/check', u1.token, { rules: [draft] });
check('rules/check 校验草案通过', chk.status === 200 && chk.body?.data?.valid === true,
  `issues=${JSON.stringify(chk.body?.data?.issues)}`);
const posted = await post('/loop/rules', u1.token, draft);
check('rules 落库 → 201', posted.status === 201, `status=${posted.status}`);
const ruleName = draft?.name;
const loop1 = await get('/loop/state', u1.token);
check('state.rules 含新规则',
  (loop1.body?.data?.rules ?? []).some((r) => r.name === ruleName), `name=${ruleName}`);
check('规则总数 4 → 5', loop1.body?.data?.totals?.rules === 5,
  `rules=${loop1.body?.data?.totals?.rules}`);
check('落库写入事实（seq 增加）', (loop1.body?.data?.seq ?? 0) > baseSeq,
  `seq ${baseSeq} -> ${loop1.body?.data?.seq}`);
check('rulesVersion 递增', (loop1.body?.data?.rulesVersion ?? 0) > (loop0.body?.data?.rulesVersion ?? 0));

/* ── 5. 事件命中新规则 → 派一轮 ─────────────────────────────── */
const evId = `adr-accepted-${Date.now()}`;
const ev = await post('/loop/events', u1.token, {
  id: evId, source: 'decision', type: 'decision.accepted', subject: ADR,
  summary: `架构决策 ${ADR} 已接受`,
});
check('接入 decision.accepted 事件 → 201', ev.status === 201, `status=${ev.status}`);
check('事件命中新规则', (ev.body?.data?.routed ?? []).includes(ruleName),
  `routed=${JSON.stringify(ev.body?.data?.routed)}`);

const runs1 = await get('/loop/runs', u1.token);
const newRun = (runs1.body?.data?.runs ?? [])
  .find((r) => r.rule === ruleName && r.eventSeqs?.includes(ev.body?.data?.event));
check('产生属于新规则的 queued 轮次', !!newRun && newRun.state === 'queued',
  `run=${newRun?.id ?? 'none'}`);
check('轮次 Agent 与草案一致', newRun?.agent === draft?.to,
  `agent=${newRun?.agent} expected=${draft?.to}`);

const why = await get(`/loop/runs/${encodeURIComponent(newRun?.id ?? '')}/why`, u1.token);
const kinds = (why.body?.data?.timeline ?? []).map((f) => f.kind);
check('why 溯源含 event.accepted', kinds.includes('event.accepted'), `kinds=${kinds.join(',')}`);
check('why 溯源含 run.queued', kinds.includes('run.queued'));

/* ── 6. 幂等：重复事件不重复派活 ────────────────────────────── */
const seqBeforeDup = (await get('/loop/state', u1.token)).body?.data?.seq;
const dup = await post('/loop/events', u1.token, {
  id: evId, source: 'decision', type: 'decision.accepted', subject: ADR,
});
check('重复事件标记 duplicate:true', dup.body?.data?.duplicate === true,
  `duplicate=${dup.body?.data?.duplicate}`);
check('重复事件不命中规则', (dup.body?.data?.routed ?? []).length === 0);
const runsAfterDup = await get('/loop/runs', u1.token);
check('重复事件不新增轮次',
  (runsAfterDup.body?.data?.runs ?? []).filter((r) => r.rule === ruleName).length === 1);
check('幂等重放仍只记一条事实',
  (await get('/loop/state', u1.token)).body?.data?.seq === seqBeforeDup + 1,
  `seq=${seqBeforeDup} -> ${(await get('/loop/state', u1.token)).body?.data?.seq}`);

/* ── 7. 双域隔离 ─────────────────────────────────────────────── */
const decAfter = await get(`/decisions/${ADR}`, u1.token);
check('决策仍是 accepted（未被 loop 改写）', decAfter.body?.data?.status === 'accepted');
check('决策 history 仍是创建+2 次流转（转执行不写决策留痕）',
  (decAfter.body?.data?.history ?? []).length === 3,
  `len=${decAfter.body?.data?.history?.length}`);
check('决策实体不含 loop 字段（如 seq 之外的 runId）',
  decAfter.body?.data?.runId === undefined && decAfter.body?.data?.facts === undefined);
const decList = await get('/decisions', u1.token);
check('决策列表数量 = 5（未因规则落库增减）', decList.body?.data?.length === 5,
  `count=${decList.body?.data?.length}`);

const otherDec = await get(`/decisions/${ADR}`, u2.token);
check('多租户：用户2 读不到该 ADR → 404', otherDec.status === 404, `status=${otherDec.status}`);
const otherLoop = await get('/loop/state', u2.token);
check('多租户：用户2 loop 不含该规则',
  !(otherLoop.body?.data?.rules ?? []).some((r) => r.name?.startsWith('adr-')));

/* ── 8. 插件启停联动（M4 能力对新规则同样生效） ─────────────── */
const agentId = draft?.to;
const disabled = await post(`/loop/plugins/${encodeURIComponent(agentId)}/disable`, u1.token, { reason: '闭环测试' });
check('停用 Agent → 200', disabled.status === 200, `status=${disabled.status}`);
const ev2 = await post('/loop/events', u1.token, {
  id: `${evId}-2`, source: 'decision', type: 'decision.accepted', subject: ADR,
});
check('停用 Agent 后新规则不派活', !(ev2.body?.data?.routed ?? []).includes(ruleName),
  `routed=${JSON.stringify(ev2.body?.data?.routed)}`);
const enabled = await post(`/loop/plugins/${encodeURIComponent(agentId)}/enable`, u1.token, {});
check('启用 Agent → 200', enabled.status === 200, `status=${enabled.status}`);
const ev3 = await post('/loop/events', u1.token, {
  id: `${evId}-3`, source: 'decision', type: 'decision.accepted', subject: `${ADR}-3`,
});
check('重新启用后规则恢复命中', (ev3.body?.data?.routed ?? []).includes(ruleName),
  `routed=${JSON.stringify(ev3.body?.data?.routed)}`);

/* ── 9. 收尾一致性 ───────────────────────────────────────────── */
const healthz = await get('/loop/healthz');
check('healthz 内核版本 0.4.0', healthz.body?.data?.kernel === 'autoloop-web-0.4.0');
const finalSeq = (await get('/loop/state', u1.token)).body?.data?.seq ?? 0;
check('全程事实日志单调递增', finalSeq > baseSeq, `seq=${finalSeq}`);
const delDec = await del(`/decisions/${ADR}`, u1.token);
check('删除决策不影响已落库规则', delDec.status === 200
  && !!(await get('/loop/state', u1.token)).body?.data?.rules?.some((r) => r.name === ruleName));

console.log('\n' + '─'.repeat(56));
console.log(`总计 ${passed + failed} 项，通过 ${passed}，失败 ${failed}`);
console.log('─'.repeat(56));
process.exit(failed === 0 ? 0 : 1);
