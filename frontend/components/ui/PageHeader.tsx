'use client';

import { Icon } from '@/components/icons/Icon';
import type { SyncState } from '@/lib/types';

const SYNC_TEXT: Record<SyncState, string> = {
  ok: '已同步 · 云端',
  syncing: '同步中…',
  offline: '离线模式',
};

export function SyncBadge({ state }: { state: SyncState }) {
  const cls = state === 'syncing' ? 'sync-badge syncing' : state === 'offline' ? 'sync-badge offline' : 'sync-badge';
  return (
    <span className={cls}>
      <i className="sdot" />
      <span>{SYNC_TEXT[state]}</span>
    </span>
  );
}

export function PageHeader({
  crumb,
  title,
  badge,
  sync,
  actions,
}: {
  crumb: string;
  title: string;
  badge?: string;
  sync?: SyncState;
  actions?: React.ReactNode;
}) {
  return (
    <>
      <div className="crumbs">{crumb}</div>
      <div className="page-head">
        <h1>{title}</h1>
        {badge ? <span className="badge-green">{badge}</span> : null}
        {actions}
        {sync ? <SyncBadge state={sync} /> : null}
      </div>
    </>
  );
}

export function EmptyTip({ children }: { children: React.ReactNode }) {
  return <div className="empty-tip">{children}</div>;
}

export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skel skel-row" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function IconButton({
  label,
  icon,
  onClick,
  danger,
}: {
  label: string;
  icon: 'i-x' | 'i-refresh' | 'i-dots' | 'i-play';
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <button
      className={`icon-btn${danger ? ' danger' : ''}`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <Icon name={icon} size={15} />
    </button>
  );
}
