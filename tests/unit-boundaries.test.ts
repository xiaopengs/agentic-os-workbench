/**
 * 单元边界测试 · 纯函数层（validate / quota / decision / kernel 校验）
 *
 * 目标：补齐 11 个既有测试文件没覆盖到的「脏输入 / 边界值 / 确定性」分支。
 * 全部零 IO：quota 用内存 StoreDriver 构造 Repo，其余直接调纯函数。
 *
 * 用法：npx tsx --test tests/unit-boundaries.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assertEmail, assertEnum, assertNumber, assertPassword, assertString, isEmail,
  optionalEnum, optionalNumber, optionalString,
} from '../backend/lib/validate';
import { consume, getUsage, limitFor, monthKey, setUsage } from '../backend/lib/quota';
import { Repo, type StoreDriver } from '../backend/lib/kv';
import {
  adrId, canTransition, decisionToRuleDraft, isReviewDue, nextDecisionSeq,
  scoreOptions, topGap, validateTradeoffs, type Decision, type DecisionOption,
} from '../shared/decision';
import {
  emptyView, matchRules, typeMatches, validateEvent, validateRule,
} from '../backend/lib/loop/kernel';
import type { LoopRule } from '../shared/loop';

/* ── 内存 StoreDriver（零文件、零平台依赖） ─────────────────── */
function memDriver(): StoreDriver & { raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>();
  return {
    name: 'mem',
    raw,
    async get<T>(key: string): Promise<T | null> {
      return (raw.get(key) ?? null) as T | null;
    },
    async put(key: string, value: unknown): Promise<void> { raw.set(key, value); },
    async del(key: string): Promise<void> { raw.delete(key); },
    async list(prefix: string): Promise<string[]> {
      return [...raw.keys()].filter((k) => !prefix || k.startsWith(prefix)).sort();
    },
  };
}

const usr = { id: 'usr_test', plan: 'free' as const };
const MONTH = '202611';
const errMsg = (fn: () => unknown): string => {
  try { fn(); return ''; } catch (e) { return (e as Error).message; }
};

/* ══════════════════════════════════════════════════════════════
 * 1. validate · 输入校验（指令数据分离的第一道门）
 * ══════════════════════════════════════════════════════════════ */
test('validate: 邮箱合法格式与归一化', () => {
  assert.equal(assertEmail('  User@Example.COM '), 'user@example.com');
  assert.equal(isEmail('a@b.c'), true);
  assert.equal(isEmail('no-at-sign'), false);
  assert.equal(isEmail('a@b'), false);
  assert.equal(isEmail('a @b.c'), false);
  assert.equal(isEmail('a'.repeat(250) + '@b.c'), true, '恰好 254 字符应合法（含上限）');
  assert.equal(isEmail('a'.repeat(251) + '@b.c'), false, '255 字符应拒绝');
  assert.match(errMsg(() => assertEmail('bad')), /邮箱格式不正确/);
  assert.match(errMsg(() => assertEmail(null)), /邮箱格式不正确/);
});

test('validate: 密码长度、类型与上限', () => {
  assert.equal(assertPassword('12345678'), '12345678');
  assert.match(errMsg(() => assertPassword('123')), /至少 8 位/);
  assert.match(errMsg(() => assertPassword(12345678)), /至少 8 位/);
  assert.match(errMsg(() => assertPassword('x'.repeat(201))), /超出限制/);
});

test('validate: 字符串 trim / 长度 / 空值', () => {
  assert.equal(assertString('  hi  ', '名称'), 'hi');
  assert.match(errMsg(() => assertString('   ', '名称')), /不能为空/);
  assert.match(errMsg(() => assertString('x'.repeat(501), '名称')), /不能超过 500/);
  assert.equal(optionalString(undefined, '备注'), undefined);
  assert.equal(optionalString(null, '备注'), undefined);
  assert.match(errMsg(() => optionalString(123, '备注')), /必须是字符串/);
  assert.match(errMsg(() => optionalString('x'.repeat(2001), '备注')), /不能超过 2000/);
});

