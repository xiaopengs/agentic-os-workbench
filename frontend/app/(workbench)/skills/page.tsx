'use client';

import { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { Chip } from '@/components/ui/WorkflowBits';
import { LoadingRows, PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/modals/Modal';
import { PLUGIN_KIND_META } from '@/lib/loop-format';
import { loopApi, loopToast } from '@/lib/loop-api';
import { useLoopMutate, useLoopState } from '@/lib/loop-hooks';
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
  disabled: boolean;
}

/** 把四方向插件摊平成统一表格行（列结构与旧技能注册表完全一致） */
function flatten(state: {
  agents: LoopPlugin[]; sources: LoopPlugin[]; channels: LoopPlugin[]; deliveries: LoopPlugin[];
  disabledPlugins?: Record<string, { since: string; reason?: string }>;
} | null): PluginRow[] {
  if (!state) return [];
  const all: LoopPlugin[] = [...state.agents, ...state.sources, ...state.channels, ...state.deliveries];
  const disabled = state.disabledPlugins ?? {};
  return all.map((p) => {
    let config = '—';
    if (p.kind === 'agent') config = `${p.use} · ${p.access}${p.model ? ` · ${p.model}` : ''}`;
    else if (p.kind === 'source') config = p.adapter ?? 'webhook';
    else if (p.kind === 'channel') config = p.answerers?.length ? `${p.answerers.length} 位应答者` : '通知通道';
    else if (p.kind === 'delivery') config = p.repo ?? '自动交付';
    return { id: p.id, name: p.name, kind: p.kind, config, disabled: !!disabled[p.id] };
  });
}

export function SkillsList({
  rows, loading, onToggle, busy,
}: {
  rows: PluginRow[];
  loading: boolean;
  onToggle: (row: PluginRow) => void;
  busy: string | null;
}) {
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
            <th style={{ textAlign: 'right' }}>操作</th>
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
                <td data-label="状态">
                  <Chip tone={p.disabled ? 'mute' : 'ok'}>{p.disabled ? '已停用' : '已登记'}</Chip>
                </td>
                <td className="tbl-full" data-label="">
                  <div className="tbl-actions">
                    <button
                      className="icon-btn"
                      title={p.disabled ? '启用插件' : '停用插件'}
                      aria-label={p.disabled ? `启用插件 ${p.id}` : `停用插件 ${p.id}`}
                      disabled={busy === p.id}
                      onClick={() => onToggle(p)}
                    >
                      <Icon name={p.disabled ? 'i-check' : 'i-x'} size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const KINDS: { value: PluginKind; label: string }[] = [
  { value: 'agent', label: 'Agent · 执行体' },
  { value: 'source', label: 'Source · 事件源' },
  { value: 'channel', label: 'Channel · 通知通道' },
  { value: 'delivery', label: 'Delivery · 交付' },
];

/** 登记插件表单（复用既有 Modal + .wf-form，零新增 CSS） */
function PluginFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { revalidateLoop } = useLoopMutate();
  const [kind, setKind] = useState<PluginKind>('agent');
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [config, setConfig] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!id.trim() || !name.trim()) { loopToast('请填写插件 id 与名称'); return; }
    setSubmitting(true);
    try {
      // 按方向把 config 映射到既有字段，构造合法 LoopPlugin
      let plugin: LoopPlugin;
      if (kind === 'agent') {
        plugin = { kind, id: id.trim(), name: name.trim(), worker: 'local', use: config.trim() || 'command', access: 'read' };
      } else if (kind === 'source') {
        plugin = { kind, id: id.trim(), name: name.trim(), adapter: config.trim() || 'webhook' };
      } else if (kind === 'channel') {
        const answerers = config.split(',').map((s) => s.trim()).filter(Boolean);
        plugin = { kind, id: id.trim(), name: name.trim(), ...(answerers.length ? { answerers } : {}) };
      } else {
        plugin = { kind, id: id.trim(), name: name.trim(), repo: config.trim() || undefined };
      }
      await loopApi.postPlugin(plugin);
      loopToast(`插件已登记：${name.trim()}`);
      setId(''); setName(''); setConfig('');
      onClose();
      await revalidateLoop();
    } catch {
      /* api-client 已统一 toast */
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} title="登记插件 · 万物皆插件" onClose={onClose}>
      <form className="wf-form" onSubmit={(e) => void submit(e)}>
        <label htmlFor="pfKind">插件方向</label>
        <select id="pfKind" value={kind} onChange={(e) => setKind(e.target.value as PluginKind)}>
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>

        <div className="form-row">
          <div>
            <label htmlFor="pfId">标识 id</label>
            <input id="pfId" value={id} onChange={(e) => setId(e.target.value)} placeholder="如 claude / github" />
          </div>
          <div>
            <label htmlFor="pfName">显示名称</label>
            <input id="pfName" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 Claude Code" />
          </div>
        </div>

        <label htmlFor="pfConfig">
          {kind === 'channel' ? '应答者白名单 answerers（逗号分隔，留空=登录本人可答）' : '配置（执行体/适配器/仓库）'}
        </label>
        <input
          id="pfConfig" value={config} onChange={(e) => setConfig(e.target.value)}
          placeholder={kind === 'channel' ? 'ou_owner, alice@workbench.local' : 'claude / webhook / owner/repo'}
        />

        <button className="primary-btn" type="submit" disabled={submitting}>
          {submitting ? '正在登记…' : '登记插件'}
        </button>
      </form>
    </Modal>
  );
}

/**
 * 插件页 · 视觉与旧技能注册表完全一致（PageHeader + sync-badge + .card + .tbl 卡片化）。
 * M4：新增「停用/启用」操作（事实化启停）+「登记插件」表单，全部复用既有视觉类，零新增 CSS。
 */
export default function SkillsPage() {
  const { data: state, isLoading, isValidating } = useLoopState();
  const { revalidateLoop } = useLoopMutate();
  const [busy, setBusy] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const rows = flatten(state ?? null);

  async function toggle(row: PluginRow) {
    setBusy(row.id);
    try {
      if (row.disabled) {
        await loopApi.enablePlugin(row.id);
        loopToast(`插件已启用：${row.id}`);
      } else {
        await loopApi.disablePlugin(row.id, '从插件页停用');
        loopToast(`插件已停用：${row.id}（停用后不再派活）`);
      }
      await revalidateLoop();
    } catch {
      /* api-client 已统一 toast */
    } finally {
      setBusy(null);
    }
  }

  const counts: { kind: PluginKind; n: number }[] = [
    { kind: 'agent', n: state?.agents.length ?? 0 },
    { kind: 'source', n: state?.sources.length ?? 0 },
    { kind: 'channel', n: state?.channels.length ?? 0 },
    { kind: 'delivery', n: state?.deliveries.length ?? 0 },
  ];
  const disabledCount = Object.keys(state?.disabledPlugins ?? {}).length;

  return (
    <>
      <PageHeader
        crumb={META.crumb}
        title={META.title}
        badge={META.badge}
        sync={isValidating ? 'syncing' : 'ok'}
        actions={
          <button className="run-btn" onClick={() => setFormOpen(true)}>
            <Icon name="i-cube" size={13} />
            登记插件
          </button>
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
          <span className="head-right">
            <span className="sub">
              {rows.length} 个已登记{disabledCount ? ` · ${disabledCount} 个停用` : ''}
            </span>
          </span>
        </div>
        <SkillsList rows={rows} loading={isLoading} onToggle={(r) => void toggle(r)} busy={busy} />
      </div>

      <PluginFormModal open={formOpen} onClose={() => setFormOpen(false)} />
    </>
  );
}
