'use client';

import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { loopApi, loopToast } from '@/lib/loop-api';
import { useLoopMutate } from '@/lib/loop-hooks';
import { emitToast } from '@/lib/toast-bus';
import type { LoopEvent, LoopRule, TellMode } from '@/lib/loop-types';

/** 事件模板 · 对应已播种的 4 条规则（source + type 会命中规则派活） */
const EVENT_TEMPLATES: { value: string; label: string; preset: Omit<LoopEvent, 'id'> }[] = [
  { value: 'issue', label: 'GitHub Issue（命中「跟进 GitHub Issue」）', preset: { source: 'github', type: 'issues.opened', subject: 'repo#128', summary: '新 Issue 待自动跟进' } },
  { value: 'alert', label: '线上报错（命中「查线上报错」）', preset: { source: 'shop', type: 'alert.cpu', subject: 'svc.payment', summary: 'CPU 告警待排查' } },
  { value: 'site', label: '网站巡检（命中「网站巡检」）', preset: { source: 'shop', type: 'site.check', subject: 'homepage', summary: '首页可用性巡检' } },
  { value: 'custom', label: '自定义事件', preset: { source: 'manual', type: 'note.created' } },
];

const TELL_OPTIONS: { value: TellMode; label: string }[] = [
  { value: 'needed', label: '按需通知' },
  { value: 'always', label: '总是通知' },
  { value: 'never', label: '不通知' },
];

type Mode = 'event' | 'rule';

