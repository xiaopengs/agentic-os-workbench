'use client';

/**
 * WorkerPanel · M8 双层插件执行器面板
 *
 * 「模型从哪来（Provider）」与「谁跑这一轮 Agent（Harness）」是两个独立、
 * 可自由组合的插件维度，各自一个下拉；协议是二者唯一的耦合契约，面板实时
 * 提示是否兼容 / CLI 是否已安装 / Key 是否已配置，绝不把不可跑的组合显示成在线。
 *
 * 数据流单向：用户操作 → loopApi 写 → revalidateLoop() 统一失效 → 各自重渲染。
 * 视觉零新增 CSS：复用 .card / .card-head / .chip / .run-btn / .sub 等既有语义类。
 * API Key 只提交、不回填、不展示，服务端独立存储。
 */
import { useState, type CSSProperties } from 'react';
import { Icon } from '@/components/icons/Icon';
import { loopApi, loopToast } from '@/lib/loop-api';
import {
  useLoopWorkerStatus, useLoopWorkerCapabilities, useLoopMutate,
} from '@/lib/loop-hooks';
import type {
  LoopWorkerMode, LoopWorkerStatus, LoopWorkerConfigPatch, LoopProviderProtocol,
  LoopProviderCapability,
} from '@/lib/loop-types';

const MODE_LABEL: Record<LoopWorkerMode, string> = {
  cli: '自动执行',
  gateway: '自动执行（旧 gateway 兼容）',
  off: '已停止',
};

/** 执行器状态对应的 chip 色调 */
function statusChip(s: LoopWorkerStatus): { tone: string; text: string } {
  if (s.config.mode === 'off') return { tone: 'mute', text: '已停止' };
  if (!s.available) return { tone: 'err', text: '不可用' };
  if (s.busy) return { tone: 'warn', text: '执行中' };
  if (s.config.auto) return { tone: 'ok', text: '自动执行中' };
  return { tone: 'info', text: '待命（手动）' };
}

const selectStyle: CSSProperties = {
  background: 'var(--bg)', border: '1px solid transparent', borderRadius: 10,
  padding: '8px 10px', fontSize: 13, minHeight: 40, maxWidth: '100%',
};
const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--bg)',
  border: '1px solid #e6ece8', borderRadius: 10, padding: '9px 10px',
  fontSize: 16, minHeight: 44,
};

