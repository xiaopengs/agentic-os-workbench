'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '@/components/icons/Icon';
import { SideNav } from './SideNav';
import { TopNav } from './TopNav';
import { useRequireAuth } from '@/lib/auth';

/**
 * 工作台外壳：顶栏 + 侧栏 + 主区（+ 总览页右侧栏）
 * 未登录时由 useRequireAuth 自动重定向到 /login
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { ready } = useRequireAuth();
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    setDrawer(false);
  }, [pathname]);

  if (!ready) {
    return (
      <div className="splash">
        <Icon name="i-refresh" size={16} />
        <span>正在校验会话…</span>
      </div>
    );
  }

  return (
    <>
      <TopNav onToggleDrawer={() => setDrawer(true)} />
      <div className="app">
        <SideNav open={drawer} onClose={() => setDrawer(false)} />
        <div
          className={`sidenav-mask${drawer ? ' show' : ''}`}
          onClick={() => setDrawer(false)}
          aria-hidden="true"
        />
        <main className="main">
          <div className="page active">{children}</div>
        </main>
      </div>
    </>
  );
}

export default AppShell;
