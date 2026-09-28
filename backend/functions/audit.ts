/**
 * functions/audit · 审计日志
 *
 * GET /api/audit → AuditLog[]（按时间倒序，默认最近 200 条）
 */
import { requireUser } from '../lib/auth';
import { listAudit as queryAudit } from '../lib/audit';
import type { ApiCtx } from '../lib/http';
import { repo } from '../lib/kv';
import { ok } from '../lib/resp';

const DEFAULT_LIMIT = 200;

export async function listAudit(ctx: ApiCtx): Promise<Response> {
  const r = await repo(ctx.env);
  const user = await requireUser(ctx, r);

  const raw = Number(ctx.query.get('limit'));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.trunc(raw), 500) : DEFAULT_LIMIT;

  const items = await queryAudit(r, user.id, limit);
  return ok(items);
}