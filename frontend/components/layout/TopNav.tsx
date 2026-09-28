'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { useAuth } from '@/lib/auth';
import { useAudit } from '@/lib/hooks';
import { NAV_ITEMS, navKeyByPath } from '@/lib/nav';
import { relTime } from '@/lib/format';
import { emitToast } from '@/lib/toast-bus';

const ENV_KEY = 'agentic_os_env';
const ENVS = ['Dev', 'Test', 'Prod'] as const;

export function TopNav({ onToggleDrawer }: { onToggleDrawer: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { data: audit } = useAudit(60000);

  const active = navKeyByPath(pathname);

  const [q, setQ] = useState('');
  const [env, setEnv] = useState<string>('Dev');
  const [envOpen, setEnvOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const envWrap = useRef<HTMLDivElement>(null);
  const bellWrap = useRef<HTMLDivElement>(null);
  const userWrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(ENV_KEY);
      if (saved && (ENVS as readonly string[]).includes(saved)) setEnv(saved);
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (!envWrap.current?.contains(t)) setEnvOpen(false);
      if (!bellWrap.current?.contains(t)) setBellOpen(false);
      if (!userWrap.current?.contains(t)) setUserOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  function pickEnv(next: string) {
    setEnv(next);
    setEnvOpen(false);
    try {
      window.localStorage.setItem(ENV_KEY, next);
    } catch {
      /* noop */
    }
    emitToast(`已切换到 ${next} 环境`);
  }

  function submitSearch() {
    const kw = q.trim();
    if (!kw) {
      emitToast('请输入关键词后回车搜索');
      return;
    }
    router.push(`/workflows?q=${encodeURIComponent(kw)}`);
  }

  const attentions = (audit ?? []).slice(0, 4);

  return (
    <header className="topnav">
      <button className="hamburger" onClick={onToggleDrawer} aria-label="菜单">
        <Icon name="i-menu" />
      </button>

      <Link href="/" className="brand">
        <svg className="logo" viewBox="0 0 24 24" aria-hidden="true">
          <use href="#i-logo" />
        </svg>
        Agentic OS
      </Link>

      <nav className="top-tabs">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={active === item.key ? 'active' : ''}
            aria-current={active === item.key ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="top-right">
        <div className="searchbox">
          <Icon name="i-search" size={15} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitSearch();
            }}
            placeholder="搜索 Agent / Skill / Contract / Trace"
            aria-label="全局搜索"
          />
        </div>

        <div className="env-wrap" ref={envWrap}>
          <button className="env-picker" onClick={() => setEnvOpen((v) => !v)} aria-haspopup="menu">
            <Icon name="i-target" size={15} style={{ color: 'var(--green-deep)' }} />
            <span>{env}</span>
            <Icon name="i-chev-d" size={13} style={{ color: 'var(--t3)' }} />
          </button>
          <div className={`env-menu${envOpen ? ' open' : ''}`} role="menu">
            {ENVS.map((e) => (
              <button
                key={e}
                className={env === e ? 'on' : ''}
                onClick={() => pickEnv(e)}
                role="menuitem"
              >
                {e}
                {env === e ? <Icon name="i-check" size={13} /> : null}
              </button>
            ))}
          </div>
        </div>

        <div className="bell-wrap" ref={bellWrap}>
          <button className="bell-btn" onClick={() => setBellOpen((v) => !v)} aria-label="通知">
            <Icon name="i-bell" />
            {attentions.length ? <i className="dot" /> : null}
          </button>
          <div className={`bell-menu${bellOpen ? ' open' : ''}`}>
            <div className="bm-title">通知 · Attention</div>
            {attentions.length ? (
              attentions.map((a) => (
                <Link
                  key={a.id}
                  href="/settings"
                  className="attn-item"
                  onClick={() => setBellOpen(false)}
                >
                  <span className="attn-ico g">
                    <Icon name="i-check" />
                  </span>
                  <span className="attn-txt">
                    <span className="attn-title">{a.action}</span>
                    <span className="attn-time">{relTime(a.at)}</span>
                  </span>
                  <span className="chev">
                    <Icon name="i-chev-r" />
                  </span>
                </Link>
              ))
            ) : (
              <div className="empty-tip">暂无新通知</div>
            )}
          </div>
        </div>

        <div className="user-wrap" ref={userWrap}>
          <button className="user-btn" onClick={() => setUserOpen((v) => !v)} aria-haspopup="menu">
            <span className="avatar">
              <Icon name="i-bot" />
            </span>
            <span className="user-mail">{user?.email ?? '未登录'}</span>
            {user?.plan === 'pro' ? <span className="user-plan">PRO</span> : null}
            <Icon name="i-chev-d" size={12} style={{ color: 'var(--t3)' }} />
          </button>
          <div className={`user-menu${userOpen ? ' open' : ''}`} role="menu">
            <div className="um-head">
              <div className="um-mail">{user?.email ?? '—'}</div>
              <div className="um-sub">
                计划 {user?.plan === 'pro' ? 'Pro（10000 runs/月）' : 'Free（100 runs/月）'}
              </div>
            </div>
            <Link href="/settings" onClick={() => setUserOpen(false)}>
              <Icon name="i-wrench" size={15} />
              账号设置
            </Link>
            <button
              className="danger"
              onClick={() => {
                setUserOpen(false);
                void logout();
              }}
            >
              <Icon name="i-x" size={15} />
              退出登录
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

export default TopNav;