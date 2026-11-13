'use client';

/**
 * DecisionFormModal · 新建 ADR（A1+A2 MADR 结构 + B3 权衡显式化）
 *
 * 复用既有 Modal + .wf-form / .form-row / .primary-btn / .tbl / .chip，零新增 CSS。
 * MVP 只做「记录 + 对比」：标题/背景/驱动/维度权重/候选方案（含得·失·假设）/结论/复核日。
 * 协作评审（C1）、AI 起草（D4）、导出（F1）留后续期。
 */
import { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { Modal } from '@/components/modals/Modal';
import { decisionApi, decisionToast } from '@/lib/decision-api';
import { useDecisionMutate } from '@/lib/decision-hooks';
import type { DecisionCriterion, DecisionInput, DecisionOption } from '@/lib/decision-types';

interface CriterionDraft { id: string; name: string; weight: number }
interface OptionDraft {
  id: string; name: string; summary: string;
  scores: Record<string, number>;
  pros: string; cons: string; assumptions: string;
}

function blankCriterion(i: number): CriterionDraft {
  return { id: `c${i}`, name: '', weight: 50 };
}
function blankOption(i: number): OptionDraft {
  return { id: `o${i}`, name: '', summary: '', scores: {}, pros: '', cons: '', assumptions: '' };
}

function csv(v: string): string[] {
  return v.split(/[，,、\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
}

export function DecisionFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { revalidateDecisions } = useDecisionMutate();
  const [title, setTitle] = useState('');
  const [context, setContext] = useState('');
  const [owner, setOwner] = useState('');
  const [drivers, setDrivers] = useState('');
  const [decisionText, setDecisionText] = useState('');
  const [reviewAt, setReviewAt] = useState('');
  const [criteria, setCriteria] = useState<CriterionDraft[]>([
    { id: 'perf', name: '性能', weight: 40 },
    { id: 'maint', name: '可维护性', weight: 35 },
    { id: 'cost', name: '成本', weight: 25 },
  ]);
  const [options, setOptions] = useState<OptionDraft[]>([
    blankOption(1), blankOption(2),
  ]);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setTitle(''); setContext(''); setOwner(''); setDrivers(''); setDecisionText(''); setReviewAt('');
    setCriteria([
      { id: 'perf', name: '性能', weight: 40 },
      { id: 'maint', name: '可维护性', weight: 35 },
      { id: 'cost', name: '成本', weight: 25 },
    ]);
    setOptions([blankOption(1), blankOption(2)]);
  }

  function setCrit(i: number, patch: Partial<CriterionDraft>) {
    setCriteria((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }
  function setOpt(i: number, patch: Partial<OptionDraft>) {
    setOptions((prev) => prev.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  }
  function setScore(i: number, cid: string, value: number) {
    setOptions((prev) => prev.map((o, j) =>
      (j === i ? { ...o, scores: { ...o.scores, [cid]: value } } : o)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !owner.trim()) { decisionToast('请填写决策标题与负责人'); return; }
    const cs: DecisionCriterion[] = criteria
      .filter((c) => c.name.trim())
      .map((c) => ({ id: c.id, name: c.name.trim(), weight: Math.max(0, Math.min(100, Number(c.weight) || 0)) }));
    const os: DecisionOption[] = options
      .filter((o) => o.name.trim())
      .map((o) => ({
        id: o.id, name: o.name.trim(), summary: o.summary.trim(),
        scores: Object.fromEntries(cs.filter((c) => o.scores[c.id] !== undefined).map((c) => [c.id, o.scores[c.id]])),
        pros: csv(o.pros), cons: csv(o.cons), assumptions: csv(o.assumptions),
      }));
    const input: DecisionInput = {
      title: title.trim(), context: context.trim(), owner: owner.trim(),
      drivers: csv(drivers), criteria: cs, options: os,
      decision: decisionText.trim(),
      chosenOptionId: os.length ? os[0].id : undefined,
      consequences: { positive: [], negative: [], risks: [] },
      ...(reviewAt ? { reviewAt } : {}),
    };
    setSubmitting(true);
    try {
      const created = await decisionApi.create(input);
      decisionToast(`已创建决策 ${created.id}`);
      reset();
      onClose();
      await revalidateDecisions();
    } catch { /* api-client 已统一 toast */ }
    finally { setSubmitting(false); }
  }

  return (
    <Modal open={open} title="新建架构决策 · ADR" onClose={onClose}>
      <form className="wf-form" onSubmit={(e) => void submit(e)}>
        <label htmlFor="dTitle">决策标题 *</label>
        <input id="dTitle" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如 选择前端状态管理方案" />

        <label htmlFor="dOwner">负责人 *</label>
        <input id="dOwner" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="如 架构组" />

        <label htmlFor="dContext">Context · 背景与问题</label>
        <textarea id="dContext" value={context} onChange={(e) => setContext(e.target.value)} rows={3}
          placeholder="为什么要做这个决策"
          style={{ width: '100%', background: 'var(--bg)', border: '1px solid transparent', borderRadius: 10, padding: '11px 13px', fontSize: 16, fontFamily: 'inherit' }} />

        <label htmlFor="dDrivers">Decision Drivers · 决策驱动（逗号分隔）</label>
        <input id="dDrivers" value={drivers} onChange={(e) => setDrivers(e.target.value)} placeholder="包体积, 可调试性, 团队熟悉度" />

        {/* 评估维度 + 权重 */}
        <label>Considered Options · 评估维度与权重（0–100）</label>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>维度</th><th>标识</th><th>权重</th><th>操作</th></tr></thead>
            <tbody>
              {criteria.map((c, i) => (
                <tr key={i}>
                  <td className="tbl-first" data-label="维度">
                    <input value={c.name} onChange={(e) => setCrit(i, { name: e.target.value })}
                      placeholder="维度名" aria-label={`维度${i + 1} 名称`}
                      style={{ width: '100%', padding: '8px 10px', fontSize: 16, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)' }} />
                  </td>
                  <td data-label="标识" className="tbl-num">{c.id}</td>
                  <td data-label="权重">
                    <input type="number" min={0} max={100} step={5} value={c.weight}
                      onChange={(e) => setCrit(i, { weight: Number(e.target.value) })}
                      aria-label={`${c.name || '维度'} 权重`}
                      style={{ width: 84, padding: '8px 10px', fontSize: 16, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)' }} />
                  </td>
                  <td data-label="操作">
                    {criteria.length > 1 ? (
                      <button type="button" className="icon-btn" aria-label={`删除维度 ${c.name || i + 1}`}
                        onClick={() => setCriteria((p) => p.filter((_, j) => j !== i))} style={{ minHeight: 44, minWidth: 44 }}>
                        <Icon name="i-x" size={14} />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="run-btn" style={{ minHeight: 44, marginTop: 8 }}
          onClick={() => setCriteria((p) => [...p, blankCriterion(p.length + 1)])}>
          <Icon name="i-bolt" size={13} /> 添加维度
        </button>

        {/* 候选方案 + 权衡显式化 */}
        <label>候选方案 · 评分 1–5 + 得/失/假设（B3 强制）</label>
        {options.map((o, i) => (
          <div className="card" key={i} style={{ boxShadow: 'none', border: '1px solid var(--border)', padding: 12, marginBottom: 10 }}>
            <div className="form-row">
              <div>
                <label htmlFor={`oName${i}`}>方案 {i + 1} 名称</label>
                <input id={`oName${i}`} value={o.name} onChange={(e) => setOpt(i, { name: e.target.value })} placeholder="如 Zustand" />
              </div>
              <div>
                <label htmlFor={`oSum${i}`}>一句话摘要</label>
                <input id={`oSum${i}`} value={o.summary} onChange={(e) => setOpt(i, { summary: e.target.value })} placeholder="轻量状态库" />
              </div>
            </div>
            <div className="wf-meta" style={{ gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
              {criteria.filter((c) => c.name.trim()).map((c) => (
                <label key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, margin: 0 }}>
                  {c.name}
                  <input type="number" min={1} max={5} step={1} value={o.scores[c.id] ?? ''}
                    onChange={(e) => setScore(i, c.id, Number(e.target.value))}
                    aria-label={`${o.name || `方案${i + 1}`} 在 ${c.name} 的评分`}
                    style={{ width: 58, padding: '7px 8px', fontSize: 16, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)' }} />
                </label>
              ))}
            </div>
            <label htmlFor={`oPros${i}`}>得到什么（必填）</label>
            <input id={`oPros${i}`} value={o.pros} onChange={(e) => setOpt(i, { pros: e.target.value })} placeholder="部署简单, 无跨域" />
            <label htmlFor={`oCons${i}`}>失去什么（必填）</label>
            <input id={`oCons${i}`} value={o.cons} onChange={(e) => setOpt(i, { cons: e.target.value })} placeholder="进程耦合" />
            <label htmlFor={`oAsm${i}`}>前提假设（必填）</label>
            <input id={`oAsm${i}`} value={o.assumptions} onChange={(e) => setOpt(i, { assumptions: e.target.value })} placeholder="单机部署" />
            {options.length > 1 ? (
              <button type="button" className="icon-btn" aria-label={`删除方案 ${o.name || i + 1}`}
                onClick={() => setOptions((p) => p.filter((_, j) => j !== i))} style={{ minHeight: 44, minWidth: 44, marginTop: 8 }}>
                <Icon name="i-x" size={14} /> 删除该方案
              </button>
            ) : null}
          </div>
        ))}
        <button type="button" className="run-btn" style={{ minHeight: 44 }}
          onClick={() => setOptions((p) => [...p, blankOption(p.length + 1)])}>
          <Icon name="i-bolt" size={13} /> 添加候选方案
        </button>

        <label htmlFor="dDecision">Decision · 结论（可先留空，评审后补）</label>
        <input id="dDecision" value={decisionText} onChange={(e) => setDecisionText(e.target.value)} placeholder="如 采用 Zustand" />

        <label htmlFor="dReview">到期复核日（可选，到期进「今天要处理」）</label>
        <input id="dReview" type="date" value={reviewAt} onChange={(e) => setReviewAt(e.target.value)} />

        <button className="primary-btn" type="submit" disabled={submitting} style={{ minHeight: 46 }}>
          {submitting ? '正在创建…' : '创建决策（draft）'}
        </button>
      </form>
    </Modal>
  );
}
