/**
 * quota · 配额检查与用量累加
 *
 * 按 user.plan 检查并累加 usage:{uid}:{yyyymm}（runs / tokens / costCents）
 * 超额 → HTTP 402 + QUOTA_EXCEEDED
 */
import { PLAN_LIMITS, type Plan, type Usage } from '../../shared/types';
import { k, repo, type Repo, type UsageRecord } from './kv';
import type { Env } from './env';
import { quotaExceeded } from './resp';

/** 当月月份键 yyyymm */
export function monthKey(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}${month}`;
}

export function limitFor(plan: Plan): number {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
}

const EMPTY: UsageRecord = { runs: 0, tokens: 0, costCents: 0 };

/** 读取当月用量（不存在则返回零值，不写库） */
export async function getUsage(
  r: Repo,
  user: { id: string; plan: Plan },
  month = monthKey(),
): Promise<Usage> {
  const record = (await r.get<UsageRecord>(k.usage(user.id, month))) || EMPTY;
  return {
    month,
    plan: user.plan,
    runs: record.runs || 0,
    tokens: record.tokens || 0,
    costCents: record.costCents || 0,
    limit: limitFor(user.plan),
  };
}

/** 写入用量记录（播种等直接赋值场景） */
export async function setUsage(
  r: Repo,
  uid: string,
  record: UsageRecord,
  month = monthKey(),
): Promise<void> {
  await r.put(k.usage(uid, month), {
    runs: record.runs || 0,
    tokens: record.tokens || 0,
    costCents: record.costCents || 0,
  });
}

export interface ConsumeDelta {
  runs?: number;
  tokens?: number;
  costCents?: number;
}

/**
 * 把增量收敛为「有限非负整数」。
 * NaN / Infinity / 脏字符串一律归 0：否则 `Math.trunc(NaN)` 会得到 NaN，
 * 既绕过 `current + NaN > limit` 的配额判断，又把 NaN 写进存储（JSON 里变 null），
 * 用量统计从此静默失真。Infinity 也不该让一次误传把正常用户判成 402。
 */
function normalizeDelta(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

/**
 * 检查配额并累加用量。
 * 只有 runs 受配额上限约束（tokens / costCents 为计量维度）。
 * 超额时不写入、直接抛 402。
 */
export async function consume(
  r: Repo,
  user: { id: string; plan: Plan },
  delta: ConsumeDelta = {},
  month = monthKey(),
): Promise<Usage> {
  const runs = normalizeDelta(delta.runs);
  const tokens = normalizeDelta(delta.tokens);
  const costCents = normalizeDelta(delta.costCents);

  const current = await getUsage(r, user, month);
  const limit = current.limit;

  if (current.runs + runs > limit) {
    throw quotaExceeded(
      `本月配额已耗尽（${current.runs}/${limit} 次）。请升级 Pro（${PLAN_LIMITS.pro} 次/月）或等待下月重置。`,
    );
  }

  const next: UsageRecord = {
    runs: current.runs + runs,
    tokens: current.tokens + tokens,
    costCents: current.costCents + costCents,
  };
  await r.put(k.usage(user.id, month), next);

  return {
    month,
    plan: user.plan,
    runs: next.runs,
    tokens: next.tokens,
    costCents: next.costCents,
    limit,
  };
}

/** 便捷：从 env 构造仓储后读取用量（供 handler 使用） */
export async function usageFor(env: Env, uid: string, plan: Plan): Promise<Usage> {
  const r = await repo(env);
  return getUsage(r, { id: uid, plan });
}