test('validate: 枚举严格匹配，空值走 optional', () => {
  assert.equal(assertEnum('ok', ['ok', 'bad'] as const, '状态'), 'ok');
  assert.match(errMsg(() => assertEnum('nope', ['ok', 'bad'] as const, '状态')), /取值非法/);
  assert.match(errMsg(() => assertEnum(1, ['ok', 'bad'] as const, '状态')), /取值非法/);
  assert.equal(optionalEnum(undefined, ['ok'] as const, '状态'), undefined);
  assert.equal(optionalEnum('', ['ok'] as const, '状态'), undefined);
});

test('validate: 数字必须是数字，拒绝 null/布尔/数组/对象 的类型混淆', () => {
  assert.equal(assertNumber(12, '耗时'), 12);
  assert.equal(assertNumber('12', '耗时'), 12, '数字字符串仍允许（query 参数场景）');
  assert.match(errMsg(() => assertNumber('abc', '耗时')), /必须是数字/);
  assert.match(errMsg(() => assertNumber(Infinity, '耗时')), /必须是数字/);
  assert.match(errMsg(() => assertNumber(NaN, '耗时')), /必须是数字/);
  // 以下 4 类在 JSON body 中都不是合法数字，必须 400，不能静默变 0/1
  assert.match(errMsg(() => assertNumber(null, '耗时')), /必须是数字/, 'null 不能变 0');
  assert.match(errMsg(() => assertNumber(true, '耗时')), /必须是数字/, 'true 不能变 1');
  assert.match(errMsg(() => assertNumber(false, '耗时')), /必须是数字/, 'false 不能变 0');
  assert.match(errMsg(() => assertNumber([], '耗时')), /必须是数字/, '[] 不能变 0');
  assert.match(errMsg(() => assertNumber({}, '耗时')), /必须是数字/, '{} 不能变 NaN');
});

test('validate: 数字 min/max/integer 约束', () => {
  assert.equal(assertNumber(5, '覆盖率', { min: 0, max: 100 }), 5);
  assert.match(errMsg(() => assertNumber(-1, '设备数', { min: 0 })), /不能小于 0/);
  assert.match(errMsg(() => assertNumber(101, '覆盖率', { max: 100 })), /不能大于 100/);
  assert.match(errMsg(() => assertNumber(1.5, '步骤数', { integer: true })), /必须是整数/);
  assert.equal(optionalNumber('', 'x'), undefined);
  assert.equal(optionalNumber(null, 'x'), undefined);
  assert.equal(optionalNumber('7', 'x', { min: 0 }), 7);
});

/* ══════════════════════════════════════════════════════════════
 * 2. quota · 配额与用量（写库值必须有限，不能出现 NaN）
 * ══════════════════════════════════════════════════════════════ */
test('quota: monthKey 按 UTC 取月，跨月/跨年边界正确', () => {
  assert.equal(monthKey(new Date('2026-01-01T00:00:00Z')), '202601');
  assert.equal(monthKey(new Date('2026-01-31T23:59:59Z')), '202601');
  assert.equal(monthKey(new Date('2026-12-31T23:59:59Z')), '202612');
  assert.equal(monthKey(new Date('2027-01-01T00:00:00Z')), '202701');
  assert.equal(monthKey(new Date('2026-02-01T00:00:00Z')), '202602');
});

test('quota: limitFor 计划映射与未知计划兜底', () => {
  assert.equal(limitFor('free'), 100);
  assert.ok(limitFor('pro') > limitFor('free'));
  assert.equal(limitFor('unknown' as 'free'), limitFor('free'));
});

test('quota: 空用量读零值且不写库', async () => {
  const d = memDriver();
  const r = new Repo(d);
  const u = await getUsage(r, usr, MONTH);
  assert.deepEqual(
    { runs: u.runs, tokens: u.tokens, costCents: u.costCents, limit: u.limit },
    { runs: 0, tokens: 0, costCents: 0, limit: 100 },
  );
  assert.equal(d.raw.size, 0, '读操作不应产生写入');
});

