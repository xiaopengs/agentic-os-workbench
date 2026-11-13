/**
 * functions/decisions · 架构设计决策面板（ADP）资源 · M6
 *
 * GET    /api/decisions                    → Decision[]（按 seq 升序，支持 ?status=&tag=&q=）
 * POST   /api/decisions                    → Decision（draft，201）
 * GET    /api/decisions/:id                → Decision
 * PATCH  /api/decisions/:id                → Decision（编辑，写 history；状态不变）
 * DELETE /api/decisions/:id                → { ok: true }
 * POST   /api/decisions/:id/review         → Decision（状态流转，校验状态机 + 写 history/审计）
 * GET    /api/decisions/:id/score          → ScoredOption[]（确定性加权评分，只读）
 * POST   /api/decisions/:id/to-rule        → { draft, valid, issues }（生成规则草案 + 校验，不落库）
 *
 * 架构约束：
 *  - 数据落在独立 `decision:{uid}:d:*` 前缀，**不侵入 autoloop 事实日志**，零回归；
 *  - uid / owner(by) 一律由服务端会话注入，客户端不可伪造；
 *  - 独立播种锁（仿 loop/seed.ts），不复用 ensureSeeded，避免改变既有播种行为；
 *  - D1「转执行」只生成并校验 LoopRule 草案，真正落库由前端调 /loop/rules（复用 M4）。
 */
import {
  adrId, canTransition, DECISION_STATUSES, DECISION_TRANSITIONS, decisionToRuleDraft,
  isReviewDue, nextDecisionSeq, scoreOptions, validateTradeoffs,
  type Decision, type DecisionCriterion, type DecisionHistoryEntry,
  type DecisionOption, type DecisionStatus,
} from '../../shared/decision';
import { requireUser } from '../lib/auth';
import { writeAudit } from '../lib/audit';
import { readJsonBody, type ApiCtx } from '../lib/http';
import { k, listDecisions, type Repo } from '../lib/kv';
import { badRequest, conflict, notFound, ok } from '../lib/resp';
import { validateRule } from '../lib/loop/kernel';
import { readView } from '../lib/loop/store';
import { assertString, optionalString, assertEnum } from '../lib/validate';

/* ── 时间（允许测试注入固定 now，生产取真实时间）──────────── */
function nowOf(ctx: ApiCtx): string {
  const injected = ctx.query.get('now');
  return injected && !Number.isNaN(Date.parse(injected)) ? injected : new Date().toISOString();
}

/* ── 独立播种：per-uid 互斥，只在首次访问写一批示例决策 ──── */
const seeding = new Map<string, Promise<void>>();

interface SeedMeta { seeded: boolean }

function strArray(v: unknown, field: string, max = 20): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw badRequest(`${field} 必须是数组`);
  if (v.length > max) throw badRequest(`${field} 最多 ${max} 项`);
  return v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, max);
}

function criteriaOf(v: unknown): DecisionCriterion[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw badRequest('criteria 必须是数组');
  if (v.length > 12) throw badRequest('评估维度最多 12 个');
  return v.map((raw, i) => {
    const c = (raw ?? {}) as Record<string, unknown>;
    const id = String(c.id ?? `c${i + 1}`).trim();
    const name = String(c.name ?? `维度${i + 1}`).trim();
    const w = Number(c.weight ?? 0);
    if (!Number.isFinite(w) || w < 0 || w > 100) throw badRequest(`维度「${name}」权重需在 0–100`);
    return { id, name, weight: w, description: c.description ? String(c.description) : undefined };
  });
}

function optionsOf(v: unknown, criteria: DecisionCriterion[]): DecisionOption[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw badRequest('options 必须是数组');
  if (v.length > 8) throw badRequest('候选方案最多 8 个');
  const ids = new Set<string>();
  return v.map((raw, i) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const id = String(o.id ?? `o${i + 1}`).trim();
    if (ids.has(id)) throw badRequest(`方案 id 重复：${id}`);
    ids.add(id);
    const scores: Record<string, number> = {};
    const rawScores = (o.scores ?? {}) as Record<string, unknown>;
    for (const c of criteria) {
      if (rawScores[c.id] !== undefined && rawScores[c.id] !== null && rawScores[c.id] !== '') {
        const n = Number(rawScores[c.id]);
        if (!Number.isFinite(n) || n < 1 || n > 5) throw badRequest(`方案「${id}」在维度「${c.name}」的评分需在 1–5`);
        scores[c.id] = n;
      }
    }
    return {
      id,
      name: String(o.name ?? `方案${i + 1}`).trim(),
      summary: String(o.summary ?? '').trim(),
      scores,
      pros: strArray(o.pros, 'pros'),
      cons: strArray(o.cons, 'cons'),
      assumptions: strArray(o.assumptions, 'assumptions'),
    };
  });
}

