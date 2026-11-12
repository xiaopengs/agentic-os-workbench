/**
 * M4 · 插件体系 / why 溯源 / 规则预演 / 通道级身份校验 · 全链路 e2e（真实服务）
 *
 * 验收需求文档 §6 M4 + §9 风险表「卡片回答身份：通道 answerers 校验」：
 *   ① 插件启停闭环：登记插件 → 停用（事实化、投影可见）→ 停用后事件不派活 → 启用恢复派活
 *   ② why 溯源：任意一轮（含续跑轮次）都能重现完整事实时间线
 *   ③ check / emit：规则集校验 valid/issues；emit 预演命中且不落库（seq 不变）
 *   ④ answerers 越权：受限通道卡片，会话 email 不在白名单 → 403；在白名单 → 200 + 续跑
 *   ⑤ M3 零回归：不带 channel 的卡片，登录本人可答 → 200
 *
 * 用法：node tests/loop-m4-e2e.mjs [baseURL]
 *   默认 http://127.0.0.1:3737（需先启动加载 M4 的 server.mjs）
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

/** 接入一条 github 事件，返回最新 queued run id */
async function issueEvent(token, id) {
  const ev = await post('/loop/events', token, {
    id, source: 'github', type: 'issues.opened', subject: 'repo#128', summary: 'M4 e2e',
  });
  const runs = await get('/loop/runs', token);
  const run = (runs.body?.data?.runs ?? [])
    .filter((r) => r.state === 'queued' && r.eventSeqs?.includes(ev.body?.data?.event))
    .sort((a, b) => b.seq - a.seq)[0];
  return { ev, run };
}

console.log('── M4 插件/溯源/预演/身份校验 · 全链路 e2e ──\n');

const email = `m4_${Date.now()}@test.local`;
const token = await register(email);
if (!token) { check('注册账号', false); process.exit(1); }

// 触发播种（4 规则 / 11 事实）
const s0 = await get('/loop/state', token);
check('① 首访自动播种（4 规则）', s0.body?.data?.totals?.rules === 4,
  `rules=${s0.body?.data?.totals?.rules}`);
check('① 初始 disabledPlugins 为空', Object.keys(s0.body?.data?.disabledPlugins ?? {}).length === 0);

/* ═══ ① 插件启停闭环 ═══ */
// 登记一个自定义 source 插件
const reg = await post('/loop/plugins', token, {
  kind: 'source', id: 'm4source', name: 'M4 测试源', adapter: 'webhook',
});
check('① 登记插件 → 201', reg.status === 201, `status=${reg.status}`);
const dis = await post('/loop/plugins/m4source/disable', token, { reason: 'M4 维护中' });
check('① 停用插件 → 200 disabled:true', dis.status === 200 && dis.body?.data?.disabled === true,
  `status=${dis.status}`);
const sDis = await get('/loop/state', token);
check('① 停用写入事实日志（seq 增长）', sDis.body?.data?.seq > s0.body?.data?.seq);
check('① state.disabledPlugins 含 m4source 且带 reason',
  sDis.body?.data?.disabledPlugins?.m4source?.reason === 'M4 维护中');
const factsDis = await get('/loop/facts', token);
check('① 事实日志出现 plugin.disabled',
  (factsDis.body?.data ?? []).some((f) => f.kind === 'plugin.disabled' && f.id === 'm4source'));
const disDup = await post('/loop/plugins/m4source/disable', token, {});
check('① 重复停用 → 404（幂等）', disDup.status === 404, `status=${disDup.status}`);

// 停用已登记的 github 源 → 事件不再派活
await post('/loop/plugins/github/disable', token, { reason: 'M4 演练' });
const preDis = await post('/loop/emit', token, { id: 'm4-pre-dis', source: 'github', type: 'issues.opened' });
check('① 停用 Source 后预演 matched 为空', (preDis.body?.data?.matched ?? []).length === 0,
  `matched=${JSON.stringify(preDis.body?.data?.matched)}`);
const en = await post('/loop/plugins/github/enable', token, {});
check('① 启用插件 → 200 disabled:false', en.status === 200 && en.body?.data?.disabled === false,
  `status=${en.status}`);
const sEn = await get('/loop/state', token);
check('① 启用后 state.disabledPlugins 移除 github', !sEn.body?.data?.disabledPlugins?.github);
const factsEn = await get('/loop/facts', token);
check('① 事实日志出现 plugin.enabled',
  (factsEn.body?.data ?? []).some((f) => f.kind === 'plugin.enabled' && f.id === 'github'));
