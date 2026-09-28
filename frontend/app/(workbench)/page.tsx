'use client';

import { useMemo, useState } from 'react';
import { KpiGrid } from '@/components/dashboard/KpiGrid';
import { LifecycleCard } from '@/components/dashboard/LifecycleCard';
import { LiveTrace } from '@/components/dashboard/LiveTrace';
import { RecentWorkflows } from '@/components/dashboard/RecentWorkflows';
import { SimulationLab } from '@/components/dashboard/SimulationLab';
import { WorkflowFormModal } from '@/components/modals/WorkflowFormModal';
import { PageHeader } from '@/components/ui/PageHeader';
import { useMutate, useWorkbench } from '@/lib/hooks';
import { p95 } from '@/lib/format';
import { useSimulation } from '@/lib/simulation';
import { emitToast } from '@/lib/toast-bus';
import { NAV_ITEMS } from '@/lib/nav';
import type { Trace } from '@/lib/types';

const OVERVIEW = NAV_ITEMS[0];

/** P95 趋势：较新一半 Trace 与较旧一半的平均耗时对比 */
function p95TrendPct(traces: Trace[]): number {
  const sorted = [...traces].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ta - tb;
  });
  if (sorted.length < 2) return 0;
  const mid = Math.floor(sorted.length / 2);
  const mean = (arr: Trace[]) =>
    arr.length ? arr.reduce((s, t) => s + (t.cost || 0), 0) / arr.length : 0;
  const older = mean(sorted.slice(0, mid));
  const newer = mean(sorted.slice(mid));
  if (!older) return 0;
  return Math.round(((newer - older) / older) * 100);
}

export default function OverviewPage() {
  const data = useWorkbench();
  const sim = useSimulation();
  const { revalidateAll } = useMutate();
  const [wfOpen, setWfOpen] = useState(false);

  const p95Value = useMemo(() => p95(data.traces.map((t) => t.cost)), [data.traces]);
  const p95Trend = useMemo(() => p95TrendPct(data.traces), [data.traces]);

  function replay() {
    sim.replay();
    void revalidateAll();
    emitToast('DAG 回放已启动：Intent → Contract → Skill → Agent → Simulation → Secure Release');
  }

  return (
    <>
      <PageHeader
        crumb={OVERVIEW.crumb}
        title={OVERVIEW.title}
        badge={OVERVIEW.badge}
        sync={data.sync}
      />

      <KpiGrid kpis={data.kpis} />

      <LifecycleCard data={data} />

      <div className="row-2col">
        <SimulationLab
          stages={data.stages}
          ratio={data.ratio}
          p95={p95Value}
          p95Trend={p95Trend}
          sim={sim}
          onReplay={replay}
        />
        <LiveTrace traces={data.traces} loading={data.loading} />
      </div>

      <RecentWorkflows
        workflows={data.workflows}
        loading={data.loading}
        onRun={() => setWfOpen(true)}
      />

      <WorkflowFormModal open={wfOpen} onClose={() => setWfOpen(false)} />
    </>
  );
}