test('quota: consume 累加 runs/tokens/costCents，setUsage 可覆盖', async () => {
  const d = memDriver();
  const r = new Repo(d);
  const a = await consume(r, usr, { runs: 2, tokens: 300, costCents: 7 }, MONTH);
  assert.deepEqual({ runs: a.runs, tokens: a.tokens, costCents: a.costCents },
    { runs: 2, tokens: 300, costCents: 7 });
  const b = await consume(r, usr, { runs: 1, tokens: 50 }, MONTH);
  assert.equal(b.runs, 3);
  assert.equal(b.tokens, 350);
  assert.equal(b.costCents, 7);
  await setUsage(r, usr.id, { runs: 10, tokens: 0, costCents: 0 }, MONTH);
  assert.equal((await getUsage(r, usr, MONTH)).runs, 10);
});

test('quota: 负数 delta 被钳为 0，不会倒扣用量', async () => {
  const d = memDriver();
  const r = new Repo(d);
  await consume(r, usr, { runs: 5 }, MONTH);
  const u = await consume(r, usr, { runs: -3, tokens: -100 }, MONTH);
  assert.equal(u.runs, 5, '负数不能倒扣');
  assert.equal(u.tokens, 0);
});

test('quota: 恰好用满不报错，再+1 抛 402 QUOTA_EXCEEDED', async () => {
  const d = memDriver();
  const r = new Repo(d);
  const u = await consume(r, usr, { runs: 100 }, MONTH);
  assert.equal(u.runs, 100);
  await assert.rejects(
    () => consume(r, usr, { runs: 1 }, MONTH),
    (e: Error & { status?: number; code?: string }) =>
      e.status === 402 && e.code === 'QUOTA_EXCEEDED',
  );
  assert.equal((await getUsage(r, usr, MONTH)).runs, 100, '超额时不得写入');
});

test('quota: 非有限 delta（NaN/Infinity/脏字符串）不得把 NaN 写进存储', async () => {
  const d = memDriver();
  const r = new Repo(d);
  for (const bad of [NaN, Infinity, -Infinity, 'abc', null, undefined]) {
    await consume(r, usr, { runs: bad as number }, MONTH);
  }
  const rec = d.raw.get('usage:usr_test:202611') as Record<string, unknown> | undefined;
  assert.ok(rec, '应存在用量记录');
  assert.ok(Number.isFinite(rec.runs), `存储 runs 必须有限，实际 ${String(rec.runs)}`);
  assert.equal(rec.runs, 0, '非有限增量应归零');
  const u = await getUsage(r, usr, MONTH);
  assert.ok(Number.isFinite(u.runs), '读出的用量必须有限');
});

test('quota: tokens/costCents 不受 runs 上限约束', async () => {
  const d = memDriver();
  const r = new Repo(d);
  const u = await consume(r, usr, { tokens: 999999, costCents: 88888 }, MONTH);
  assert.equal(u.runs, 0);
  assert.equal(u.tokens, 999999);
});

/* ══════════════════════════════════════════════════════════════
 * 3. decision · 纯函数内核边界
 * ══════════════════════════════════════════════════════════════ */
test('decision: ADR 编号与 seq 分配', () => {
  assert.equal(adrId(1), 'ADR-0001');
  assert.equal(adrId(12345), 'ADR-12345');
  assert.equal(nextDecisionSeq([]), 1);
  assert.equal(nextDecisionSeq(['ADR-0001', 'ADR-0003']), 4);
  assert.equal(nextDecisionSeq(['noise', 'ADR-0010', 'ADR-0002']), 11);
});