const preEn = await post('/loop/emit', token, { id: 'm4-pre-en', source: 'github', type: 'issues.opened' });
check('① 启用后预演恢复命中「跟进 GitHub Issue」',
  (preEn.body?.data?.matched ?? []).includes('跟进 GitHub Issue'),
  `matched=${JSON.stringify(preEn.body?.data?.matched)}`);

/* ═══ ③ check / emit 预演（不落库）═══ */
const seqBefore = (await get('/loop/state', token)).body?.data?.seq;
const emitDry = await post('/loop/emit', token, { id: 'm4-dry', source: 'github', type: 'issues.opened' });
check('③ emit 预演 → 200 且返回 matched', emitDry.status === 200 && Array.isArray(emitDry.body?.data?.matched),
  `status=${emitDry.status}`);
check('③ emit 预演命中规则', (emitDry.body?.data?.matched ?? []).length > 0);
const seqAfter = (await get('/loop/state', token)).body?.data?.seq;
check('③ emit 预演不落库（seq 不变）', seqBefore === seqAfter, `${seqBefore} → ${seqAfter}`);
const checkGood = await post('/loop/rules/check', token, {
  rules: [{ name: '合法规则', when: { source: 'github', types: ['issues.*'] }, to: 'claude', cwd: '~/x', group: 'g', tell: 'needed' }],
});
check('③ check 合法规则 → valid:true', checkGood.status === 200 && checkGood.body?.data?.valid === true);
const checkBad = await post('/loop/rules/check', token, {
  rules: [{ name: '', when: { source: 'github', types: [] }, to: '', cwd: '', group: '', tell: 'needed' }],
});
check('③ check 非法规则 → valid:false + issues', checkGood.status === 200 && checkBad.body?.data?.valid === false
  && (checkBad.body?.data?.issues ?? []).length > 0);
const checkDup = await post('/loop/rules/check', token, {
  rules: [
    { name: '同名', when: { source: 'github', types: ['issues.*'] }, to: 'claude', cwd: '~/x', group: 'g', tell: 'needed' },
    { name: '同名', when: { source: 'github', types: ['issues.*'] }, to: 'claude', cwd: '~/x', group: 'g', tell: 'needed' },
  ],
});
check('③ check 检出规则名重复', checkDup.body?.data?.valid === false
  && (checkDup.body?.data?.issues ?? []).some((s) => s.includes('重复')));

/* ═══ ④ answerers 越权 / 白名单放行 ═══ */
// 造受限卡片（channel=feishu，种子 answerers=['ou_owner']，会话 email 不在名单）
const { run: rRestricted } = await issueEvent(token, `m4_restricted_${Date.now()}`);
const resR = await post(`/loop/runs/${rRestricted?.id}/result`, token, {
  outcome: 'done', summary: '请求拍板（受限通道）',
  ask: [{ title: '是否合并？', text: '需 feishu 应答者确认', options: ['合并', '暂缓'], channel: 'feishu' }],
});
const cardRId = resR.body?.data?.cards?.[0];
check('④ 受限卡片：交回执产卡片', resR.status === 201 && !!cardRId, `status=${resR.status}`);
const cardsR = await get('/loop/cards', token);
const cardR = (cardsR.body?.data ?? []).find((c) => c.id === cardRId);
check('④ 受限卡片快照 channel=feishu', cardR?.channel === 'feishu', `channel=${cardR?.channel}`);
check('④ 受限卡片快照 answerers 含 ou_owner', cardR?.answerers?.includes('ou_owner'),
  `answerers=${JSON.stringify(cardR?.answerers)}`);
const deny = await post(`/loop/cards/${cardRId}/answer`, token, { choice: 0 });
check('④ 越权：会话 email 不在白名单 → 403', deny.status === 403, `status=${deny.status}`);
check('④ 越权：错误码 FORBIDDEN', deny.body?.error?.code === 'FORBIDDEN', JSON.stringify(deny.body?.error));
const cardsAfterDeny = await get('/loop/cards', token);
const cardAfterDeny = (cardsAfterDeny.body?.data ?? []).find((c) => c.id === cardRId);
check('④ 越权不改变卡片状态（仍 open）', cardAfterDeny?.state === 'open', `state=${cardAfterDeny?.state}`);

