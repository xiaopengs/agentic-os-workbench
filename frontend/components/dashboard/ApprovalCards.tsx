'use client';

import { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { loopApi, loopToast } from '@/lib/loop-api';
import { useLoopMutate } from '@/lib/loop-hooks';
import { cardKindText } from '@/lib/loop-format';
import type { LoopCard } from '@/lib/loop-types';

/**
 * 审批卡片台 · M3（挂起零消耗的可视化闭环）
 *
 * 视觉全部复用既有语义类（.card / .card-head / .wf-card / .wf-head / .wf-ico /
 * .wf-status / .wf-meta / .chip / .run-btn / .empty-tip），零新增 CSS、零新图标。
 *
 * 数据流严格单向：用户点选项/演示 → 调真实 /loop/* API 写事实 → revalidateLoop()
 * 统一失效 → SWR 各自重渲染（不在渲染函数里互调，符合内核 DAG 约束）。
 *
 * 闭环：按钮接入一条示例事件后【交给真实 Agent 执行器】领走这一轮，Agent 读资料、
 * 自己判断是否需要拍板并产出 open 卡片（挂起期间不派新 Run、不消耗 Token）→
 * 点选项 answer → 内核产 card.answered + 新 run.queued 接原事项续跑 →
 * 执行器再次真实执行，卡片转 decided/done，事实日志与 Recent Runs 同步可见。
 *
 * M7 改动：不再手工伪造「带 ask 的回执」，整条链路由真实 Agent 驱动。
 */

export function ApprovalCards({
  cards, loading,
}: {
  cards: LoopCard[];
  loading: boolean;
}) {
  const { revalidateLoop } = useLoopMutate();
  const [busy, setBusy] = useState(false);
  // 卡片 id → 回答后续跑出的轮次 id（用于「已处理」卡片展示续跑结果）
  const [resumed, setResumed] = useState<Record<string, string>>({});

  const open = cards.filter((c) => c.state === 'open' && c.kind === 'ask' && c.options.length > 0);
  const handled = cards
    .filter((c) => !(c.state === 'open' && c.kind === 'ask' && c.options.length > 0))
    .slice(-3)
    .reverse();

  /** 真实闭环：接入示例事件 → 交给真实 Agent 执行器跑完这一轮 → 由 Agent 决定是否请求拍板 */
  async function demo() {
    setBusy(true);
    try {
      const ev = await loopApi.postEvent({
        id: `real_ask_${Date.now()}`, source: 'github', type: 'issues.opened',
        subject: '中文事项 · 登录页报错排查',
        summary: '用户反馈登录页偶发 500，需要判断优先级并给出处理建议；如涉及删数据/重启服务请请求人工拍板。',
      });
      if (!ev.routed.length) {
        loopToast('未命中规则，请先在规则页运行一条规则');
        return;
      }
      const res = await loopApi.workerRun();
      await revalidateLoop();
      if (res.busy) {
        loopToast('已有 Agent 正在执行，稍候刷新即可看到回执（执行器串行工作）');
      } else if (res.executed > 0) {
        const j = res.jobs[res.jobs.length - 1];
        loopToast(j?.real
          ? `真实 Agent 已执行本轮（${j?.outcome ?? j?.status}）· 若需拍板会自动生成卡片`
          : '本轮已执行');
      } else {
        loopToast('事件已入队 · 执行器正在自动领取，稍候刷新即可看到 Agent 回执');
      }
    } catch {
      /* api-client 已统一 toast */
    } finally {
      setBusy(false);
    }
  }

  /** 拍板：answer → 内核自动续跑一轮，写回事实日志 */
  async function answer(card: LoopCard, choice: number) {
    setBusy(true);
    try {
      const res = await loopApi.answerCard(card.id, { choice });
      if (res.resumedRun) setResumed((prev) => ({ ...prev, [card.id]: res.resumedRun as string }));
      await revalidateLoop();
      loopToast(res.resumedRun
        ? `已拍板「${card.options[choice]}」→ 续跑 ${res.resumedRun}`
        : `已拍板「${card.options[choice]}」`);
    } catch {
      /* api-client 已统一 toast */
    } finally {
      setBusy(false);
    }
  }

  const rows = [...open, ...handled];

  return (
    <div className="card" id="approval" style={{ marginBottom: 18 }}>
      <div className="card-head">
        <b>审批卡片台 · Approval</b>
        <span className="sub">挂起零消耗 · 待拍板期间不派新轮次，回答后才续跑</span>
        <span className="head-right">
          <button className="run-btn" onClick={demo} disabled={busy} style={{ minHeight: 44 }} aria-label="接入事件并让真实 Agent 执行一轮">
            <Icon name="i-bolt" size={13} />
            {busy ? 'Agent 执行中…' : '真实跑一轮'}
          </button>
        </span>
      </div>

      {loading && !rows.length ? (
        <div className="empty-tip">正在加载卡片…</div>
      ) : rows.length ? (
        <div className="wf-grid">
          {open.map((card) => (
            <div className="wf-card" key={card.id}>
              <div className="wf-head">
                <div className="wf-ico g"><Icon name="i-bell" /></div>
                <div style={{ minWidth: 0 }}>
                  <div className="wf-title">{card.title}</div>
                  <div className="wf-cat">{cardKindText(card.kind)} · {card.id}</div>
                </div>
                <span className="wf-status running"><i />待拍板</span>
              </div>

              <div style={{ fontSize: 12.5, color: 'var(--t2)', lineHeight: 1.65 }}>
                {card.text || '—'}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {card.options.map((opt, i) => (
                  <button
                    key={i}
                    className="run-btn"
                    disabled={busy}
                    onClick={() => answer(card, i)}
                    style={i === card.recommend
                      ? { minHeight: 44 }
                      : { minHeight: 44, background: '#f1f4f2', color: 'var(--t2)' }}
                  >
                    {opt}{i === card.recommend ? ' · 推荐' : ''}
                  </button>
                ))}
              </div>

              <div className="wf-meta" style={{ marginTop: 'auto' }}>
                <span>
                  <Icon name="i-bolt" />
                  挂起中 · 0 新轮次 / 0 Token
                </span>
              </div>
            </div>
          ))}

          {handled.map((card) => (
            <div className="wf-card" key={card.id}>
              <div className="wf-head">
                <div className="wf-ico b"><Icon name="i-check" /></div>
                <div style={{ minWidth: 0 }}>
                  <div className="wf-title">{card.title}</div>
                  <div className="wf-cat">{cardKindText(card.kind)} · {card.id}</div>
                </div>
                <span className="wf-status done">
                  <Icon name="i-check" size={11} />
                  {card.state === 'closed' ? '已结案' : '已回答'}
                </span>
              </div>
              <div className="tbl-sub">已选：{card.answer ?? card.text ?? '—'}</div>
              <div className="wf-meta" style={{ marginTop: 'auto' }}>
                <span>
                  <Icon name="i-bolt" />
                  {resumed[card.id] ? `已续跑 ${resumed[card.id]}` : '回答已写入事实日志'}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-tip">
          暂无待拍板卡片 · 点击「真实跑一轮」让 Agent 执行，遇到拿不准的事会自动发卡片找你拍板
        </div>
      )}
    </div>
  );
}

export default ApprovalCards;
