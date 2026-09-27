'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { Modal } from './Modal';
import { streamCopilot } from '@/lib/api-client';
import type { CopilotMessage } from '@/lib/types';

export type CopilotKind = 'skill' | 'contract' | 'regression' | 'trace';

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
  }, [open, kind]);

  useEffect(() => {
    if (!open) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, open]);

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

  const runStream = useCallback(
    async (history: CopilotMessage[]) => {
      setBusy(true);
      setMsgs((prev) => [...prev, { role: 'assistant', content: '' }]);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let acc = '';
      try {
        await streamCopilot(
          { messages: history, context },
          (chunk) => {
            acc += chunk;
            setMsgs((prev) => {
              const next = prev.slice();
              if (next.length) next[next.length - 1] = { role: 'assistant', content: acc };
              return next;
            });
          },
          ctrl.signal,
        );
        if (!acc) {
          setMsgs((prev) => {
            const next = prev.slice();
            if (next.length) next[next.length - 1] = { role: 'assistant', content: '（无返回内容）' };
            return next;
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Copilot 调用失败';
        setMsgs((prev) => {
          const next = prev.slice();
          if (next.length) next[next.length - 1] = { role: 'assistant', content: `⚠️ ${msg}` };
          return next;
        });
      } finally {
        setBusy(false);
        abortRef.current = null;
        setMsgs((prev) => {
          persist(prev);
          return prev;
        });
      }
    },
    [context, persist],
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
          <button className="send-btn" onClick={send} disabled={busy} aria-label="发送">
            <Icon name="i-send" />
          </button>
        </div>
      }
    >
      <div className="chat-flow" ref={bodyRef}>
        {msgs.map((m, i) => (
          <div className={`msg ${m.role === 'user' ? 'me' : 'ai'}`} key={i}>
            {m.content || (busy && i === msgs.length - 1 ? '正在解析需求并匹配 Contract Registry…' : '')}
          </div>
        ))}
      </div>
    </Modal>
  );
}

export default CopilotModal;
