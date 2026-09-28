'use client';

import { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { Chip } from '@/components/ui/WorkflowBits';
import { LoadingRows, PageHeader } from '@/components/ui/PageHeader';
import { useAuth } from '@/lib/auth';
import { useWorkbench } from '@/lib/hooks';
import { fmtMoney, relTime } from '@/lib/format';
import { NAV_ITEMS } from '@/lib/nav';

const META = NAV_ITEMS[5];

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const data = useWorkbench();
  const [leaving, setLeaving] = useState(false);

  const usage = data.usage;
  const limit = usage?.limit ?? 100;
  const runs = usage?.runs ?? 0;
  const pct = limit > 0 ? Math.min(100, Math.round((runs / limit) * 100)) : 0;
  const barCls = pct >= 100 ? ' full' : pct >= 80 ? ' hot' : '';

  return (
    <>
      <PageHeader crumb={META.crumb} title={META.title} badge={META.badge} sync={data.sync} />

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <b>账号</b>
          <span className="sub">来自 GET /api/auth/me</span>
          <span className="head-right">
            <Chip tone={user?.plan === 'pro' ? 'ok' : 'mute'}>
              {user?.plan === 'pro' ? 'Pro' : 'Free'}
            </Chip>
          </span>
        </div>
        <div className="kv-grid">
          <div className="kv">
            <div className="k">邮箱</div>
            <div className="v" style={{ fontSize: 15, wordBreak: 'break-all' }}>
              {user?.email ?? '—'}
            </div>
          </div>
          <div className="kv">
            <div className="k">用户 ID</div>
            <div className="v" style={{ fontSize: 15, wordBreak: 'break-all' }}>
              {user?.id ?? '—'}
            </div>
          </div>
          <div className="kv">
            <div className="k">注册时间</div>
            <div className="v" style={{ fontSize: 15 }}>
              {user?.createdAt ? relTime(user.createdAt) : '—'}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <b>配额与用量</b>
          <span className="sub">来自 GET /api/usage · 超额将返回 402</span>
        </div>
        {usage ? (
          <>
            <div className="row-actions" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: 'var(--t2)' }}>
                本月 {usage.month} · 已用 {runs} / {limit} runs
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: pct >= 100 ? 'var(--red)' : 'var(--green-deep)' }}>
                {pct}%
              </span>
            </div>
            <div className="quota-bar">
              <i className={barCls.trim()} style={{ width: `${pct}%` }} />
            </div>
            <div className="kv-grid">
              <div className="kv">
                <div className="k">Runs</div>
                <div className="v">{runs}</div>
              </div>
              <div className="kv">
                <div className="k">Tokens</div>
                <div className="v">{(usage.tokens ?? 0).toLocaleString('zh-CN')}</div>
              </div>
              <div className="kv">
                <div className="k">成本</div>
                <div className="v">{fmtMoney(usage.costCents ?? 0)}</div>
              </div>
            </div>
          </>
        ) : (
          <LoadingRows rows={2} />
        )}
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <b>审计日志</b>
          <span className="sub">来自 GET /api/audit</span>
          <span className="head-right">
            <span className="count-pill">{data.audit.length}</span>
          </span>
        </div>
        {data.loading && !data.audit.length ? (
          <LoadingRows rows={3} />
        ) : data.audit.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>动作</th>
                  <th>对象</th>
                  <th>操作者</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {data.audit.map((a) => (
                  <tr key={a.id}>
                    <td className="tbl-name">{a.action}</td>
                    <td className="tbl-sub">{a.target ?? '—'}</td>
                    <td className="tbl-sub">{a.actor ?? '—'}</td>
                    <td className="tbl-sub">{relTime(a.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-tip">暂无审计记录</div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <b>会话</b>
          <span className="sub">登出将清空本地缓存与会话状态</span>
        </div>
        <button
          className="rel-btn"
          style={{ background: 'var(--red)', maxWidth: 260 }}
          disabled={leaving}
          onClick={() => {
            setLeaving(true);
            void logout();
          }}
        >
          <Icon name="i-x" size={14} />
          {leaving ? '正在登出…' : '退出登录'}
        </button>
      </div>
    </>
  );
}