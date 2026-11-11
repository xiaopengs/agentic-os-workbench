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

/**
 * 当前基线只开放 3 个业务入口 + 设置。
 * 合同 / 设备 / 仿真 / Copilot 等模块源码仍在仓库内，按「逐个补充」节奏恢复，
 * 详见 docs/08-架构设计决策面板-补充需求.md 与 README。
 */
export const NAV_ITEMS: NavItem[] = [
  { key: 'overview', href: '/', label: '总览', icon: 'i-grid', crumb: 'Agentic OS / 工作台', title: 'Automation Workbench', badge: '工作流与技能' },
  { key: 'workflows', href: '/workflows', label: '工作流', icon: 'i-list', crumb: 'Agentic OS / 工作流', title: 'Workflows', badge: '场景编排与执行' },
  { key: 'skills', href: '/skills', label: '技能', icon: 'i-cube', crumb: 'Agentic OS / 技能', title: 'Skills', badge: '原子能力注册表' },
  { key: 'settings', href: '/settings', label: '设置', icon: 'i-wrench', crumb: 'Agentic OS / 设置', title: 'Settings', badge: '账号 · 配额 · 审计' },
];

/** 按最长前缀匹配，避免增删导航项时索引错位 */
export function navByPath(pathname: string): NavItem {
  const match = [...NAV_ITEMS]
    .reverse()
    .find((item) => item.href !== '/' && pathname.startsWith(item.href));
  return match ?? NAV_ITEMS[0];
}

export function navKeyByPath(pathname: string): string {
  return navByPath(pathname).key;
}

/** 按 key 精确查找，避免增删导航项时硬编码索引错位（逐个补充模块时安全） */
export function navByKey(key: string): NavItem {
  return NAV_ITEMS.find((item) => item.key === key) ?? NAV_ITEMS[0];
}
