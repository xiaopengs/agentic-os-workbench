/**
 * resp · 统一 ApiResp<T> 构造 + 错误码 → HTTP 状态映射
 */
import { ERROR_CODES, HTTP_STATUS_BY_CODE, type ApiErrBody } from '../../shared/types';

/** 业务异常：携带错误码与 HTTP 状态 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = 'INTERNAL', status = 500) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export const ERR = {
  ...ERROR_CODES,
  /** 未归类服务端错误 */
  INTERNAL: 'INTERNAL',
  /** 服务端配置缺失（如 JWT_SECRET 未注入） */
  SERVER_MISCONFIG: 'SERVER_MISCONFIG',
} as const;

/* ── 快捷抛错 ───────────────────────────────────────────────── */
export const badRequest = (message: string): ApiError =>
  new ApiError(message, ERR.VALIDATION_ERROR, 400);
export const unauthorized = (message = '请先登录'): ApiError =>
  new ApiError(message, ERR.UNAUTHORIZED, 401);
export const quotaExceeded = (message = '本月配额已耗尽，请升级 Pro 或等待下月重置'): ApiError =>
  new ApiError(message, ERR.QUOTA_EXCEEDED, 402);
export const notFound = (message = '资源不存在'): ApiError =>
  new ApiError(message, ERR.NOT_FOUND, 404);
export const conflict = (message: string): ApiError => new ApiError(message, ERR.CONFLICT, 409);
export const misconfig = (message: string): ApiError =>
  new ApiError(message, ERR.SERVER_MISCONFIG, 500);
export const aiUnavailable = (message = 'AI Gateway 暂不可用，请稍后重试'): ApiError =>
  new ApiError(message, ERR.AI_UNAVAILABLE, 503);

/* ── 状态码映射 ─────────────────────────────────────────────── */
export function statusForCode(code: string): number {
  return HTTP_STATUS_BY_CODE[code] ?? 500;
}

/* ── 响应构造 ───────────────────────────────────────────────── */
export interface SendOptions {
  status?: number;
  headers?: Record<string, string>;
  /** 可追加多个 Set-Cookie */
  cookies?: string[];
}

export function send(payload: unknown, options: SendOptions = {}): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  Object.entries(options.headers || {}).forEach(([key, value]) => headers.set(key, value));
  (options.cookies || []).forEach((cookie) => headers.append('Set-Cookie', cookie));

  return new Response(JSON.stringify(payload), {
    status: options.status ?? 200,
    headers,
  });
}

export function ok<T>(data: T, options: SendOptions = {}): Response {
  return send({ ok: true, data }, options);
}

export function fail(code: string, message: string, status?: number): Response {
  const errorBody: ApiErrBody = { code, message };
  return send({ ok: false, error: errorBody }, { status: status ?? statusForCode(code) });
}

/** CORS 头（同域部署默认不触发，本地跨端口调试时需要） */
export function corsHeaders(origin?: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}

/** 统一异常护栏：ApiError → 对应状态码；未知异常 → 500 + 结构化日志 */
export async function guard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError) {
      return fail(error.code, error.message, error.status);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error('[api] unhandled error:', error);
    return fail(ERR.INTERNAL, `服务内部错误：${message}`, 500);
  }
}
