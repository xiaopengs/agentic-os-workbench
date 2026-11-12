'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { WorkflowFormModal } from '@/components/modals/WorkflowFormModal';
import { RulePreview } from '@/components/dashboard/RulePreview';
import { Chip } from '@/components/ui/WorkflowBits';
import { LoadingRows, PageHeader } from '@/components/ui/PageHeader';
import { loopApi, loopToast } from '@/lib/loop-api';
import { useLoopMutate, useLoopState } from '@/lib/loop-hooks';
import { rulePaused, tellText, whenText } from '@/lib/loop-format';
import { navByKey } from '@/lib/nav';
import type { LoopRule } from '@/lib/loop-types';

const META = navByKey('workflows');

/**
 * 规则页 · 视觉与旧工作流列表完全一致（.card / .tbl + data-label 卡片化 / .icon-btn / .chip / .run-btn）。
 * 语义换成 Autoloop「规则 Rules」：列从 设备/步骤/覆盖率 换成 触发/交给/目录/通知，
 * 操作从「改状态/删除」换成「暂停·恢复 / 立即运行」（后端无删除规则端点，避免引入不一致写操作）。
 */
export default function WorkflowsClient() {
  const sp = useSearchParams();
  const q = (sp.get('q') || '').trim().toLowerCase();
  const { data: state, isValidating } = useLoopState();
  const { revalidateLoop } = useLoopMutate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const rules = state?.rules ?? [];
  const pauses = state?.pauses ?? {};

  const rows = rules.filter((r) =>
    !q
      ? true
      : [r.name, r.to, r.cwd, r.group, whenText(r.when)].some((f) =>
          String(f ?? '').toLowerCase().includes(q),
        ),
  );

  const activeCount = rules.filter((r) => !rulePaused(r, pauses)).length;

  async function togglePause(rule: LoopRule) {
    const paused = rulePaused(rule, pauses);
    setBusy(rule.name);
    try {
      if (paused) {
        await loopApi.resumeRule(rule.name);
        loopToast(`规则已恢复：${rule.name}`);
      } else {
        await loopApi.pauseRule(rule.name, '从规则页暂停');
        loopToast(`规则已暂停：${rule.name}`);
      }
      await revalidateLoop();
    } catch {
      /* api-client 已统一 toast */
    } finally {
      setBusy(null);
    }
  }

  async function runNow(rule: LoopRule) {
    setBusy(rule.name);
    try {
      const res = await loopApi.runRule(rule.name);
      loopToast(`已派出轮次：${res.run}`);
      await revalidateLoop();
    } catch {
      /* api-client 已统一 toast */
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        crumb={META.crumb}
        title={META.title}
        badge={META.badge}
        sync={isValidating ? 'syncing' : 'ok'}
        actions={
          <button className="run-btn" onClick={() => setOpen(true)}>
            <Icon name="i-play" size={13} />
            新建规则
          </button>
        }
      />

      <RulePreview rules={rules} />

      <div className="card">
        <div className="card-head">
          <b>规则列表</b>
          <span className="sub">
            {q ? `搜索「${q}」· 命中 ${rows.length} 条` : `共 ${rows.length} 条 · 来自 GET /api/loop/state`}
          </span>
          <span className="head-right">
            <span className="sub">启用 {activeCount} · 暂停 {rows.length - activeCount}</span>
          </span>
        </div>

        {!state && !rows.length ? (
          <LoadingRows rows={4} />
        ) : rows.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>规则</th>
                  <th>状态</th>
                  <th>触发 when</th>
                  <th>交给 to</th>
                  <th>目录 cwd</th>
                  <th>通知</th>
                  <th>分组</th>
                  <th style={{ textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const paused = rulePaused(r, pauses);
                  return (
                    <tr key={r.name}>
                      <td className="tbl-first" data-label="">
                        <div className="tbl-name">{r.name}</div>
                        <div className="tbl-sub">{r.skill ?? r.title ?? '事件驱动规则'}</div>
                      </td>
                      <td data-label="状态">
                        <Chip tone={paused ? 'mute' : 'ok'}>{paused ? '已暂停' : '启用中'}</Chip>
                      </td>
                      <td className="tbl-sub" data-label="触发">{whenText(r.when)}</td>
                      <td className="tbl-num" data-label="交给">{r.to}</td>
                      <td className="tbl-sub" data-label="目录">{r.cwd}</td>
                      <td className="tbl-sub" data-label="通知">{tellText(r.tell)}</td>
                      <td className="tbl-sub" data-label="分组">{r.group}</td>
                      <td className="tbl-full" data-label="">
                        <div className="tbl-actions">
                          <button
                            className="icon-btn"
                            title={paused ? '恢复规则' : '暂停规则'}
                            aria-label={paused ? '恢复规则' : '暂停规则'}
                            disabled={busy === r.name}
                            onClick={() => void togglePause(r)}
                          >
                            <Icon name="i-refresh" size={15} />
                          </button>
                          <button
                            className="icon-btn"
                            title="立即运行一轮"
                            aria-label="立即运行一轮"
                            disabled={busy === r.name || paused}
                            onClick={() => void runNow(r)}
                          >
                            <Icon name="i-play" size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-tip">
            暂无规则{q ? `匹配「${q}」` : ''}，点击右上角「新建规则」登记第一条
          </div>
        )}
      </div>

      <WorkflowFormModal open={open} onClose={() => setOpen(false)} defaultMode="rule" />
    </>
  );
}
