'use client';

import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { api } from '@/lib/api-client';
import { useMutate } from '@/lib/hooks';
import { emitToast } from '@/lib/toast-bus';
import type { WorkflowInput, WorkflowStatus } from '@/lib/types';

const TEMPLATES: { value: string; label: string; preset: Omit<WorkflowInput, 'status'> }[] = [
  {
    value: 'msg',
    label: '消息智能摘要 Agent',
    preset: {
      name: '消息智能摘要 Agent',
      category: '效率工具 · 信息聚合',
      description: '聚合未读消息并生成摘要与待办',
      devices: 2,
      steps: 7,
      coverage: 0,
      duration: 12,
    },
  },
  {
    value: 'album',
    label: '相册整理 Agent',
    preset: {
      name: '相册整理 Agent',
      category: '生活服务 · 图像管理',
      description: '按人物/场景自动归类相册并去重',
      devices: 3,
      steps: 9,
      coverage: 0,
      duration: 16,
    },
  },
  {
    value: 'meeting',
    label: '会议纪要生成 Agent',
    preset: {
      name: '会议纪要生成 Agent',
      category: '办公协同 · 语音转写',
      description: '转写会议录音并生成纪要与行动项',
      devices: 4,
      steps: 10,
      coverage: 0,
      duration: 20,
    },
  },
];

const STATUS_OPTIONS: { value: WorkflowStatus; label: string }[] = [
  { value: 'running', label: '运行中' },
  { value: 'queued', label: '排队中' },
  { value: 'done', label: '已完成' },
  { value: 'failed', label: '失败' },
];

const FORM_KEY = 'agentic_os_wf_form';

export function WorkflowFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { revalidateWorkflows, revalidateUsage, revalidateAudit } = useMutate();
  const [tpl, setTpl] = useState('msg');
  const [form, setForm] = useState<WorkflowInput>({ ...TEMPLATES[0].preset, status: 'running' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    try {
      const raw = window.localStorage.getItem(FORM_KEY);
      if (raw) setForm((prev) => ({ ...prev, ...(JSON.parse(raw) as Partial<WorkflowInput>) }));
    } catch {
      /* noop */
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      try {
        window.localStorage.setItem(FORM_KEY, JSON.stringify(form));
      } catch {
        /* noop */
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [form, open]);

  function applyTemplate(key: string) {
    const t = TEMPLATES.find((x) => x.value === key);
    if (!t) return;
    setTpl(key);
    setForm((prev) => ({ ...t.preset, status: prev.status }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.category.trim()) {
      emitToast('请填写工作流名称与分类');
      return;
    }
    setSubmitting(true);
    try {
      const payload: WorkflowInput = {
        ...form,
        name: form.name.trim(),
        category: form.category.trim(),
        devices: Number(form.devices) || 1,
        steps: Number(form.steps) || 1,
        coverage: Number(form.coverage) || 0,
        duration: Number(form.duration) || 1,
      };
      await api.workflows.create(payload);
      try {
        window.localStorage.removeItem(FORM_KEY);
      } catch {
        /* noop */
      }
      emitToast(`工作流已启动：${payload.name}`);
      onClose();
      await Promise.all([revalidateWorkflows(), revalidateUsage(), revalidateAudit()]);
    } catch {
      /* api-client 已统一 toast */
    } finally {
      setSubmitting(false);
    }
  }

  const set = <K extends keyof WorkflowInput>(key: K, value: WorkflowInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <Modal open={open} title="运行新工作流" onClose={onClose}>
      <form className="wf-form" onSubmit={submit}>
        <label htmlFor="fTpl">场景模板</label>
        <select id="fTpl" value={tpl} onChange={(e) => applyTemplate(e.target.value)}>
          {TEMPLATES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        <label htmlFor="fName">工作流名称</label>
        <input
          id="fName"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          required
          placeholder="如：消息智能摘要 Agent"
        />

        <div className="form-row">
          <div>
            <label htmlFor="fCat">分类</label>
            <input
              id="fCat"
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              required
              placeholder="如 效率工具"
            />
          </div>
          <div>
            <label htmlFor="fStatus">状态</label>
            <select
              id="fStatus"
              value={form.status}
              onChange={(e) => set('status', e.target.value as WorkflowStatus)}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label htmlFor="fDesc">描述</label>
        <input
          id="fDesc"
          value={form.description ?? ''}
          onChange={(e) => set('description', e.target.value)}
          placeholder="一句话描述工作流目标"
        />

        <div className="form-row">
          <div>
            <label htmlFor="fDev">设备数</label>
            <input
              id="fDev"
              type="number"
              min={1}
              max={16}
              value={form.devices}
              onChange={(e) => set('devices', Number(e.target.value))}
              required
            />
          </div>
          <div>
            <label htmlFor="fStep">步骤数</label>
            <input
              id="fStep"
              type="number"
              min={1}
              max={99}
              value={form.steps}
              onChange={(e) => set('steps', Number(e.target.value))}
              required
            />
          </div>
        </div>

        <div className="form-row">
          <div>
            <label htmlFor="fCov">覆盖率 (%)</label>
            <input
              id="fCov"
              type="number"
              min={0}
              max={100}
              value={form.coverage}
              onChange={(e) => set('coverage', Number(e.target.value))}
              required
            />
          </div>
          <div>
            <label htmlFor="fDur">回归时长 (分)</label>
            <input
              id="fDur"
              type="number"
              min={1}
              max={120}
              value={form.duration}
              onChange={(e) => set('duration', Number(e.target.value))}
              required
            />
          </div>
        </div>

        <button className="primary-btn" type="submit" disabled={submitting}>
          {submitting ? '正在启动…' : '启动工作流'}
        </button>
      </form>
    </Modal>
  );
}

export default WorkflowFormModal;
