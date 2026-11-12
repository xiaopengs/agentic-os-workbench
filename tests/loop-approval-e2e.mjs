/**
 * M3 审批卡片台 · 全链路 e2e（真实服务）
 *
 * 验收「挂起零消耗」可视化闭环的后端语义（需求文档 §6/§7）：
 *   ① 接入事件 → 命中规则派发一个 queued run
 *   ② 对该 run 交「带 ask 的回执」→ 产出 1 张 open 的 ask 卡片
 *      · derivedRuns 为空、Run 总数不变（挂起期间不派新活、不消耗 usage）
 *   ③ GET /loop/cards → 卡片可见且 options 完整
 *   ④ POST /loop/cards/:id/answer → 卡片 decided、answer 记录所选选项
 *      · 产生新 run 接原 lane（现在才启动），resumedRun 非空
 *      · facts 出现 card.answered / event.accepted / run.queued
 *   ⑤ GET /loop/state → totals.openCards 归零、runs 增加
 *   ⑥ why 溯源：原 run 与续跑 run 都能查到相关事实
 *   ⑦ 幂等/边界：重复 answer 同一卡片 → 409；choice 越界 → 400
 *   ⑧ 多租户：另一用户看不到我的卡片
 *
 * 用法：node tests/loop-approval-e2e.mjs [baseURL]
 *   默认 http://127.0.0.1:3737（需先启动 server.mjs）
 */
