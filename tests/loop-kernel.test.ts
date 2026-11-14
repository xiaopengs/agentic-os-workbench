/**
 * M1 · 内核单元测试（纯函数，无需起服务）
 * 运行：npx tsx tests/loop-kernel.test.ts
 *
 * 覆盖 docs/09 §7 验收清单：确定性重放 / 事件去重 / 指令数据分离 / 规则匹配 /
 * 暂停恢复 / 跳数熔断 / 挂起零消耗 / 回答续跑 / why 溯源 / 幂等重交 / emits 约束。
 */
import {
  decide, emptyView, evolve, matchRules, replay, stateOf, typeMatches,
  validateEvent, validateRule, whyOf,
} from '../backend/lib/loop/kernel';
import { MAX_HOPS, type Fact, type LoopInput, type LoopView } from '../shared/loop';
import { seedInputs } from '../backend/lib/loop/seed';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass += 1; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail += 1; console.log(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
}
function section(title: string): void { console.log(`\n\x1b[36m${title}\x1b[0m`); }

const T0 = '2026-11-12T02:00:00.000Z';
const T1 = '2026-11-12T02:01:00.000Z';
const T2 = '2026-11-12T02:02:00.000Z';

/** 与 store.commit 等价的一步：decide → evolve */
function step(view: LoopView, input: LoopInput, now: string): { view: LoopView; facts: Fact[] } {
  const facts = decide(view, input, now);
  let v = view;
  for (const f of facts) v = evolve(v, f);
  return { view: v, facts };
}

/** 用种子配置构造一个已登记插件与规则的视图 */
function seeded(): LoopView {
  let v = emptyView();
  for (const input of seedInputs()) v = step(v, input, T0).view;
  return v;
}

function kindsOf(facts: Fact[], kind: Fact['kind']): number {
  return facts.filter((f) => f.kind === kind).length;
}

/* ══════════════════════════════════════════════════════════ */
section('① 确定性内核 / 事件溯源');
{
  // 收集完整事实：种子配置 + 一段真实交互
  const seedFacts: Fact[] = [];
  let sv = emptyView();
  for (const input of seedInputs()) { const r = step(sv, input, T0); sv = r.view; seedFacts.push(...r.facts); }

  const inputs: Array<[LoopInput, string]> = [
    [{ kind: 'event', event: { id: 'e1', source: 'github', type: 'issues.opened', subject: '#42', summary: '新 Issue' } }, T1],
    [{ kind: 'tick' }, T2],
  ];
  const collect: Fact[] = [];
  let cur = sv;
  for (const [input, now] of inputs) {
    const fs = decide(cur, input, now);
    collect.push(...fs);
    for (const f of fs) cur = evolve(cur, f);
  }

  const full = [...seedFacts, ...collect];
  const a = replay(full);
  const b = replay(full);
  check('同一 Fact[] 重放两次得到字节级相同的 View', JSON.stringify(a) === JSON.stringify(b));
  check('replay(完整事实) 与逐步 evolve 结果一致', JSON.stringify(a) === JSON.stringify(cur));

  // 纯函数：decide 不改入参
  const before = JSON.stringify(cur);
  decide(cur, { kind: 'event', event: { id: 'x', source: 'github', type: 'issues.opened' } }, T2);
  check('decide 不修改传入 view', JSON.stringify(cur) === before);
  const inputObj: LoopInput = { kind: 'event', event: { id: 'y', source: 'github', type: 'issues.opened' } };
  const snapshot = JSON.stringify(inputObj);
  decide(cur, inputObj, T2);
  check('decide 不修改传入 input', JSON.stringify(inputObj) === snapshot);
}

/* ══════════════════════════════════════════════════════════ */
section('② 事件去重');
{
  let v = seeded();
  const ev: LoopInput = { kind: 'event', event: { id: 'dup-1', source: 'github', type: 'issues.opened', subject: '#7' } };
  const r1 = step(v, ev, T1); v = r1.view;
  const runsAfterFirst = Object.keys(v.runs).length;
  const r2 = step(v, ev, T1); v = r2.view;
  const accepted = r2.facts.find((f) => f.kind === 'event.accepted') as Extract<Fact, { kind: 'event.accepted' }>;
  check('第二次同 source+id 事件标记 duplicate:true', accepted?.duplicate === true);
  check('重复事件不派新规则（routed 为空）', (accepted?.routed ?? []).length === 0);
  check('重复事件不新增 Run', Object.keys(v.runs).length === runsAfterFirst);
  check('重复事件不新增 queued 事实', kindsOf(r2.facts, 'run.queued') === 0);
}

