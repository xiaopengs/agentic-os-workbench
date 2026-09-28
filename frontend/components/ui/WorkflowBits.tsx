import { Icon, type IconName } from '@/components/icons/Icon';
import type { WorkflowStatus } from '@/lib/types';

/** 依据工作流名称选择图标与色调（沿用原型 wfIcon 规则） */
export function wfIcon(name?: string): [IconName, string] {
  if (!name) return ['i-cube', 'g'];
  if (name.includes('文件')) return ['i-folder', 'g'];
  if (name.includes('日程')) return ['i-calendar', 'b'];
  if (name.includes('外卖')) return ['i-takeout', 'o'];
  if (name.includes('消息')) return ['i-list', 'p'];
  if (name.includes('相册')) return ['i-folder', 'c'];
  if (name.includes('会议')) return ['i-doc', 'b'];
  return ['i-cube', 'g'];
}

export const STATUS_TEXT: Record<WorkflowStatus, string> = {
  running: '运行中',
  done: '已完成',
  failed: '失败',
  queued: '排队中',
};

export function StatusPill({ status }: { status: WorkflowStatus }) {
  const cls =
    status === 'running' ? 'wf-status running' : status === 'failed' ? 'wf-status failed' : 'wf-status done';
  return (
    <span className={cls}>
      {status === 'done' ? (
        <Icon name="i-check" size={11} />
      ) : (
        <i />
      )}
      {STATUS_TEXT[status] ?? status}
    </span>
  );
}

export function Chip({
  tone = 'mute',
  children,
}: {
  tone?: 'ok' | 'warn' | 'err' | 'info' | 'mute';
  children: React.ReactNode;
}) {
  return <span className={`chip ${tone}`}>{children}</span>;
}