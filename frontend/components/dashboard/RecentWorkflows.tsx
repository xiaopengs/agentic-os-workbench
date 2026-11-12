'use client';

import Link from 'next/link';
import { Icon } from '@/components/icons/Icon';
import { wfIcon } from '@/components/ui/WorkflowBits';
import { relTime } from '@/lib/format';
import { runStateChip } from '@/lib/loop-format';
import type { LoopRun, RunState } from '@/lib/loop-types';

/** RunState → 既有 .wf-status 三态（running / failed / done），视觉与 StatusPill 完全一致 */
const RUN_STATUS_CLASS: Record<RunState, string> = {
  queued: 'running', claimed: 'running', unknown: 'running',
  done: 'done', nothing: 'done', cancelled: 'failed',
};

/**
 * Recent Workflows · 视觉与原型完全一致（.workflows-card / .wf-top / .wf-grid / .wf-card / .wf-foot）。
 * 语义从「最近工作流」换成「最近轮次 Runs」：3 张卡展示 rule / agent / 状态 / 回执摘要。
 * 保留导出名与 onRun 回调名以兼容既有引用；按钮文案改为「接入事件」。
 */
export function RecentWorkflows({
  runs,
  loading,
  onRun,
  onWhy,
}: {
  runs: LoopRun[];
  loading: boolean;
  onRun: () => void;
  /** M4：点击查看该轮次的 why 溯源时间线 */
  onWhy: (runId: string) => void;
}) {
  const rows = [...runs]
    .sort((a, b) => b.seq - a.seq)
    .slice(0, 3);

  return (
    <div className="workflows-card">
      <div className="wf-top">
        <b>Recent Runs</b>
        <span className="sub" style={{ fontSize: 12.5, color: 'var(--t3)' }}>
          最近轮次 · 规则命中后派发的执行实例
        </span>
        <span className="head-right" style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          <Link className="link-more" href="/workflows">
            全部规则 →
          </Link>
          <button className="run-btn" onClick={onRun}>
            <Icon name="i-play" size={13} />
            接入事件
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
          {rows.map((run) => {
            const [icon, tone] = wfIcon(run.rule);
            const chip = runStateChip(run.state);
            return (
              <div className="wf-card" key={run.id}>
                <div className="wf-head">
                  <div className={`wf-ico ${tone}`}>
                    <Icon name={icon} />
                  </div>
                  <div>
                    <div className="wf-title">{run.rule}</div>
                    <div className="wf-cat">{run.agent} · {run.lane || '主事项'}</div>
                  </div>
                  <span className={`wf-status ${RUN_STATUS_CLASS[run.state] ?? 'done'}`}>
                    {run.state === 'done' ? <Icon name="i-check" size={11} /> : <i />}
                    {chip.text}
                  </span>
                </div>
                <div className="wf-meta">
                  <span>
                    <Icon name="i-device" />
                    #{run.seq}
                  </span>
                  <span>
                    <Icon name="i-list" />
                    {run.eventSeqs.length}&nbsp;事件
                  </span>
                  <span>
                    <Icon name="i-target" />
                    尝试&nbsp;{run.attempts}
                  </span>
                </div>
                <div className="wf-foot">
                  <div className="wf-bar">
                    <i style={{ width: `${run.state === 'done' ? 100 : run.state === 'claimed' ? 60 : 25}%` }} />
                  </div>
                  <span className="wf-dur">{run.finishedAt ? relTime(run.finishedAt) : `hops ${run.hops}`}</span>
                  <button
                    className="mini-more"
                    onClick={() => onWhy(run.id)}
                    aria-label={`溯源轮次 ${run.id}`}
                    title="查看 why 溯源时间线"
                    style={{ marginLeft: 'auto', width: 'auto', padding: '0 6px', gap: 4, fontSize: 11.5 }}
                  >
                    <Icon name="i-list" size={12} />
                    溯源
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <div className="empty-tip">暂无轮次，点击「接入事件」或运行一条规则即可派活</div>
        </div>
      )}
    </div>
  );
}

export default RecentWorkflows;
