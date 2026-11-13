/**
 * M6 · 架构决策面板 内核单元测试（纯函数，无需起服务）
 * 运行：npx tsx tests/decision-kernel.test.ts
 *
 * 覆盖 docs/08 §3 MVP 的确定性部分：
 *   A3 状态机合法/非法流转、ADR 编号；
 *   B1/B2 归一化加权评分（确定性、权重归一、平局稳定、越界钳制、重放一致）；
 *   B3 权衡显式化校验；C4 到期复核；D1 决策→规则草案映射。
 */
import {
  adrId, canTransition, DECISION_STATUSES, DECISION_TRANSITIONS, DECISION_STATUS_META,
  decisionToRuleDraft, isReviewDue, nextDecisionSeq, scoreOptions, topGap, validateTradeoffs,
  type Decision, type DecisionCriterion, type DecisionOption, type DecisionStatus,
} from '../shared/decision';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass += 1; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail += 1; console.log(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
}
function section(title: string): void { console.log(`\n\x1b[36m${title}\x1b[0m`); }

/* ── 夹具 ─────────────────────────────────────────────────── */
const CRITERIA: DecisionCriterion[] = [
  { id: 'perf', name: '性能', weight: 50 },
  { id: 'cost', name: '成本', weight: 30 },
  { id: 'maint', name: '可维护性', weight: 20 },
];

function opt(
  id: string, name: string, scores: Record<string, number>,
  pros = ['得到A'], cons = ['失去B'], assumptions = ['假设C'],
): DecisionOption {
  return { id, name, summary: `${name} 摘要`, scores, pros, cons, assumptions };
}

function decisionFixture(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'ADR-0001', seq: 1, title: '选择前端状态管理方案', status: 'accepted',
    context: '需要在多个页面共享状态', drivers: ['包体积', '可调试性'],
    criteria: CRITERIA,
    options: [
      opt('a', 'Zustand', { perf: 5, cost: 5, maint: 4 }),
      opt('b', 'Redux', { perf: 4, cost: 3, maint: 5 }),
      opt('c', 'Context', { perf: 3, cost: 5, maint: 2 }),
    ],
    decision: '采用 Zustand', chosenOptionId: 'a',
    consequences: { positive: ['轻量'], negative: ['生态较小'], risks: ['升级破坏'] },
    owner: 'arch@workbench.local', tags: ['frontend'], links: [],
    createdAt: '2026-11-12T02:00:00.000Z', updatedAt: '2026-11-12T02:00:00.000Z',
    acceptedAt: '2026-11-12T03:00:00.000Z', history: [],
    ...overrides,
  };
}

/* ══════════════════════════════════════════════════════════ */
section('① A3 状态机：合法 / 非法流转');
check('draft → review 合法', canTransition('draft', 'review'));
check('review → accepted 合法', canTransition('review', 'accepted'));
check('review → draft（驳回）合法', canTransition('review', 'draft'));
check('accepted → deprecated 合法', canTransition('accepted', 'deprecated'));
check('accepted → superseded 合法', canTransition('accepted', 'superseded'));
check('draft → accepted 越级非法', !canTransition('draft', 'accepted'));
check('accepted → review 回退非法', !canTransition('accepted', 'review'));
check('deprecated 为终态', DECISION_TRANSITIONS.deprecated.length === 0);
check('superseded 为终态', DECISION_TRANSITIONS.superseded.length === 0);
check('5 个状态均有元数据', DECISION_STATUSES.every((s) => !!DECISION_STATUS_META[s]));
check('终态无出边', (['deprecated', 'superseded'] as DecisionStatus[])
  .every((s) => DECISION_TRANSITIONS[s].length === 0));

section('② ADR 编号：格式化 / 递增');
check('adrId(1) = ADR-0001', adrId(1) === 'ADR-0001');
check('adrId(42) = ADR-0042', adrId(42) === 'ADR-0042');
check('空集合下一个 seq = 1', nextDecisionSeq([]) === 1);
check('取最大编号 +1', nextDecisionSeq(['ADR-0001', 'ADR-0009', 'ADR-0003']) === 10);
check('忽略非法编号', nextDecisionSeq(['xxx', 'ADR-0007', 'bad']) === 8);

section('③ B1/B2 归一化加权评分：确定性');
const d = decisionFixture();
const s1 = scoreOptions(d);
check('返回 3 个方案评分', s1.length === 3);
check('按分数降序', s1[0].score >= s1[1].score && s1[1].score >= s1[2].score);
check('rank 从 1 连续', s1.every((x, i) => x.rank === i + 1));
// Zustand: 5*0.5 + 5*0.3 + 4*0.2 = 4.8（最高）
check('Zustand 加权分 = 4.8', s1[0].id === 'a' && s1[0].score === 4.8, `top=${s1[0].id}/${s1[0].score}`);
check('Redux 加权分 = 3.9', s1.find((x) => x.id === 'b')?.score === 3.9);
check('Context 加权分 = 3.4', s1.find((x) => x.id === 'c')?.score === 3.4);
check('breakdown 覆盖全部维度', Object.keys(s1[0].breakdown).length === 3);
check('breakdown 贡献合计≈总分',
  Math.abs(Object.values(s1[0].breakdown).reduce((a, b) => a + b, 0) - s1[0].score) < 0.02);