/** 示例决策种子：4 条覆盖全状态 + 1 条待复核（reviewAt 已过期，进「今天要处理」） */
function seedDecisions(now: string): Decision[] {
  const day = (offset: number) => {
    const d = new Date(Date.parse(now) + offset * 86400000);
    return d.toISOString();
  };
  const criteria: DecisionCriterion[] = [
    { id: 'perf', name: '性能', weight: 40 },
    { id: 'maint', name: '可维护性', weight: 35 },
    { id: 'cost', name: '成本', weight: 25 },
  ];
  const base = (i: number, o: Partial<Decision>): Decision => ({
    id: adrId(i), seq: i, title: '', status: 'draft', context: '', drivers: [],
    criteria: [], options: [], decision: '', consequences: { positive: [], negative: [], risks: [] },
    owner: '系统', tags: [], links: [], createdAt: day(-30 + i * 2), updatedAt: day(-30 + i * 2),
    history: [{ at: day(-30 + i * 2), action: 'created', note: '示例种子' }],
    ...o,
  });
  return [
    base(1, {
      title: '单端口同进程挂载前端与 API', status: 'accepted',
      context: '沙箱只暴露一个端口，前后端分离部署需要额外网关与跨域处理。',
      drivers: ['部署复杂度', '冷启动速度', '同域免 CORS'],
      criteria,
      options: [
        { id: 'mono', name: '单端口 server.mjs', summary: 'Node 同进程挂载 Next 与 /api', scores: { perf: 4, maint: 5, cost: 5 }, pros: ['一次启动', '无跨域'], cons: ['进程耦合'], assumptions: ['单机部署'] },
        { id: 'split', name: '前后端分离', summary: '两个进程 + 反向代理', scores: { perf: 5, maint: 3, cost: 2 }, pros: ['可独立扩容'], cons: ['多一层网关', 'CORS 配置'], assumptions: ['有多实例需求'] },
      ],
      decision: '采用单端口同进程挂载', chosenOptionId: 'mono',
      consequences: { positive: ['部署一条命令', '同域无 CORS'], negative: ['进程内耦合'], risks: ['多实例时需重构'] },
      owner: '架构组', tags: ['部署', '基线'], acceptedAt: day(-28),
      reviewAt: day(-2).slice(0, 10), // 已过期 → 今天要处理（格式 YYYY-MM-DD）
    }),
    base(2, {
      title: '事实日志 + 可丢弃投影缓存', status: 'accepted',
      context: '需要事件溯源与 why 溯源，又要避免每次请求全量重放。',
      drivers: ['可追溯', '读性能', '内核版本升级'],
      criteria,
      options: [
        { id: 'es', name: 'append-only facts + view 缓存', summary: '日志只追加，投影可重建', scores: { perf: 5, maint: 4, cost: 4 }, pros: ['可重放', '版本变更自动重建'], cons: ['多一份缓存'], assumptions: ['单进程'] },
        { id: 'crud', name: '直接 CRUD 状态表', summary: '原地改状态', scores: { perf: 5, maint: 2, cost: 5 }, pros: ['简单'], cons: ['无法溯源', '无重放'], assumptions: [] },
      ],
      decision: '采用事实日志 + 投影缓存', chosenOptionId: 'es',
      consequences: { positive: ['确定性重放', 'why 溯源'], negative: ['缓存一致性需维护'], risks: ['并发播种竞态'] },
      owner: '内核组', tags: ['内核', '事件溯源'], acceptedAt: day(-24),
    }),
    base(3, {
      title: '通道级应答者白名单', status: 'review',
      context: '审批卡片需限制谁能应答，避免越权拍板。',
      drivers: ['身份校验', '挂起零消耗'],
      criteria: criteria.slice(0, 2),
      options: [
        { id: 'snapshot', name: '建卡时快照 answerers', summary: '按通道快照名单', scores: { perf: 5, maint: 4 }, pros: ['名单稳定'], cons: ['通道变更不回溯'], assumptions: ['通道先登记'] },
      ],
      decision: '倾向建卡时快照', owner: '安全组', tags: ['安全'],
    }),
    base(4, {
      title: '首版引入 SQLite 持久化', status: 'deprecated',
      context: '早期考虑用关系库替换文件 KV。',
      drivers: ['零依赖', '沙箱可移植'],
      criteria: criteria.slice(0, 1),
      options: [
        { id: 'sqlite', name: 'SQLite', summary: '引入原生依赖', scores: { perf: 3 }, pros: ['事务'], cons: ['新增依赖', '沙箱编译'], assumptions: ['允许原生模块'] },
      ],
      decision: '弃用：改为文件 KV 单键 append', owner: '架构组', tags: ['存储', '已废弃'],
    }),
  ];
}

