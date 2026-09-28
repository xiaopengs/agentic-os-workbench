'use client';

import Link from 'next/link';
import { Icon, type IconName } from '@/components/icons/Icon';
import type { WorkbenchData } from '@/lib/hooks';

interface KpiDef {
  key: string;
  label: string;
  icon: IconName;
  tone: 'g' | 'p' | 'b' | 'c';
  href: string;
}

const KPIS: KpiDef[] = [
  { key: 'contract', label: 'Contract', icon: 'i-doc', tone: 'g', href: '/contracts' },
  { key: 'skills', label: 'Skills', icon: 'i-cube', tone: 'p', href: '/skills' },
  { key: 'tests', label: 'Running Tests', icon: 'i-play', tone: 'b', href: '/workflows' },
  { key: 'devices', label: 'Devices', icon: 'i-device', tone: 'c', href: '/devices' },
];

export function KpiGrid({ kpis }: { kpis: WorkbenchData['kpis'] }) {
  return (
    <div className="kpi-grid">
      {KPIS.map((def) => {
        const item = kpis[def.key as keyof WorkbenchData['kpis']];
        return (
          <Link key={def.key} href={def.href} className="kpi-card">
            <div className={`kpi-ic ${def.tone}`}>
              <Icon name={def.icon} />
            </div>
            <div className="kpi-mid">
              <div className="kpi-label">{def.label}</div>
              <div className="kpi-num-row">
                <span className="kpi-num">{item.value}</span>
                <span className={`kpi-trend${item.trend.flat ? ' flat' : ''}`}>
                  {item.trend.label}
                </span>
              </div>
              <div className="kpi-week">较上周</div>
            </div>
            <span className="kpi-go">
              <Icon name="i-chev-r" />
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export default KpiGrid;