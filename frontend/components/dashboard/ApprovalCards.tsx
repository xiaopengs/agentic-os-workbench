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
 * 闭环：演示按钮接入事件并交「带 ask 的回执」→ 产出 open 卡片（挂起期间不派新
 * Run、不消耗 Token）→ 点选项 answer → 内核产 card.answered + 新 run.queued 接原
 * 事项续跑 → 卡片转 decided/done，事实日志与 Recent Runs 同步可见。
 */

/** 演示用 ask 载荷：一次真实的「Agent 完成分析，请求拍板」 */
const DEMO_ASK = {
  title: '是否合并这条修复？',
  text: 'Agent 已完成 repo#128 的排查并提交修复分支，等待你确认下一步。',
  options: ['合并到 main', '先放着，稍后再看', '关闭不处理'],
  recommend: 0,
};

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

  /** 演示：走真实 API 造出一张待拍板卡片（ask → open，挂起零消耗） */
  async function demo() {
    setBusy(true);
    try {
      let st = await loopApi.state();
      let run = (st.runs ?? []).find((r) => r.state === 'queued' || r.state === 'claimed');
      if (!run) {
        const ev = await loopApi.postEvent({
          id: `demo_ask_${Date.now()}`, source: 'github', type: 'issues.opened',
          subject: 'repo#128', summary: '需要拍板的示例事项',
        });
        if (!ev.routed.length) {
          loopToast('未命中规则，请先在规则页运行一条规则');
          return;
        }
        st = await loopApi.state();
        run = (st.runs ?? []).find((r) => r.state === 'queued' || r.state === 'claimed');
      }
      if (!run) {
        loopToast('没有可交回执的轮次');
        return;
      }
      await loopApi.resultRun(run.id, {
        outcome: 'done', summary: 'Agent 完成分析，请求拍板', ask: [DEMO_ASK],
      });
      await revalidateLoop();
      loopToast('已生成待拍板卡片 · 挂起期间不派新轮次、不消耗 Token');
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
          <button className="run-btn" onClick={demo} disabled={busy} style={{ minHeight: 44 }} aria-label="演示一次 Agent 请求拍板">
            <Icon name="i-bell" size={13} />
            {busy ? '处理中…' : '演示一次拍板'}
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
          暂无待拍板卡片 · 点击「演示一次拍板」即可看到 事件 → 派活 → 请求拍板 → 挂起 → 回答续跑 的完整闭环
        </div>
      )}
    </div>
  );
}

export default ApprovalCards;