/** 幂等独立播种（并发首访读到完整数据；不触碰 ensureSeeded / loop log） */
export async function ensureDecisionSeeded(r: Repo, uid: string, now: string): Promise<void> {
  const ongoing = seeding.get(uid);
  if (ongoing) { await ongoing; return; }

  const meta = await r.get<SeedMeta>(k.decisionMeta(uid));
  if (meta?.seeded) return;

  const task = (async () => {
    const again = await r.get<SeedMeta>(k.decisionMeta(uid));
    if (again?.seeded) return;
    const items = seedDecisions(now);
    for (const d of items) await r.put(k.decision(uid, d.id), d);
    await r.put(k.decisionMeta(uid), { seeded: true } satisfies SeedMeta);
  })();
  seeding.set(uid, task);
  try { await task; } finally { seeding.delete(uid); }
}

/* ── 通用准备（会话注入 uid / email / now + 独立播种）──────── */
async function prepare(ctx: ApiCtx): Promise<{ r: Repo; uid: string; email: string; now: string }> {
  const { repo } = await import('../lib/kv');
  const r = await repo(ctx.env);
  const user = await requireUser(ctx, r);
  const now = nowOf(ctx);
  await ensureDecisionSeeded(r, user.id, now);
  return { r, uid: user.id, email: user.email, now };
}

function hist(d: Decision, e: Omit<DecisionHistoryEntry, 'at'>, now: string): DecisionHistoryEntry[] {
  return [...(d.history ?? []), { ...e, at: now }].slice(-50);
}

/* ── 入参归一化（创建 / 编辑共用）──────────────────────────── */
function normalizeInput(body: Record<string, any>, partial: boolean, current?: Decision): Partial<Decision> {
  const out: Partial<Decision> = {};
  const has = (key: string) => body[key] !== undefined && body[key] !== null;

  if (has('title') || !partial) out.title = assertString(body.title ?? '', '决策标题', 200);
  if (has('context')) out.context = optionalString(body.context, '背景 Context', 4000) ?? '';
  else if (!partial) out.context = '';
  if (has('decision')) out.decision = optionalString(body.decision, '结论 Decision', 4000) ?? '';
  else if (!partial) out.decision = '';
  if (has('confirmation')) out.confirmation = optionalString(body.confirmation, 'Confirmation', 2000);
  if (has('owner') || !partial) out.owner = assertString(body.owner ?? '', '负责人', 100);
  if (has('chosenOptionId')) out.chosenOptionId = optionalString(body.chosenOptionId, '选定方案', 100);

  if (has('drivers')) out.drivers = strArray(body.drivers, 'drivers');
  else if (!partial) out.drivers = [];
  if (has('tags')) out.tags = strArray(body.tags, 'tags');
  else if (!partial) out.tags = [];
  if (has('reviewAt')) {
    const rv = body.reviewAt ? optionalString(body.reviewAt, '复核日期', 20) : undefined;
    if (rv && !/^\d{4}-\d{2}-\d{2}$/.test(rv)) throw badRequest('复核日期格式需为 YYYY-MM-DD');
    out.reviewAt = rv;
  }

  const criteria = has('criteria') ? criteriaOf(body.criteria) : (current?.criteria ?? []);
  if (has('criteria')) out.criteria = criteria;
  else if (!partial) out.criteria = [];
  if (has('options')) out.options = optionsOf(body.options, criteria);
  else if (!partial) out.options = [];

  if (has('consequences')) {
    const c = (body.consequences ?? {}) as Record<string, unknown>;
    out.consequences = {
      positive: strArray(c.positive, 'positive'),
      negative: strArray(c.negative, 'negative'),
      risks: strArray(c.risks, 'risks'),
    };
  } else if (!partial) {
    out.consequences = { positive: [], negative: [], risks: [] };
  }
  return out;
}

