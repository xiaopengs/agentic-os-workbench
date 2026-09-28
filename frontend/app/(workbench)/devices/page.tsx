'use client';

import { Icon } from '@/components/icons/Icon';
import { Chip } from '@/components/ui/WorkflowBits';
import { LoadingRows, PageHeader } from '@/components/ui/PageHeader';
import { useWorkbench } from '@/lib/hooks';
import { NAV_ITEMS } from '@/lib/nav';

const META = NAV_ITEMS[4];

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'mute'> = {
  online: 'ok',
  busy: 'warn',
  offline: 'mute',
};

export default function DevicesPage() {
  const data = useWorkbench();
  const devices = data.devices ?? [];
  /** 契约中暂无 /api/devices，退化为按工作流聚合设备数 */
  const pooled = data.workflows.reduce((sum, w) => sum + (w.devices || 0), 0);

  return (
    <>
      <PageHeader crumb={META.crumb} title={META.title} badge={META.badge} sync={data.sync} />

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <b>设备概览</b>
          <span className="sub">真机 + 模拟器统一管理</span>
          <span className="head-right">
            <span className="env-pill">
              <Icon name="i-device" size={12} />
              集群规模 {devices.length || pooled}
            </span>
          </span>
        </div>
        <div className="kv-grid">
          <div className="kv">
            <div className="k">在线设备</div>
            <div className="v">{devices.filter((d) => d.status === 'online').length || 0}</div>
          </div>
          <div className="kv">
            <div className="k">工作流占用</div>
            <div className="v">{pooled}</div>
          </div>
          <div className="kv">
            <div className="k">运行中工作流</div>
            <div className="v">{data.runningCount}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <b>设备列表</b>
          <span className="sub">来自 GET /api/devices（契约未定义该端点时显示空态）</span>
        </div>

        {data.loading && !devices.length ? (
          <LoadingRows rows={3} />
        ) : devices.length ? (
          <div className="dev-grid">
            {devices.map((d) => (
              <div className="dev-card" key={d.id}>
                <span className="dev-ic">
                  <Icon name="i-phone" />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="tbl-name">{d.name}</div>
                  <div className="tbl-sub">
                    {d.model ?? '—'} · {d.os ?? '—'}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <Chip tone={STATUS_TONE[d.status ?? ''] ?? 'mute'}>{d.status ?? '—'}</Chip>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-tip">
            尚未接入设备集群：05 文档契约中暂无 <code>/api/devices</code> 端点，
            上方「设备概览」暂由工作流聚合推算。后端补充该端点后本页自动展示真实设备。
          </div>
        )}
      </div>
    </>
  );
}