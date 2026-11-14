/**
 * functions/loop · Agent Autoloop REST 端点
 *
 * 全部走确定性内核：handler 只做「鉴权 → 校验 → commit(输入) → 读快照」，
 * 业务逻辑零写在 HTTP 层。userId 由会话注入，客户端不可伪造。
 * now 由外壳注入（内核不读系统时钟）。
 *
 * 路由见 backend/functions/router.ts 的 /loop/* 段。
 */
import {
  LOOP_KERNEL_VERSION, RECEIPT_OUTCOMES, type LoopEvent, type LoopInput, type LoopPlugin, type LoopReceipt, type LoopRule,
} from '../../shared/loop';
import { requireUser } from '../lib/auth';
import { readJsonBody, type ApiCtx } from '../lib/http';
import { repo } from '../lib/kv';
import { commit, loopFacts, loopState, loopWhy, readView } from '../lib/loop/store';
import { ensureLoopSeeded } from '../lib/loop/seed';
import { validateEvent, validateRule, matchRules, decide } from '../lib/loop/kernel';
import { badRequest, conflict, forbidden, notFound, ok } from '../lib/resp';
import { workerStatus, runWorkerTick, saveUserConfig } from '../lib/loop/worker';

/** 外壳注入当前时间（内核绝不自己读时钟） */
function nowOf(ctx: ApiCtx): string {
  // 允许测试通过 query 注入固定时间，保证可复现；生产用真实时间
  const injected = ctx.query.get('now');
  return injected && !Number.isNaN(Date.parse(injected)) ? injected : new Date().toISOString();
}

async function prepare(ctx: ApiCtx): Promise<{ r: Awaited<ReturnType<typeof repo>>; uid: string; email: string; now: string }> {
  const r = await repo(ctx.env);
  const user = await requireUser(ctx, r);
  const now = nowOf(ctx);
  await ensureLoopSeeded(r, user.id, now);
  // email 由会话注入，作为卡片应答者身份（by），客户端不可伪造
  return { r, uid: user.id, email: user.email, now };
}

/* ── 只读查询 ───────────────────────────────────────────────── */
export async function getState(ctx: ApiCtx): Promise<Response> {
  const { r, uid, now } = await prepare(ctx);
  return ok(await loopState(r, uid, now));
}

export async function getHealthz(): Promise<Response> {
  // 版本取自单一事实源，避免内核 bump 后健康探针仍报旧版本
  return ok({ status: 'ok', kernel: LOOP_KERNEL_VERSION, at: new Date().toISOString() });
}

export async function getFacts(ctx: ApiCtx): Promise<Response> {
  const { r, uid } = await prepare(ctx);
  const after = Number(ctx.query.get('after') ?? 0) || 0;
  return ok(await loopFacts(r, uid, after));
}

export async function getRuns(ctx: ApiCtx): Promise<Response> {
  const { r, uid, now } = await prepare(ctx);
  const state = await loopState(r, uid, now);
  const before = Number(ctx.query.get('before') ?? 0) || 0;
  const runs = before ? state.runs.filter((run) => run.seq < before) : state.runs;
  return ok({ runs, hasMore: runs.length < state.runs.length });
}

export async function getWhy(ctx: ApiCtx): Promise<Response> {
  const { r, uid } = await prepare(ctx);
  const facts = await loopWhy(r, uid, ctx.params.id);
  if (!facts.length) throw notFound('轮次不存在或无关联事实');
  return ok({ run: ctx.params.id, timeline: facts });
}

export async function getEventBySeq(ctx: ApiCtx): Promise<Response> {
  const { r, uid } = await prepare(ctx);
  const seq = Number(ctx.params.seq);
  const facts = await loopFacts(r, uid, seq - 1);
  const accepted = facts.find((f) => f.seq === seq && f.kind === 'event.accepted');
  if (!accepted) throw notFound('事件不存在');
  return ok(accepted);
}

export async function getCards(ctx: ApiCtx): Promise<Response> {
  const { r, uid, now } = await prepare(ctx);
  const state = await loopState(r, uid, now);
  return ok(state.cards);
}

/* ── 事件接入 / 预演 ───────────────────────────────────────── */
/** subject 归一化：trim 后为空视为未提供，避免把空串写进事实日志 */
function subjectOf(body: Record<string, unknown>): string | undefined {
  const s = body.subject;
  if (typeof s !== 'string') return undefined;
  const t = s.trim();
  return t || undefined;
}

