/**
 * decision · 架构设计决策面板（ADP）领域契约 + 确定性纯函数内核
 *
 * 定位（docs/08）：精简基线（工作流 + 技能）之后「逐个补充」的第 3 个业务模块。
 * M6 实现文档 08 §3 第 1 期 MVP 4 项：
 *   A1+A2+A3 ADR 卡片 CRUD + MADR 结构 + 状态机（留痕）
 *   B1+B2+B3 方案对比矩阵 + 可调权重评分 + 权衡显式化
 *   E1        按状态分列决策看板
 *   D1        决策 → 执行（对齐 autoloop 语义：生成规则草案 → 校验 → 落库）
 *
 * 架构约束：
 *  - 本文件为唯一事实源，纯函数、零 IO、零依赖，前后端共用；前端镜像于 frontend/lib/decision-types.ts。
 *  - 数据以 uid 为前缀隔离，落在独立 `decision:{uid}:` KV 前缀，**不侵入 autoloop 事实日志**，
 *    与既有 workflows/traces/loop 数据完全隔离，保证零回归。
 *  - 评分 / 状态机 / 规则草案均为确定性纯函数：同输入必得同输出，便于单测与重放。
 */

/* ── 状态机 ─────────────────────────────────────────────────── */
export type DecisionStatus = 'draft' | 'review' | 'accepted' | 'deprecated' | 'superseded';

export const DECISION_STATUSES: readonly DecisionStatus[] = [
  'draft', 'review', 'accepted', 'deprecated', 'superseded',
] as const;

/** 合法流转：draft → review → accepted →(deprecated|superseded)；review 可驳回回 draft */
export const DECISION_TRANSITIONS: Record<DecisionStatus, readonly DecisionStatus[]> = {
  draft: ['review'],
  review: ['accepted', 'draft'],
  accepted: ['deprecated', 'superseded'],
  deprecated: [],
  superseded: [],
};

export const DECISION_STATUS_META: Record<DecisionStatus, { label: string; tone: 'mute' | 'info' | 'ok' | 'warn' | 'err' }> = {
  draft: { label: '提议', tone: 'mute' },
  review: { label: '评审中', tone: 'info' },
  accepted: { label: '已接受', tone: 'ok' },
  deprecated: { label: '已废弃', tone: 'warn' },
  superseded: { label: '被取代', tone: 'err' },
};

export function canTransition(from: DecisionStatus, to: DecisionStatus): boolean {
  return (DECISION_TRANSITIONS[from] ?? []).includes(to);
}

/* ── 领域模型（MADR 结构）──────────────────────────────────── */
export interface DecisionCriterion {
  id: string;
  /** 评估维度名：性能 / 成本 / 复杂度 / 可维护性 / 团队熟悉度 / 风险 */
  name: string;
  /** 权重 0–100，同一决策内归一化 */
  weight: number;
  description?: string;
}

export interface DecisionOption {
  id: string;
  name: string;
  summary: string;
  /** criterionId → 1–5 分 */
  scores: Record<string, number>;
  /** 权衡显式化：得到什么 / 失去什么 / 假设是什么，不允许只写优点 */
  pros: string[];
  cons: string[];
  assumptions: string[];
}

export interface DecisionConsequences {
  positive: string[];
  negative: string[];
  risks: string[];
}

export type DecisionLinkType = 'rule' | 'skill' | 'pr' | 'doc' | 'trace' | 'event';

export interface DecisionLink {
  type: DecisionLinkType;
  ref: string;
}

/** 每次状态流转 / 编辑留痕 */
export interface DecisionHistoryEntry {
  at: string;
  action: 'created' | 'status' | 'edit' | 'score' | 'execute';
  from?: DecisionStatus;
  to?: DecisionStatus;
  note?: string;
  by?: string;
}

export interface Decision {
  /** ADR 编号，如 ADR-0001 */
  id: string;
  seq: number;
  title: string;
  status: DecisionStatus;
  /** Context */
  context: string;
  /** Decision Drivers */
  drivers: string[];
  /** Considered Options 的评估维度 */
  criteria: DecisionCriterion[];
  /** Considered Options */
  options: DecisionOption[];
  /** Decision：最终结论文本 */
  decision: string;
  /** 选中的方案 id（若结论对应某候选方案） */
  chosenOptionId?: string;
  /** Consequences */
  consequences: DecisionConsequences;
  /** Confirmation：如何验证决策成立 */
  confirmation?: string;
  owner: string;
  tags: string[];
  links: DecisionLink[];
  /** 到期复核日（YYYY-MM-DD），到期进「今天要处理」 */
  reviewAt?: string;
  /** 谱系 */
  supersedes?: string;
  supersededBy?: string;
  createdAt: string;
  updatedAt: string;
  acceptedAt?: string;
  history: DecisionHistoryEntry[];
}

/** 客户端创建入参（服务端生成 id/seq/时间戳/history） */
export interface DecisionInput {
  title: string;
  context: string;
  drivers?: string[];
  criteria?: DecisionCriterion[];
  options?: DecisionOption[];
  decision?: string;
  chosenOptionId?: string;
  consequences?: Partial<DecisionConsequences>;
  confirmation?: string;
  owner: string;
  tags?: string[];
  reviewAt?: string;
}

/* ── ADR 编号 ───────────────────────────────────────────────── */
export function adrId(seq: number): string {
  return `ADR-${String(seq).padStart(4, '0')}`;
}

