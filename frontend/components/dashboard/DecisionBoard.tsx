'use client';

/**
 * DecisionBoard · 决策看板（E1）
 *
 * 视觉零改动：状态分段复用 .top-tabs，卡片流复用 .wf-grid / .wf-card / .wf-head /
 * .wf-ico / .wf-title / .wf-meta / .wf-foot / .chip / .mini-more。
 * 窄屏由 .wf-grid 既有媒体查询自动单列，不做横向拖拽列（对齐 docs/08 §6）。
 */
import { Icon } from '@/components/icons/Icon';
import { Chip } from '@/components/ui/WorkflowBits';
import { BOARD_COLUMNS, DECISION_STATUS_META, shortDate } from '@/lib/decision-format';
import type { Decision, DecisionStatus } from '@/lib/decision-types';

export function DecisionStatusTabs({
  active, counts, onChange,
}: {
  active: DecisionStatus | 'all';
  counts: Record<string, number>;
  onChange: (s: DecisionStatus | 'all') => void;
}) {
  const tabs: Array<{ key: DecisionStatus | 'all'; label: string }> = [
    { key: 'all', label: `全部 ${counts.all ?? 0}` },
    ...BOARD_COLUMNS.map((s) => ({ key: s as DecisionStatus | 'all', label: `${DECISION_STATUS_META[s].label} ${counts[s] ?? 0}` })),
  ];
  // 注意：不能用 .top-tabs —— 它在 @media(max-width:900px) 被 display:none（顶部导航专属），
  // 而文档 08 §6 要求窄屏「分段筛选 + 卡片流」，分段按钮在窄屏反而必须可见。
  // 这里改用 .wf-top（flex-wrap，未被隐藏）+ 内联分段按钮，零新增 CSS。
  return (
    <div className="wf-top" data-decision-tabs role="tablist" aria-label="决策状态分段" style={{ gap: 6, marginBottom: 0 }}>
      {tabs.map((t) => {
        const on = active === t.key;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            aria-selected={on}
            role="tab"
            style={{
              minHeight: 44, padding: '8px 14px', borderRadius: 'var(--r-el)', fontSize: 14,
              fontWeight: on ? 600 : 500, whiteSpace: 'nowrap', cursor: 'pointer',
              border: '1px solid var(--border)',
              background: on ? '#1a1f24' : 'var(--bg)',
              color: on ? '#fff' : 'var(--t2)',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function DecisionCard({
  decision, onOpen,
}: {
  decision: Decision;
  onOpen: (d: Decision) => void;
}) {
  const meta = DECISION_STATUS_META[decision.status];
  const topScore = decision.options?.length ?? 0;
  return (
    <div className="wf-card" data-decision-id={decision.id}>
      <div className="wf-head">
        <div className={`wf-ico ${meta.tone}`}>
          <Icon name={meta.icon} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="wf-title">{decision.title}</div>
          <div className="wf-cat">{decision.id} · {decision.owner}</div>
        </div>
        <Chip tone={meta.chip}>{meta.label}</Chip>
      </div>

      <div className="wf-meta">
        <span><Icon name="i-cube" size={12} /> {topScore} 个候选方案</span>
        <span><Icon name="i-target" size={12} /> {decision.criteria?.length ?? 0} 个评估维度</span>
        {decision.reviewAt ? <span><Icon name="i-calendar" size={12} /> 复核 {shortDate(decision.reviewAt)}</span> : null}
      </div>

      {decision.tags?.length ? (
        <div className="wf-meta">
          {decision.tags.slice(0, 4).map((t) => <Chip key={t} tone="mute">{t}</Chip>)}
        </div>
      ) : null}

      {decision.reviewDue && decision.status !== 'deprecated' && decision.status !== 'superseded' ? (
        <div className="wf-meta" style={{ color: 'var(--orange)' }}>
          <span><Icon name="i-warn" size={12} /> 已到复核期，建议重新确认</span>
        </div>
      ) : null}

      {decision.decision ? (
        <div className="tbl-sub" style={{ fontSize: 12, lineHeight: 1.5 }}>
          结论：{decision.decision.length > 60 ? `${decision.decision.slice(0, 60)}…` : decision.decision}
        </div>
      ) : null}

      <div className="wf-foot">
        <span className="wf-dur">更新 {shortDate(decision.updatedAt)}</span>
        <button
          className="run-btn"
          style={{ marginLeft: 'auto', minHeight: 44 }}
          onClick={() => onOpen(decision)}
          aria-label={`查看决策详情 ${decision.id}`}
        >
          <Icon name="i-search" size={13} />
          查看详情
        </button>
      </div>
    </div>
  );
}

export function DecisionBoard({
  decisions, loading, onOpen,
}: {
  decisions: Decision[];
  loading: boolean;
  onOpen: (d: Decision) => void;
}) {
  if (loading && !decisions.length) {
    return (
      <div className="wf-grid">
        {[0, 1, 2].map((i) => (
          <div className="wf-card" key={i} aria-busy="true">
            <div className="skel skel-row" style={{ width: '80%' }} />
            <div className="skel skel-row" style={{ width: '55%' }} />
            <div className="skel skel-row" style={{ width: '90%' }} />
          </div>
        ))}
      </div>
    );
  }
  if (!decisions.length) {
    return <div className="empty-tip">当前状态暂无决策 · 点击右上「新建决策」记录第一条架构决策</div>;
  }
  return (
    <div className="wf-grid">
      {decisions.map((d) => <DecisionCard key={d.id} decision={d} onOpen={onOpen} />)}
    </div>
  );
}
