'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { Modal } from './Modal';
import { ApiClientError, streamSSE } from '@/lib/api-client';
import type { CopilotKind, CopilotMessage } from '@/lib/types';

export type { CopilotKind };

export const COP_TITLE: Record<CopilotKind, string> = {
  skill: '生成 Skill',
  contract: '生成 Contract',
  regression: '运行回归',
  trace: '分析 Trace',
};

const PRESET: Record<CopilotKind, string> = {
  skill: '帮我生成一个「文件传输」Skill 的开发框架',
  contract: '为「日程查询」系统应用生成 Agent Contract',
  regression: '对 Skill v2.4.1 运行一轮回归测试',
  trace: '过去 3 小时里 Agent 工具调用失败的原因是什么？',
};

const LOG_KEY = 'agentic_os_copilot';

/** 流内/HTTP 错误统一形态，用于渲染错误条 */
interface CopilotError {
  code: string;
  message: string;
}

/** 402 配额耗尽：单独文案 + 引导升级 */
function quotaHint(message: string): string {
  return `${message}\n\n升级 Pro 可获得 10,000 次/月额度（当前套餐 100 次/月），也可等待下月自动重置。`;
}

export function CopilotModal({
  open,
  kind,
  onClose,
  context,
}: {
  open: boolean;
  kind: CopilotKind;
  onClose: () => void;
  context?: { page?: string; env?: string; workflowId?: string };
}) {
  const [msgs, setMsgs] = useState<CopilotMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<CopilotError | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const kindRef = useRef<CopilotKind>(kind);
  kindRef.current = kind;

  /* 会话历史本地缓存（登出时由 AuthProvider 清理） */
  useEffect(() => {
    if (!open) return;
    try {
      const raw = window.localStorage.getItem(LOG_KEY);
      const all = raw ? (JSON.parse(raw) as Record<string, CopilotMessage[]>) : {};
      setMsgs(all[kind] ?? []);
    } catch {
      setMsgs([]);
    }
    setError(null);
    setInput('');
  }, [open, kind]);

  useEffect(() => {
    if (!open) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, open, error]);

  const persist = useCallback((next: CopilotMessage[]) => {
    try {
      const raw = window.localStorage.getItem(LOG_KEY);
      const all = raw ? (JSON.parse(raw) as Record<string, CopilotMessage[]>) : {};
      all[kindRef.current] = next.slice(-40);
      window.localStorage.setItem(LOG_KEY, JSON.stringify(all));
    } catch {
      /* noop */
    }
  }, []);

  const patchLast = useCallback((content: string) => {
    setMsgs((prev) => {
      if (!prev.length) return prev;
      const next = prev.slice();
      next[next.length - 1] = { role: 'assistant', content };
      return next;
    });
  }, []);

  const runStream = useCallback(
    async (history: CopilotMessage[]) => {
      setBusy(true);
      setError(null);
      setMsgs((prev) => [...prev, { role: 'assistant', content: '' }]);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let acc = '';

      try {
        await streamSSE({
          path: '/ai/copilot',
          body: { messages: history, context: { ...context, kind: kindRef.current } },
          signal: ctrl.signal,
          onDelta: (chunk) => {
            acc += chunk;
            patchLast(acc);
          },
          onErrorEvent: (payload) => setError({ code: payload.code, message: payload.message }),
        });

        if (!acc && !ctrl.signal.aborted) {
          setError({ code: 'EMPTY_RESPONSE', message: '模型未返回内容，请换个说法再试' });
        }
      } catch (e) {
        // 用户主动中断：不清空已收到的内容，只提示
        if ((e as Error)?.name === 'AbortError' || ctrl.signal.aborted) {
          if (!acc) patchLast('（已中断）');
          return;
        }
        const apiErr = e as ApiClientError;
        const code = apiErr?.code || 'HTTP_ERROR';
        const message =
          code === 'QUOTA_EXCEEDED' && apiErr?.status === 402
            ? quotaHint(apiErr.message)
            : apiErr?.message || 'Copilot 调用失败';
        setError({ code, message });
      } finally {
        setBusy(false);
        abortRef.current = null;
        setMsgs((prev) => {
          persist(prev);
          return prev;
        });
      }
    },
    [context, patchLast, persist],
  );

  /** 打开时若无历史，自动发出该场景的预设提问（与原型的脚本化开场对齐） */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = window.localStorage.getItem(LOG_KEY);
        const all = raw ? (JSON.parse(raw) as Record<string, CopilotMessage[]>) : {};
        const history = all[kind];
        if (history && history.length) return;
        if (cancelled) return;
        const first: CopilotMessage[] = [{ role: 'user', content: PRESET[kind] }];
        setMsgs(first);
        await runStream(first);
      } catch {
        /* noop */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, kind, runStream]);

  function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    const next: CopilotMessage[] = [...msgs, { role: 'user', content: text }];
    setMsgs(next);
    void runStream(next);
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <Modal
      open={open}
      title={`AI Copilot · ${COP_TITLE[kind]}`}
      icon={
        <span className="bot-avatar" style={{ width: 32, height: 32, fontSize: 16 }}>
          <Icon name="i-bot" />
        </span>
      }
      onClose={() => {
        abortRef.current?.abort();
        onClose();
      }}
      footer={
        <div className="chat-input">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
            placeholder="描述你的需求，例如：帮我生成文件传输 Skill…"
            aria-label="Copilot 输入"
          />
          {busy ? (
            <button className="send-btn stop" onClick={stop} aria-label="中断生成">
              <Icon name="i-x" />
            </button>
          ) : (
            <button className="send-btn" onClick={send} disabled={busy} aria-label="发送">
              <Icon name="i-send" />
            </button>
          )}
        </div>
      }
    >
      <div className="chat-flow" ref={bodyRef}>
        {msgs.map((m, i) => {
          const pending = busy && i === msgs.length - 1 && !m.content;
          return (
            <div className={`msg ${m.role === 'user' ? 'me' : 'ai'}`} key={i}>
              {m.content ||
                (pending ? (
                  <span className="typing">
                    正在解析需求并匹配 Contract Registry
                    <i className="dot">.</i>
                    <i className="dot">.</i>
                    <i className="dot">.</i>
                  </span>
                ) : '')}
            </div>
          );
        })}

        {error ? (
          <div className="msg ai copilot-error" role="alert">
            <div className="copilot-error-title">
              <Icon name="i-warn" />
              <b>{error.code === 'QUOTA_EXCEEDED' ? '配额已用完' : '生成失败'}</b>
            </div>
            <div className="copilot-error-body">{error.message}</div>
            <button className="copilot-retry" onClick={() => setError(null)}>
              知道了
            </button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

export default CopilotModal;