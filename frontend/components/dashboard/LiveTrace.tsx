'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons/Icon';
import { fmtClock } from '@/lib/format';
import { FACT_META, factBadge, factSub, factTitle } from '@/lib/loop-format';
import type { Fact } from '@/lib/loop-types';

/**
 * Live Trace · 视觉与原型完全一致（.trace-list / .trace-row / .tr-ico 四色调 / .tr-bar / .tr-badge）。
 * 语义从「调用链路」换成「事实日志流」：逐条 Fact（事件溯源），
 * 20+ 种 kind 通过 FACT_META 归入既有 4 个 .tr-ico 色调槽位，图标全部取自现有 IconSprite。
 */
export function LiveTrace({
  facts, loading, pendingCards = 0,
}: {
  facts: Fact[];
  loading: boolean;
  /** 待拍板卡片数，用于卡头副标题（「今天要处理」提示，复用既有 .sub 文案位） */
  pendingCards?: number;
}) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // 事实按序号倒序（最新在上），取最近 6 条
  const rows = [...facts]
    .filter((f) => Number.isFinite(f.seq))
    .sort((a, b) => b.seq - a.seq)
    .slice(0, 6);

  return (
    <div className="card trace-card">
      <div className="card-head">
        <b>事实日志 · Fact Log</b>
        <span className="sub">
          事件溯源 · 只追加事实流
          {pendingCards > 0 ? ` · ${pendingCards} 张卡片待拍板` : ''}
        </span>
        <span className="head-right">
          <span className="trace-clock">{now ? fmtClock(now) : '--:--:--'}</span>
          <button className="mini-more" aria-label="更多" title="更多">
            <Icon name="i-dots" />
          </button>
        </span>
      </div>

      <div className="trace-list">
        {loading && !rows.length ? (
          <div className="empty-tip">正在加载事实日志…</div>
        ) : rows.length ? (
          rows.map((f) => {
            const meta = FACT_META[f.kind] ?? { label: f.kind, tone: 'Agent' as const, icon: 'i-cube' as const };
            const badge = factBadge(f);
            return (
              <div className="trace-row" key={f.seq}>
                <div className={`tr-ico ${meta.tone}`}>
                  <Icon name={meta.icon} />
                </div>
                <div className="tr-mid">
                  <div className="tr-type">{factSub(f)}</div>
                  <div className="tr-name">{factTitle(f)}</div>
                </div>
                <span className="tr-time">{fmtClock(new Date(f.at))}</span>
                <span className="tr-cost">#{f.seq}</span>
                <div className="tr-bar">
                  <i style={{ width: `${Math.min(95, 30 + ((f.hops ?? 0) * 9))}%` }} />
                </div>
                <span className={`tr-badge${badge.warn ? ' warn' : ''}`}>{badge.text}</span>
              </div>
            );
          })
        ) : (
          <div className="empty-tip">暂无事实记录，接入事件或运行规则后将自动写入日志</div>
        )}
      </div>

      <Link className="trace-more" href="/settings">
        查看完整事实日志 →
      </Link>
    </div>
  );
}

export default LiveTrace;