/* ══════════════════════════════════════════════════════════ */
section('③ 指令数据分离（validateEvent 纯函数）');
{
  check('拒收 cwd 指令字段', validateEvent({ id: 'a', type: 'alert.new', cwd: '~/x' }).some((m) => m.includes('cwd')));
  check('拒收 agent 指令字段', validateEvent({ id: 'a', type: 'alert.new', agent: 'codex' }).some((m) => m.includes('agent')));
  check('拒收 access 指令字段', validateEvent({ id: 'a', type: 'alert.new', access: 'full' }).some((m) => m.includes('access')));
  check('拒收 to / use / worker', ['to', 'use', 'worker'].every((f) =>
    validateEvent({ id: 'a', type: 'alert.new', [f]: 'x' }).some((m) => m.includes(f))));
  check('合法资料事件通过', validateEvent({ id: 'a', type: 'alert.new', subject: '#42', summary: 's', detail: 'd' }).length === 0);
  check('subject 中文/空格/标点可通过', validateEvent({ id: 'a', type: 'alert.new', subject: 'Node架构设计' }).length === 0 &&
    validateEvent({ id: 'a', type: 'alert.new', subject: 'a b;rm' }).length === 0);
  check('subject 控制字符/不可见格式符被拒', ['\u0000', '\n', '\u202E', '\u200B'].every((c) =>
    validateEvent({ id: 'a', type: 'alert.new', subject: 'x' + c + 'y' }).some((m) => m.includes('subject'))));
  check('subject 空白视为未提供', validateEvent({ id: 'a', type: 'alert.new', subject: '   ' }).length === 0);
  check('link 非 ASCII / 非 http 被拒', validateEvent({ id: 'a', type: 'alert.new', link: 'https://例子.com' }).length > 0 &&
    validateEvent({ id: 'a', type: 'alert.new', link: 'javascript:alert(1)' }).length > 0);
  check('type 非法格式被拒', validateEvent({ id: 'a', type: 'BAD TYPE!' }).length > 0);
  check('detail 超 4000 字被拒', validateEvent({ id: 'a', type: 'alert.new', detail: 'x'.repeat(4001) }).length > 0);
  check('合法 link 通过', validateEvent({ id: 'a', type: 'alert.new', link: 'https://github.com/x/y/issues/1' }).length === 0);
}

/* ══════════════════════════════════════════════════════════ */
section('④ 规则匹配 / 校验');
{
  check('typeMatches 支持 *', typeMatches(['*'], 'anything.go'));
  check('typeMatches 支持 x.*', typeMatches(['issues.*'], 'issues.opened'));
  check('typeMatches 精确匹配', typeMatches(['alert.new'], 'alert.new'));
  check('typeMatches 不匹配其他前缀', !typeMatches(['issues.*'], 'pr.opened'));
  const v = seeded();
  const matched = matchRules(v, { id: 'm1', source: 'github', type: 'issues.opened' } as any);
  check('GitHub Issue 事件命中「跟进 GitHub Issue」', matched.some((r) => r.name === '跟进 GitHub Issue'));
  check('告警事件命中「查线上报错」', matchRules(v, { id: 'm2', source: 'shop', type: 'alert.error' } as any).some((r) => r.name === '查线上报错'));
  check('无关来源不命中', matchRules(v, { id: 'm3', source: 'unknown', type: 'issues.opened' } as any).length === 0);
  check('validateRule 拒绝未登记 Agent', validateRule({ name: 'x', when: { source: 'github', types: ['issues.*'] }, to: 'ghost', cwd: '~' }, ['claude']).length > 0);
  check('validateRule 接受合法规则', validateRule({ name: 'x', when: { source: 'github', types: ['issues.*'] }, to: 'claude', cwd: '~/code' }, ['claude']).length === 0);
}

