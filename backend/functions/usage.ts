/**
 * functions/usage · 当月用量与配额
 *
 * GET /api/usage → Usage { month, plan, runs, tokens, costCents, limit }
 */
import { requireUser } from '../lib/auth';
import type { ApiCtx } from '../lib/http';
import { repo } from '../lib/kv';
import { getUsage as queryUsage } from '../lib/quota';
import { ok } from '../lib/resp';

export async function getUsage(ctx: ApiCtx): Promise<Response> {
  const r = await repo(ctx.env);
  const user = await requireUser(ctx, r);

  const usage = await queryUsage(r, user);
  return ok(usage);
}
