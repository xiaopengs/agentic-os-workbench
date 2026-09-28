/**
 * conversation · makers-conversation-id 契约（平台铁律）
 *
 * 所有 AI 端点（agents/、/api/ai/copilot）请求都必须携带 makers-conversation-id：
 * 缺失会导致会话历史无法续接、粘性路由失效、中断请求定位不到运行中的会话。
 */
const KEY = 'eo_conversation_id';

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* 非安全上下文降级 */
  }
  return `cid_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** 读取（或首次生成）当前会话 ID，持久化在 localStorage */
export function getOrCreateConversationId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const cached = window.localStorage.getItem(KEY);
    if (cached) return cached;
    const fresh = randomId();
    window.localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    return '';
  }
}

/** 开新会话（历史不复用） */
export function rotateConversationId(): string {
  const fresh = randomId();
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(KEY, fresh);
    } catch {
      /* localStorage 不可用则仅本次生效 */
    }
  }
  return fresh;
}
