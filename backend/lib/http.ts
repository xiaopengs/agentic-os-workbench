/**
 * http · 请求抽象（兼容平台两种 context.request 形态）
 *
 * makers-cloud-functions（Node Functions）：context.request 为标准 Request 对象
 * makers-agents（Node 运行时）      ：context.request.headers 为普通对象，body 已预解析
 * 这里统一封装，两种形态都能正确工作。
 */

/** 读取请求头：兼容 Headers API 与 plain object */
export function getHeader(req: any, name: string): string | null {
  const headers = req?.headers;
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const lower = name.toLowerCase();
  const value = headers[lower] ?? headers[name];
  return value === undefined ? null : String(value);
}

/** 读取 Cookie */
export function getCookie(req: any, name: string): string | null {
  const raw = getHeader(req, 'cookie') || getHeader(req, 'Cookie');
  if (!raw) return null;
  for (const part of String(raw).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return part.slice(idx + 1).trim();
      }
    }
  }
  return null;
}

/** 解析请求体 JSON：优先使用平台预解析的 body，否则读取原始流 */
export async function readJsonBody(raw: any, ctx?: any): Promise<Record<string, any>> {
  const pre = ctx?.request?.body ?? raw?.body;
  if (pre && typeof pre === 'object' && typeof (pre as any).getReader !== 'function') {
    return pre as Record<string, any>;
  }
  if (typeof pre === 'string' && pre.trim()) {
    try {
      return JSON.parse(pre) as Record<string, any>;
    } catch {
      return {};
    }
  }
  try {
    const text = await raw?.text?.();
    if (!text) return {};
    return JSON.parse(text) as Record<string, any>;
  } catch {
    return {};
  }
}

/** 解析 URL（相对路径自动补全 base，避免 new URL('/x') 抛错） */
export function safeUrl(raw: string | undefined): URL {
  const value = String(raw || '/');
  try {
    return new URL(value, 'http://localhost');
  } catch {
    return new URL('http://localhost/');
  }
}

/** 取请求方法（大写） */
export function methodOf(raw: any, ctx?: any): string {
  return String(ctx?.request?.method || raw?.method || ctx?.method || 'GET').toUpperCase();
}

/* ── 统一请求上下文（由 router 构造，透传给各 handler） ─────── */
export interface ApiCtx {
  /** 平台注入的环境变量（context.env），已含 process.env 兜底读取能力 */
  env: Record<string, string | undefined>;
  method: string;
  /** 去掉 /api 前缀后的路径，如 /workflows/wf_1 */
  path: string;
  /** 路径分段，如 ['workflows','wf_1'] */
  segs: string[];
  params: Record<string, string>;
  query: URLSearchParams;
  origin: string | null;
  /** 原始 request 对象 */
  req: any;
  /** 平台原始 context */
  raw: any;
}