const BASE = (process.argv[2] || 'http://127.0.0.1:3737').replace(/\/+$/, '');

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++; else failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function register(email) {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test123456' }),
  });
  const b = await r.json().catch(() => ({}));
  return b?.data?.token;
}
const H = (t) => ({ Authorization: `Bearer ${t}` });
async function req(method, path, token, body) {
  const r = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { ...H(token), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const get = (p, t) => req('GET', p, t);
const post = (p, t, b) => req('POST', p, t, b ?? {});

console.log('── M3 审批卡片台 · 全链路 e2e ──\n');

const token = await register(`m3_${Date.now()}@test.local`);
if (!token) { check('注册账号', false); process.exit(1); }

// 先触发播种（种子 4 规则 / 11 事实）
const s0 = await get('/loop/state', token);
check('首访自动播种（4 规则）', s0.body?.data?.totals?.rules === 4, `rules=${s0.body?.data?.totals?.rules}`);
const seq0 = s0.body?.data?.seq;

/* ── ① 接入事件 → 派发一个 queued run ── */
const ev = await post('/loop/events', token, {
  id: `m3_issue_${Date.now()}`, source: 'github', type: 'issues.opened',
  subject: 'repo#128', summary: 'M3 演示：新 Issue 待拍板',
});
check('① 接入事件返回 201', ev.status === 201, `status=${ev.status}`);
check('① 命中「跟进 GitHub Issue」规则', (ev.body?.data?.routed ?? []).includes('跟进 GitHub Issue'),
  `routed=${JSON.stringify(ev.body?.data?.routed)}`);

const sAfterEvent = await get('/loop/state', token);
const queued = (sAfterEvent.body?.data?.runs ?? []).filter((r) => r.state === 'queued');
check('① 出现排队轮次', queued.length >= 1, `queued=${queued.length}`);
const runId = queued.sort((a, b) => b.seq - a.seq)[0]?.id;
const runsBeforeReceipt = sAfterEvent.body?.data?.totals?.runs;
const usageBefore = sAfterEvent.body?.data?.usage;
check('① 拿到轮次 id', !!runId, `runId=${runId}`);

/* ── ② 交带 ask 的回执 → 挂起零消耗 ── */
const ASK = {
  title: '是否合并这条修复？',
  text: 'Agent 已完成 repo#128 的排查并提交修复分支，等待确认。',
  options: ['合并到 main', '先放着，稍后再看', '关闭不处理'],
  recommend: 0,
};
const receipt = await post(`/loop/runs/${runId}/result`, token, {
  outcome: 'done', summary: 'Agent 完成分析，请求拍板', ask: [ASK],
});
check('② 交回执返回 201', receipt.status === 201, `status=${receipt.status}`);
const createdCards = receipt.body?.data?.cards ?? [];
check('② 回执产出 1 张卡片', createdCards.length === 1, `cards=${JSON.stringify(createdCards)}`);
const derivedRuns = receipt.body?.data?.derivedRuns ?? [];
check('② 挂起零消耗：derivedRuns 为空（未派新活）', derivedRuns.length === 0,
  `derivedRuns=${JSON.stringify(derivedRuns)}`);

const sHanging = await get('/loop/state', token);
const runsAfterReceipt = sHanging.body?.data?.totals?.runs;
check('② 挂起零消耗：Run 总数不变', runsAfterReceipt === runsBeforeReceipt,
  `before=${runsBeforeReceipt} after=${runsAfterReceipt}`);
// 挂起零消耗 = ask 回执不派新 Run、不额外消耗 Token。
// 回执本身未带 usage 字段，故 tokens / costCents 必须保持不变；
// usage.runs +1 是「这一轮完成」的正常计数（交任何回执都会 +1），非挂起开销。
check('② 挂起零消耗：tokens 未增长',
  sHanging.body?.data?.usage?.tokens === usageBefore?.tokens,
  `before=${usageBefore?.tokens} after=${sHanging.body?.data?.usage?.tokens}`);
check('② 挂起零消耗：costCents 未增长',
  sHanging.body?.data?.usage?.costCents === usageBefore?.costCents,
  `before=${usageBefore?.costCents} after=${sHanging.body?.data?.usage?.costCents}`);
const cardId = createdCards[0];
check('② 原 run 已完成（done）', sHanging.body?.data?.runs?.find((r) => r.id === runId)?.state === 'done');
check('② totals.openCards = 1', sHanging.body?.data?.totals?.openCards === 1,
  `openCards=${sHanging.body?.data?.totals?.openCards}`);

/* ── ③ 卡片列表可见且完整 ── */
const cardsRes = await get('/loop/cards', token);
const card = (cardsRes.body?.data ?? []).find((c) => c.id === cardId);
check('③ GET /loop/cards 含该卡片', !!card, `cards=${cardsRes.body?.data?.length}`);
check('③ 卡片 kind=ask / state=open', card?.kind === 'ask' && card?.state === 'open',
  `kind=${card?.kind} state=${card?.state}`);
check('③ 卡片 options 完整（3 项）', card?.options?.length === 3, `options=${JSON.stringify(card?.options)}`);
check('③ 卡片标题/正文正确', card?.title === ASK.title && card?.text === ASK.text);
check('③ 卡片关联原 run', card?.run === runId, `card.run=${card?.run}`);

/* ── ④ answer → 续跑 ── */
const answer = await post(`/loop/cards/${cardId}/answer`, token, { choice: 0 });
check('④ answer 返回 200', answer.status === 200, `status=${answer.status}`);
const resumedRun = answer.body?.data?.resumedRun;
check('④ 回答后产生续跑轮次', !!resumedRun, `resumedRun=${resumedRun}`);
const answerFacts = answer.body?.data?.facts ?? [];
const factsRes = await get('/loop/facts', token);
const allFacts = factsRes.body?.data ?? [];
const answerKinds = answerFacts
  .map((seq) => allFacts.find((f) => f.seq === seq)?.kind)
  .filter(Boolean);
check('④ facts 含 card.answered', answerKinds.includes('card.answered'), `kinds=${JSON.stringify(answerKinds)}`);
check('④ facts 含 event.accepted（回答是一条新事件）', answerKinds.includes('event.accepted'));
check('④ facts 含 run.queued（现在才启动）', answerKinds.includes('run.queued'));

const sResumed = await get('/loop/state', token);
const decidedCard = (sResumed.body?.data?.cards ?? []).find((c) => c.id === cardId);
check('④ 卡片变为 decided', decidedCard?.state === 'decided', `state=${decidedCard?.state}`);
check('④ 卡片记录所选选项', decidedCard?.answer === '合并到 main', `answer=${decidedCard?.answer}`);
const newRun = (sResumed.body?.data?.runs ?? []).find((r) => r.id === resumedRun);
check('④ 续跑 run 存在且为 queued', newRun?.state === 'queued', `state=${newRun?.state}`);
check('④ 续跑 run 接原事项 lane', newRun?.lane === sHanging.body?.data?.runs?.find((r) => r.id === runId)?.lane,
  `newLane=${newRun?.lane}`);
check('④ 续跑 run hops = 原 run + 1',
  newRun?.hops === (sHanging.body?.data?.runs?.find((r) => r.id === runId)?.hops ?? 0) + 1,
  `hops=${newRun?.hops}`);

/* ── ⑤ 全局状态收敛 ── */
check('⑤ totals.openCards 归零', sResumed.body?.data?.totals?.openCards === 0,
  `openCards=${sResumed.body?.data?.totals?.openCards}`);
check('⑤ Run 总数 +1（回答后才新增）',
  sResumed.body?.data?.totals?.runs === runsBeforeReceipt + 1,
  `before=${runsBeforeReceipt} final=${sResumed.body?.data?.totals?.runs}`);
check('⑤ 事实日志序号递增', sResumed.body?.data?.seq > seq0, `seq0=${seq0} seqFinal=${sResumed.body?.data?.seq}`);

/* ── ⑥ why 溯源 ── */
// why 返回 { run, timeline: Fact[] }（与前端 LoopWhyResp 镜像一致）
const whyOrig = await get(`/loop/runs/${runId}/why`, token);
const origTimeline = whyOrig.body?.data?.timeline;
check('⑥ 原 run 可溯源（timeline 含回执/卡片事实）',
  Array.isArray(origTimeline) && origTimeline.length > 0 &&
  origTimeline.some((f) => f.kind === 'run.finished'),
  `status=${whyOrig.status} timeline=${origTimeline?.length}`);
const whyResumed = await get(`/loop/runs/${resumedRun}/why`, token);
const resumedTimeline = whyResumed.body?.data?.timeline;
check('⑥ 续跑 run 可溯源', Array.isArray(resumedTimeline) && resumedTimeline.length > 0,
  `status=${whyResumed.status} timeline=${resumedTimeline?.length}`);

/* ── ⑦ 幂等 / 边界 ── */
const dup = await post(`/loop/cards/${cardId}/answer`, token, { choice: 0 });
check('⑦ 重复 answer 已结卡片 → 409', dup.status === 409, `status=${dup.status}`);

// 再造一张卡片测越界
const ev2 = await post('/loop/events', token, {
  id: `m3_issue2_${Date.now()}`, source: 'github', type: 'issues.opened', subject: 'repo#129',
});
const s2 = await get('/loop/state', token);
const queued2 = (s2.body?.data?.runs ?? []).filter((r) => r.state === 'queued').sort((a, b) => b.seq - a.seq)[0];
const rec2 = await post(`/loop/runs/${queued2.id}/result`, token, {
  outcome: 'done', ask: [{ title: '第二个问题？', options: ['是', '否'] }],
});
const cardId2 = rec2.body?.data?.cards?.[0];
const oob = await post(`/loop/cards/${cardId2}/answer`, token, { choice: 9 });
check('⑦ choice 越界 → 400', oob.status === 400, `status=${oob.status}`);
check('⑦ 越界后卡片仍 open',
  (await get('/loop/cards', token)).body?.data?.find((c) => c.id === cardId2)?.state === 'open');
void ev2;

/* ── ⑧ 多租户隔离 ── */
const other = await register(`m3_other_${Date.now()}@test.local`);
const otherCards = await get('/loop/cards', other);
check('⑧ 他人看不到我的卡片',
  !(otherCards.body?.data ?? []).some((c) => c.id === cardId || c.id === cardId2),
  `other cards=${otherCards.body?.data?.length}`);

console.log(`\n========================================================`);
console.log(`结果：${passed} 通过 / ${failed} 失败`);
console.log(`========================================================`);
if (failed > 0) process.exitCode = 1;