section('④ B2 重放一致 / 权重归一 / 边界');
const s2 = scoreOptions(d);
check('同输入重放字节级一致', JSON.stringify(s1) === JSON.stringify(s2));
const scaled = scoreOptions(decisionFixture({
  criteria: CRITERIA.map((c) => ({ ...c, weight: c.weight * 10 })),
}));
check('权重整体缩放 10× → 排名与分数不变', JSON.stringify(scaled) === JSON.stringify(s1));
const zeroW = scoreOptions(decisionFixture({
  criteria: CRITERIA.map((c) => ({ ...c, weight: 0 })),
}));
check('权重全 0 → 退化为等权平均（不崩）',
  zeroW.every((x) => x.score > 0 && Number.isFinite(x.score)));
const noCrit = scoreOptions(decisionFixture({ criteria: [] }));
check('空维度 → 全部 0 分不崩', noCrit.every((x) => x.score === 0));
const clamped = scoreOptions(decisionFixture({
  criteria: [{ id: 'perf', name: '性能', weight: 100 }],
  options: [opt('a', '越界高分', { perf: 99 }), opt('b', '越界低分', { perf: -5 })],
}));
check('分数越界钳制到 [1,5]', clamped[0].score === 5 && clamped[1].score === 1,
  `scores=${clamped.map((x) => x.score).join(',')}`);
const missing = scoreOptions(decisionFixture({
  criteria: CRITERIA,
  options: [opt('a', '缺维度', { perf: 5 })],
}));
check('缺失维度记 0 贡献（不臆造）', missing[0].score === 2.5, `score=${missing[0].score}`);
const tie = scoreOptions(decisionFixture({
  criteria: [{ id: 'perf', name: '性能', weight: 100 }],
  options: [opt('z', 'Z', { perf: 3 }), opt('a', 'A', { perf: 3 })],
}));
check('平局按 id 字典序稳定', tie[0].id === 'a' && tie[1].id === 'z');
check('topGap 返回头两名分差', topGap(s1) === 0.9, `gap=${topGap(s1)}`);
check('topGap 单方案为 0', topGap(s1.slice(0, 1)) === 0);

section('⑤ B3 权衡显式化校验');
check('完整权衡通过', validateTradeoffs(d.options).length === 0);
const bad = validateTradeoffs([
  opt('a', '缺项方案', { perf: 3 }, [], [], []),
]);
check('缺 得/失/假设 → 3 条问题', bad.length === 3);
check('问题文案含方案名', bad.every((x) => x.includes('缺项方案')));
check('只缺「失去什么」→ 1 条', validateTradeoffs([opt('a', 'X', { perf: 3 }, ['p'], [], ['a'])]).length === 1);

section('⑥ C4 到期复核判断');
check('今天到期 → due', isReviewDue('2026-11-12', '2026-11-12T08:00:00.000Z'));
check('已逾期 → due', isReviewDue('2026-11-10', '2026-11-12T08:00:00.000Z'));
check('未来 → 未到期', !isReviewDue('2026-12-01', '2026-11-12T08:00:00.000Z'));
check('无 reviewAt → 未到期', !isReviewDue(undefined, '2026-11-12T08:00:00.000Z'));
check('非法日期 → 未到期（不崩）', !isReviewDue('not-a-date', '2026-11-12T08:00:00.000Z'));

section('⑦ D1 决策 → autoloop 规则草案');
const draft = decisionToRuleDraft(d, 'claude');
check('规则名带 adr 前缀且小写', draft.name === 'adr-adr-0001');
check('when 为 decision 事件源', draft.when.source === 'decision' && draft.when.types[0] === 'decision.accepted');
check('to 指向传入 Agent', draft.to === 'claude');
check('tell = needed', draft.tell === 'needed');
check('cwd/group 有默认值', !!draft.cwd && draft.group === 'decisions');
check('title 含 ADR 编号', draft.title.includes('ADR-0001'));
check('prompt 含结论与选定方案', draft.prompt.includes('采用 Zustand') && draft.prompt.includes('Zustand'));
const noChosen = decisionToRuleDraft(decisionFixture({ chosenOptionId: undefined }), 'codex');
check('无选定方案时 prompt 不崩且含结论', noChosen.prompt.includes('采用 Zustand'));
check('草案满足 validateRule 必填（name/to/cwd/when/tell）',
  !!draft.name && !!draft.to && !!draft.cwd && !!draft.when && !!draft.tell);

/* ══════════════════════════════════════════════════════════ */
console.log(`\n${'='.repeat(56)}`);
console.log(`结果：\x1b[32m${pass} 通过\x1b[0m / \x1b[${fail ? 31 : 32}m${fail} 失败\x1b[0m`);
console.log('='.repeat(56));
if (fail > 0) process.exit(1);
