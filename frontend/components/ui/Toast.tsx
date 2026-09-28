'use client';

import { useEffect, useState } from 'react';
import { onToast } from '@/lib/toast-bus';

/** 全局 toast（与原型 #toast 视觉一致：底部居中，2.4s 自动消失） */
export function ToastHost() {
  const [msg, setMsg] = useState('');
  const [show, setShow] = useState(false);

  useEffect(() => {
    return onToast((message) => {
      setMsg(message);
      setShow(true);
      window.setTimeout(() => setShow(false), 2400);
    });
  }, []);

  return (
    <div id="toast" className={show ? 'show' : ''} role="status" aria-live="polite">
      {msg}
    </div>
  );
}

export default ToastHost;