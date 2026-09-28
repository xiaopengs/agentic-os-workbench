'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon, type IconName } from '@/components/icons/Icon';
import { fmtClock } from '@/lib/format';
import type { Trace, TraceKind } from '@/lib/types';

const KIND_ICON: Record<TraceKind, IconName> = {
  Agent: 'i-bot',
  Skill: 'i-cube',
  Tool: 'i-wrench',
  Contract: 'i-doc',
};

/** Live Trace · 数据来自 GET /api/traces（SWR 5s 自动重验证） */
export function LiveTrace({ traces, loading }: { traces: Trace[]; loading: boolean }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const rows = [...traces]
    .sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    })
    .slice(0, 6);

  return (
    <div className="card trace-card">
      <div className="card-head">
        <b>Live Trace</b>
        <span className="sub">实时调用链路与性能分析</span>
        <span className="head-right">
          <span className="trace-clock">{now ? fmtClock(now) : '--:--:--'}</span>
          <button className="mini-more" aria-label="更多" title="更多">
            <Icon name="i-dots" />
          </button>
        </span>
      </div>

      <div className="trace-list">
        {loading && !rows.length ? (
          <div className="empty-tip">正在加载调用链路数据…</div>
        ) : rows.length ? (
          rows.map((t) => (
            <div className="trace-row" key={t.id}>
              <div className={`tr-ico ${t.kind}`}>
                <Icon name={KIND_ICON[t.kind] ?? 'i-cube'} />
              </div>
              <div className="tr-mid">
                <div className="tr-type">{t.kind}</div>
                <div className="tr-name">{t.name}</div>
              </div>
              <span className="tr-time">{t.time}</span>
              <span className="tr-cost">{t.cost}ms</span>
              <div className="tr-bar">
                <i style={{ width: `${Math.min(95, Math.round((t.cost / 220) * 88) + 8)}%` }} />
              </div>
              <span className={`tr-badge${t.status === 'Success' ? '' : ' warn'}`}>{t.status}</span>
            </div>
          ))
        ) : (
          <div className="empty-tip">暂无 Trace 记录，运行工作流后将自动生成调用链</div>
        )}
      </div>

      <Link className="trace-more" href="/workflows">
        View full trace →
      </Link>
    </div>
  );
}

export default LiveTrace;