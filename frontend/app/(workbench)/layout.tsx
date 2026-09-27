import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/AppShell';

/** 工作台路由组：统一套壳（顶栏 / 侧栏 / 鉴权守卫） */
export default function WorkbenchLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