test('decision: 状态机全部合法/非法流转', () => {
  assert.equal(canTransition('draft', 'review'), true);
  assert.equal(canTransition('review', 'accepted'), true);
  assert.equal(canTransition('review', 'draft'), true);
  assert.equal(canTransition('accepted', 'deprecated'), true);
  assert.equal(canTransition('accepted', 'superseded'), true);
  assert.equal(canTransition('draft', 'accepted'), false, '不可跨级接受');
  assert.equal(canTransition('accepted', 'draft'), false);
  assert.equal(canTransition('deprecated', 'accepted'), false, '终态不可复活');
  assert.equal(canTransition('superseded', 'review'), false);
});

function opt(id: string, scores: Record<string, unknown>): DecisionOption {
  return {
    id, name: `方案${id}`, summary: '', scores: scores as Record<string, number>,
    pros: ['得'], cons: ['失'], assumptions: ['前提'],
  };
}

test('decision: 加权评分确定性、平局按 id、重放一致', () => {
  const criteria = [{ id: 'a', name: 'A', weight: 60 }, { id: 'b', name: 'B', weight: 40 }];
  const options = [
    opt('o1', { a: 5, b: 1 }),
    opt('o2', { a: 1, b: 5 }),
    opt('o3', { a: 3, b: 3 }),
  ];
  const first = scoreOptions({ criteria, options });
  const second = scoreOptions({ criteria, options });
  assert.deepEqual(first, second, '同输入必须字节级一致');
  assert.equal(first[0].id, 'o1', '60% 权重下 o1 应排第一');
  assert.equal(first[0].rank, 1);
  assert.deepEqual(first.map((s) => s.rank), [1, 2, 3]);
  assert.equal(topGap(first), Math.round((first[0].score - first[1].score) * 100) / 100);
  assert.equal(topGap([first[0]]), 0);
});

test('decision: 权重全 0 → 等权；空维度 → 0 分', () => {
  const zero = scoreOptions({
    criteria: [{ id: 'a', name: 'A', weight: 0 }, { id: 'b', name: 'B', weight: 0 }],
    options: [opt('o1', { a: 5, b: 1 }), opt('o2', { a: 1, b: 5 })],
  });
  assert.equal(zero[0].score, zero[1].score, '等权时两方案同分');
  assert.equal(zero[0].id, 'o1', '平局按 id 字典序');
  const none = scoreOptions({ criteria: [], options: [opt('o1', {})] });
  assert.equal(none[0].score, 0);
});

test('decision: 缺失/非有限/空串分数记 0 贡献，不臆造分数', () => {
  const criteria = [{ id: 'a', name: 'A', weight: 100 }];
  const scores = scoreOptions({
    criteria,
    options: [
      opt('missing', {}),
      opt('nan', { a: NaN }),
      opt('empty', { a: '' }),
      opt('over', { a: 99 }),
      opt('under', { a: -5 }),
    ],
  });
  const by = Object.fromEntries(scores.map((s) => [s.id, s.score]));
  assert.equal(by.missing, 0, '缺失记 0');
  assert.equal(by.nan, 0, 'NaN 记 0');
  assert.equal(by.empty, 0, '空字符串应视为缺失记 0，不能钳成 1');
  assert.equal(by.over, 5, '越上界钳到 5');
  assert.equal(by.under, 1, '越下界钳到 1');
});

test('decision: 负权重与非有限权重不破坏评分', () => {
  const s = scoreOptions({
    criteria: [{ id: 'a', name: 'A', weight: -50 }, { id: 'b', name: 'B', weight: NaN }],
    options: [opt('o1', { a: 5, b: 5 })],
  });
  assert.ok(Number.isFinite(s[0].score), '评分必须有限');
  assert.ok(s[0].score >= 0 && s[0].score <= 5, '评分须落在 1–5 量纲内');
});

test('decision: validateTradeoffs 强制得/失/假设三者齐全', () => {
  assert.equal(validateTradeoffs([opt('ok', {})]).length, 0);
  const bad = opt('bad', {});
  bad.cons = [];
  const issues = validateTradeoffs([bad]);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /失去什么/);
  assert.equal(validateTradeoffs([]).length, 0);
  assert.ok(validateTradeoffs(undefined as unknown as DecisionOption[]).length === 0);
});

