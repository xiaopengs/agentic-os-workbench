/**
 * api-client · 统一 API 访问层
 * - 基础路径同域 /api（方案 A），可用 NEXT_PUBLIC_API_BASE 覆盖
 * - 统一拆解 ApiResp<T> 信封：成功返回 data，失败抛 ApiClientError
 * - 401 → 通知 AuthProvider 清空会话并跳转 /login
 * - 402 → 提示配额耗尽
 * - 其他错误 → toast
 */
import { emitToast } from './toast-bus';
import type {
  ApiResp,
  AuthResult,
  AuditLog,
  Contract,
  CopilotRequest,
  Device,
  Skill,
  Trace,
  TraceInput,
  Usage,
  User,
  Workflow,
  WorkflowInput,
} from './types';

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || '/api').replace(/\/+$/, '');

const TOKEN_KEY = 'agentic_os_token';

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = 'UNKNOWN', status = 0) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
  }
}

/* ── 可插拔处理器（由 AuthProvider / ToastProvider 注入） ────── */
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

/* ── Token（后端若使用 Bearer 亦可兼容；HttpOnly Cookie 为主） ─ */
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* localStorage 不可用时静默降级为纯 Cookie 会话 */
  }
}

/* ── 底层请求 ───────────────────────────────────────────────── */
export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** 静默模式：失败不弹 toast（如 /auth/me 探测、可选端点探测） */
  silent?: boolean;
  /** 跳过 401 全局跳转（登录/注册页使用） */
  skipAuthRedirect?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const sp = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  });
  const qs = sp.toString();
  return qs ? `${url}?${qs}` : url;
}

function unwrap<T>(payload: unknown): T {
  // 兼容两种后端实现：{ ok:true, data } 信封 或 直接返回裸数据
  if (payload && typeof payload === 'object') {
    const resp = payload as Partial<ApiResp<T>>;
    if (resp.ok === true) return resp.data as T;
    if (resp.ok === false) {
      const err = (payload as { error?: { code?: string; message?: string } }).error;
      throw new ApiClientError(err?.message || '请求失败', err?.code || 'BIZ_ERROR', 200);
    }
  }
  return payload as T;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, silent, skipAuthRedirect, headers, ...rest } = options;
  const token = getToken();

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      credentials: 'include', // HttpOnly Cookie 会话
      cache: 'no-store',
      ...rest,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(headers as Record<string, string> | undefined),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    const msg = '网络异常，请检查连接后重试';
    if (!silent) emitToast(msg);
    throw new ApiClientError(msg, 'NETWORK', 0);
  }

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (res.status === 401) {
    if (!skipAuthRedirect) unauthorizedHandler?.();
    throw new ApiClientError('登录已失效，请重新登录', 'UNAUTHORIZED', 401);
  }

  if (res.status === 402) {
    const msg = '本月配额已耗尽，请升级 Pro 或等待下月重置';
    if (!silent) emitToast(msg);
    throw new ApiClientError(msg, 'QUOTA_EXCEEDED', 402);
  }

  if (res.status === 404) {
    const msg = '资源不存在或后端尚未实现该接口';
    if (!silent) emitToast(msg);
    throw new ApiClientError(msg, 'NOT_FOUND', 404);
  }

  if (!res.ok) {
    const err = (payload as { error?: { message?: string; code?: string } } | null)?.error;
    const msg = err?.message || `请求失败（${res.status}）`;
    if (!silent) emitToast(msg);
    throw new ApiClientError(msg, err?.code || 'HTTP_ERROR', res.status);
  }

  try {
    return unwrap<T>(payload);
  } catch (e) {
    if (e instanceof ApiClientError) {
      if (!silent) emitToast(e.message);
      throw e;
    }
    throw e;
  }
}

/* ── 端点封装 ───────────────────────────────────────────────── */
export const api = {
  auth: {
    me: () => request<{ user: User }>('/auth/me', { silent: true, skipAuthRedirect: true }),
    login: (email: string, password: string) =>
      request<AuthResult>('/auth/login', {
        method: 'POST',
        body: { email, password },
        skipAuthRedirect: true,
      }),
    register: (email: string, password: string) =>
      request<AuthResult>('/auth/register', {
        method: 'POST',
        body: { email, password },
        skipAuthRedirect: true,
      }),
    logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST', silent: true }),
  },
  workflows: {
    list: () => request<Workflow[]>('/workflows'),
    get: (id: string) => request<Workflow>(`/workflows/${encodeURIComponent(id)}`),
    create: (input: WorkflowInput) =>
      request<Workflow>('/workflows', { method: 'POST', body: input }),
    update: (id: string, patch: Partial<WorkflowInput>) =>
      request<Workflow>(`/workflows/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
    remove: (id: string) =>
      request<{ ok: boolean }>(`/workflows/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
  traces: {
    list: () => request<Trace[]>('/traces'),
    create: (input: TraceInput) => request<Trace>('/traces', { method: 'POST', body: input }),
  },
  skills: {
    list: () => request<Skill[]>('/skills'),
  },
  contracts: {
    list: () => request<Contract[]>('/contracts'),
  },
  usage: {
    get: () => request<Usage>('/usage'),
  },
  audit: {
    list: () => request<AuditLog[]>('/audit'),
  },
  devices: {
    /** 契约中暂无该端点，静默探测失败返回空数组 */
    list: async (): Promise<Device[]> => {
      try {
        return await request<Device[]>('/devices', { silent: true });
      } catch {
        return [];
      }
    },
  },
};

/**
 * AI Copilot · SSE 流式对话
 * 后端若以 application/json 一次性返回，则自动降级为整段文本。
 */
export async function streamCopilot(
  payload: CopilotRequest,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/ai/copilot`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (res.status === 401) {
    unauthorizedHandler?.();
    throw new ApiClientError('登录已失效，请重新登录', 'UNAUTHORIZED', 401);
  }
  if (res.status === 402) {
    const msg = '本月 AI 配额已耗尽，请升级 Pro 或等待下月重置';
    emitToast(msg);
    throw new ApiClientError(msg, 'QUOTA_EXCEEDED', 402);
  }
  if (!res.ok) {
    const msg = `Copilot 请求失败（${res.status}）`;
    emitToast(msg);
    throw new ApiClientError(msg, 'HTTP_ERROR', res.status);
  }

  const ctype = res.headers.get('content-type') || '';
  if (!res.body) throw new ApiClientError('Copilot 返回空响应', 'EMPTY', res.status);

  // 非流式：整包 JSON
  if (ctype.includes('application/json')) {
    const json = (await res.json()) as { data?: { content?: string; text?: string } } & {
      content?: string;
      text?: string;
    };
    const text = json?.data?.content ?? json?.content ?? json?.data?.text ?? json?.text ?? '';
    if (text) onDelta(text);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data) as
          | string
          | { content?: string; text?: string; delta?: string; choices?: unknown };
        if (typeof parsed === 'string') onDelta(parsed);
        else if (typeof parsed?.content === 'string') onDelta(parsed.content);
        else if (typeof parsed?.delta === 'string') onDelta(parsed.delta);
        else if (typeof parsed?.text === 'string') onDelta(parsed.text);
      } catch {
        // 纯文本 SSE（非 JSON payload）
        onDelta(data);
      }
    }
  }
}