export async function postEvent(ctx: ApiCtx): Promise<Response> {
  const { r, uid, now } = await prepare(ctx);
  const body = await readJsonBody(ctx.req, ctx.raw);

  // ③ 指令数据分离：校验在内核，HTTP 层只负责转 400
  const issues = validateEvent(body);
  if (issues.length) throw badRequest(issues.join('；'));

  const source = typeof body.source === 'string' && body.source ? body.source : 'manual';
  const event: LoopEvent = {
    id: String(body.id), source, type: String(body.type),
    subject: subjectOf(body),
    summary: body.summary as string | undefined,
    detail: body.detail as string | undefined,
    link: body.link as string | undefined,
    hops: body.hops === undefined ? 0 : Number(body.hops),
  };

  const { facts, view } = await commit(r, uid, { kind: 'event', event }, now);
  const accepted = facts.find((f) => f.kind === 'event.accepted') as
    | Extract<typeof facts[number], { kind: 'event.accepted' }> | undefined;
  const blocked = facts.some((f) => f.kind === 'hop.blocked');
  return ok({
    event: accepted?.seq ?? view.seq,
    duplicate: accepted?.duplicate ?? false,
    routed: accepted?.routed ?? [],
    mergedInto: accepted?.mergedInto ?? null,
    hopBlocked: blocked,
    facts: facts.map((f) => f.seq),
  }, { status: 201 });
}

export async function postEmit(ctx: ApiCtx): Promise<Response> {
  const { r, uid, now } = await prepare(ctx);
  const body = await readJsonBody(ctx.req, ctx.raw);
  const issues = validateEvent(body);
  if (issues.length) throw badRequest(issues.join('；'));

  // 预演：只读视图直接跑 decide，不落库、不写真日志（对齐 CLI emit --dry-run）
  const view = await readView(r, uid);
  const event: LoopEvent = {
    id: String(body.id), source: String(body.source ?? 'manual'), type: String(body.type),
    subject: subjectOf(body), hops: Number(body.hops ?? 0),
  };
  const facts = decide(view, { kind: 'event', event }, now);
  const accepted = facts.find((f) => f.kind === 'event.accepted') as
    | Extract<typeof facts[number], { kind: 'event.accepted' }> | undefined;
  return ok({
    routed: accepted?.routed ?? [],
    wouldBlock: facts.some((f) => f.kind === 'hop.blocked'),
    duplicate: accepted?.duplicate ?? false,
    matched: matchRules(view, event).map((rule) => rule.name),
  });
}

/* ── 规则 ───────────────────────────────────────────────────── */
export async function listRules(ctx: ApiCtx): Promise<Response> {
  const { r, uid, now } = await prepare(ctx);
  return ok((await loopState(r, uid, now)).rules);
}

export async function postRule(ctx: ApiCtx): Promise<Response> {
  const { r, uid, now } = await prepare(ctx);
  const body = await readJsonBody(ctx.req, ctx.raw);
  const view = await readView(r, uid);
  const issues = validateRule(body, Object.keys(view.plugins.agents));
  if (issues.length) throw badRequest(issues.join('；'));

  const rule = body as unknown as LoopRule;
  const { facts } = await commit(r, uid, { kind: 'rule.upsert', rule }, now);
  return ok({ rule, facts: facts.map((f) => f.seq) }, { status: 201 });
}

export async function postRuleCheck(ctx: ApiCtx): Promise<Response> {
  const { r, uid } = await prepare(ctx);
  const body = await readJsonBody(ctx.req, ctx.raw);
  const view = await readView(r, uid);
  const draft = (body.rules ?? body.rule ?? [body]) as Array<Record<string, unknown>>;
  const issues: string[] = [];
  draft.forEach((raw, i) => {
    validateRule(raw, Object.keys(view.plugins.agents)).forEach((msg) => issues.push(`#${i + 1} ${msg}`));
  });
  const names = draft.map((d) => String(d.name ?? ''));
  const dup = names.filter((n, i) => n && names.indexOf(n) !== i);
  if (dup.length) issues.push(`规则名重复：${[...new Set(dup)].join('、')}`);
  return ok({ valid: issues.length === 0, issues });
}

export async function postRulePause(ctx: ApiCtx): Promise<Response> {
  const { r, uid, now } = await prepare(ctx);
  const body = await readJsonBody(ctx.req, ctx.raw);
  const { facts } = await commit(r, uid, {
    kind: 'rule.pause', name: ctx.params.name, reason: body.reason as string | undefined,
  }, now);
  if (!facts.length) throw notFound('规则不存在');
  return ok({ paused: true, facts: facts.map((f) => f.seq) });
}

