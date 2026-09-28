/**
 * functions/traces · 执行 Trace
 *
 * GET  /api/traces  → Trace[]
 * POST /api/traces  → Trace（计入 tokens 用量，不额外占用 run 配额）
 */
import { TRACE_KINDS, TRACE_STATUSES, type Trace, type TraceKind, type TraceStatus } from '../../shared/types';
import { requireUser } from '../lib/auth';
import { writeAudit } from '../lib/audit';
import { readJsonBody, type ApiCtx } from '../lib/http';
import { k, newId, repo, sortByCreatedAtDesc } from '../lib/kv';
import { consume } from '../lib/quota';
import { badRequest, ok } from '../lib/resp';
import { ensureSeeded } from '../lib/seed';
import { assertEnum, assertNumber, assertString } from '../lib/validate';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

export async function listTraces(ctx: ApiCtx): Promise<Response> {
  const r = await repo(ctx.env);
  const user = await requireUser(ctx, r);
  await ensureSeeded(r, user);

  const items = await r.list<Trace>(`trace:${user.id}:`);
  return ok(sortByCreatedAtDesc(items));
}

export async function createTrace(ctx: ApiCtx): Promise<Response> {
  const r = await repo(ctx.env);
  const user = await requireUser(ctx, r);
  await ensureSeeded(r, user);

  const body = await readJsonBody(ctx.req, ctx.raw);

  const kind = assertEnum<TraceKind>(body.kind, TRACE_KINDS, 'Span 类型');
  const name = assertString(body.name, 'Span 名称', 200);
  const cost = assertNumber(body.cost, '耗时', { min: 0, max: 86_400_000, integer: true });
  const status = assertEnum<TraceStatus>(body.status, TRACE_STATUSES, '状态');

  const time = typeof body.time === 'string' ? body.time.trim() : '';
  if (!TIME_RE.test(time)) throw badRequest('time 需为 HH:MM:SS 格式');

  // Trace 仅计入用量，不占用 run 配额
  await consume(r, user, { runs: 0, tokens: Math.ceil(cost / 4), costCents: 1 });

  const trace: Trace = {
    id: newId('trace'),
    kind,
    name,
    cost,
    status,
    time,
    createdAt: new Date().toISOString(),
  };

  await r.put(k.trace(user.id, trace.id), trace);
  await writeAudit(r, user.id, { action: 'trace.create', target: trace.id, actor: user.email });

  return ok(trace, { status: 201 });
}
