'use client';

import { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { Chip } from '@/components/ui/WorkflowBits';
import { LoadingRows, PageHeader } from '@/components/ui/PageHeader';
import { useAuth } from '@/lib/auth';
import { FACT_META, factTitle } from '@/lib/loop-format';
import { useLoopState, useLoopFacts } from '@/lib/loop-hooks';
import { relTime } from '@/lib/format';
import { navByKey } from '@/lib/nav';

const META = navByKey('settings');

/**
 * 设置页 · 视觉与旧版完全一致（.card / .kv-grid / .quota-bar / .tbl 卡片化 / .rel-btn）。
 * 语义换成：账号不变；配额 → 内核累计用量与跳数熔断；审计日志 → 事实日志溯源（逐条 Fact）。
 */
export default function SettingsPage() {
  const { user, logout } = useAuth();
  const { data: state, isValidating } = useLoopState();
  const { data: facts } = useLoopFacts();
  const [leaving, setLeaving] = useState(false);

  const usage = state?.usage;
  const totals = state?.totals;
  // 事实序号进度：以「已确认轮次 / 100」映射既有 quota-bar，纯展示（内核无月度配额上限）
  const runs = usage?.runs ?? 0;
  const pct = Math.min(100, Math.round((runs / 100) * 100));
  const barCls = pct >= 100 ? ' full' : pct >= 80 ? ' hot' : '';

  const factRows = [...(facts ?? [])].sort((a, b) => b.seq - a.seq).slice(0, 20);

  return (
    <>
      <PageHeader crumb={META.crumb} title={META.title} badge={META.badge} sync={isValidating ? 'syncing' : 'ok'} />

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
          <b>用量与跳数</b>
          <span className="sub">来自 GET /api/loop/state · 事实日志累计（幂等重放不重复计费）</span>
        </div>
        {usage && totals ? (
          <>
            <div className="row-actions" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: 'var(--t2)' }}>
                已确认 {runs} runs · {totals.facts} 条事实 · 熔断 {totals.hopsBlocked} 次
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: pct >= 100 ? 'var(--red)' : 'var(--green-deep)' }}>
                {totals.queuedRuns} 排队
              </span>
            </div>
            <div className="quota-bar">
              <i className={barCls.trim()} style={{ width: `${Math.max(3, pct)}%` }} />
            </div>
            <div className="kv-grid">
              <div className="kv">
                <div className="k">已确认轮次</div>
                <div className="v">{runs}</div>
              </div>
              <div className="kv">
                <div className="k">Tokens</div>
                <div className="v">{(usage.tokens ?? 0).toLocaleString('zh-CN')}</div>
              </div>
              <div className="kv">
                <div className="k">活跃规则</div>
                <div className="v">{totals.activeRules} / {totals.rules}</div>
              </div>
            </div>
          </>
        ) : (
          <LoadingRows rows={2} />
        )}
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <b>事实日志溯源</b>
          <span className="sub">来自 GET /api/loop/facts · 只追加、可完整重放</span>
          <span className="head-right">
            <span className="count-pill">{facts?.length ?? 0}</span>
          </span>
        </div>
        {!facts && !factRows.length ? (
          <LoadingRows rows={3} />
        ) : factRows.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>序号</th>
                  <th>类型</th>
                  <th>内容</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {factRows.map((f) => (
                  <tr key={f.seq}>
                    <td className="tbl-first tbl-num" data-label="">#{f.seq}</td>
                    <td className="tbl-sub" data-label="类型">{FACT_META[f.kind]?.label ?? f.kind}</td>
                    <td className="tbl-name" data-label="内容">{factTitle(f)}</td>
                    <td className="tbl-sub" data-label="时间">{relTime(f.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-tip">暂无事实记录</div>
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
