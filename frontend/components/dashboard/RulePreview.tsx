'use client';

/**
 * RulePreview · M4「规则校验 / 预演」面板
 *
 * 复用既有 `.card/.card-head/.wf-form/.primary-btn/.chip/.tbl-sub` 视觉，零新增 CSS。
 *  - 预演 emit：输入一条事件，展示会命中哪些规则 / 是否会熔断 / 是否重复，**不落库**；
 *  - 校验 check：对当前规则集做一次静态校验，展示 valid / issues。
 * 单向调用链：表单提交 → 调 API → 只更新本组件 state；不触发任何其它渲染函数。
 */
import { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { loopApi } from '@/lib/loop-api';
import type { LoopEmitResp, LoopRule, LoopRuleCheckResp } from '@/lib/loop-types';

const TEMPLATES = [
  { value: 'issue', label: 'GitHub Issue', source: 'github', type: 'issues.opened', subject: 'repo#128' },
  { value: 'alert', label: '线上报错', source: 'shop', type: 'alert.cpu', subject: 'svc.payment' },
  { value: 'site', label: '网站巡检', source: 'shop', type: 'site.check', subject: 'homepage' },
  { value: 'custom', label: '自定义', source: 'manual', type: 'note.created', subject: '' },
];

export function RulePreview({ rules }: { rules: LoopRule[] }) {
  const [tpl, setTpl] = useState('issue');
  const [source, setSource] = useState('github');
  const [type, setType] = useState('issues.opened');
  const [subject, setSubject] = useState('repo#128');
  const [result, setResult] = useState<LoopEmitResp | null>(null);
  const [check, setCheck] = useState<LoopRuleCheckResp | null>(null);
  const [busy, setBusy] = useState<'emit' | 'check' | null>(null);
  const [error, setError] = useState('');

  function applyTemplate(key: string) {
    const t = TEMPLATES.find((x) => x.value === key);
    if (!t) return;
    setTpl(key); setSource(t.source); setType(t.type); setSubject(t.subject);
    setResult(null); setError('');
  }

  async function preview(e: React.FormEvent) {
    e.preventDefault();
    if (!source.trim() || !type.trim()) { setError('请填写来源与类型'); return; }
    setBusy('emit'); setError(''); setResult(null);
    try {
      const res = await loopApi.emit({
        id: `preview_${Date.now().toString(36)}`,
        source: source.trim(), type: type.trim(),
        subject: subject.trim() || undefined,
      });
      setResult(res);
    } catch {
      setError('预演失败，请检查输入');
    } finally {
      setBusy(null);
    }
  }

  async function validate() {
    setBusy('check'); setError(''); setCheck(null);
    try {
      const fallback: LoopRule = {
        name: '示例规则', when: { source: 'github', types: ['issues.*'] },
        to: 'claude', cwd: '~/x', group: 'g', tell: 'needed',
      };
      const res = await loopApi.checkRule(rules.length ? rules : fallback);
      setCheck(res);
    } catch {
      setError('校验失败');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="card-head">
        <b>规则预演 · Dry Run</b>
        <span className="sub">只读演算，不写事实日志 · check 校验 / emit 预演</span>
        <span className="head-right">
          <button className="run-btn" onClick={() => void validate()} disabled={busy !== null}>
            <Icon name="i-shield" size={13} />
            {busy === 'check' ? '校验中…' : '校验规则集'}
          </button>
        </span>
      </div>

      <form className="wf-form" onSubmit={(e) => void preview(e)}>
        <label htmlFor="pvTpl">事件模板</label>
        <select id="pvTpl" value={tpl} onChange={(e) => applyTemplate(e.target.value)}>
          {TEMPLATES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>

        <div className="form-row">
          <div>
            <label htmlFor="pvSrc">来源 source</label>
            <input id="pvSrc" value={source} onChange={(e) => setSource(e.target.value)} placeholder="github" />
          </div>
          <div>
            <label htmlFor="pvType">类型 type</label>
            <input id="pvType" value={type} onChange={(e) => setType(e.target.value)} placeholder="issues.opened" />
          </div>
        </div>

        <label htmlFor="pvSubject">事项 subject（可选）</label>
        <input id="pvSubject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="repo#128" />

        <button className="primary-btn" type="submit" disabled={busy !== null}>
          {busy === 'emit' ? '正在预演…' : '预演这条事件（不落库）'}
        </button>
      </form>

      {/* 结果区：复用 .chip / .tbl-sub，零新增样式 */}
      {error && <div className="tbl-sub" style={{ color: 'var(--red)', marginTop: 10 }}>{error}</div>}

      {result && (
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span className={`chip ${result.matched.length ? 'ok' : 'mute'}`}>
            命中 {result.matched.length} 条规则
          </span>
          {result.matched.map((m) => <span className="chip info" key={m}>{m}</span>)}
          {result.wouldBlock && <span className="chip warn">跳数熔断</span>}
          {result.duplicate && <span className="chip mute">重复事件（已去重）</span>}
          {!result.matched.length && !result.wouldBlock && !result.duplicate && (
            <span className="tbl-sub">未命中任何规则 · 事件仅会被记录</span>
          )}
        </div>
      )}

      {check && (
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span className={`chip ${check.valid ? 'ok' : 'err'}`}>
            <Icon name={check.valid ? 'i-check' : 'i-warn'} size={11} />
            {check.valid ? '规则集校验通过' : `校验未通过 · ${check.issues.length} 项`}
          </span>
          {!check.valid && check.issues.slice(0, 3).map((issue, i) => (
            <span className="tbl-sub" key={i}>{issue}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default RulePreview;