/** 从已有 id 集合中算出下一个 seq（纯函数，服务端用于分配编号） */
export function nextDecisionSeq(existingIds: string[]): number {
  let max = 0;
  for (const id of existingIds) {
    const m = /^ADR-(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/* ── 确定性加权评分（B1/B2）───────────────────────────────── */
export interface ScoredOption {
  id: string;
  name: string;
  /** 归一化加权总分（1–5 量纲，保留 2 位） */
  score: number;
  /** 各维度得分明细（criterionId → 归一化后贡献值） */
  breakdown: Record<string, number>;
  rank: number;
}

const SCORE_MIN = 1;
const SCORE_MAX = 5;

/**
 * 分数归一化：缺失 / 空串 / 非有限 / 非数字一律记 0 贡献（不臆造分数），
 * 合法分数钳制到 [1,5]。
 * 注意：Number('') === 0、Number(true) === 1，若不加类型判断会把空串钳成 1 分、
 * 把布尔当成有效评分，破坏「缺失记 0」的确定性语义。
 */
function clampScore(v: unknown): number {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && v.trim() !== '') n = Number(v);
  else return 0;
  if (!Number.isFinite(n)) return 0;
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, n));
}

/**
 * 归一化加权评分：把每个维度权重归一到总和 1，按 1–5 分加权求和。
 * - 权重全 0 或空维度 → 等权（或返回 0 分，见下）；
 * - 分数缺失/越界 → 钳制到 [1,5]，缺失记 0 贡献（不臆造）；
 * - 排名按 score 降序，平局按 id 字典序，保证确定性（重放一致）。
 */
export function scoreOptions(decision: {
  criteria: DecisionCriterion[];
  options: DecisionOption[];
}): ScoredOption[] {
  const criteria = decision.criteria ?? [];
  const options = decision.options ?? [];
  const weightSum = criteria.reduce((s, c) => s + Math.max(0, Number(c.weight) || 0), 0);

  const scored = options.map((opt) => {
    let score = 0;
    const breakdown: Record<string, number> = {};
    for (const c of criteria) {
      const raw = opt.scores?.[c.id];
      const value = raw !== undefined && raw !== null ? clampScore(raw) : 0;
      const w = weightSum > 0 ? Math.max(0, Number(c.weight) || 0) / weightSum
        : (criteria.length > 0 ? 1 / criteria.length : 0);
      const contribution = value * w;
      breakdown[c.id] = Math.round(contribution * 100) / 100;
      score += contribution;
    }
    return {
      id: opt.id,
      name: opt.name,
      score: Math.round(score * 100) / 100,
      breakdown,
    };
  });

  scored.sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id));
  return scored.map((s, i) => ({ ...s, rank: i + 1 }));
}

/** 敏感性提示：权重变化是否可能翻转第一名（B4 预留，M6 只做只读判断） */
export function topGap(scores: ScoredOption[]): number {
  if (scores.length < 2) return 0;
  return Math.round((scores[0].score - scores[1].score) * 100) / 100;
}

/* ── 权衡完整性校验（B3）──────────────────────────────────── */
/** 返回问题清单；空数组表示通过。强制每个方案填写得/失/假设，不许只写优点。 */
export function validateTradeoffs(options: DecisionOption[]): string[] {
  const issues: string[] = [];
  for (const o of options ?? []) {
    if (!o.pros?.length) issues.push(`方案「${o.name}」缺少「得到什么」`);
    if (!o.cons?.length) issues.push(`方案「${o.name}」缺少「失去什么」`);
    if (!o.assumptions?.length) issues.push(`方案「${o.name}」缺少「前提假设」`);
  }
  return issues;
}

/* ── 到期复核（C4 的 MVP 雏形：只判断，不做提醒推送）───────── */
/** reviewAt（YYYY-MM-DD）相对今天是否到期/逾期 */
export function isReviewDue(reviewAt: string | undefined, nowISO: string): boolean {
  if (!reviewAt) return false;
  const due = Date.parse(`${reviewAt}T00:00:00Z`);
  if (!Number.isFinite(due)) return false;
  const today = Date.parse(`${nowISO.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(today) && due <= today;
}

/* ── D1：决策 → 执行（对齐 autoloop 规则语义）──────────────── */
/**
 * 把「已接受决策」的落地事项转换成一条 LoopRule 草案，交由 /loop/rules/check 校验、
 * /loop/rules 落库（复用 M4 能力，决策模块本身不写事实日志）。
 *
 * 映射：决策标题 → 规则 name（加 adr 前缀避免与既有规则重名）、
 *       driver 首项 → when.types 的语义提示（默认 decision.accepted 事件源）、
 *       chosenOption 的结论 → prompt。
 */
export interface DecisionRuleDraft {
  name: string;
  when: { source: string; types: string[] };
  to: string;
  cwd: string;
  group: string;
  tell: 'needed';
  title: string;
  prompt: string;
}

export function decisionToRuleDraft(decision: Decision, agent: string): DecisionRuleDraft {
  const chosen = decision.options?.find((o) => o.id === decision.chosenOptionId);
  const conclusion = [decision.decision, chosen ? `选定方案：${chosen.name}` : ''].filter(Boolean).join('；');
  return {
    name: `adr-${decision.id.toLowerCase()}`,
    when: { source: 'decision', types: ['decision.accepted'] },
    to: agent,
    cwd: '~/workbench',
    group: 'decisions',
    tell: 'needed',
    title: `[${decision.id}] ${decision.title}`,
    prompt: conclusion || `落实架构决策 ${decision.id}`,
  };
}

/* ── 统一响应与 API 路径常量（与 shared/types.ts 风格一致）──── */
export const DECISION_API = {
  LIST: '/decisions',
  DETAIL: '/decisions/:id',
  REVIEW: '/decisions/:id/review',
  SCORE: '/decisions/:id/score',
  TO_RULE: '/decisions/:id/to-rule',
} as const;
