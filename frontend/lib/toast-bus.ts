/**
 * 极简 toast 事件总线。
 * 目的：让非 React 模块（api-client）也能触发 toast，而不需要持有 React context。
 */
type Listener = (message: string) => void;

const listeners = new Set<Listener>();

export function emitToast(message: string): void {
  listeners.forEach((l) => {
    try {
      l(message);
    } catch {
      /* 单个监听器异常不影响其他监听器 */
    }
  });
}

export function onToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