export async function postRuleResume(ctx: ApiCtx): Promise<Response> {
  const { r, uid, now } = await prepare(ctx);
  const { facts } = await commit(r, uid, { kind: 'rule.resume', name: ctx.params.name }, now);
  if (!facts.length) throw notFound('规则不存在');
  return ok({ paused: false, facts: facts.map((f) => f.seq) });
}

export async function postRuleRun(ctx: ApiCtx): Promise<Response> {
  const { r, uid, now } = await prepare(ctx);
  const body = await readJsonBody(ctx.req, ctx.raw);
  const { facts } = await commit(r, uid, {
    kind: 'rule.run', name: ctx.params.name, subject: subjectOf(body),
  }, now);
  const queued = facts.find((f) => f.kind === 'run.queued') as
    | Extract<typeof facts[number], { kind: 'run.queued' }> | undefined;
  if (!queued) throw conflict('规则不存在、已暂停，或同事项已有活跃轮次');
  return ok({ run: queued.run.id, facts: facts.map((f) => f.seq) }, { status: 201 });
}

/* ── 轮次：领活 / 交回执 ───────────────────────────────────── */
export async function postRunClaim(ctx: ApiCtx): Promise<Response> {
  const { r, uid, now } = await prepare(ctx);
  const view = await readView(r, uid);
  if (!view.runs[ctx.params.id]) throw notFound('轮次不存在');
  const { facts } = await commit(r, uid, { kind: 'run.claim', id: ctx.params.id }, now);
  if (!facts.length) throw conflict('轮次不处于 queued 状态');
  return ok({ claimed: true, facts: facts.map((f) => f.seq) });
}

export async function postRunResult(ctx: ApiCtx): Promise<Response> {
  const { r, uid, now } = await prepare(ctx);
  const body = await readJsonBody(ctx.req, ctx.raw);
  const view = await readView(r, uid);
  const run = view.runs[ctx.params.id];
  if (!run) throw notFound('轮次不存在');

  const outcome = String(body.outcome ?? 'done');
  if (!RECEIPT_OUTCOMES.includes(outcome as LoopReceipt['outcome'])) {
    throw badRequest(`outcome 取值非法，可选：${RECEIPT_OUTCOMES.join(' / ')}`);
  }

  // 幂等/冲突判定完全下沉给内核（业务逻辑零写在 HTTP 层）：
  //  - 相同内容重交 → 内核产 run.finished{duplicate:true}，不改状态、不重复计费
  //  - 不同内容重交 → 内核 receipts 指纹不符、不产任何事实 → 此处映射为 409
  //  - 首次提交 → 内核产 run.finished + 卡片/派生轮次
  const receipt = body as unknown as LoopReceipt;
  const { facts } = await commit(r, uid, { kind: 'run.result', id: ctx.params.id, receipt }, now);
  if (!facts.length) throw conflict('该轮次已提交过不同内容的回执');
  const finished = facts.find((f) => f.kind === 'run.finished') as
    | Extract<typeof facts[number], { kind: 'run.finished' }> | undefined;
  return ok({
    duplicate: finished?.duplicate ?? false,
    cards: facts.filter((f) => f.kind === 'card.created').map((f) => (f as any).card?.id),
    derivedRuns: facts.filter((f) => f.kind === 'run.queued').map((f) => (f as any).run?.id),
    facts: facts.map((f) => f.seq),
  }, { status: 201 });
}

/* ── 卡片：回答 / 结案 ─────────────────────────────────────── */
export async function postCardAnswer(ctx: ApiCtx): Promise<Response> {
  const { r, uid, email, now } = await prepare(ctx);
  const body = await readJsonBody(ctx.req, ctx.raw);
  const view = await readView(r, uid);
  const card = view.cards[ctx.params.id];
  if (!card) throw notFound('卡片不存在');
  if (card.kind !== 'ask' || card.state !== 'open') throw conflict('卡片不是待回答的提问');
  const choice = body.choice === undefined ? undefined : Number(body.choice);
  if (choice !== undefined && (!Number.isInteger(choice) || choice < 0 || choice >= card.options.length)) {
    throw badRequest('choice 超出选项范围');
  }
  // M4：通道级应答身份校验完全下沉内核（卡片 answerers 白名单 vs 会话注入的 by）。
  // 内核拒绝时不产任何事实 → 外壳映射 403；业务逻辑零写在 HTTP 层。
  const { facts } = await commit(r, uid, {
    kind: 'card.answer', id: ctx.params.id, choice,
    text: body.text as string | undefined, by: email,
  }, now);
  if (!facts.length) throw forbidden('当前身份不在该卡片的通道应答者名单内');
  const resumed = facts.find((f) => f.kind === 'run.queued') as
    | Extract<typeof facts[number], { kind: 'run.queued' }> | undefined;
  return ok({
    decided: true, resumedRun: resumed?.run.id ?? null, facts: facts.map((f) => f.seq),
  });
}

