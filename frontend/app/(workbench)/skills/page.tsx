'use client';

import { Icon } from '@/components/icons/Icon';
import { Chip } from '@/components/ui/WorkflowBits';
import { LoadingRows, PageHeader } from '@/components/ui/PageHeader';
import { PLUGIN_KIND_META } from '@/lib/loop-format';
import { useLoopState } from '@/lib/loop-hooks';
import { navByKey } from '@/lib/nav';
import type { LoopPlugin, PluginKind } from '@/lib/loop-types';

const META = navByKey('skills');

/** 四方向 → 既有 design token（g/p/b/c 对应 green/purple/blue/cyan） */
const TONE_STYLE: Record<'g' | 'p' | 'b' | 'c', { background: string; color: string }> = {
  g: { background: 'var(--green-bg)', color: 'var(--green-deep)' },
  p: { background: 'var(--purple-bg)', color: 'var(--purple)' },
  b: { background: 'var(--blue-bg)', color: 'var(--blue)' },
  c: { background: 'var(--cyan-bg)', color: 'var(--cyan)' },
};

interface PluginRow {
  id: string;
  name: string;
  kind: PluginKind;
  config: string;
}

/** 把四方向插件摊平成统一表格行（列结构与旧技能注册表完全一致） */
function flatten(state: {
  agents: LoopPlugin[]; sources: LoopPlugin[]; channels: LoopPlugin[]; deliveries: LoopPlugin[];
} | null): PluginRow[] {
  if (!state) return [];
  const all: LoopPlugin[] = [...state.agents, ...state.sources, ...state.channels, ...state.deliveries];
  return all.map((p) => {
    let config = '—';
    if (p.kind === 'agent') config = `${p.use} · ${p.access}${p.model ? ` · ${p.model}` : ''}`;
    else if (p.kind === 'source') config = p.adapter ?? 'webhook';
    else if (p.kind === 'channel') config = p.answerers?.length ? `${p.answerers.length} 位应答者` : '通知通道';
    else if (p.kind === 'delivery') config = p.repo ?? '自动交付';
    return { id: p.id, name: p.name, kind: p.kind, config };
  });
}

export function SkillsList({ rows, loading }: { rows: PluginRow[]; loading: boolean }) {
  if (loading && !rows.length) return <LoadingRows rows={4} />;
  if (!rows.length)
    return <div className="empty-tip">暂无插件登记（GET /api/loop/state 返回空）</div>;

  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>插件</th>
            <th>方向</th>
            <th>标识</th>
            <th>配置</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const meta = PLUGIN_KIND_META[p.kind];
            return (
              <tr key={`${p.kind}:${p.id}`}>
                <td className="tbl-first" data-label="">
                  <div className="tbl-name">{p.name}</div>
                  <div className="tbl-sub">{meta.label}</div>
                </td>
                <td data-label="方向">
                  <Chip tone="info">{p.kind}</Chip>
                </td>
                <td className="tbl-num" data-label="标识">{p.id}</td>
                <td className="tbl-sub" data-label="配置">{p.config}</td>
                <td data-label="状态"><Chip tone="ok">已登记</Chip></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 插件页 · 视觉与旧技能注册表完全一致（PageHeader + sync-badge + .card + .tbl 卡片化）。
 * 语义换成「四方向插件注册表」：Agent / Source / Channel / Delivery，数据来自 /loop/state。
 */
export default function SkillsPage() {
  const { data: state, isLoading, isValidating } = useLoopState();
  const rows = flatten(state ?? null);

  const counts: { kind: PluginKind; n: number }[] = [
    { kind: 'agent', n: state?.agents.length ?? 0 },
    { kind: 'source', n: state?.sources.length ?? 0 },
    { kind: 'channel', n: state?.channels.length ?? 0 },
    { kind: 'delivery', n: state?.deliveries.length ?? 0 },
  ];

  return (
    <>
      <PageHeader
        crumb={META.crumb}
        title={META.title}
        badge={META.badge}
        sync={isValidating ? 'syncing' : 'ok'}
        actions={
          <span className="sync-badge" style={{ marginLeft: 0 }}>
            <Icon name="i-cube" size={13} />
            <span>{rows.length} 个已登记</span>
          </span>
        }
      />

      {/* 四方向计数 · 复用既有 .dev-grid / .dev-card / .dev-ic 视觉 */}
      <div className="dev-grid" style={{ marginBottom: 18 }}>
        {counts.map(({ kind, n }) => {
          const meta = PLUGIN_KIND_META[kind];
          return (
            <div className="dev-card" key={kind}>
              <div className="dev-ic" style={TONE_STYLE[meta.tone]}>
                <Icon name={meta.icon} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="tbl-name">{meta.label}</div>
                <div className="tbl-sub">{n} 个已登记</div>
              </div>
              <span className="count-pill" style={{ marginLeft: 'auto' }}>{n}</span>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="card-head">
          <b>插件注册表</b>
          <span className="sub">来自 GET /api/loop/state · 万物皆插件（事件/执行/通知/交付）</span>
        </div>
        <SkillsList rows={rows} loading={isLoading} />
      </div>
    </>
  );
}
