'use client';

/**
 * 决策页 · 架构设计决策面板（M6，文档 08 第 1 期 MVP）
 *
 * 视觉零改动：PageHeader + sync-badge + .card + .top-tabs + .wf-grid/.wf-card +
 * .searchbox + .run-btn，全部复用既有语义类。窄屏由 .wf-grid / .tbl 既有媒体查询
 * 自动单列/卡片化，符合文档 08 §6「移动优先」。
 *
 * 单向调用链（铁律 9）：所有写操作 → decisionApi → revalidateDecisions() → SWR 重拉。
 * 渲染函数互不调用，统一由 refresh() 调度。
 */
import { useMemo, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { PageHeader, LoadingRows } from '@/components/ui/PageHeader';
import { DecisionBoard, DecisionStatusTabs } from '@/components/dashboard/DecisionBoard';
import { DecisionFormModal } from '@/components/modals/DecisionFormModal';
import { DecisionDetailModal } from '@/components/modals/DecisionDetailModal';
import { useDecisions, useDecisionMutate } from '@/lib/decision-hooks';
import { BOARD_COLUMNS, DECISION_STATUS_META } from '@/lib/decision-format';
import { navByKey } from '@/lib/nav';
import type { Decision, DecisionStatus } from '@/lib/decision-types';

const META = navByKey('decisions');

export default function DecisionsPage() {
  const { data, isLoading, isValidating, error } = useDecisions();
  const { revalidateDecisions } = useDecisionMutate();
  const [tab, setTab] = useState<DecisionStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [detail, setDetail] = useState<Decision | null>(null);

  const decisions = useMemo(() => data ?? [], [data]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: decisions.length };
    for (const s of BOARD_COLUMNS) c[s] = decisions.filter((d) => d.status === s).length;
    // 终态 superseded 也计入「全部」，分段里归入废弃列展示
    return c;
  }, [decisions]);

  const visible = useMemo(() => {
    let list = decisions;
    if (tab !== 'all') {
      // deprecated 分段同时容纳 deprecated / superseded（都是终态）
      list = tab === 'deprecated'
        ? list.filter((d) => d.status === 'deprecated' || d.status === 'superseded')
        : list.filter((d) => d.status === tab);
    }
    const kw = q.trim().toLowerCase();
    if (kw) list = list.filter((d) =>
      `${d.id} ${d.title} ${d.context} ${(d.tags ?? []).join(' ')} ${d.owner}`.toLowerCase().includes(kw));
    return list;
  }, [decisions, tab, q]);

  const dueCount = decisions.filter((d) => d.reviewDue && d.status !== 'deprecated' && d.status !== 'superseded').length;
  const acceptedCount = decisions.filter((d) => d.status === 'accepted').length;
  const sync = error ? 'offline' : isValidating ? 'syncing' : 'ok';

  /** 详情里写操作后的统一刷新入口（详情组件自己也会 revalidateDecisions，这里幂等） */
  async function refresh() { await revalidateDecisions(); }

  return (
    <>
      <PageHeader
        crumb={META.crumb}
        title={META.title}
        badge={META.badge}
        sync={sync}
        actions={
          <button className="run-btn" onClick={() => setFormOpen(true)} aria-label="新建决策">
            <Icon name="i-bulb" size={13} />
            新建决策
          </button>
        }
      />

      {/* 概览计数 · 复用 .dev-grid / .dev-card / .dev-ic 视觉 */}
      <div className="dev-grid" style={{ marginBottom: 18 }}>
        <div className="dev-card">
          <div className="dev-ic" style={{ background: 'var(--blue-bg)', color: 'var(--blue)' }}><Icon name="i-doc" /></div>
          <div style={{ minWidth: 0 }}>
            <div className="tbl-name">决策总数</div>
            <div className="tbl-sub">记录 / 对比 / 决策 / 执行</div>
          </div>
          <span className="count-pill" style={{ marginLeft: 'auto' }}>{decisions.length}</span>
        </div>
        <div className="dev-card">
          <div className="dev-ic" style={{ background: 'var(--green-bg)', color: 'var(--green-deep)' }}><Icon name="i-check" /></div>
          <div style={{ minWidth: 0 }}>
            <div className="tbl-name">已接受</div>
            <div className="tbl-sub">可生成执行规则</div>
          </div>
          <span className="count-pill" style={{ marginLeft: 'auto' }}>{acceptedCount}</span>
        </div>
        <div className="dev-card">
          <div className="dev-ic" style={{ background: 'var(--orange-bg)', color: 'var(--orange)' }}><Icon name="i-warn" /></div>
          <div style={{ minWidth: 0 }}>
            <div className="tbl-name">待复核</div>
            <div className="tbl-sub">已到复核期</div>
          </div>
          <span className="count-pill" style={{ marginLeft: 'auto' }}>{dueCount}</span>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <b>决策看板</b>
          <span className="sub">ADR · MADR 结构 · 加权评分 · 决策→执行闭环</span>
          <span className="head-right">
            <div className="searchbox" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="i-search" size={14} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索决策 / 标签 / 负责人"
                aria-label="搜索决策"
                style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 16, minWidth: 160, padding: '6px 2px' }}
              />
            </div>
            <span className="sub">{visible.length} 条</span>
          </span>
        </div>

        <div style={{ marginBottom: 14 }}>
          <DecisionStatusTabs active={tab} counts={counts} onChange={setTab} />
        </div>

        {isLoading && !decisions.length ? (
          <LoadingRows rows={4} />
        ) : (
          <DecisionBoard decisions={visible} loading={isLoading} onOpen={setDetail} />
        )}

        {dueCount > 0 ? (
          <div className="attn-item" style={{ marginTop: 14 }}>
            <span className="attn-ico a"><Icon name="i-bell" /></span>
            <span className="attn-txt">
              <span className="attn-title">{dueCount} 条架构决策待复核</span>
              <span className="attn-time">到期复核 · 打开决策详情确认结论是否仍然成立</span>
            </span>
            <button className="run-btn" style={{ marginLeft: 'auto', minHeight: 44 }}
              onClick={() => { const first = decisions.find((d) => d.reviewDue); if (first) setDetail(first); }}
              aria-label="处理待复核决策">
              <Icon name="i-chev-r" size={13} /> 去处理
            </button>
          </div>
        ) : null}
      </div>

      {/* 空列提示（分段切换但当前无数据） */}
      {!isLoading && decisions.length > 0 && visible.length === 0 ? (
        <div className="empty-tip" style={{ marginTop: 12 }}>
          「{tab === 'all' ? '全部' : DECISION_STATUS_META[tab as DecisionStatus]?.label}」下暂无匹配决策，试试切换分段或清空搜索词
        </div>
      ) : null}

      <DecisionFormModal open={formOpen} onClose={() => setFormOpen(false)} />
      <DecisionDetailModal
        decision={detail}
        onClose={() => setDetail(null)}
        onRefresh={refresh}
      />
    </>
  );
}
