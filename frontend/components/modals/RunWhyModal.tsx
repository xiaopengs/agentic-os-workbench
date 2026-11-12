'use client';

/**
 * RunWhyModal · M4「why 溯源视图」
 *
 * 从 Recent Runs 的轮次卡片点「溯源」打开，展示 `/loop/runs/:id/why` 返回的事实时间线，
 * 让任意一轮都能被完整重现（事件接入 → 派活 → 领取 → 回执 → 卡片 → 续跑）。
 *
 * UI 视觉零改动：整块复用 LiveTrace 既有的 `.trace-row/.tr-ico/.tr-mid/.tr-bar/.tr-badge`
 * 与 FACT_META/factTitle/factSub/factBadge 映射，装在既有 Modal 容器里，零新增 CSS。
 * 单向调用链：Modal 打开 → 拉一次 why → 独立渲染；不与任何渲染函数互调。
 */
import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { Icon } from '@/components/icons/Icon';
import { fmtClock } from '@/lib/format';
import { loopApi } from '@/lib/loop-api';
import { FACT_META, factBadge, factSub, factTitle } from '@/lib/loop-format';
import type { Fact } from '@/lib/loop-types';

export function RunWhyModal({
  runId, onClose,
}: {
  /** 为 null 时关闭；传入轮次 id 时打开并拉取溯源 */
  runId: string | null;
  onClose: () => void;
}) {
  const [timeline, setTimeline] = useState<Fact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!runId) return;
    let alive = true;
    setLoading(true);
    setError('');
    setTimeline([]);
    loopApi.why(runId)
      .then((res) => { if (alive) setTimeline(res.timeline ?? []); })
      .catch(() => { if (alive) setError('无法加载该轮次的溯源记录'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [runId]);

  // 按事实序号升序（时间线正序：先发生 → 后发生）
  const rows = [...timeline].sort((a, b) => a.seq - b.seq);

  return (
    <Modal
      open={!!runId}
      title={`溯源 · ${runId ?? ''}`}
      icon={<span className="tr-ico Tool" style={{ width: 30, height: 30, fontSize: 15 }}><Icon name="i-list" /></span>}
      onClose={onClose}
    >
      <div className="card-head" style={{ marginBottom: 12 }}>
        <span className="sub">该轮次相关的全部事实 · 事件溯源可完整重放</span>
        {!loading && !error && (
          <span className="chip info" style={{ marginLeft: 'auto' }}>{rows.length} 条事实</span>
        )}
      </div>

      {loading ? (
        <div className="empty-tip">正在重建事实时间线…</div>
      ) : error ? (
        <div className="empty-tip">{error}</div>
      ) : rows.length ? (
        <div className="trace-list">
          {rows.map((f) => {
            const meta = FACT_META[f.kind] ?? { label: f.kind, tone: 'Agent' as const, icon: 'i-cube' as const };
            const badge = factBadge(f);
            return (
              <div className="trace-row" key={f.seq} style={{ marginBottom: 8 }}>
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
          })}
        </div>
      ) : (
        <div className="empty-tip">该轮次暂无关联事实</div>
      )}
    </Modal>
  );
}

export default RunWhyModal;
