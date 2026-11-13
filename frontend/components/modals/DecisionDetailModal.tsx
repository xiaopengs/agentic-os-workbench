'use client';

/**
 * DecisionDetailModal · ADR 详情（MADR 分节）+ 方案对比评分 + 状态流转 + D1 转执行
 *
 * 视觉零新增 CSS：Modal + .card-head / .tbl / .chip / .wf-form / .rel-* / .run-btn /
 * .primary-btn / .mini-head / .count-pill / .rel-check 全部复用既有语义类。
 * 评分条形用内联 SVG/ div.wf-bar，不引图表库。
 *
 * 单向调用链：所有写操作 → await decisionApi.* → revalidateDecisions() → SWR 重拉，
 * 渲染函数之间互不调用（铁律 9）。
 */
import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { Chip } from '@/components/ui/WorkflowBits';
import { Modal } from '@/components/modals/Modal';
import { decisionApi, decisionToast } from '@/lib/decision-api';
import { useDecisionMutate } from '@/lib/decision-hooks';
import { useLoopMutate } from '@/lib/loop-hooks';
import { loopApi } from '@/lib/loop-api';
import {
  DECISION_STATUS_META, shortDate, transitionLabel,
} from '@/lib/decision-format';
import { DECISION_TRANSITIONS } from '@/lib/decision-types';
import type {
  Decision, DecisionCriterion, DecisionStatus, DecisionScoreResp, DecisionToRuleResp,
} from '@/lib/decision-types';

function Section({ title, icon, children }: { title: string; icon: 'i-doc' | 'i-target' | 'i-cube' | 'i-check' | 'i-warn' | 'i-list'; children: React.ReactNode }) {
  return (
    <div className="card" style={{ boxShadow: 'none', border: '1px solid var(--border)', marginBottom: 12, padding: 14 }}>
      <div className="mini-head"><Icon name={icon} /><b>{title}</b></div>
      {children}
    </div>
  );
}

function Bullets({ items, tone = 'ok' }: { items: string[]; tone?: 'ok' | 'warn' | 'err' | 'mute' }) {
  if (!items?.length) return <div className="tbl-sub">—</div>;
  const icon: 'i-check' | 'i-warn' | 'i-x' | 'i-chev-r' =
    tone === 'ok' ? 'i-check' : tone === 'warn' ? 'i-warn' : tone === 'err' ? 'i-x' : 'i-chev-r';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map((t, i) => (
        <div className={`rel-check${tone === 'mute' ? ' muted' : ''}`} key={i}>
          <Icon name={icon} size={13} />
          <span>{t}</span>
        </div>
      ))}
    </div>
  );
}