export function WorkerPanel() {
  const { data: status, isLoading } = useLoopWorkerStatus();
  const { data: caps } = useLoopWorkerCapabilities();
  const { revalidateLoop } = useLoopMutate();
  const [busy, setBusy] = useState(false);
  const [showConn, setShowConn] = useState(false);
  const [draft, setDraft] = useState({ apiKey: '', baseUrl: '', model: '', protocol: '' });

  /**
   * 统一写入口：始终回传当前插件选择，避免老 mode 兼容逻辑把组合重置掉；
   * patch 中的字段优先（切换 harness/provider 时生效）。
   */
  async function apply(patch: LoopWorkerConfigPatch) {
    setBusy(true);
    try {
      const full: LoopWorkerConfigPatch = {
        ...(status?.config.harness && patch.harness === undefined ? { harness: status.config.harness } : {}),
        ...(status?.config.provider && patch.provider === undefined ? { provider: status.config.provider } : {}),
        ...patch,
      };
      await loopApi.workerConfig(full);
      await revalidateLoop();
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    setBusy(true);
    try {
      const res = await loopApi.workerRun();
      if (res.busy) {
        loopToast('已有 Agent 正在执行本轮，请稍候（执行器串行工作，避免模型拥塞）');
      } else if (res.executed === 0) {
        loopToast('当前没有排队轮次 · 先「接入事件」或「运行一条规则」');
      } else {
        const j = res.jobs[res.jobs.length - 1];
        loopToast(j?.real
          ? `真实 Agent 已执行 ${res.executed} 轮 · ${j?.outcome ?? j?.status}${j?.durationMs ? ` · ${(j.durationMs / 1000).toFixed(1)}s` : ''}`
          : `已执行 ${res.executed} 轮`);
      }
      await revalidateLoop();
    } catch {
      /* api-client 已统一 toast */
    } finally {
      setBusy(false);
    }
  }

  async function changeHarness(id: string) {
    try {
      await apply({ harness: id });
      loopToast('Agent 运行时已切换，请确认协议与供应商匹配');
    } catch { /* api-client 已统一 toast */ }
  }

  async function changeProvider(id: string) {
    try {
      await apply({ provider: id });
      const p = caps?.providers.find((x) => x.id === id);
      loopToast(p?.requiresKey
        ? `模型供应商已切换为 ${p.label} · 请在「连接设置」填写 API Key`
        : `模型供应商已切换为 ${p?.label ?? id}`);
    } catch { /* api-client 已统一 toast */ }
  }

  async function changeMode(mode: LoopWorkerMode) {
    try {
      await apply({ mode });
      loopToast(MODE_LABEL[mode]);
    } catch { /* api-client 已统一 toast */ }
  }

  async function changeAuto(auto: boolean) {
    try {
      await apply({ auto });
      loopToast(auto ? '已开启自动轮询' : '已暂停自动轮询（仍可手动执行）');
    } catch { /* api-client 已统一 toast */ }
  }

  function toggleConn() {
    // 每次打开都从服务端当前配置同步非敏感字段；Key 永远不回填
    setDraft({
      apiKey: '',
      baseUrl: status?.config.baseUrl ?? '',
      model: status?.config.model ?? '',
      protocol: status?.config.protocol ?? '',
    });
    setShowConn((v) => !v);
  }

  async function saveConn() {
    setBusy(true);
    try {
      const patch: LoopWorkerConfigPatch = {
        baseUrl: draft.baseUrl,
        model: draft.model,
      };
      if (draft.apiKey.trim()) patch.apiKey = draft.apiKey.trim();
      if (status?.config.provider === 'custom') {
        patch.protocol = (draft.protocol || '') as LoopProviderProtocol | '';
      }
      await apply(patch);
      setDraft((d) => ({ ...d, apiKey: '' }));
      loopToast('连接设置已保存（API Key 不会回显）');
    } catch { /* api-client 已统一 toast */ } finally {
      setBusy(false);
    }
  }

  async function clearKey() {
    try {
      await apply({ clearKey: true });
      loopToast('已清除已保存的 API Key');
    } catch { /* api-client 已统一 toast */ }
  }

  const chip = status ? statusChip(status) : { tone: 'mute', text: '加载中' };
  const last = status?.lastJob;
  const currentHarnessId = status?.config.harness ?? 'codebuddy';
  const currentProviderId = status?.config.provider ?? 'platform';
  const harness = caps?.harnesses.find((h) => h.id === currentHarnessId);
  const provider = caps?.providers.find((p) => p.id === currentProviderId);
  const protocol: LoopProviderProtocol = (status?.config.protocol ?? harness?.protocol ?? 'platform') as LoopProviderProtocol;
  const protocolLabel = caps?.protocols.find((x) => x.id === protocol)?.label ?? protocol;
  const compatible = provider ? provider.protocols.includes(protocol) : true;
  const providerSupports = (p: LoopProviderCapability) => p.protocols.includes(protocol);
  const defaultEndpoint = provider?.endpoints[protocol];
  const defaultModel = provider?.defaultModels[protocol];
  const modelLabel = status?.model || '平台默认档';

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="card-head">
        <b>Agent 执行器</b>
        <span className={`chip ${chip.tone}`}><i />{chip.text}</span>
        <span className="sub">{status?.reason ?? (isLoading ? '正在探测执行器…' : '')}</span>
        <span className="head-right">
          <button
            className="run-btn" onClick={runNow}
            disabled={busy || !status?.available}
            aria-label="立即让真实 Agent 执行一轮" style={{ minHeight: 40 }}
          >
            <Icon name="i-bolt" size={13} />
            {busy ? '执行中…' : '立即执行'}
          </button>
        </span>
      </div>

      {/* ① 两层插件：各自独立下拉，正交可组合 */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--t2)' }}>
          Agent 运行时
          <select
            value={currentHarnessId} disabled={busy}
            onChange={(e) => changeHarness(e.target.value)}
            aria-label="Agent 运行时（Harness 插件）"
            style={selectStyle}
          >
            {(caps?.harnesses ?? [{ id: currentHarnessId, label: currentHarnessId, installed: true, protocol, reason: '' }]).map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}{h.installed ? '' : ' · 未安装'}
              </option>
            ))}
          </select>
        </label>

        <span className="sub" aria-hidden>×</span>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--t2)' }}>
          模型供应商
          <select
            value={currentProviderId} disabled={busy}
            onChange={(e) => changeProvider(e.target.value)}
            aria-label="模型供应商（Provider 插件）"
            style={selectStyle}
          >
            {(caps?.providers ?? [{ id: currentProviderId, label: currentProviderId, protocols: [protocol], requiresKey: false, hasKey: false, endpoints: {}, defaultModels: {} }]).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}{providerSupports(p as LoopProviderCapability) ? '' : ' · 协议不匹配'}
              </option>
            ))}
          </select>
        </label>

        <span className="chip info" title="协议是 harness 与 provider 之间唯一的耦合契约">
          <i />协议 {protocolLabel}
        </span>
      </div>

      {/* 组合可用性的显式提示（不兼容 / 未安装 / 缺 Key） */}
      {caps && (!compatible || !harness?.installed) && (
        <div className="empty-tip" style={{ padding: '10px 12px', marginTop: 10, color: 'var(--red)' }}>
          {!compatible
            ? `协议不兼容：${harness?.label ?? currentHarnessId} 需要「${protocolLabel}」端点，`
              + `而 ${provider?.label ?? currentProviderId} 提供 ${(provider?.protocols ?? []).map((x) => caps.protocols.find((c) => c.id === x)?.label ?? x).join('、')}。请换供应商，或选「自定义兼容网关」。`
            : `${harness?.label ?? currentHarnessId} 未安装${harness?.installHint ? `（${harness.installHint}）` : ''}。`
              + ' 可先安装，或改选「HTTP 直连」（无需安装 CLI，配好 Key 即可真跑）。'}
        </div>
      )}

      {/* ② 运行控制与概览 */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--t2)', cursor: 'pointer' }}>
          <input
            type="checkbox" checked={status?.config.auto ?? true} disabled={busy}
            onChange={(e) => changeAuto(e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          自动轮询（每 {Math.round((status?.config.intervalMs ?? 15000) / 1000)} 秒）
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--t2)' }}>
          执行状态
          <select
            value={status?.config.mode ?? 'cli'} disabled={busy}
            onChange={(e) => changeMode(e.target.value as LoopWorkerMode)}
            aria-label="执行状态" style={{ ...selectStyle, minHeight: 36 }}
          >
            <option value="cli">自动执行</option>
            <option value="off">停止自动执行</option>
          </select>
        </label>
        <button
          className="run-btn" onClick={toggleConn}
          aria-expanded={showConn} style={{ minHeight: 36, background: 'var(--bg)', color: 'var(--t2)' }}
        >
          {showConn ? '收起连接设置' : '连接设置'}
        </button>
        <span
          className="chip info" style={{ marginLeft: 'auto' }}
          title={status?.model
            ? `本轮显式指定模型：${status.model}`
            : '未显式指定模型，由供应商默认档 / CLI 平台默认档决定'}
        >
          <i />模型 {modelLabel}
        </span>
        <span className="chip info"><i />累计真实执行 {status?.totalExecuted ?? 0} 轮</span>
      </div>

      {/* ③ 连接设置：Key / 端点 / 模型 / 协议 */}
      {showConn && (
        <div style={{ marginTop: 12, padding: 14, borderRadius: 12, background: 'var(--bg)', display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.6 }}>
            当前组合：<b>{harness?.label ?? currentHarnessId}</b> × <b>{provider?.label ?? currentProviderId}</b>
            {provider?.note ? ` · ${provider.note}` : ''}
            {defaultEndpoint ? ` · 默认端点 ${defaultEndpoint}` : ''}
          </div>
          <label style={{ display: 'grid', gap: 5, fontSize: 12.5, color: 'var(--t2)' }}>
            API Key（{status?.config.hasKey ? '已配置，留空则不修改' : '未配置'}）
            <input
              type="password" value={draft.apiKey} autoComplete="off"
              onChange={(e) => setDraft((d) => ({ ...d, apiKey: e.target.value }))}
              placeholder={status?.config.hasKey ? '••••••••（已保存，不回显）' : 'sk-...'}
              aria-label="API Key" style={inputStyle}
            />
          </label>
          <label style={{ display: 'grid', gap: 5, fontSize: 12.5, color: 'var(--t2)' }}>
            Base URL（留空则使用供应商默认端点）
            <input
              type="url" value={draft.baseUrl}
              onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))}
              placeholder={defaultEndpoint || 'https://...'} aria-label="Base URL" style={inputStyle}
            />
          </label>
          <label style={{ display: 'grid', gap: 5, fontSize: 12.5, color: 'var(--t2)' }}>
            模型 ID（留空则使用默认模型）
            <input
              type="text" value={draft.model}
              onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
              placeholder={defaultModel || '由供应商默认档决定'} aria-label="模型 ID" style={inputStyle}
            />
          </label>
          {currentProviderId === 'custom' && (
            <label style={{ display: 'grid', gap: 5, fontSize: 12.5, color: 'var(--t2)' }}>
              协议（自定义网关必选，需与 harness 一致）
              <select
                value={draft.protocol} onChange={(e) => setDraft((d) => ({ ...d, protocol: e.target.value }))}
                aria-label="协议" style={{ ...inputStyle, fontSize: 16 }}
              >
                <option value="">跟随运行时默认（{protocolLabel}）</option>
                {(caps?.protocols ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="run-btn" onClick={saveConn} disabled={busy} style={{ minHeight: 44 }}>
              保存连接设置
            </button>
            <button
              className="run-btn" onClick={clearKey} disabled={busy || !status?.config.hasKey}
              style={{ minHeight: 44, background: 'var(--bg)', color: 'var(--t2)' }}
            >
              清除已存 Key
            </button>
            {provider?.docs && (
              <a
                href={provider.docs} target="_blank" rel="noreferrer"
                style={{ fontSize: 12.5, alignSelf: 'center', color: 'var(--t2)' }}
              >
                获取 {provider.label} 的 Key ↗
              </a>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--t2)', lineHeight: 1.6 }}>
            Key 仅存服务端、不回显、不写入事实日志；切换供应商会自动清空旧 Key，避免误发到别家端点。
            提供者端点与示例模型只是默认值，请以各家官方文档的当前值为准。
          </div>
        </div>
      )}

      {/* ④ 最近一轮：展示真实组合，便于溯源 */}
      {last && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #f3f6f4', fontSize: 12.5, lineHeight: 1.6 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className={`chip ${last.status === 'done' ? 'ok' : last.status === 'skipped' ? 'mute' : 'err'}`}>
              <i />{last.status === 'done' ? '已完成' : last.status === 'skipped' ? '跳过' : '失败'}
            </span>
            <b style={{ fontSize: 12.5 }}>{last.runId}</b>
            <span className="sub">{last.rule} · {last.agent}</span>
            {last.durationMs != null && <span className="sub">{(last.durationMs / 1000).toFixed(1)}s</span>}
            {last.real && <span className="chip ok"><i />真实模型</span>}
            <span className="chip info" title="本轮实际使用的模型"><i />{last.model || '平台默认档'}</span>
            {last.harness && <span className="chip mute"><i />{last.harness}</span>}
            {last.provider && <span className="chip mute"><i />{last.provider}</span>}
          </div>
          {last.summary && <div style={{ marginTop: 6, color: 'var(--t2)' }}>{last.summary}</div>}
          {last.error && <div style={{ marginTop: 6, color: 'var(--red)' }}>{last.error}</div>}
        </div>
      )}

      {!status?.available && !caps && (
        <div className="empty-tip" style={{ padding: '14px 10px' }}>
          {status?.reason || '执行器不可用'} · 请检查插件组合与连接设置
        </div>
      )}
    </div>
  );
}
