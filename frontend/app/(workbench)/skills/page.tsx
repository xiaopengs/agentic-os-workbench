'use client';

import { Icon } from '@/components/icons/Icon';
import { Chip } from '@/components/ui/WorkflowBits';
import { LoadingRows, PageHeader } from '@/components/ui/PageHeader';
import { useWorkbench } from '@/lib/hooks';
import { relTime } from '@/lib/format';
import { NAV_ITEMS } from '@/lib/nav';
import type { Skill } from '@/lib/types';

const META = NAV_ITEMS[2];

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'mute'> = {
  active: 'ok',
  draft: 'warn',
  deprecated: 'mute',
};

export function SkillsList({ skills, loading }: { skills: Skill[]; loading: boolean }) {
  if (loading && !skills.length) return <LoadingRows rows={4} />;
  if (!skills.length)
    return <div className="empty-tip">暂无 Skill 记录（GET /api/skills 返回空）</div>;

  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>技能</th>
            <th>版本</th>
            <th>分类</th>
            <th>状态</th>
            <th>更新</th>
          </tr>
        </thead>
        <tbody>
          {skills.map((s) => (
            <tr key={s.id}>
              <td>
                <div className="tbl-name">{s.name}</div>
                <div className="tbl-sub">{s.description ?? '—'}</div>
              </td>
              <td className="tbl-num">{s.version}</td>
              <td className="tbl-sub">{s.category ?? '—'}</td>
              <td>
                <Chip tone={STATUS_TONE[s.status ?? ''] ?? 'mute'}>{s.status ?? '—'}</Chip>
              </td>
              <td className="tbl-sub">{relTime(s.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SkillsPage() {
  const data = useWorkbench();

  return (
    <>
      <PageHeader
        crumb={META.crumb}
        title={META.title}
        badge={META.badge}
        sync={data.sync}
        actions={
          <span className="sync-badge" style={{ marginLeft: 0 }}>
            <Icon name="i-cube" size={13} />
            <span>{data.skills.length} 个已注册</span>
          </span>
        }
      />

      <div className="card">
        <div className="card-head">
          <b>技能注册表</b>
          <span className="sub">来自 GET /api/skills · 60s 自动重验证</span>
        </div>
        <SkillsList skills={data.skills} loading={data.loading} />
      </div>
    </>
  );
}
