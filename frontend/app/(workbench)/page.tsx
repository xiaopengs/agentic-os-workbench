'use client';

import { useState } from 'react';
import { KpiGrid } from '@/components/dashboard/KpiGrid';
import { LiveTrace } from '@/components/dashboard/LiveTrace';
import { RecentWorkflows } from '@/components/dashboard/RecentWorkflows';
import { WorkflowFormModal } from '@/components/modals/WorkflowFormModal';
import { PageHeader } from '@/components/ui/PageHeader';
import { useWorkbench } from '@/lib/hooks';
import { navByKey } from '@/lib/nav';

const OVERVIEW = navByKey('overview');

/**
 * 精简基线版总览：只保留与「工作流 / 技能」直接相关的三块内容。
 * 已下线：Agent Lifecycle、Simulation Lab、右侧 Copilot 侧栏（源码保留，后续逐个补充）。
 */
export default function OverviewPage() {
  const data = useWorkbench();
  const [wfOpen, setWfOpen] = useState(false);

  return (
    <>
      <PageHeader
        crumb={OVERVIEW.crumb}
        title={OVERVIEW.title}
        badge={OVERVIEW.badge}
        sync={data.sync}
      />

      <KpiGrid workflows={data.workflows} skills={data.skills} />

      <LiveTrace traces={data.traces} loading={data.loading} />

      <RecentWorkflows
        workflows={data.workflows}
        loading={data.loading}
        onRun={() => setWfOpen(true)}
      />

      <WorkflowFormModal open={wfOpen} onClose={() => setWfOpen(false)} />
    </>
  );
}