/* ══════════════════════════════════════════════════════════ */
section('⑤ 暂停 / 恢复（pause 期间不派活，恢复后不补跑）');
{
  let v = seeded();
  const ev = (id: string): LoopInput => ({ kind: 'event', event: { id, source: 'github', type: 'issues.opened', subject: id } });
  v = step(v, { kind: 'rule.pause', name: '跟进 GitHub Issue' }, T1).view;
  const paused = step(v, ev('p1'), T1);
  v = paused.view;
  const a = paused.facts.find((f) => f.kind === 'event.accepted') as Extract<Fact, { kind: 'event.accepted' }>;
  check('暂停期间事件 routed 为空', (a?.routed ?? []).length === 0);
  check('暂停期间不派 Run', kindsOf(paused.facts, 'run.queued') === 0);
  const runsWhilePaused = Object.keys(v.runs).length;
  v = step(v, { kind: 'rule.resume', name: '跟进 GitHub Issue' }, T2).view;
  check('恢复动作本身不补跑（Run 数不变）', Object.keys(v.runs).length === runsWhilePaused);
  const after = step(v, ev('p2'), T2);
  const a2 = after.facts.find((f) => f.kind === 'event.accepted') as Extract<Fact, { kind: 'event.accepted' }>;
  check('恢复后新事件正常派活', (a2?.routed ?? []).includes('跟进 GitHub Issue'));
}

/* ══════════════════════════════════════════════════════════ */
section('⑥ 跳数熔断');
{
  let v = seeded();
  const r = step(v, { kind: 'event', event: { id: 'hop', source: 'github', type: 'issues.opened', hops: MAX_HOPS + 1 } }, T1);
  v = r.view;
  check(`hops=${MAX_HOPS + 1} 产生 hop.blocked 事实`, kindsOf(r.facts, 'hop.blocked') === 1);
  check('熔断事件不派 Run', kindsOf(r.facts, 'run.queued') === 0);
  check('熔断生成一张通知卡片', kindsOf(r.facts, 'card.created') === 1);
  const st = stateOf(v, T1);
  check('state.totals.hopsBlocked 正确计数', st.totals.hopsBlocked === 1);
  const okRun = step(v, { kind: 'event', event: { id: 'hop-ok', source: 'github', type: 'issues.opened', hops: MAX_HOPS } }, T1);
  check(`hops=${MAX_HOPS}（未超限）仍正常派活`, kindsOf(okRun.facts, 'run.queued') === 1);
}

/* ══════════════════════════════════════════════════════════ */
section('⑦ 挂起零消耗（ask → open 卡片，不派新 Run）');
{
  let v = seeded();
  const ev = step(v, { kind: 'event', event: { id: 'ask-ev', source: 'shop', type: 'alert.error', subject: 'svc-1' } }, T1);
  v = ev.view;
  const runFact = ev.facts.find((f) => f.kind === 'run.queued') as Extract<Fact, { kind: 'run.queued' }>;
  const runId = runFact.run.id;
  v = step(v, { kind: 'run.claim', id: runId }, T1).view;

  const beforeRuns = Object.keys(v.runs).length;
  const result = step(v, {
    kind: 'run.result', id: runId,
    receipt: {
      outcome: 'done', summary: '需要决定是否重启服务',
      ask: [{ title: '要不要重启服务？', text: '两种方法都能恢复', options: ['重启', '先观察'], key: 'restart' }],
    },
  }, T2);
  v = result.view;
  const card = result.facts.find((f) => f.kind === 'card.created') as Extract<Fact, { kind: 'card.created' }>;
  check('ask 回执生成 open 提问卡片', card?.card.state === 'open' && card?.card.kind === 'ask');
  check('① 挂起零消耗：不产生新 Run', kindsOf(result.facts, 'run.queued') === 0);
  check('① 挂起零消耗：Run 总数不变', Object.keys(v.runs).length === beforeRuns);
  check('本轮 Run 变为 done', v.runs[runId].state === 'done');
  check('open 卡片出现在 state 中', stateOf(v, T2).cards.some((c) => c.id === card.card.id && c.state === 'open'));

  /* ⑧ 回答续跑 */
  section('⑧ 回答续跑（挂起 → 点一下 → 接原事项）');
  const answer = step(v, { kind: 'card.answer', id: card.card.id, choice: 0, by: 'owner' }, T2);
  v = answer.view;
  const resumed = answer.facts.find((f) => f.kind === 'run.queued') as Extract<Fact, { kind: 'run.queued' }> | undefined;
  check('answer 后产生新 Run（现在才启动）', !!resumed);
  check('新 Run 接原 lane（事项连续）', resumed?.run.lane === runFact.run.lane);
  check('新 Run 的 hops = 原 hops + 1', resumed?.run.hops === runFact.run.hops + 1);
  check('新 Run 带 answer 事件', kindsOf(answer.facts, 'event.accepted') === 1);
  check('卡片变为 decided', v.cards[card.card.id].state === 'decided');
  check('卡片记录所选选项', v.cards[card.card.id].answer === '重启');
}