function newEventId(): string {
  return `evt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 动作弹窗 · 视觉与原型「运行新工作流」弹窗完全一致（Modal + .wf-form + .form-row + .primary-btn）。
 * 语义换成 Autoloop 的两个写操作：手动接入事件（派活）/ 新建规则。
 * 写成功后只调一个 revalidateLoop() 统一失效，由 SWR 各自重渲染（单向链路，无渲染互调）。
 */
export function WorkflowFormModal({
  open, onClose, defaultMode = 'event',
}: {
  open: boolean;
  onClose: () => void;
  defaultMode?: Mode;
}) {
  const { revalidateLoop } = useLoopMutate();
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [submitting, setSubmitting] = useState(false);

  // 事件模式
  const [tpl, setTpl] = useState('issue');
  const [event, setEvent] = useState<LoopEvent>({ ...EVENT_TEMPLATES[0].preset, id: newEventId() });
  // 规则模式
  const [rule, setRule] = useState({
    name: '', source: 'github', types: 'issues.opened', to: 'claude',
    cwd: '~/code/app', group: 'dev', tell: 'needed' as TellMode,
  });

  useEffect(() => {
    if (!open) return;
    setMode(defaultMode);
    setEvent({ ...EVENT_TEMPLATES[0].preset, id: newEventId() });
  }, [open, defaultMode]);

  function applyTemplate(key: string) {
    const t = EVENT_TEMPLATES.find((x) => x.value === key);
    if (!t) return;
    setTpl(key);
    setEvent((prev) => ({ ...t.preset, id: prev.id }));
  }

  async function submitEvent(e: React.FormEvent) {
    e.preventDefault();
    if (!event.id.trim() || !event.type.trim()) {
      emitToast('请填写事件 id 与类型');
      return;
    }
    setSubmitting(true);
    try {
      const res = await loopApi.postEvent({
        ...event,
        id: event.id.trim(),
        type: event.type.trim(),
        subject: event.subject?.trim() || undefined,
      });
      loopToast(
        res.duplicate ? '事件重复，已去重' :
        res.hopBlocked ? '跳数超限，已熔断' :
        res.routed.length ? `已派活：${res.routed.join('、')}` : '事件已记录（未命中规则）',
      );
      onClose();
      await revalidateLoop();
    } catch {
      /* api-client 已统一 toast */
    } finally {
      setSubmitting(false);
    }
  }

  async function submitRule(e: React.FormEvent) {
    e.preventDefault();
    const types = rule.types.split(',').map((s) => s.trim()).filter(Boolean);
    if (!rule.name.trim() || !types.length || !rule.to.trim() || !rule.cwd.trim()) {
      emitToast('请填写规则名 / 触发类型 / 交给 / 目录');
      return;
    }
    setSubmitting(true);
    try {
      const payload: LoopRule = {
        name: rule.name.trim(),
        when: { source: rule.source.trim() || 'manual', types },
        to: rule.to.trim(),
        cwd: rule.cwd.trim(),
        group: rule.group.trim() || 'default',
        tell: rule.tell,
      };
      const check = await loopApi.checkRule(payload);
      if (!check.valid) {
        emitToast(`规则校验未通过：${check.issues[0] ?? '请检查字段'}`);
        return;
      }
      await loopApi.postRule(payload);
      loopToast(`规则已登记：${payload.name}`);
      onClose();
      await revalidateLoop();
    } catch {
      /* api-client 已统一 toast */
    } finally {
      setSubmitting(false);
    }
  }

  const setEvt = <K extends keyof LoopEvent>(key: K, value: LoopEvent[K]) =>
    setEvent((prev) => ({ ...prev, [key]: value }));
  const setR = <K extends keyof typeof rule>(key: K, value: (typeof rule)[K]) =>
    setRule((prev) => ({ ...prev, [key]: value }));

  return (
    <Modal open={open} title="Autoloop · 接入事件 / 新建规则" onClose={onClose}>
      <form className="wf-form" onSubmit={mode === 'event' ? submitEvent : submitRule}>
        <label htmlFor="fMode">操作类型</label>
        <select id="fMode" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          <option value="event">手动接入事件（触发规则派活）</option>
          <option value="rule">新建规则（登记触发条件）</option>
        </select>

        {mode === 'event' ? (
          <>
            <label htmlFor="fTpl">事件模板</label>
            <select id="fTpl" value={tpl} onChange={(e) => applyTemplate(e.target.value)}>
              {EVENT_TEMPLATES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>

            <label htmlFor="fId">事件 id（去重键）</label>
            <input id="fId" value={event.id} onChange={(e) => setEvt('id', e.target.value)} required placeholder="evt_..." />

            <div className="form-row">
              <div>
                <label htmlFor="fSrc">来源 source</label>
                <input id="fSrc" value={event.source} onChange={(e) => setEvt('source', e.target.value)} required placeholder="github" />
              </div>
              <div>
                <label htmlFor="fType">类型 type</label>
                <input id="fType" value={event.type} onChange={(e) => setEvt('type', e.target.value)} required placeholder="issues.opened" />
              </div>
            </div>

            <label htmlFor="fSubject">事项 subject（可选，支持中文）</label>
            <input id="fSubject" value={event.subject ?? ''} onChange={(e) => setEvt('subject', e.target.value)} placeholder="如：Node架构设计 或 repo#128" />

            <label htmlFor="fSummary">摘要（可选）</label>
            <input id="fSummary" value={event.summary ?? ''} onChange={(e) => setEvt('summary', e.target.value)} placeholder="一句话描述" />
          </>
        ) : (
          <>
            <label htmlFor="rName">规则名</label>
            <input id="rName" value={rule.name} onChange={(e) => setR('name', e.target.value)} required placeholder="如：跟进 PR 评论" />

            <div className="form-row">
              <div>
                <label htmlFor="rSrc">触发源 source</label>
                <input id="rSrc" value={rule.source} onChange={(e) => setR('source', e.target.value)} required placeholder="github" />
              </div>
              <div>
                <label htmlFor="rTypes">触发类型（逗号分隔）</label>
                <input id="rTypes" value={rule.types} onChange={(e) => setR('types', e.target.value)} required placeholder="issues.opened,issue.*" />
              </div>
            </div>

            <div className="form-row">
              <div>
                <label htmlFor="rTo">交给 Agent</label>
                <input id="rTo" value={rule.to} onChange={(e) => setR('to', e.target.value)} required placeholder="claude / codex" />
              </div>
              <div>
                <label htmlFor="rCwd">工作目录 cwd</label>
                <input id="rCwd" value={rule.cwd} onChange={(e) => setR('cwd', e.target.value)} required placeholder="~/code/app" />
              </div>
            </div>

            <div className="form-row">
              <div>
                <label htmlFor="rGroup">分组 group</label>
                <input id="rGroup" value={rule.group} onChange={(e) => setR('group', e.target.value)} placeholder="dev" />
              </div>
              <div>
                <label htmlFor="rTell">通知策略 tell</label>
                <select id="rTell" value={rule.tell} onChange={(e) => setR('tell', e.target.value as TellMode)}>
                  {TELL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
          </>
        )}

        <button className="primary-btn" type="submit" disabled={submitting}>
          {submitting ? '正在提交…' : mode === 'event' ? '接入事件' : '登记规则'}
        </button>
      </form>
    </Modal>
  );
}

export default WorkflowFormModal;
