'use client';

import Link from 'next/link';
import { Icon } from '@/components/icons/Icon';
import { StatusPill, wfIcon } from '@/components/ui/WorkflowBits';
import type { Workflow } from '@/lib/types';

export function RecentWorkflows({
  workflows,
  loading,
  onRun,
}: {
  workflows: Workflow[];
  loading: boolean;
  onRun: () => void;
}) {
  const rows = workflows.slice(0, 3);

  return (
    <div className="workflows-card">
      <div className="wf-top">
        <b>Recent Workflows</b>
        <span className="sub" style={{ fontSize: 12.5, color: 'var(--t3)' }}>
          最近执行的典型场景与工作流
        </span>
        <span className="head-right" style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          <Link className="link-more" href="/workflows">
            全部工作流 →
          </Link>
          <button className="run-btn" onClick={onRun}>
            <Icon name="i-play" size={13} />
            运行新工作流
          </button>
        </span>
      </div>

      {loading && !rows.length ? (
        <div className="card">
          <div className="skel skel-row" />
          <div className="skel skel-row" style={{ width: '70%' }} />
        </div>
      ) : rows.length ? (
        <div className="wf-grid">
          {rows.map((wf) => {
            const [icon, tone] = wfIcon(wf.name);
            return (
              <div className="wf-card" key={wf.id}>
                <div className="wf-head">
                  <div className={`wf-ico ${tone}`}>
                    <Icon name={icon} />
                  </div>
                  <div>
                    <div className="wf-title">{wf.name}</div>
                    <div className="wf-cat">{wf.category}</div>
                  </div>
                  <StatusPill status={wf.status} />
                </div>
                <div className="wf-meta">
                  <span>
                    <Icon name="i-device" />
                    {wf.devices}&nbsp;设备
                  </span>
                  <span>
                    <Icon name="i-list" />
                    {wf.steps}&nbsp;个步骤
                  </span>
                  <span>
                    <Icon name="i-target" />
                    覆盖率&nbsp;{wf.coverage}%
                  </span>
                </div>
                <div className="wf-foot">
                  <div className="wf-bar">
                    <i style={{ width: `${Math.min(100, Math.max(0, wf.coverage))}%` }} />
                  </div>
                  <span className="wf-dur">Regression {wf.duration} min</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <div className="empty-tip">暂无工作流记录，点击「运行新工作流」发起第一次仿真</div>
        </div>
      )}
    </div>
  );
}

export default RecentWorkflows;
