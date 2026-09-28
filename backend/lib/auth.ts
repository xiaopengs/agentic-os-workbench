/**
 * auth · 密码哈希 / JWT / HttpOnly Cookie / 鉴权守卫
 *
 * - bcryptjs（cost 10）哈希存储，禁止明文密码
 * - jose 签发/校验 HS256 JWT，有效期 7 天
 * - HttpOnly Cookie（token，SameSite=Lax，Path=/）为主会话通道
 * - 同时兼容 Authorization: Bearer <token>（前端两种都支持）
 * - 会话记录落 session:{sid}，登出即失效
 */
import { hash, compare } from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import type { AuthResult, Plan, User } from '../../shared/types';
import { getEnv, isProduction, type Env } from './env';
import { getCookie, getHeader, type ApiCtx } from './http';
import { k, normalizeEmail, newId, repo, type Repo, type SessionRecord, type UserRecord } from './kv';
import { misconfig, unauthorized } from './resp';

export const BCRYPT_COST = 10;
export const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 天
export const COOKIE_NAME = 'token';

/** 本地开发兜底密钥（仅非生产环境允许使用，启动时打印警告） */
const DEV_FALLBACK_SECRET = 'agentic-os-dev-insecure-jwt-secret-change-me';
let devSecretWarned = false;

/* ── JWT 密钥 ───────────────────────────────────────────────── */
export function getJwtSecret(env: Env): string {
  const configured = getEnv(env, 'JWT_SECRET');

  if (configured) {
    if (configured.length < 16) {
      throw misconfig('JWT_SECRET 长度不足 16 位，请使用足够随机的密钥');
    }
    return configured;
  }

  if (isProduction(env)) {
    // 生产环境绝不硬编码密钥，直接给出明确报错
    throw misconfig(
      'JWT_SECRET 未配置：请在 EdgeOne Makers 控制台「环境变量」中注入 JWT_SECRET（建议 ≥32 位随机串）',
    );
  }

  if (!devSecretWarned) {
    devSecretWarned = true;
    console.warn(
      '[auth] ⚠️ 未检测到 JWT_SECRET，已回退到本地开发固定密钥。生产环境必须配置 JWT_SECRET！',
    );
  }
  return DEV_FALLBACK_SECRET;
}

/* ── 密码 ───────────────────────────────────────────────────── */
export function hashPassword(password: string): Promise<string> {
  return hash(password, BCRYPT_COST);
}

export function verifyPassword(password: string, passHash: string): Promise<boolean> {
  if (!passHash) return Promise.resolve(false);
  return compare(password, passHash);
}

/* ── JWT ────────────────────────────────────────────────────── */
export interface TokenPayload {
  userId: string;
  email: string;
  plan: Plan;
  sid: string;
}

export async function signToken(user: UserRecord, sid: string, env: Env): Promise<string> {
  const secret = new TextEncoder().encode(getJwtSecret(env));
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: user.email, plan: user.plan, sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_TTL_SECONDS)
    .sign(secret);
}

export async function verifyToken(token: string, env: Env): Promise<TokenPayload | null> {
  // 密钥缺失/过短时直接抛出（500 SERVER_MISCONFIG），不被下方 catch 吞成 401
  const secret = new TextEncoder().encode(getJwtSecret(env));
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    if (!payload.sub || typeof payload.email !== 'string') return null;
    return {
      userId: payload.sub,
      email: payload.email,
      plan: (payload.plan as Plan) || 'free',
      sid: typeof payload.sid === 'string' ? payload.sid : '',
    };
  } catch {
    return null;
  }
}

/* ── Cookie ─────────────────────────────────────────────────── */
export function buildAuthCookie(token: string, options: { secure?: boolean; maxAge?: number } = {}): string {
  const maxAge = options.maxAge ?? TOKEN_TTL_SECONDS;
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearCookie(options: { secure?: boolean } = {}): string {
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax'];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

/** 是否为 HTTPS 请求（决定 Cookie 是否带 Secure） */
export function isSecureRequest(ctx: ApiCtx): boolean {
  const proto = getHeader(ctx.req, 'x-forwarded-proto');
  if (proto) return String(proto).split(',')[0].trim() === 'https';
  return (ctx.origin || '').startsWith('https://');
}

/* ── Token 提取（Cookie 优先，兼容 Bearer） ─────────────────── */
export function readToken(ctx: ApiCtx): string | null {
  const fromCookie = getCookie(ctx.req, COOKIE_NAME);
  if (fromCookie) return fromCookie;

  const auth = getHeader(ctx.req, 'authorization') || getHeader(ctx.req, 'Authorization');
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return null;
}

/* ── 公共用户信息（剔除 passHash 等私有字段） ───────────────── */
export function toPublicUser(record: UserRecord): User {
  return {
    id: record.id,
    email: record.email,
    plan: record.plan,
    createdAt: record.createdAt,
  };
}

/* ── 会话 ───────────────────────────────────────────────────── */
export async function createSession(r: Repo, user: UserRecord): Promise<string> {
  const sid = newId('sid');
  const record: SessionRecord = {
    userId: user.id,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  await r.put(k.session(sid), record);
  return sid;
}

/**
 * 吊销会话。
 * ⚠️ 这里写入「墓碑」而不是删除记录：存储为最终一致模型时，
 *    「已删除」与「尚未同步」无法区分，删除会被读成不存在而被放行。
 *    写入 exp=0 + revoked=true 可确保登出后令牌立即失效。
 */
export async function destroySession(r: Repo, sid: string): Promise<void> {
  if (!sid) return;
  await r.put(k.session(sid), { userId: '', email: '', exp: 0, revoked: true } satisfies SessionRecord);
}

/* ── 鉴权守卫 ───────────────────────────────────────────────── */
export async function requireUser(ctx: ApiCtx, r: Repo): Promise<UserRecord> {
  const token = readToken(ctx);
  if (!token) throw unauthorized('登录已失效，请重新登录');

  const payload = await verifyToken(token, ctx.env);
  if (!payload) throw unauthorized('登录已失效，请重新登录');

  const record = await r.get<UserRecord>(k.user(payload.email));
  if (!record || record.id !== payload.userId) throw unauthorized('登录已失效，请重新登录');

  // 会话记录存在时才做失效校验：
  //  - 登出已删除 / 已过期 → 拒绝（真正的登出失效）
  //  - 记录缺失（存储最终一致同步延迟）→ 放行，避免误判 401
  if (payload.sid) {
    const session = await r.get<SessionRecord>(k.session(payload.sid));
    const now = Math.floor(Date.now() / 1000);
    if (session && (session.revoked || session.userId !== record.id || session.exp < now)) {
      throw unauthorized('登录已失效，请重新登录');
    }
  }

  return record;
}

/* ── 组合：登录/注册成功后签发令牌 + 写入会话 ───────────────── */
export async function issueAuth(ctx: ApiCtx, r: Repo, user: UserRecord): Promise<AuthResult> {
  const sid = await createSession(r, user);
  const token = await signToken(user, sid, ctx.env);
  return { user: toPublicUser(user), token };
}

/* ── 便捷：从 ctx 直接拿到仓储 ──────────────────────────────── */
export function repoOf(ctx: ApiCtx): Promise<Repo> {
  return repo(ctx.env);
}

export { normalizeEmail };
