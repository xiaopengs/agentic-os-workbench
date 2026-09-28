'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace('/');
  }, [loading, user, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await login(email.trim(), password);
      router.replace('/');
    } catch (error) {
      setErr(error instanceof Error ? error.message : '登录失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-box">
        <div className="auth-brand">
          <svg className="logo" viewBox="0 0 24 24" aria-hidden="true">
            <use href="#i-logo" />
          </svg>
          Agentic OS
        </div>
        <div className="auth-title">登录工作台</div>
        <div className="auth-sub">继续管理 Contract / Skill / Agent 的全链路开发与验证</div>

        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="email">邮箱</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
          <label htmlFor="password">密码</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 6 位"
          />
          {err ? <div className="auth-err">{err}</div> : null}
          <button className="primary-btn" type="submit" disabled={busy}>
            {busy ? '登录中…' : '登录'}
          </button>
        </form>

        <div className="auth-alt">
          还没有账号？<Link href="/register">立即注册</Link>
        </div>
        <div className="auth-hint">
          <Icon name="i-shield" size={12} /> 会话使用 HttpOnly Cookie，前端不持有明文凭据
        </div>
      </div>
    </div>
  );
}