/* ══════════════════════════════════════════════════════════ */
section('⑨ why 溯源 / ⑩ 幂等重交');
{
  let v = seeded();
  const allFacts: Fact[] = [];
  const ev = step(v, { kind: 'event', event: { id: 'why-1', source: 'github', type: 'issues.opened', subject: '#99' } }, T1);
  v = ev.view; allFacts.push(...ev.facts);
  const runFact = ev.facts.find((f) => f.kind === 'run.queued') as Extract<Fact, { kind: 'run.queued' }>;
  const runId = runFact.run.id;
  const cl = step(v, { kind: 'run.claim', id: runId }, T1); v = cl.view; allFacts.push(...cl.facts);
  const receipt = { outcome: 'done' as const, summary: '已处理', usage: { input: 100, output: 50, cost: 0.02 } };
  const fin = step(v, { kind: 'run.result', id: runId, receipt }, T2); v = fin.view; allFacts.push(...fin.facts);

  const timeline = whyOf(allFacts, runId);
  check('why 返回该轮相关事实', timeline.length >= 3);
  check('why 含触发事件', timeline.some((f) => f.kind === 'event.accepted'));
  check('why 含把轮次排入队列', timeline.some((f) => f.kind === 'run.queued'));
  check('why 含领取', timeline.some((f) => f.kind === 'run.claimed'));
  check('why 含回执', timeline.some((f) => f.kind === 'run.finished'));

  const tokensBefore = v.usage.tokens;
  const dup = step(v, { kind: 'run.result', id: runId, receipt }, T2); v = dup.view;
  const dupFin = dup.facts.find((f) => f.kind === 'run.finished') as Extract<Fact, { kind: 'run.finished' }>;
  check('⑩ 相同回执重交标记 duplicate', dupFin?.duplicate === true);
  check('⑩ 重交不重复累计 Token', v.usage.tokens === tokensBefore);
  check('⑩ 重交不重复累计 runs', v.usage.runs === 1);
}

/* ══════════════════════════════════════════════════════════ */
section('⑪ emits 约束 / 派生事件跳数链');
{
  let v = seeded();
  const ev = step(v, { kind: 'event', event: { id: 'emit-1', source: 'github', type: 'issues.opened', subject: '#5' } }, T1);
  v = ev.view;
  const runFact = ev.facts.find((f) => f.kind === 'run.queued') as Extract<Fact, { kind: 'run.queued' }>;
  const runId = runFact.run.id;

  // 规则 emits 只允许 issue.followup，派生 release.ready 应被拒绝
  const bad = step(v, {
    kind: 'run.result', id: runId,
    receipt: { outcome: 'done', summary: 'ok', events: [{ id: 'd1', source: 'github', type: 'release.ready' }] },
  }, T2);
  check('emits 不许可的派生事件不派活', kindsOf(bad.facts, 'run.queued') === 0);

  // 许可的派生事件：hops 应 +1
  let v2 = seeded();
  const ev2 = step(v2, { kind: 'event', event: { id: 'emit-2', source: 'github', type: 'issues.opened', subject: '#6' } }, T1);
  v2 = ev2.view;
  const rf2 = ev2.facts.find((f) => f.kind === 'run.queued') as Extract<Fact, { kind: 'run.queued' }>;
  const good = step(v2, {
    kind: 'run.result', id: rf2.run.id,
    receipt: { outcome: 'done', summary: 'ok', events: [{ id: 'd2', source: 'github', type: 'issue.followup', subject: '#6' }] },
  }, T2);
  const derived = good.facts.find((f) => f.kind === 'event.accepted') as Extract<Fact, { kind: 'event.accepted' }> | undefined;
  check('emits 许可的派生事件被记录', !!derived);
  check('派生事件 hops = 父轮次 + 1', derived?.event.hops === rf2.run.hops + 1);
}

