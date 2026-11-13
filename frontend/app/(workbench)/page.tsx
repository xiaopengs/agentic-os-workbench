'use client';

import { useState } from 'react';
import Link from 'next/link';
import { KpiGrid } from '@/components/dashboard/KpiGrid';
import { LiveTrace } from '@/components/dashboard/LiveTrace';
import { RecentWorkflows } from '@/components/dashboard/RecentWorkflows';
import { ApprovalCards } from '@/components/dashboard/ApprovalCards';
import { WorkflowFormModal } from '@/components/modals/WorkflowFormModal';
import { RunWhyModal } from '@/components/modals/RunWhyModal';
import { Icon, type IconName } from '@/components/icons/Icon';
import { PageHeader } from '@/components/ui/PageHeader';
import { useLoopWorkbench } from '@/lib/loop-hooks';
import { useDecisions } from '@/lib/decision-hooks';
import { navByKey } from '@/lib/nav';

const OVERVIEW = navByKey('overview');

interface AttentionItem {
  key: string;
  title: string;
  time: string;
  icon: IconName;
  icoTone: 'r' | 'g' | 'a';
  chipText: string;
  chipTone: 'ok' | 'warn' | 'err' | 'info' | 'mute';
  href: string;
}

/**
 * 总览 · 组件骨架与精简基线完全一致（PageHeader / KPI 2 卡 / Live Trace 列表 / Recent 3 卡 / 弹窗），
 * 仅把数据源从旧 workflows/skills/traces 换成 Autoloop 内核（/loop/state + /loop/facts）。
 * 顶部「今天要处理」复用既有 .attn-* / .chip 样式，零新增 CSS。
 */
export default function OverviewPage() {
  const { state, totals, facts, loading, sync } = useLoopWorkbench();
  const { data: decisions } = useDecisions();
  const [open, setOpen] = useState(false);
  const [whyRun, setWhyRun] = useState<string | null>(null);

  const openCards = state?.cards.filter((c) => c.state === 'open').length ?? 0;
  const dueDecisions = (decisions ?? []).filter((d) => d.reviewDue && d.status !== 'deprecated' && d.status !== 'superseded');

  const attention: AttentionItem[] = [];
  if (dueDecisions.length > 0) {
    attention.push({
      key: 'decisions', title: `${dueDecisions.length} 条架构决策待复核`, time: '到期复核 · 决策记录与方案权衡需重新确认',
      icon: 'i-bulb', icoTone: 'a', chipText: '待复核', chipTone: 'warn', href: '/decisions',
    });
  }
  if (openCards > 0) {
    attention.push({
      key: 'cards', title: `${openCards} 张卡片待拍板`, time: '回答后自动续跑，挂起期间不占轮次',
      icon: 'i-bell', icoTone: 'r', chipText: '待决策', chipTone: 'err', href: '#approval',
    });
  }
  if (totals && totals.queuedRuns > 0) {
    attention.push({
      key: 'queued', title: `${totals.queuedRuns} 个轮次排队中`, time: '规则命中后派发，等待执行回执',
      icon: 'i-play', icoTone: 'g', chipText: '进行中', chipTone: 'info', href: '/workflows',
    });
  }
  if (totals && totals.hopsBlocked > 0) {
    attention.push({
      key: 'hops', title: `${totals.hopsBlocked} 次跳数熔断`, time: '超过 8 层已停止派活，避免无限循环',
      icon: 'i-warn', icoTone: 'a', chipText: '已拦截', chipTone: 'warn', href: '/workflows',
    });
  }

  return (
    <>
      <PageHeader
        crumb={OVERVIEW.crumb}
        title={OVERVIEW.title}
        badge={OVERVIEW.badge}
        sync={sync}
      />

      {/* 今天要处理 · 复用既有卡片/列表/chip 样式，视觉零改动 */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <b>今天要处理</b>
          <span className="sub">挂起零消耗 · 待拍板与排队轮次都不会凭空消失</span>
          <span className="head-right">
            <button className="run-btn" onClick={() => setOpen(true)}>
              <Icon name="i-play" size={13} />
              接入事件
            </button>
          </span>
        </div>
        {attention.length ? (
          attention.map((a) => (
            <div className="attn-item" key={a.key}>
              <span className={`attn-ico ${a.icoTone}`}>
                <Icon name={a.icon} />
              </span>
              <span className="attn-txt">
                <span className="attn-title">{a.title}</span>
                <span className="attn-time">{a.time}</span>
              </span>
              <span className={`chip ${a.chipTone}`} style={{ marginLeft: 'auto', flex: 'none' }}>
                {a.chipText}
              </span>
              <Link className="chev" href={a.href} aria-label={`前往处理：${a.title}`}>
                <Icon name="i-chev-r" />
              </Link>
            </div>
          ))
        ) : (
          <div className="empty-tip">一切就绪 · 点击「接入事件」即可命中规则、派出第一轮并写入事实日志</div>
        )}
      </div>

      <ApprovalCards cards={state?.cards ?? []} loading={loading} />

      <KpiGrid state={state} />

      <LiveTrace facts={facts} loading={loading} pendingCards={openCards} />

      <RecentWorkflows
        runs={state?.runs ?? []}
        loading={loading}
        onRun={() => setOpen(true)}
        onWhy={setWhyRun}
      />

      <WorkflowFormModal open={open} onClose={() => setOpen(false)} />
      <RunWhyModal runId={whyRun} onClose={() => setWhyRun(null)} />
    </>
  );
}
