'use client';

/**
 * WorkerPanel · M7 真实 Agent 执行器面板
 *
 * 与「演示按钮」的区别：这里的每个动作都真的调起本机 CLI Agent，
 * 把 queued 轮次领走、执行、回写真回执。页面明确展示执行器是否在线、
 * 用的是真实模型还是模拟、最近一轮做了什么。
 *
 * 数据流单向：用户操作 → loopApi 写 → revalidateLoop() 统一失效 → 各自重渲染。
 * 视觉零新增 CSS：复用 .card / .card-head / .chip / .run-btn / .sub 等既有语义类。
 */
import { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { loopApi, loopToast } from '@/lib/loop-api';
import { useLoopWorkerStatus, useLoopMutate } from '@/lib/loop-hooks';
import type { LoopWorkerMode, LoopWorkerStatus } from '@/lib/loop-types';

const MODE_LABEL: Record<LoopWorkerMode, string> = {
  cli: '真实 Agent（本机 CLI）',
  gateway: '真实模型（HTTP）',
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

export function WorkerPanel() {
  const { data: status, isLoading } = useLoopWorkerStatus();
  const { revalidateLoop } = useLoopMutate();
  const [busy, setBusy] = useState(false);

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

  async function change(patch: { mode?: LoopWorkerMode; auto?: boolean }) {
    setBusy(true);
    try {
      await loopApi.workerConfig(patch);
      await revalidateLoop();
      loopToast(patch.mode ? `执行模式已切换：${MODE_LABEL[patch.mode]}` : (patch.auto ? '已开启自动执行' : '已暂停自动执行'));
    } catch {
      /* api-client 已统一 toast */
    } finally {
      setBusy(false);
    }
  }

  const chip = status ? statusChip(status) : { tone: 'mute', text: '加载中' };
  const last = status?.lastJob;

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="card-head">
        <b>Agent 执行器</b>
        <span className={`chip ${chip.tone}`}><i />{chip.text}</span>
        <span className="sub">{status?.reason ?? (isLoading ? '正在探测执行器…' : '')}</span>
        <span className="head-right">
          <button className="run-btn" onClick={runNow} disabled={busy || !status?.available} aria-label="立即让真实 Agent 执行一轮" style={{ minHeight: 36 }}>
            <Icon name="i-bolt" size={13} />
            {busy ? '执行中…' : '立即执行'}
          </button>
        </span>
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--t2)' }}>
          模式
          <select
            value={status?.config.mode ?? 'cli'}
            disabled={busy}
            onChange={(e) => change({ mode: e.target.value as LoopWorkerMode })}
            aria-label="执行器模式"
            style={{ background: 'var(--bg)', border: '1px solid transparent', borderRadius: 10, padding: '8px 10px', fontSize: 13, minHeight: 36 }}
          >
            <option value="cli">真实 Agent（本机 CLI）</option>
            <option value="gateway">真实模型（HTTP Gateway）</option>
            <option value="off">停止自动执行</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--t2)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={status?.config.auto ?? true}
            disabled={busy}
            onChange={(e) => change({ auto: e.target.checked })}
            style={{ width: 16, height: 16 }}
          />
          自动轮询（每 {Math.round((status?.config.intervalMs ?? 15000) / 1000)} 秒）
        </label>
        <span className="chip info" style={{ marginLeft: 'auto' }}>
          <i />累计真实执行 {status?.totalExecuted ?? 0} 轮
        </span>
      </div>

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
          </div>
          {last.summary && <div style={{ marginTop: 6, color: 'var(--t2)' }}>{last.summary}</div>}
          {last.error && <div style={{ marginTop: 6, color: 'var(--red)' }}>{last.error}</div>}
        </div>
      )}

      {!status?.available && (
        <div className="empty-tip" style={{ padding: '14px 10px' }}>
          {status?.reason || '执行器不可用'} · 真实 Agent 模式需要本机已登录的命令行 Agent
        </div>
      )}
    </div>
  );
}