/* ══════════════════════════════════════════════════════════ */
section('⑫ 定时 / 复查（tick 外壳注入 now）');
{
  let v = seeded();
  const t1 = step(v, { kind: 'tick' }, T1); v = t1.view;
  const cronRuns = kindsOf(t1.facts, 'run.queued');
  check('tick 触发一次 cron 规则（每日早报）', cronRuns >= 1);
  const t1b = step(v, { kind: 'tick' }, T1); v = t1b.view;
  check('同一天再次 tick 不重复触发 cron', kindsOf(t1b.facts, 'run.queued') === 0);
  check('cron.fired 落为事实（可重放）', t1.facts.some((f) => f.kind === 'cron.fired'));
  const t2 = step(v, { kind: 'tick' }, '2026-11-13T02:00:00.000Z');
  check('跨天 tick 重新触发', kindsOf(t2.facts, 'run.queued') >= 1);
}

/* ══════════════════════════════════════════════════════════ */
section('⑬ 事件溯源完备性（重放还原全部视图字段）');
{
  let v = seeded();
  const seq: Array<[LoopInput, string]> = [
    [{ kind: 'plugin.upsert', plugin: { kind: 'agent', id: 'extra', name: 'Extra', worker: 'local', use: 'command', access: 'read' } }, T1],
    [{ kind: 'event', event: { id: 'replay-1', source: 'shop', type: 'alert.error', subject: 'svc-9' } }, T1],
    [{ kind: 'tick' }, T2],
  ];
  const facts: Fact[] = [];
  for (const [input, now] of seq) { const r = step(v, input, now); v = r.view; facts.push(...r.facts); }
  // 连同种子事实一起重放
  const seedFacts: Fact[] = [];
  let sv = emptyView();
  for (const input of seedInputs()) { const r = step(sv, input, T0); sv = r.view; seedFacts.push(...r.facts); }
  const rebuilt = replay([...seedFacts, ...facts]);
  check('重放还原 plugin 登记', !!rebuilt.plugins.agents.extra);
  check('重放还原 rules/rulesVersion', Object.keys(rebuilt.rules).length === 4 && rebuilt.rulesVersion > 0);
  check('重放还原 lanes（事项）', Object.keys(rebuilt.lanes).length > 0);
  check('重放还原 cronFired', Object.keys(rebuilt.cronFired).length > 0);
  check('重放还原 runs/cards/events', Object.keys(rebuilt.runs).length > 0 && rebuilt.events.length > 0);
  check('重放后 View.seq 与事实序号一致', rebuilt.seq === [...seedFacts, ...facts].at(-1)!.seq);
}

