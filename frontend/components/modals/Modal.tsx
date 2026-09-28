'use client';

import { useEffect, type ReactNode } from 'react';
import { Icon } from '@/components/icons/Icon';

export function Modal({
  open,
  title,
  icon,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal open"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-box" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          {icon}
          <b>{title}</b>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            <Icon name="i-x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer}
      </div>
    </div>
  );
}

export default Modal;