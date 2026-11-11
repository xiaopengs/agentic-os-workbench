'use client';

import Link from 'next/link';
import { Icon, type IconName } from '@/components/icons/Icon';
import { weeklyTrend } from '@/lib/format';
import type { Skill, Workflow } from '@/lib/types';

interface KpiDef {
  key: string;
  label: string;
  icon: IconName;
  tone: 'g' | 'p' | 'b' | 'c';
  href: string;
  value: number;
  trendLabel: string;
  flat: boolean;
}

/** 精简基线：只保留工作流与技能两张 KPI 卡（合同 / 设备已下线） */
export function KpiGrid({ workflows, skills }: { workflows: Workflow[]; skills: Skill[] }) {
  const wt = weeklyTrend(workflows);
  const st = weeklyTrend(skills);

  const items: KpiDef[] = [
    { key: 'workflows', label: 'Workflows', icon: 'i-list', tone: 'g', href: '/workflows', value: workflows.length, trendLabel: wt.label, flat: wt.flat },
    { key: 'skills', label: 'Skills', icon: 'i-cube', tone: 'p', href: '/skills', value: skills.length, trendLabel: st.label, flat: st.flat },
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
            <div className="kpi-week">较上周</div>
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
