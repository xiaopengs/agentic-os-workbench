'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { WorkflowFormModal } from '@/components/modals/WorkflowFormModal';
import { LoadingRows, PageHeader } from '@/components/ui/PageHeader';
import { StatusPill } from '@/components/ui/WorkflowBits';
import { api } from '@/lib/api-client';
import { useMutate, useWorkbench } from '@/lib/hooks';
import { relTime } from '@/lib/format';
import { navByKey } from '@/lib/nav';
import type { Workflow } from '@/lib/types';

const META = navByKey('workflows');

export default function WorkflowsClient() {
  const sp = useSearchParams();
  const q = (sp.get('q') || '').trim().toLowerCase();
  const data = useWorkbench();
  const { revalidateWorkflows, revalidateUsage } = useMutate();
  const [open, setOpen] = useState(false);

  const rows = data.workflows.filter((w) =>
    !q
      ? true
      : [w.name, w.category, w.description, w.status].some((f) =>
          String(f ?? '').toLowerCase().includes(q),
        ),
  );

  async function patchStatus(wf: Workflow) {
    const next = wf.status === 'running' ? 'done' : 'running';
    try {
      await api.workflows.update(wf.id, { status: next });
      await Promise.all([revalidateWorkflows(), revalidateUsage()]);
    } catch {
      /* api-client 已 toast */
    }
  }

  async function remove(wf: Workflow) {
    try {
      await api.workflows.remove(wf.id);
      await revalidateWorkflows();
    } catch {
      /* api-client 已 toast */
    }
  }

  return (
    <>
      <PageHeader
        crumb={META.crumb}
        title={META.title}
        badge={META.badge}
        sync={data.sync}
        actions={
          <button className="run-btn" onClick={() => setOpen(true)}>
            <Icon name="i-play" size={13} />
            运行新工作流
          </button>
        }
      />

      <div className="card">
        <div className="card-head">
          <b>工作流列表</b>
          <span className="sub">
            {q ? `搜索「${q}」· 命中 ${rows.length} 条` : `共 ${rows.length} 条 · 来自 GET /api/workflows`}
          </span>
          <span className="head-right">
            <span className="sub">运行中 {data.runningCount} · 已完成 {data.doneCount} · 失败 {data.failedCount}</span>
          </span>
        </div>

        {data.loading && !rows.length ? (
          <LoadingRows rows={4} />
        ) : rows.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>工作流</th>
                  <th>状态</th>
                  <th>设备</th>
                  <th>步骤</th>
                  <th>覆盖率</th>
                  <th>回归时长</th>
                  <th>更新</th>
                  <th style={{ textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((wf) => (
                  <tr key={wf.id}>
                    <td className="tbl-first" data-label="">
                      <div className="tbl-name">{wf.name}</div>
                      <div className="tbl-sub">{wf.category}</div>
                    </td>
                    <td data-label="状态">
                      <StatusPill status={wf.status} />
                    </td>
                    <td className="tbl-num" data-label="设备">{wf.devices}</td>
                    <td className="tbl-num" data-label="步骤">{wf.steps}</td>
                    <td className="tbl-num" data-label="覆盖率">{wf.coverage}%</td>
                    <td className="tbl-num" data-label="时长">{wf.duration} min</td>
                    <td className="tbl-sub" data-label="更新">{relTime(wf.updatedAt ?? wf.createdAt)}</td>
                    <td className="tbl-full" data-label="">
                      <div className="tbl-actions">
                        <button
                          className="icon-btn"
                          title={wf.status === 'running' ? '标记完成' : '重新运行'}
                          aria-label={wf.status === 'running' ? '标记完成' : '重新运行'}
                          onClick={() => void patchStatus(wf)}
                        >
                          <Icon name="i-refresh" size={15} />
                        </button>
                        <button
                          className="icon-btn danger"
                          title="删除"
                          aria-label="删除"
                          onClick={() => void remove(wf)}
                        >
                          <Icon name="i-x" size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-tip">
            暂无工作流{q ? `匹配「${q}」` : ''}，点击右上角「运行新工作流」创建第一条记录
          </div>
        )}
      </div>

      <WorkflowFormModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
