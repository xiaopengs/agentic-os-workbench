'use client';

import { Icon } from '@/components/icons/Icon';
import { Chip } from '@/components/ui/WorkflowBits';
import { LoadingRows, PageHeader } from '@/components/ui/PageHeader';
import { useWorkbench } from '@/lib/hooks';
import { relTime } from '@/lib/format';
import { NAV_ITEMS } from '@/lib/nav';

const META = NAV_ITEMS[3];

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'mute'> = {
  active: 'ok',
  draft: 'warn',
  deprecated: 'mute',
};

export default function ContractsPage() {
  const data = useWorkbench();

  return (
    <>
      <PageHeader
        crumb={META.crumb}
        title={META.title}
        badge={META.badge}
        sync={data.sync}
        actions={
          <span className="sync-badge" style={{ marginLeft: 0 }}>
            <Icon name="i-doc" size={13} />
            <span>{data.contracts.length} 份契约</span>
          </span>
        }
      />

      <div className="cap-hero">
        <h2>能力接入 · 声明式 Contract</h2>
        <p>
          系统应用开发者无需编写 MCP 适配代码，只需声明能力契约，AgentFunctionService
          自动完成注册与协议适配——新增工具无需修改代码、无需发版。
        </p>
        <div className="cap-tags">
          <span className="cap-tag">Agent Contract 编辑器</span>
          <span className="cap-tag">变更影响分析</span>
          <span className="cap-tag">自动校验与 Mock</span>
          <span className="cap-tag">批量接入流水线</span>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <b>契约列表</b>
          <span className="sub">来自 GET /api/contracts · 60s 自动重验证</span>
        </div>

        {data.loading && !data.contracts.length ? (
          <LoadingRows rows={4} />
        ) : data.contracts.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>契约名称</th>
                  <th>tool_name</th>
                  <th>版本</th>
                  <th>权限级</th>
                  <th>状态</th>
                  <th>更新</th>
                </tr>
              </thead>
              <tbody>
                {data.contracts.map((c) => (
                  <tr key={c.id}>
                    <td className="tbl-name">{c.name}</td>
                    <td className="tbl-num">{c.toolName ?? '—'}</td>
                    <td className="tbl-num">{c.version ?? '—'}</td>
                    <td>
                      <Chip tone="info">{c.permissionLevel ?? '—'}</Chip>
                    </td>
                    <td>
                      <Chip tone={STATUS_TONE[c.status ?? ''] ?? 'mute'}>{c.status ?? '—'}</Chip>
                    </td>
                    <td className="tbl-sub">{relTime(c.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-tip">暂无 Contract 记录（GET /api/contracts 返回空）</div>
        )}
      </div>
    </>
  );
}