/* ══════════════════════════════════════════════════════════ */
section('⑭ M4 插件启停（事实化 / 停用后不派活 / 重放一致）');
{
  let v = seeded();
  // 停用 github 源：来自 github 的事件不再命中任何规则
  const ev = { id: 'm4-dis-1', source: 'github', type: 'issues.opened', subject: 'repo#1' };
  check('停用前 github 事件命中「跟进 GitHub Issue」',
    matchRules(v, ev as any).some((r) => r.name === '跟进 GitHub Issue'));

  const d1 = step(v, { kind: 'plugin.disable', id: 'github', reason: '维护中' }, T1);
  v = d1.view;
  check('停用产 plugin.disabled 事实', kindsOf(d1.facts, 'plugin.disabled') === 1);
  check('投影记录 disabledPlugins.github', !!v.disabledPlugins.github);
  check('停用 Source 后同事件不再派活', matchRules(v, ev as any).length === 0);
  check('停用后 stateOf 输出 disabledPlugins', !!stateOf(v, T1).disabledPlugins.github);

  // 幂等：重复停用不产事实
  const d2 = step(v, { kind: 'plugin.disable', id: 'github' }, T1);
  check('重复停用不产事实（幂等）', d2.facts.length === 0);
  v = d2.view;

  // 不存在的插件停用 → 无事实
  const d3 = step(v, { kind: 'plugin.disable', id: 'no_such_plugin' }, T1);
  check('停用不存在的插件不产事实', d3.facts.length === 0);

  // 停用 Agent 后指向它的规则不派活
  const d4 = step(v, { kind: 'plugin.disable', id: 'codex' }, T1);
  v = d4.view;
  check('停用 Agent 后 shop 告警不再派给 codex',
    matchRules(v, { id: 'm4-dis-2', source: 'shop', type: 'alert.cpu', subject: 'svc' } as any)
      .every((r) => r.to !== 'codex'));

  // 启用恢复
  const e1 = step(v, { kind: 'plugin.enable', id: 'github' }, T2);
  v = e1.view;
  check('启用产 plugin.enabled 事实', kindsOf(e1.facts, 'plugin.enabled') === 1);
  check('启用后投影移除 github', !v.disabledPlugins.github);
  check('启用后事件恢复派活', matchRules(v, ev as any).some((r) => r.name === '跟进 GitHub Issue'));
  const e2 = step(v, { kind: 'plugin.enable', id: 'github' }, T2);
  check('重复启用不产事实（幂等）', e2.facts.length === 0);

  // 重放一致性：把启停事实并入日志重放，投影须一致
  const seedFacts: Fact[] = [];
  let sv = emptyView();
  for (const input of seedInputs()) { const r = step(sv, input, T0); sv = r.view; seedFacts.push(...r.facts); }
  const rebuilt = replay([...seedFacts, ...d1.facts, ...d4.facts, ...e1.facts]);
  check('重放还原停用状态（github 已启用、codex 仍停用）',
    !rebuilt.disabledPlugins.github && !!rebuilt.disabledPlugins.codex);
}

/* ══════════════════════════════════════════════════════════ */
section('⑮ M4 通道级应答身份校验（内核判定 / 名单快照 / 挂起语义不变）');
{
  let v = seeded();
  // 造一轮 github 事件派活
  const r1 = step(v, { kind: 'event', event: { id: 'm4-ask-1', source: 'github', type: 'issues.opened', subject: 'repo#77' } }, T1);
  v = r1.view;
  const runId = Object.values(v.runs)[0]?.id ?? '';

  // ① 回执带 channel=feishu（种子 feishu.answerers=['ou_owner']）→ 卡片快照白名单
  const r2 = step(v, { kind: 'run.result', id: runId, receipt: {
    outcome: 'done', summary: '请求拍板',
    ask: [{ title: '是否合并？', text: '等待确认', options: ['合并', '暂缓'], channel: 'feishu' }],
  } }, T1);
  v = r2.view;
  const card = Object.values(v.cards)[0];
  check('带 channel 的卡片快照 answerers 白名单',
    !!card && Array.isArray(card.answerers) && card.answerers.includes('ou_owner'));
  check('带 channel 的卡片记录 channel', card?.channel === 'feishu');

  // ② 名单外身份回答 → 内核拒绝（不产任何事实），卡片仍 open
  const bad = step(v, { kind: 'card.answer', id: card!.id, choice: 0, by: 'intruder@x.local' }, T2);
  check('名单外 by 被内核拒绝（零事实）', bad.facts.length === 0);
  check('名单外回答不改变卡片状态', bad.view.cards[card!.id].state === 'open');

  // ③ 名单内身份回答 → 产 card.answered + 续跑（挂起→恢复），且 by 落事实
  const good = step(v, { kind: 'card.answer', id: card!.id, choice: 0, by: 'ou_owner' }, T2);
  v = good.view;
  check('名单内 by 通过校验', kindsOf(good.facts, 'card.answered') === 1);
  check('名单内回答后卡片 decided', v.cards[card!.id].state === 'decided');
  check('名单内回答沿用续跑语义（产 run.queued）', kindsOf(good.facts, 'run.queued') === 1);
  const answered = good.facts.find((f) => f.kind === 'card.answered') as Extract<Fact, { kind: 'card.answered' }>;
  check('by 写入事实（可溯源）', answered.by === 'ou_owner');

  // ④ 未指定 channel 的卡片（M3 演示路径）→ answerers 空 → 登录本人可答（零回归）
  let v2 = seeded();
  const a1 = step(v2, { kind: 'event', event: { id: 'm4-ask-2', source: 'shop', type: 'alert.cpu', subject: 'svc' } }, T1);
  v2 = a1.view;
  const run2 = Object.values(v2.runs)[0]?.id ?? '';
  const a2 = step(v2, { kind: 'run.result', id: run2, receipt: {
    outcome: 'done', ask: [{ title: '确认？', options: ['是', '否'] }],
  } }, T1);
  v2 = a2.view;
  const card2 = Object.values(v2.cards)[0];
  check('未带 channel 的卡片 answerers 为空', !card2?.answerers?.length);
  const ownerAns = step(v2, { kind: 'card.answer', id: card2!.id, choice: 0, by: 'anyone@workbench.local' }, T2);
  check('无名单卡片登录本人可答（M3 零回归）', kindsOf(ownerAns.facts, 'card.answered') === 1);
}