export async function postCardResolve(ctx: ApiCtx): Promise<Response> {
  const { r, uid, now } = await prepare(ctx);
  const body = await readJsonBody(ctx.req, ctx.raw);
  const { facts } = await commit(r, uid, {
    kind: 'card.resolve', id: ctx.params.id, reason: body.reason as string | undefined,
  }, now);
  if (!facts.length) throw conflict('卡片不存在或已结案');
  return ok({ closed: true, facts: facts.map((f) => f.seq) });
}

/* ── 时钟驱动（外壳注入 now）───────────────────────────────── */
export async function postTick(ctx: ApiCtx): Promise<Response> {
  const { r, uid, now } = await prepare(ctx);
  const { facts } = await commit(r, uid, { kind: 'tick' }, now);
  return ok({
    fired: facts.filter((f) => f.kind === 'timer.fired').length,
    newRuns: facts.filter((f) => f.kind === 'run.queued').length,
    facts: facts.map((f) => f.seq),
  });
}

/* ── 插件登记（M1 提供基础写入，M4 展开管理 UI）───────────────── */
export async function postPlugin(ctx: ApiCtx): Promise<Response> {
  const { r, uid, now } = await prepare(ctx);
  const body = await readJsonBody(ctx.req, ctx.raw);
  const kind = String(body.kind ?? '');
  if (!['agent', 'source', 'channel', 'delivery'].includes(kind)) throw badRequest('kind 非法');
  if (!body.id || !body.name) throw badRequest('插件缺少 id / name');
  const plugin = body as unknown as LoopPlugin;
  const { facts } = await commit(r, uid, { kind: 'plugin.upsert', plugin }, now);
  return ok({ plugin, facts: facts.map((f) => f.seq) }, { status: 201 });
}

/** 停用插件：内核校验存在性 + 幂等，未产出事实 → 404（不存在或已停用） */
export async function postPluginDisable(ctx: ApiCtx): Promise<Response> {
  const { r, uid, now } = await prepare(ctx);
  const body = await readJsonBody(ctx.req, ctx.raw);
  const { facts } = await commit(r, uid, {
    kind: 'plugin.disable', id: ctx.params.id,
    reason: body.reason as string | undefined,
  }, now);
  if (!facts.length) throw notFound('插件不存在或已停用');
  return ok({ disabled: true, id: ctx.params.id, facts: facts.map((f) => f.seq) });
}

/* ── M7 · 真实 Agent 执行器 ──────────────────────────────────
 * 内核只负责确定性状态机；这里把「领活 → 真 Agent 执行 → 交回执」交给外壳 worker。
 * 三个端点：状态查询 / 立即执行一轮 / 配置（模式开关、并发、自动轮询）。
 */
export async function getWorkerStatus(ctx: ApiCtx): Promise<Response> {
  const { r, uid } = await prepare(ctx);
  return ok(await workerStatus(r, uid, ctx.env));
}

/** 立即执行一轮：领走 queued 轮次，调用真实 Agent，回写真回执。手动触发不受 auto 开关限制。 */
export async function postWorkerRun(ctx: ApiCtx): Promise<Response> {
  const { r, uid, now } = await prepare(ctx);
  const result = await runWorkerTick(r, uid, ctx.env, now, true);
  return ok(result);
}

/** 更新执行器配置（白名单字段，返回生效配置） */
export async function postWorkerConfig(ctx: ApiCtx): Promise<Response> {
  const { r, uid } = await prepare(ctx);
  const body = await readJsonBody(ctx.req, ctx.raw);
  const config = await saveUserConfig(r, uid, ctx.env, body);
  return ok({ config, status: await workerStatus(r, uid, ctx.env) });
}

/** 启用插件：内核校验是否已停用，未产出事实 → 404 */
export async function postPluginEnable(ctx: ApiCtx): Promise<Response> {
  const { r, uid, now } = await prepare(ctx);
  const { facts } = await commit(r, uid, { kind: 'plugin.enable', id: ctx.params.id }, now);
  if (!facts.length) throw notFound('插件不存在或未被停用');
  return ok({ disabled: false, id: ctx.params.id, facts: facts.map((f) => f.seq) });
}