test('decision: 到期复核按 UTC 日期比较，非法日期返回 false', () => {
  const now = '2026-11-14T10:00:00Z';
  assert.equal(isReviewDue(undefined, now), false);
  assert.equal(isReviewDue('2026-11-13', now), true, '逾期');
  assert.equal(isReviewDue('2026-11-14', now), true, '当天到期');
  assert.equal(isReviewDue('2026-11-15', now), false, '未到期');
  assert.equal(isReviewDue('garbage', now), false);
  assert.equal(isReviewDue('2026-13-45', now), false);
});

test('decision: decisionToRuleDraft 字段映射稳定', () => {
  const d = {
    id: 'ADR-0007', title: '采用文件 KV', decision: '选 A', chosenOptionId: 'a',
    options: [{ id: 'a', name: '文件 KV' }],
  } as unknown as Decision;
  const draft = decisionToRuleDraft(d, 'claude');
  assert.equal(draft.name, 'adr-adr-0007');
  assert.deepEqual(draft.when, { source: 'decision', types: ['decision.accepted'] });
  assert.equal(draft.to, 'claude');
  assert.equal(draft.group, 'decisions');
  assert.equal(draft.tell, 'needed');
  assert.match(draft.title, /ADR-0007/);
  assert.match(draft.prompt, /文件 KV/);
  assert.equal(decisionToRuleDraft({ id: 'ADR-0008', title: 'T', decision: '', options: [] } as unknown as Decision, 'x').prompt,
    '落实架构决策 ADR-0008');
});

/* ══════════════════════════════════════════════════════════════
 * 4. loop kernel · 校验层与规则匹配边界
 * ══════════════════════════════════════════════════════════════ */
test('loop: validateEvent 拒收指令字段（指令数据分离）', () => {
  const base = { id: 'e1', type: 'issues.opened' };
  assert.deepEqual(validateEvent(base), []);
  for (const f of ['cwd', 'agent', 'access', 'to', 'use']) {
    const issues = validateEvent({ ...base, [f]: 'evil' });
    assert.ok(issues.some((i) => i.includes(f)), `应拒绝字段 ${f}`);
  }
});

test('loop: validateEvent 校验 id/type/subject/link/summary/detail', () => {
  assert.ok(validateEvent({ id: '', type: 'a.b' }).some((i) => i.includes('id')));
  assert.ok(validateEvent({ id: 'e', type: '有中文' }).some((i) => i.includes('type')));
  assert.deepEqual(validateEvent({ id: 'e', type: 'a.b', subject: 'bad subject!' }), [], '空格/标点应放行');
  assert.ok(validateEvent({ id: 'e', type: 'a.b', subject: 'x' + String.fromCharCode(0) + 'y' })
    .some((i) => i.includes('subject')), 'NUL 应被拒');
  assert.ok(validateEvent({ id: 'e', type: 'a.b', link: 'https://例子.com' }).some((i) => i.includes('link')));
  assert.ok(validateEvent({ id: 'e', type: 'a.b', summary: 123 }).some((i) => i.includes('summary')));
  assert.deepEqual(validateEvent({ id: 'e', type: 'a.b', link: 'https://example.com/x' }), []);
});