/* ── 端点 ─────────────────────────────────────────────────── */
export async function listDecisionsHandler(ctx: ApiCtx): Promise<Response> {
  const { r, uid, now } = await prepare(ctx);
  let items = await listDecisions(r, uid);
  const status = ctx.query.get('status');
  const tag = ctx.query.get('tag');
  const q = (ctx.query.get('q') ?? '').trim().toLowerCase();
  if (status && DECISION_STATUSES.includes(status as DecisionStatus)) {
    items = items.filter((d) => d.status === status);
  }
  if (tag) items = items.filter((d) => (d.tags ?? []).includes(tag));
  if (q) items = items.filter((d) =>
    `${d.id} ${d.title} ${d.context} ${(d.tags ?? []).join(' ')}`.toLowerCase().includes(q));
  items.sort((a, b) => a.seq - b.seq);
  // 附只读派生字段（到期复核），不落库
  const data = items.map((d) => ({ ...d, reviewDue: isReviewDue(d.reviewAt, now) }));
  return ok(data);
}

export async function createDecision(ctx: ApiCtx): Promise<Response> {
  const { r, uid, email, now } = await prepare(ctx);
  const body = await readJsonBody(ctx.req, ctx.raw);
  const input = normalizeInput(body, false);

  const all = await listDecisions(r, uid);
  const seq = nextDecisionSeq(all.map((d) => d.id));
  const id = adrId(seq);
  if (all.some((d) => d.id === id)) throw conflict(`决策编号已存在：${id}`);

  const decision: Decision = {
    id, seq,
    title: input.title as string,
    status: 'draft',
    context: input.context ?? '',
    drivers: input.drivers ?? [],
    criteria: input.criteria ?? [],
    options: input.options ?? [],
    decision: input.decision ?? '',
    chosenOptionId: input.chosenOptionId,
    consequences: input.consequences ?? { positive: [], negative: [], risks: [] },
    confirmation: input.confirmation,
    owner: input.owner as string,
    tags: input.tags ?? [],
    links: [],
    reviewAt: input.reviewAt,
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, action: 'created', by: email, note: '创建为提议' }],
  };

  await r.put(k.decision(uid, id), decision);
  await writeAudit(r, uid, { action: 'decision.create', target: id, actor: email });
  return ok(decision, { status: 201 });
}

export async function getDecision(ctx: ApiCtx): Promise<Response> {
  const { r, uid, now } = await prepare(ctx);
  const d = await r.get<Decision>(k.decision(uid, ctx.params.id));
  if (!d) throw notFound('决策不存在');
  return ok({ ...d, reviewDue: isReviewDue(d.reviewAt, now) });
}

export async function updateDecision(ctx: ApiCtx): Promise<Response> {
  const { r, uid, email, now } = await prepare(ctx);
  const current = await r.get<Decision>(k.decision(uid, ctx.params.id));
  if (!current) throw notFound('决策不存在');
  const body = await readJsonBody(ctx.req, ctx.raw);
  // 状态不允许通过 PATCH 改：必须走 /review（保证状态机与留痕）
  if (body.status !== undefined) throw badRequest('状态变更请使用 /review 端点');
  const patch = normalizeInput(body, true, current);

  const next: Decision = {
    ...current, ...patch,
    id: current.id, seq: current.seq, status: current.status,
    links: current.links ?? [],
    createdAt: current.createdAt, acceptedAt: current.acceptedAt,
    updatedAt: now,
    history: hist(current, { action: 'edit', by: email, note: '编辑决策内容' }, now),
  };
  await r.put(k.decision(uid, next.id), next);
  await writeAudit(r, uid, { action: 'decision.update', target: next.id, actor: email });
  return ok(next);
}

