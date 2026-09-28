/**
 * functions/assets · 技能 / 合同 / 设备（只读目录）
 *
 * GET /api/skills    → Skill[]
 * GET /api/contracts → Contract[]
 * GET /api/devices   → Device[]   （前端设备页需要）
 *
 * 首次访问时为用户播种演示数据，其后均为持久化读取。
 */
import type { Contract, Device, Skill } from '../../shared/types';
import { requireUser } from '../lib/auth';
import type { ApiCtx } from '../lib/http';
import { repo, sortByUpdatedAtDesc } from '../lib/kv';
import { ok } from '../lib/resp';
import { ensureSeeded } from '../lib/seed';

export async function listSkills(ctx: ApiCtx): Promise<Response> {
  const r = await repo(ctx.env);
  const user = await requireUser(ctx, r);
  await ensureSeeded(r, user);

  const items = await r.list<Skill>(`skill:${user.id}:`);
  return ok(sortByUpdatedAtDesc(items));
}

export async function listContracts(ctx: ApiCtx): Promise<Response> {
  const r = await repo(ctx.env);
  const user = await requireUser(ctx, r);
  await ensureSeeded(r, user);

  const items = await r.list<Contract>(`contract:${user.id}:`);
  return ok(sortByUpdatedAtDesc(items));
}

export async function listDevices(ctx: ApiCtx): Promise<Response> {
  const r = await repo(ctx.env);
  const user = await requireUser(ctx, r);
  await ensureSeeded(r, user);

  const items = await r.list<Device>(`device:${user.id}:`);
  return ok(items);
}