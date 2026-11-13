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
 * 导航沿用 NAV_ITEMS 单一数据源与 navByKey（增删模块不索引错位）。
 * M2 把 label / crumb / title / badge 换成 Autoloop 语义：工作流→规则、技能→插件。
 * M6 按「逐个补充」节奏新增第 3 个业务模块「决策」（架构设计决策面板）。
 * 合同 / 设备 / 仿真 / Copilot 等模块源码仍在仓库内，按节奏逐步恢复。
 */
export const NAV_ITEMS: NavItem[] = [
  { key: 'overview', href: '/', label: '总览', icon: 'i-grid', crumb: 'Agentic OS / 工作台', title: 'Automation Workbench', badge: '规则 · 事件 · 轮次' },
  { key: 'workflows', href: '/workflows', label: '规则', icon: 'i-list', crumb: 'Agentic OS / 规则', title: 'Rules', badge: '事件触发与派活' },
  { key: 'skills', href: '/skills', label: '插件', icon: 'i-cube', crumb: 'Agentic OS / 插件', title: 'Plugins', badge: '四方向插件注册表' },
  { key: 'decisions', href: '/decisions', label: '决策', icon: 'i-bulb', crumb: 'Agentic OS / 决策', title: 'Architecture Decisions', badge: 'ADR · 方案权衡 · 落地' },
  { key: 'settings', href: '/settings', label: '设置', icon: 'i-wrench', crumb: 'Agentic OS / 设置', title: 'Settings', badge: '账号 · 用量 · 事实溯源' },
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
