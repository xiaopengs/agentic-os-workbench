'use client';

import Link from 'next/link';
import { Icon, type IconName } from '@/components/icons/Icon';
import type { LoopState } from '@/lib/loop-types';

interface KpiDef {
  key: string;
  label: string;
  icon: IconName;
  tone: 'g' | 'p' | 'b' | 'c';
  href: string;
  value: number | string;
  trendLabel: string;
  flat: boolean;
  week: string;
}

/**
 * 总览 KPI · 视觉与精简基线完全一致（2 张卡 / kpi-grid / kpi-ic 色调 / kpi-trend / kpi-week / kpi-go）。
 * 只把数值来源从 workflows.length / skills.length 换成 LoopState.totals：
 *   工作流 → 活跃规则，技能 → 已登记插件。
 */
export function KpiGrid({ state }: { state: LoopState | null }) {
  const t = state?.totals;
  const pluginCount = t ? t.agents + t.sources + t.channels + t.deliveries : 0;

  const items: KpiDef[] = [
    {
      key: 'rules', label: '活跃规则', icon: 'i-list', tone: 'g', href: '/workflows',
      value: t?.activeRules ?? '—',
      trendLabel: t ? `共 ${t.rules} 条` : '— 持平', flat: true,
      week: state ? `规则版本 v${state.rulesVersion}` : '较上周',
    },
    {
      key: 'plugins', label: '已登记插件', icon: 'i-cube', tone: 'p', href: '/skills',
      value: t ? pluginCount : '—',
      trendLabel: t ? `${t.agents} 个 Agent` : '— 持平', flat: true,
      week: state ? `事实 #${state.seq}` : '较上周',
    },
  ];

  return (
    <div className="kpi-grid">
      {items.map((def) => (
        <Link key={def.key} href={def.href} className="kpi-card">
          <div className={`kpi-ic ${def.tone}`}>
            <Icon name={def.icon} />
          </div>
          <div className="kpi-mid">
            <div className="kpi-label">{def.label}</div>
            <div className="kpi-num-row">
              <span className="kpi-num">{def.value}</span>
              <span className={`kpi-trend${def.flat ? ' flat' : ''}`}>{def.trendLabel}</span>
            </div>
            <div className="kpi-week">{def.week}</div>
          </div>
          <span className="kpi-go">
            <Icon name="i-chev-r" />
          </span>
        </Link>
      ))}
    </div>
  );
}

export default KpiGrid;