/** 方案对比矩阵：可调权重，实时重排；条形用内联 div.wf-bar（零依赖） */
function ScoreMatrix({
  decision, score, weights, onWeight, busy,
}: {
  decision: Decision;
  score: DecisionScoreResp | null;
  weights: Record<string, number>;
  onWeight: (id: string, w: number) => void;
  busy: boolean;
}) {
  const criteria: DecisionCriterion[] = decision.criteria ?? [];
  const scores = score?.scores ?? [];
  const byId = (id: string) => decision.options?.find((o) => o.id === id);
  const maxScore = 5;
  return (
    <div>
      {/* 权重调节：桌面表格 / 窄屏卡片化（复用 .tbl-wrap + data-label） */}
      {criteria.length ? (
        <div className="tbl-wrap" style={{ marginBottom: 12 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>评估维度</th>
                <th>权重（可调）</th>
                <th>归一化占比</th>
              </tr>
            </thead>
            <tbody>
              {criteria.map((c) => {
                const w = weights[c.id] ?? c.weight;
                const total = criteria.reduce((s, x) => s + (weights[x.id] ?? x.weight), 0) || 1;
                return (
                  <tr key={c.id}>
                    <td className="tbl-first" data-label="维度"><div className="tbl-name">{c.name}</div></td>
                    <td data-label="权重">
                      <input
                        type="number" min={0} max={100} step={5}
                        value={w}
                        onChange={(e) => onWeight(c.id, Number(e.target.value))}
                        aria-label={`${c.name} 权重`}
                        style={{ width: 90, padding: '8px 10px', fontSize: 16, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)' }}
                      />
                    </td>
                    <td data-label="占比"><span className="tbl-num">{Math.round((w / total) * 100)}%</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* 排名：内联条形，不引图表库 */}
      {scores.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {scores.map((s) => {
            const o = byId(s.id);
            const pct = Math.max(0, Math.min(100, (s.score / maxScore) * 100));
            return (
              <div key={s.id} data-scored-option={s.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, marginBottom: 3 }}>
                  <Chip tone={s.rank === 1 ? 'ok' : 'mute'}>#{s.rank}</Chip>
                  <b>{s.name}</b>
                  {decision.chosenOptionId === s.id ? <Chip tone="info">已选</Chip> : null}
                  <span style={{ marginLeft: 'auto', fontWeight: 700 }}>{s.score.toFixed(2)}</span>
                </div>
                <div className="wf-bar"><i style={{ width: `${pct}%` }} /></div>
                {o ? (
                  <div className="tbl-sub" style={{ fontSize: 11.5, marginTop: 4 }}>
                    得：{o.pros?.join('、') || '—'} · 失：{o.cons?.join('、') || '—'} · 假设：{o.assumptions?.join('、') || '—'}
                  </div>
                ) : null}
              </div>
            );
          })}
          {busy ? <div className="tbl-sub">重算中…</div> : null}
        </div>
      ) : (
        <div className="tbl-sub">暂无候选方案评分（可在详情里补充方案后重新计算）</div>
      )}
    </div>
  );
}

export function DecisionDetailModal({
  decision, onClose, onRefresh,
}: {
  decision: Decision | null;
  onClose: () => void;
  onRefresh: () => Promise<unknown>;
}) {
  const { revalidateDecisions } = useDecisionMutate();
  const { revalidateLoop } = useLoopMutate();
  const [busy, setBusy] = useState<string | null>(null);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [score, setScore] = useState<DecisionScoreResp | null>(null);
  const [rulePreview, setRulePreview] = useState<DecisionToRuleResp | null>(null);

  const d = decision;

  // 打开/切换决策时重置本地状态并重算评分
  useEffect(() => {
    setWeights({});
    setScore(null);
    setRulePreview(null);
    if (!d) return;
    let alive = true;
    decisionApi.score(d.id).then((res) => { if (alive) setScore(res); }).catch(() => {});
    return () => { alive = false; };
  }, [d?.id]);

  async function recompute(nextWeights: Record<string, number>) {
    if (!d) return;
    setBusy('score');
    try {
      const keys = Object.keys(nextWeights);
      const res = await decisionApi.score(d.id, keys.length ? nextWeights : undefined);
      setScore(res);
    } catch { /* api-client 已 toast */ }
    finally { setBusy(null); }
  }

  function onWeight(id: string, w: number) {
    const next = { ...weights, [id]: Math.max(0, Math.min(100, w)) };
    setWeights(next);
    void recompute(next);
  }

  async function transition(to: DecisionStatus) {
    if (!d) return;
    setBusy(`to-${to}`);
    try {
      await decisionApi.review(d.id, to);
      decisionToast(`决策已流转：${DECISION_STATUS_META[to].label}`);
      await onRefresh();
      await revalidateDecisions();
      onClose();
    } catch { /* api-client 已 toast */ }
    finally { setBusy(null); }
  }

  /** D1：先拿草案校验 → 展示预览 → 用户确认后落库到 loop 规则 */
  async function prepareRule() {
    if (!d) return;
    setBusy('rule');
    try {
      const res = await decisionApi.toRule(d.id);
      setRulePreview(res);
      if (!res.valid) decisionToast(`规则草案校验未通过：${res.issues[0] ?? '请检查'}`);
    } catch { /* api-client 已 toast */ }
    finally { setBusy(null); }
  }

  async function commitRule() {
    if (!d || !rulePreview?.valid) return;
    setBusy('rule-commit');
    try {
      // 复用 M4 的规则端点：先校验、再落库（写 loop 事实日志，决策模块本身不写）
      const check = await loopApi.checkRule(rulePreview.draft as unknown as Parameters<typeof loopApi.checkRule>[0]);
      if (!check.valid) { decisionToast(`规则校验未通过：${check.issues[0] ?? ''}`); return; }
      await loopApi.postRule(rulePreview.draft as unknown as Parameters<typeof loopApi.postRule>[0]);
      decisionToast(`已生成执行规则：${rulePreview.draft.name}`);
      await revalidateLoop();
      await revalidateDecisions();
      onClose();
    } catch { /* api-client 已 toast */ }
    finally { setBusy(null); }
  }

  if (!d) return null;
  const meta = DECISION_STATUS_META[d.status];
  const nextStates: readonly DecisionStatus[] = DECISION_TRANSITIONS[d.status] ?? [];

  return (
    <Modal open={!!d} title={`${d.id} · ${d.title}`} onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <Chip tone={meta.chip}>{meta.label}</Chip>
        <span className="tbl-sub">负责人 {d.owner} · 建于 {shortDate(d.createdAt)}</span>
        {d.reviewAt ? <Chip tone={d.reviewDue ? 'warn' : 'mute'}>复核 {shortDate(d.reviewAt)}{d.reviewDue ? ' · 已到期' : ''}</Chip> : null}
        {d.tags?.map((t) => <Chip key={t} tone="mute">{t}</Chip>)}
      </div>

      <Section title="Context · 背景" icon="i-doc">
        <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{d.context || '—'}</div>
      </Section>

      <Section title="Decision Drivers · 决策驱动" icon="i-target">
        <Bullets items={d.drivers ?? []} tone="ok" />
      </Section>

      <Section title="Considered Options · 方案对比与加权评分" icon="i-cube">
        <ScoreMatrix decision={d} score={score} weights={weights} onWeight={onWeight} busy={busy === 'score'} />
        {score && score.scores.length > 1 ? (
          <div className="tbl-sub" style={{ marginTop: 8 }}>
            头名领先 {score.gap.toFixed(2)} 分 · 调整权重可检验结论是否稳健（只读预演，不改数据）
          </div>
        ) : null}
      </Section>

      <Section title="Decision · 结论" icon="i-check">
        <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{d.decision || '—（评审中，尚未定论）'}</div>
        {d.chosenOptionId ? (
          <div className="tbl-sub" style={{ marginTop: 6 }}>
            选定方案：{d.options?.find((o) => o.id === d.chosenOptionId)?.name ?? d.chosenOptionId}
          </div>
        ) : null}
      </Section>

      <Section title="Consequences · 后果" icon="i-warn">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
          <div><div className="tbl-sub">正面</div><Bullets items={d.consequences?.positive ?? []} tone="ok" /></div>
          <div><div className="tbl-sub">负面</div><Bullets items={d.consequences?.negative ?? []} tone="warn" /></div>
          <div><div className="tbl-sub">风险</div><Bullets items={d.consequences?.risks ?? []} tone="err" /></div>
        </div>
      </Section>

      {d.confirmation ? (
        <Section title="Confirmation · 验证方式" icon="i-check">
          <div style={{ fontSize: 13 }}>{d.confirmation}</div>
        </Section>
      ) : null}

      {d.history?.length ? (
        <Section title="变更留痕" icon="i-list">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {[...d.history].reverse().slice(0, 6).map((h, i) => (
              <div className="rel-check" key={i}>
                <Icon name="i-chev-r" size={12} />
                <span>{shortDate(h.at)} · {h.action}{h.from ? ` ${h.from}→${h.to}` : ''}{h.note ? ` · ${h.note}` : ''}</span>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {/* 状态流转 + D1 转执行 */}
      <div className="row-actions" style={{ marginTop: 6 }}>
        {nextStates.map((to) => (
          <button
            key={to}
            className="run-btn"
            disabled={busy !== null}
            onClick={() => void transition(to)}
            style={{ minHeight: 44 }}
            aria-label={transitionLabel(d.status, to)}
          >
            <Icon name={DECISION_STATUS_META[to].icon} size={13} />
            {transitionLabel(d.status, to)}
          </button>
        ))}
        {d.status === 'accepted' ? (
          <button className="run-btn" disabled={busy !== null} onClick={() => void prepareRule()} style={{ minHeight: 44 }}>
            <Icon name="i-arrow-r" size={13} />
            生成执行规则
          </button>
        ) : null}
        <button
          className="run-btn"
          disabled={busy !== null}
          onClick={() => { void (async () => { setBusy('del'); try { await decisionApi.remove(d.id); decisionToast(`已删除 ${d.id}`); await revalidateDecisions(); onClose(); } catch { /* toast */ } finally { setBusy(null); } })(); }}
          style={{ minHeight: 44, marginLeft: 'auto' }}
          aria-label={`删除决策 ${d.id}`}
        >
          <Icon name="i-x" size={13} />
          删除
        </button>
      </div>

      {/* D1 规则草案预览 + 确认落库 */}
      {rulePreview ? (
        <div className="card" style={{ boxShadow: 'none', border: '1px solid var(--border)', marginTop: 12, padding: 14 }}>
          <div className="mini-head"><Icon name="i-arrow-r" /><b>决策 → 执行规则草案</b></div>
          <div className="tbl-sub" style={{ marginBottom: 8 }}>
            校验 {rulePreview.valid ? '通过' : '未通过'} · 落库将写入 autoloop 事实日志（可在规则页查看）
          </div>
          {!rulePreview.valid ? (
            <Bullets items={rulePreview.issues} tone="err" />
          ) : (
            <>
              <div className="tbl-wrap">
                <table className="tbl">
                  <tbody>
                    <tr><td data-label="字段" className="tbl-first"><div className="tbl-name">规则名</div></td><td data-label="值" className="tbl-sub">{rulePreview.draft.name}</td></tr>
                    <tr><td data-label="字段" className="tbl-first"><div className="tbl-name">触发</div></td><td data-label="值" className="tbl-sub">{rulePreview.draft.when.source} / {rulePreview.draft.when.types.join(', ')}</td></tr>
                    <tr><td data-label="字段" className="tbl-first"><div className="tbl-name">交给</div></td><td data-label="值" className="tbl-sub">{rulePreview.draft.to}</td></tr>
                    <tr><td data-label="字段" className="tbl-first"><div className="tbl-name">分组</div></td><td data-label="值" className="tbl-sub">{rulePreview.draft.group}</td></tr>
                  </tbody>
                </table>
              </div>
              <button className="primary-btn" disabled={busy !== null} onClick={() => void commitRule()} style={{ minHeight: 46 }}>
                {busy === 'rule-commit' ? '正在落库…' : '确认生成规则（写入 autoloop）'}
              </button>
            </>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