test('loop: subject 允许可见文字、拒绝注入载体', () => {
  const ok = (subject: unknown) => validateEvent({ id: 'e', type: 'a.b', subject }).length === 0;
  const bad = (subject: unknown) => validateEvent({ id: 'e', type: 'a.b', subject })
    .some((i) => i.includes('subject'));
  for (const s of ['Node架构设计', '架构设计 方案 v2', 'repo#128', 'a b;rm', '订单 / 支付 @ 上海', '评审：通过（P0）', '🚀 发布']) {
    assert.ok(ok(s), `应允许可见文字：${JSON.stringify(s)}`);
  }
  assert.ok(ok(''), '空串视为未提供');
  assert.ok(ok('   '), '纯空白视为未提供');
  const invisible = [
    String.fromCharCode(0), String.fromCharCode(10), String.fromCharCode(13),
    String.fromCharCode(9), String.fromCharCode(31), String.fromCharCode(127),
    String.fromCharCode(0x200B), String.fromCharCode(0x202E),
    String.fromCharCode(0x2066), String.fromCharCode(0xFEFF),
  ];
  for (const c of invisible) {
    assert.ok(bad('x' + c + 'y'), `应拒绝不可见字符 U+${c.codePointAt(0)!.toString(16)}`);
  }
  assert.ok(bad(123), '非字符串应被拒');
  assert.ok(bad({ a: 1 }), '对象应被拒');
  assert.ok(bad('中'.repeat(101)), '超过 100 字应被拒');
  assert.ok(ok('中'.repeat(100)), '恰好 100 字应通过');
  assert.deepEqual(validateEvent({ id: 'e', type: 'a.b', subject: '#42', summary: 's' }), [], '既有标识符零回归');
});

test('loop: validateRule 校验必填、Agent 登记、cron、tell/access', () => {
  const agents = ['claude', 'github'];
  const good: Record<string, unknown> = {
    name: 'r1', to: 'claude', cwd: '~/x', when: { source: 'github', types: ['issues.opened'] }, tell: 'needed',
  };
  assert.deepEqual(validateRule(good, agents), []);
  assert.ok(validateRule({ ...good, to: 'unknown' }, agents).some((i) => i.includes('不是已登记')));
  assert.ok(validateRule({ ...good, name: '  ' }, agents).some((i) => i.includes('name')));
  assert.ok(validateRule({ ...good, cwd: '' }, agents).some((i) => i.includes('cwd')));
  assert.ok(validateRule({ ...good, when: { cron: '* * * *' } }, agents).some((i) => i.includes('cron')));
  assert.deepEqual(validateRule({ ...good, when: { cron: '0 9 * * 1' } }, agents), []);
  assert.ok(validateRule({ ...good, tell: 'daily' }, agents).some((i) => i.includes('tell')));
  assert.ok(validateRule({ ...good, access: 'root' }, agents).some((i) => i.includes('access')));
});

test('loop: typeMatches 支持精确 / * / x.* 三种模式', () => {
  assert.equal(typeMatches(['issues.opened'], 'issues.opened'), true);
  assert.equal(typeMatches(['*'], 'anything.goes'), true);
  assert.equal(typeMatches(['issues.*'], 'issues.closed'), true);
  assert.equal(typeMatches(['issues.*'], 'pull.opened'), false);
  assert.equal(typeMatches([], 'issues.opened'), false);
});

test('loop: matchRules 过滤停用规则/暂停/停用 Source 与 Agent', () => {
  const view = emptyView();
  const rule: LoopRule = {
    name: 'r1', when: { source: 'github', types: ['issues.opened'] }, to: 'claude',
    cwd: '~/x', group: 'g', tell: 'needed', enabled: true,
  } as LoopRule;
  view.rules = { r1: rule };
  view.plugins.sources.github = { id: 'github', name: 'GitHub', kind: 'source' } as never;
  view.plugins.agents.claude = { id: 'claude', name: 'Claude', kind: 'agent' } as never;
  const ev = { source: 'github', type: 'issues.opened', id: 'e1' } as never;
  assert.equal(matchRules(view, ev).length, 1);
  view.pauses.r1 = true;
  assert.equal(matchRules(view, ev).length, 0, '暂停规则不命中');
  view.pauses = {};
  view.disabledPlugins.github = true;
  assert.equal(matchRules(view, ev).length, 0, '停用 Source 不命中');
  view.disabledPlugins = {};
  view.disabledPlugins.claude = true;
  assert.equal(matchRules(view, ev).length, 0, '停用 Agent 不命中');
  view.disabledPlugins = {};
  view.rules.r1 = { ...rule, enabled: false };
  assert.equal(matchRules(view, ev).length, 0, 'enabled=false 不命中');
});
