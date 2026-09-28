/**
 * functions/workflows · 工作流资源
 *
 * GET    /api/workflows        → Workflow[]
 * POST   /api/workflows        → Workflow（消耗 1 次 run 配额）
 * GET    /api/workflows/:id    → Workflow
 * PATCH  /api/workflows/:id    → Workflow
 * DELETE /api/workflows/:id    → { ok: true }
 *
 * 所有数据以 userId 为前缀隔离，userId 由服务端从会话注入，客户端不可伪造。
 */
import { WORKFLOW_STATUSES, type Workflow, type WorkflowStatus } from '../../shared/types';
import { requireUser } from '../lib/auth';
import { writeAudit } from '../lib/audit';
import { readJsonBody, type ApiCtx } from '../lib/http';
import { k, newId, repo, sortByCreatedAtDesc } from '../lib/kv';
import { consume } from '../lib/quota';
import { notFound, ok } from '../lib/resp';
import { ensureSeeded } from '../lib/seed';
import { assertEnum, assertString, optionalNumber, optionalString } from '../lib/validate';

/** 单次创建工作流估算的用量（与官方文档口径一致：1 run ≈ 1200 tokens） */
const RUN_TOKENS = 1200;
const RUN_COST_CENTS = 9;

/* ── 入参归一化 ─────────────────────────────────────────────── */
function normalizeInput(body: Record<string, any>, partial: boolean): Partial<Workflow> {
  const out: Partial<Workflow> = {};

  const has = (key: string) => body[key] !== undefined && body[key] !== null && body[key] !== '';

  if (has('name') || !partial) out.name = assertString(body.name ?? '', '工作流名称', 200);
  if (has('category') || !partial) out.category = assertString(body.category ?? '', '分类', 200);
  if (has('description')) out.description = optionalString(body.description, '描述');

  if (has('devices') || !partial) {
    out.devices = optionalNumber(body.devices ?? 0, '设备数', { min: 0, max: 100000, integer: true }) ?? 0;
  }
  if (has('steps') || !partial) {
    out.steps = optionalNumber(body.steps ?? 0, '步骤数', { min: 0, max: 100000, integer: true }) ?? 0;
  }
  if (has('coverage') || !partial) {
    out.coverage = optionalNumber(body.coverage ?? 0, '覆盖率', { min: 0, max: 100 }) ?? 0;
  }
  if (has('duration') || !partial) {
    out.duration = optionalNumber(body.duration ?? 0, '回归时长', { min: 0, max: 100000, integer: true }) ?? 0;
  }
  if (has('status') || !partial) {
    out.status = assertEnum<WorkflowStatus>(body.status ?? 'queued', WORKFLOW_STATUSES, '状态');
  }
  if (has('env')) out.env = optionalString(body.env, '环境', 100);

  return out;
}

/* ── 端点 ───────────────────────────────────────────────────── */
export async function listWorkflows(ctx: ApiCtx): Promise<Response> {
  const r = await repo(ctx.env);
  const user = await requireUser(ctx, r);
  await ensureSeeded(r, user);

  const items = await r.list<Workflow>(`wf:${user.id}:`);
  return ok(sortByCreatedAtDesc(items));
}

export async function createWorkflow(ctx: ApiCtx): Promise<Response> {
  const r = await repo(ctx.env);
  const user = await requireUser(ctx, r);
  await ensureSeeded(r, user);

  const body = await readJsonBody(ctx.req, ctx.raw);
  const input = normalizeInput(body, false);

  // 配额检查 + 累加（超额抛 402 QUOTA_EXCEEDED）
  await consume(r, user, { runs: 1, tokens: RUN_TOKENS, costCents: RUN_COST_CENTS });

  const now = new Date().toISOString();
  const workflow: Workflow = {
    id: newId('wf'),
    name: input.name as string,
    category: input.category as string,
    description: input.description,
    devices: input.devices ?? 0,
    steps: input.steps ?? 0,
    coverage: input.coverage ?? 0,
    duration: input.duration ?? 0,
    status: input.status ?? 'queued',
    env: input.env,
    createdAt: now,
    updatedAt: now,
  };

  await r.put(k.wf(user.id, workflow.id), workflow);
  await writeAudit(r, user.id, {
    action: 'workflow.create',
    target: workflow.id,
    actor: user.email,
  });

  return ok(workflow, { status: 201 });
}

export async function getWorkflow(ctx: ApiCtx): Promise<Response> {
  const r = await repo(ctx.env);
  const user = await requireUser(ctx, r);

  const id = ctx.params.id;
  const workflow = await r.get<Workflow>(k.wf(user.id, id));
  if (!workflow) throw notFound('工作流不存在');

  return ok(workflow);
}

export async function updateWorkflow(ctx: ApiCtx): Promise<Response> {
  const r = await repo(ctx.env);
  const user = await requireUser(ctx, r);

  const id = ctx.params.id;
  const current = await r.get<Workflow>(k.wf(user.id, id));
  if (!current) throw notFound('工作流不存在');

  const body = await readJsonBody(ctx.req, ctx.raw);
  const patch = normalizeInput(body, true);

  const next: Workflow = {
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  };

  await r.put(k.wf(user.id, id), next);
  await writeAudit(r, user.id, { action: 'workflow.update', target: id, actor: user.email });

  return ok(next);
}

export async function deleteWorkflow(ctx: ApiCtx): Promise<Response> {
  const r = await repo(ctx.env);
  const user = await requireUser(ctx, r);

  const id = ctx.params.id;
  const current = await r.get<Workflow>(k.wf(user.id, id));
  if (!current) throw notFound('工作流不存在');

  await r.del(k.wf(user.id, id));
  await writeAudit(r, user.id, { action: 'workflow.delete', target: id, actor: user.email });

  return ok({ ok: true });
}