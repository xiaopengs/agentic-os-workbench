import type { IconName } from '@/components/icons/Icon';

export interface NavItem {
  key: string;
  href: string;
  label: string;
  icon: IconName;
  /** 面包屑 */
  crumb: string;
  /** 页面主标题 */
  title: string;
  /** 标题旁徽标文案，空则不展示 */
  badge?: string;
}

/** 工作台 6 个 Tab（对齐原型导航结构） */
export const NAV_ITEMS: NavItem[] = [
  { key: 'overview', href: '/', label: '总览', icon: 'i-grid', crumb: 'Agentic OS / 工作台', title: 'Automation Workbench', badge: '全链路开发与验证' },
  { key: 'workflows', href: '/workflows', label: '工作流', icon: 'i-list', crumb: 'Agentic OS / 工作流', title: 'Workflows', badge: '场景编排与执行' },
  { key: 'skills', href: '/skills', label: '技能', icon: 'i-cube', crumb: 'Agentic OS / 技能', title: 'Skills', badge: '原子能力注册表' },
  { key: 'contracts', href: '/contracts', label: '合同', icon: 'i-doc', crumb: 'Agentic OS / 合同', title: 'Contract Registry', badge: '声明式能力契约' },
  { key: 'devices', href: '/devices', label: '设备', icon: 'i-device', crumb: 'Agentic OS / 设备', title: 'Device Cluster', badge: '真机与仿真集群' },
  { key: 'settings', href: '/settings', label: '设置', icon: 'i-wrench', crumb: 'Agentic OS / 设置', title: 'Settings', badge: '账号 · 配额 · 审计' },
];

export function navByPath(pathname: string): NavItem {
  if (pathname.startsWith('/workflows')) return NAV_ITEMS[1];
  if (pathname.startsWith('/skills')) return NAV_ITEMS[2];
  if (pathname.startsWith('/contracts')) return NAV_ITEMS[3];
  if (pathname.startsWith('/devices')) return NAV_ITEMS[4];
  if (pathname.startsWith('/settings')) return NAV_ITEMS[5];
  return NAV_ITEMS[0];
}

export function navKeyByPath(pathname: string): string {
  return navByPath(pathname).key;
}