/* ══════════════════════════════════════════════════════════ */
section('⑫ 失败重试：failed 回执退回 queued 后，重试交不同回执不应被幂等锁死');
{
  let v = seeded();
  const ev = step(v, { kind: 'event', event: { id: 'retry-1', source: 'github', type: 'issues.opened', subject: '#77' } }, T1);
  v = ev.view;
  const runId = Object.values(v.runs)[0]?.id ?? '';
  const claim = step(v, { kind: 'run.claim', id: runId }, T1); v = claim.view;

  // 第一次交 failed → 内核退回 queued 等待重试
  const failed = step(v, { kind: 'run.result', id: runId, receipt: {
    outcome: 'failed', summary: 'Agent 超时', notice: [{ title: '执行异常' }],
  } }, T1); v = failed.view;
  check('⑫ failed 后轮次退回 queued', v.runs[runId]?.state === 'queued', `实际 ${v.runs[runId]?.state}`);
  check('⑫ 失败已写入 receipt 指纹', v.receipts[runId] !== undefined);

  // 重试领取 + 交不同内容的成功回执 → 必须能真正结案（修复前会被 409 锁死）
  const reClaim = step(v, { kind: 'run.claim', id: runId }, T2); v = reClaim.view;
  const retry = step(v, { kind: 'run.result', id: runId, receipt: { outcome: 'done', summary: '重试成功' } }, T2);
  v = retry.view;
  check('⑫ 重试交不同回执产出了新事实', retry.facts.some((f) => f.kind === 'run.finished'));
  check('⑫ 重试后轮次结案为 done', v.runs[runId]?.state === 'done', `实际 ${v.runs[runId]?.state}`);
  check('⑫ 重试回执覆盖旧指纹', v.receipts[runId]?.includes('重试成功') === true);

  // 终态幂等仍生效：相同回执重交标 duplicate、不同回执仍 409（外壳据此返回冲突）
  const dup = step(v, { kind: 'run.result', id: runId, receipt: { outcome: 'done', summary: '重试成功' } }, T2);
  check('⑫ 终态相同回执重交标记 duplicate', dup.facts.some(
    (f) => f.kind === 'run.finished' && (f as Extract<Fact, { kind: 'run.finished' }>).duplicate === true,
  ));
  const conflictRetry = step(v, { kind: 'run.result', id: runId, receipt: { outcome: 'nothing', summary: '篡改' } }, T2);
  check('⑫ 终态不同回执重交不产事实（409 保护保留）', conflictRetry.facts.length === 0);
}

/* ══════════════════════════════════════════════════════════ */
console.log(`\n${'='.repeat(56)}`);
console.log(`结果：\x1b[32m${pass} 通过\x1b[0m / \x1b[${fail ? 31 : 32}m${fail} 失败\x1b[0m`);
console.log('='.repeat(56));
if (fail > 0) process.exit(1);
