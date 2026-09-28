/**
 * api-client · 统一 API 访问层
 * - 基础路径同域 /api（方案 A），可用 NEXT_PUBLIC_API_BASE 覆盖
 * - 统一拆解 ApiResp<T> 信封：成功返回 data，失败抛 ApiClientError
 * - 401 → 通知 AuthProvider 清空会话并跳转 /login
 * - 402 → 提示配额耗尽
 * - 其他错误 → toast
 */
import { emitToast } from './toast-bus';
import { getOrCreateConversationId } from './conversation';
import type {
  ApiResp,
  AuthResult,
  AuditLog,
  Contract,
  CopilotRequest,
  CopilotStreamEvent,
  CopilotUsageEvent,
  Device,
  Skill,
  Trace,
  TraceInput,
  Usage,
  User,
  Workflow,
  WorkflowInput,
} from './types';
import { SSE_DONE } from './types';

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

/* ── SSE 流式请求（AI Copilot 及后续 AI 端点共用） ──────────── */

/** 流内 error 事件载荷 */
export interface StreamErrorPayload {
  code: string;
  message: string;
}

export interface StreamSSEHandlers {
  /** 文本增量（打字机渲染） */
  onDelta?: (text: string) => void;
  /** 流内 error 事件（HTTP 状态码已提交，错误只能走事件） */
  onErrorEvent?: (payload: StreamErrorPayload) => void;
  /** 用量回执 */
  onUsage?: (usage: CopilotUsageEvent['usage']) => void;
  /** 原始事件（已过滤心跳），便于扩展 tool_call / done 等 */
  onEvent?: (event: CopilotStreamEvent) => void;
}

export interface StreamSSEOptions extends StreamSSEHandlers {
  /** 相对 API_BASE 的路径，如 '/ai/copilot' */
  path: string;
  body?: unknown;
  signal?: AbortSignal;
  /** 静默模式：失败不弹 toast */
  silent?: boolean;
}

/**
 * 发起 SSE 流式请求并逐帧解析。
 *
 * 错误语义与 request() 保持一致：
 *   401 → 触发全局登出跳转 + ApiClientError(UNAUTHORIZED)
 *   402 → 配额提示 + ApiClientError(QUOTA_EXCEEDED)
 *   503 → AI Gateway 不可用 + ApiClientError(AI_UNAVAILABLE)
 *   其他 → ApiClientError(HTTP_ERROR)（优先透传后端 ApiResp.error.message）
 * 用户中断 → 原样抛出 AbortError（调用方用 err.name 判断）
 */
export async function streamSSE(options: StreamSSEOptions): Promise<void> {
  const { path, body, signal, silent, onDelta, onErrorEvent, onUsage, onEvent } = options;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
        // ⭐ 平台契约：AI 端点必须携带会话 ID
        'makers-conversation-id': getOrCreateConversationId(),
      },
      body: JSON.stringify(body ?? {}),
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e; // 用户中断，交给调用方处理
    const msg = '网络异常，请检查连接后重试';
    if (!silent) emitToast(msg);
    throw new ApiClientError(msg, 'NETWORK', 0);
  }

  // 非 2xx：优先拆解 ApiResp 信封，保证错误文案与后端一致
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let error: StreamErrorPayload | null = null;
    try {
      const parsed = JSON.parse(text) as { error?: StreamErrorPayload };
      if (parsed?.error?.message) error = parsed.error;
    } catch {
      /* 非 JSON 响应 */
    }

    const code = error?.code || (res.status === 402 ? 'QUOTA_EXCEEDED' : res.status === 401 ? 'UNAUTHORIZED' : res.status === 503 ? 'AI_UNAVAILABLE' : 'HTTP_ERROR');
    const fallback =
      code === 'QUOTA_EXCEEDED'
        ? '本月 AI 配额已耗尽，请升级 Pro 或等待下月重置'
        : code === 'UNAUTHORIZED'
          ? '登录已失效，请重新登录'
          : code === 'AI_UNAVAILABLE'
            ? 'AI Copilot 暂不可用，请稍后重试'
            : `请求失败（${res.status}）`;
    const message = error?.message || fallback;

    if (res.status === 401) unauthorizedHandler?.();
    if (!silent && code !== 'UNAUTHORIZED') emitToast(message);
    throw new ApiClientError(message, code, res.status);
  }

  if (!res.body) throw new ApiClientError('响应为空', 'EMPTY', res.status);

  // 后端降级为一次性 JSON 时，整包作为单帧处理
  if ((res.headers.get('content-type') || '').includes('application/json')) {
    const json = (await res.json()) as { data?: { content?: string; text?: string } } & {
      content?: string;
      text?: string;
    };
    const text = json?.data?.content ?? json?.content ?? json?.data?.text ?? json?.text ?? '';
    if (text) onDelta?.(text);
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
      if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) continue;

      const data = trimmed.slice(5).trim();
      if (!data) continue;
      if (data === SSE_DONE) return;

      let event: CopilotStreamEvent;
      try {
        event = JSON.parse(data) as CopilotStreamEvent;
      } catch {
        // 纯文本 SSE（非 JSON payload）
        onDelta?.(data);
        continue;
      }

      const anyEvent = event as unknown as Record<string, unknown>;
      if (anyEvent.type === 'ping') continue; // 心跳，忽略

      onEvent?.(event);

      if (typeof anyEvent.delta === 'string') {
        if (anyEvent.delta) onDelta?.(anyEvent.delta);
        continue;
      }
      if (anyEvent.error && typeof anyEvent.error === 'object') {
        onErrorEvent?.(anyEvent.error as StreamErrorPayload);
        continue;
      }
      if (anyEvent.type === 'usage' && anyEvent.usage && typeof anyEvent.usage === 'object') {
        onUsage?.(anyEvent.usage as CopilotUsageEvent['usage']);
        continue;
      }
      // 兼容历史格式：{ content } / { text }
      if (typeof anyEvent.content === 'string') onDelta?.(anyEvent.content);
      else if (typeof anyEvent.text === 'string') onDelta?.(anyEvent.text);
    }
  }
}

/**
 * AI Copilot · SSE 流式对话
 * @param payload  { messages, context }
 * @param onDelta  文本增量回调
 * @param signal   中断信号（AbortController）
 */
export async function streamCopilot(
  payload: CopilotRequest,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  return streamSSE({ path: '/ai/copilot', body: payload, signal, onDelta });
}
