/**
 * functions/auth · 注册 / 登录 / 登出 / 当前用户
 *
 * POST /api/auth/register  { email, password } → { user, token }
 * POST /api/auth/login     { email, password } → { user, token }
 * POST /api/auth/logout                        → { ok: true }
 * GET  /api/auth/me                            → { user }
 */
import type { User } from '../../shared/types';
import {
  buildAuthCookie,
  buildClearCookie,
  destroySession,
  hashPassword,
  isSecureRequest,
  issueAuth,
  readToken,
  requireUser,
  toPublicUser,
  verifyPassword,
  verifyToken,
} from '../lib/auth';
import { readJsonBody, type ApiCtx } from '../lib/http';
import { k, newId, repo, type UserRecord } from '../lib/kv';
import { conflict, ok, unauthorized } from '../lib/resp';
import { writeAudit } from '../lib/audit';
import { ensureSeeded } from '../lib/seed';
import { assertEmail, assertPassword } from '../lib/validate';

export async function register(ctx: ApiCtx): Promise<Response> {
  const r = await repo(ctx.env);
  const body = await readJsonBody(ctx.req, ctx.raw);

  const email = assertEmail(body.email);
  const password = assertPassword(body.password);

  const existing = await r.get<UserRecord>(k.user(email));
  if (existing) throw conflict('该邮箱已注册，请直接登录');

  const record: UserRecord = {
    id: newId('usr'),
    email,
    plan: 'free',
    createdAt: new Date().toISOString(),
    passHash: await hashPassword(password),
    seeded: false,
  };
  await r.put(k.user(email), record);

  // 新用户播种演示数据，保证进来不是空白页
  await ensureSeeded(r, record);
  const afterSeed = (await r.get<UserRecord>(k.user(email))) || record;

  await writeAudit(r, record.id, {
    action: 'user.register',
    target: email,
    actor: record.id,
  });

  const auth = await issueAuth(ctx, r, afterSeed);
  return ok(auth, {
    status: 201,
    cookies: [buildAuthCookie(auth.token, { secure: isSecureRequest(ctx) })],
  });
}

export async function login(ctx: ApiCtx): Promise<Response> {
  const r = await repo(ctx.env);
  const body = await readJsonBody(ctx.req, ctx.raw);

  const email = assertEmail(body.email);
  const password = assertPassword(body.password);

  const record = await r.get<UserRecord>(k.user(email));
  // 邮箱不存在与密码错误返回一致提示，避免账号枚举
  if (!record || !(await verifyPassword(password, record.passHash))) {
    throw unauthorized('邮箱或密码错误');
  }

  const fresh = record.seeded ? record : await (async () => {
    await ensureSeeded(r, record);
    return (await r.get<UserRecord>(k.user(email))) || record;
  })();

  await writeAudit(r, record.id, {
    action: 'user.login',
    target: email,
    actor: record.id,
  });

  const auth = await issueAuth(ctx, r, fresh);
  return ok(auth, {
    cookies: [buildAuthCookie(auth.token, { secure: isSecureRequest(ctx) })],
  });
}

export async function logout(ctx: ApiCtx): Promise<Response> {
  const r = await repo(ctx.env);
  const secure = isSecureRequest(ctx);

  const token = readToken(ctx);
  if (token) {
    const payload = await verifyToken(token, ctx.env);
    if (payload) {
      await destroySession(r, payload.sid);
      await writeAudit(r, payload.userId, {
        action: 'user.logout',
        target: payload.email,
        actor: payload.userId,
      });
    }
  }

  return ok({ ok: true }, { cookies: [buildClearCookie({ secure })] });
}

export async function authMe(ctx: ApiCtx): Promise<Response> {
  const r = await repo(ctx.env);
  const record = await requireUser(ctx, r);
  await ensureSeeded(r, record);

  const user: User = toPublicUser(record);
  return ok({ user });
}