export async function deleteDecision(ctx: ApiCtx): Promise<Response> {
  const { r, uid, email } = await prepare(ctx);
  const d = await r.get<Decision>(k.decision(uid, ctx.params.id));
  if (!d) throw notFound('决策不存在');
  await r.del(k.decision(uid, d.id));
  await writeAudit(r, uid, { action: 'decision.delete', target: d.id, actor: email });
  return ok({ ok: true });
}

export async function reviewDecision(ctx: ApiCtx): Promise<Response> {
  const { r, uid, email, now } = await prepare(ctx);
  const d = await r.get<Decision>(k.decision(uid, ctx.params.id));
  if (!d) throw notFound('决策不存在');
  const body = await readJsonBody(ctx.req, ctx.raw);
  const to = assertEnum<DecisionStatus>(body.to, DECISION_STATUSES, '目标状态');
  if (!canTransition(d.status, to)) {
    const allowed = (DECISION_TRANSITIONS[d.status] ?? []).join(' / ') || '无（终态）';
    throw badRequest(`非法状态流转：${d.status} → ${to}；当前状态允许：${allowed}`);
  }
  // 接受前要求权衡显式化（B3）：有候选方案时必须每个都填得/失/假设
  if (to === 'accepted' && d.options?.length) {
    const issues = validateTradeoffs(d.options);
    if (issues.length) throw badRequest(`接受决策前需补全权衡：${issues.slice(0, 3).join('；')}`);
  }
  const note = body.note ? optionalString(body.note, '流转备注', 500) : undefined;
  const next: Decision = {
    ...d, status: to, updatedAt: now,
    acceptedAt: to === 'accepted' ? now : d.acceptedAt,
    history: hist(d, { action: 'status', from: d.status, to, by: email, note }, now),
  };
  await r.put(k.decision(uid, next.id), next);
  await writeAudit(r, uid, { action: `decision.status.${to}`, target: next.id, actor: email });
  return ok(next);
}

export async function scoreDecision(ctx: ApiCtx): Promise<Response> {
  const { r, uid, now } = await prepare(ctx);
  const d = await r.get<Decision>(k.decision(uid, ctx.params.id));
  if (!d) throw notFound('决策不存在');
  // 允许测试/前端通过 query 覆盖权重（B2 可调权重预演，不落库）
  const weightParam = ctx.query.get('weights');
  let criteria = d.criteria ?? [];
  if (weightParam) {
    try {
      const parsed = JSON.parse(weightParam) as Record<string, number>;
      criteria = criteria.map((c) =>
        parsed[c.id] !== undefined ? { ...c, weight: Number(parsed[c.id]) || 0 } : c);
    } catch { throw badRequest('weights 需为 JSON 对象'); }
  }
  const scores = scoreOptions({ criteria, options: d.options ?? [] });
  await writeAudit(r, uid, { action: 'decision.score', target: d.id, actor: 'system' });
  return ok({ id: d.id, at: now, criteria, scores, gap: scores.length > 1 ? Math.round((scores[0].score - scores[1].score) * 100) / 100 : 0 });
}

/** D1：生成规则草案 + 复用 loop validateRule 校验；不落库（前端调 /loop/rules 落库） */
export async function decisionToRule(ctx: ApiCtx): Promise<Response> {
  const { r, uid, email } = await prepare(ctx);
  const d = await r.get<Decision>(k.decision(uid, ctx.params.id));
  if (!d) throw notFound('决策不存在');
  if (d.status !== 'accepted') throw badRequest('只有「已接受」的决策可以转为执行规则');
  const body = await readJsonBody(ctx.req, ctx.raw);
  const view = await readView(r, uid);
  const agents = Object.keys(view.plugins.agents ?? {});
  const agent = (body.agent as string) || agents[0] || 'claude';
  const draft = decisionToRuleDraft(d, agent);
  const issues = validateRule(draft as unknown as Record<string, unknown>, agents);
  // 若该规则名已存在，提示（不阻断，交给 /loop/rules 决定幂等）
  const dup = !!view.rules?.[draft.name];
  if (dup) issues.push(`规则名已存在：${draft.name}（可先改名或复用）`);
  await writeAudit(r, uid, { action: 'decision.to-rule', target: d.id, actor: email });
  return ok({ draft, valid: issues.length === 0, issues, agents });
}