// 把会话 email 加进一个新通道白名单，造卡片 → 名单内放行
await post('/loop/plugins', token, {
  kind: 'channel', id: 'm4gate', name: 'M4 授权通道', answerers: [email],
});
const { run: rAllowed } = await issueEvent(token, `m4_allowed_${Date.now()}`);
const resA = await post(`/loop/runs/${rAllowed?.id}/result`, token, {
  outcome: 'done', summary: '请求拍板（授权通道）',
  ask: [{ title: '确认发布？', text: '会话身份已授权', options: ['发布', '取消'], channel: 'm4gate' }],
});
const cardAId = resA.body?.data?.cards?.[0];
const allow = await post(`/loop/cards/${cardAId}/answer`, token, { choice: 0 });
check('④ 名单内：会话 email 在白名单 → 200', allow.status === 200, `status=${allow.status}`);
check('④ 名单内：回答触发续跑（resumedRun 非空）', !!allow.body?.data?.resumedRun,
  `resumedRun=${allow.body?.data?.resumedRun}`);
const resumedRun = allow.body?.data?.resumedRun;

/* ═══ ② why 溯源：任意一轮可重现 ═══ */
const whyOrig = await get(`/loop/runs/${rAllowed?.id}/why`, token);
check('② why 原轮次 → { run, timeline }',
  whyOrig.status === 200 && whyOrig.body?.data?.run === rAllowed?.id
  && Array.isArray(whyOrig.body?.data?.timeline) && whyOrig.body.data.timeline.length > 0,
  `status=${whyOrig.status} n=${whyOrig.body?.data?.timeline?.length}`);
check('② why 时间线含事件接入/派活/回执/卡片',
  (() => {
    const kinds = new Set((whyOrig.body?.data?.timeline ?? []).map((f) => f.kind));
    return kinds.has('event.accepted') && kinds.has('run.queued') && kinds.has('run.finished') && kinds.has('card.created');
  })(),
  `kinds=${JSON.stringify([...new Set((whyOrig.body?.data?.timeline ?? []).map((f) => f.kind))])}`);
if (resumedRun) {
  const whyResumed = await get(`/loop/runs/${resumedRun}/why`, token);
  check('② why 续跑轮次同样可溯源',
    whyResumed.status === 200 && (whyResumed.body?.data?.timeline ?? []).length > 0,
    `status=${whyResumed.status}`);
}
const whyBad = await get('/loop/runs/no_such_run/why', token);
check('② why 不存在轮次 → 404', whyBad.status === 404, `status=${whyBad.status}`);

/* ═══ ⑤ M3 零回归：无名单卡片登录本人可答 ═══ */
const { run: rFree } = await issueEvent(token, `m4_free_${Date.now()}`);
const resF = await post(`/loop/runs/${rFree?.id}/result`, token, {
  outcome: 'done', summary: '普通拍板',
  ask: [{ title: '是否处理？', options: ['处理', '忽略'] }],
});
const cardFId = resF.body?.data?.cards?.[0];
const cardsF = await get('/loop/cards', token);
const cardF = (cardsF.body?.data ?? []).find((c) => c.id === cardFId);
check('⑤ 无名单卡片 answerers 为空', !cardF?.answerers?.length);
const freeAns = await post(`/loop/cards/${cardFId}/answer`, token, { choice: 0 });
check('⑤ 无名单卡片登录本人可答（M3 零回归）→ 200', freeAns.status === 200, `status=${freeAns.status}`);
check('⑤ 无名单卡片回答触发续跑', !!freeAns.body?.data?.resumedRun);

/* ═══ ⑥ 多租户隔离：他人看不到我的停用状态与卡片 ═══ */
const other = await register(`m4_other_${Date.now()}@test.local`);
const otherState = await get('/loop/state', other);
check('⑥ 他人独立投影：disabledPlugins 不含我的停用',
  !otherState.body?.data?.disabledPlugins?.m4source);
const otherCards = await get('/loop/cards', other);
check('⑥ 他人看不到我的受限卡片',
  !(otherCards.body?.data ?? []).some((c) => c.id === cardRId));

console.log(`\n${'='.repeat(56)}`);
console.log(`结果：${passed} 通过 / ${failed} 失败`);
console.log('='.repeat(56));
if (failed > 0) process.exit(1);
