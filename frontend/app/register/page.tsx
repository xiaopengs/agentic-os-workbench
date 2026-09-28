'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { useAuth } from '@/lib/auth';

export default function RegisterPage() {
  const { register, user, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace('/');
  }, [loading, user, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (password !== confirm) {
      setErr('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    try {
      await register(email.trim(), password);
      router.replace('/');
    } catch (error) {
      setErr(error instanceof Error ? error.message : '注册失败，请重试');
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
        <div className="auth-title">创建账号</div>
        <div className="auth-sub">
          免费版 100 runs / 月，注册即可使用 Contract Registry 与仿真测试
        </div>

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
            autoComplete="new-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 6 位"
          />
          <label htmlFor="confirm">确认密码</label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="再次输入密码"
          />
          {err ? <div className="auth-err">{err}</div> : null}
          <button className="primary-btn" type="submit" disabled={busy}>
            {busy ? '创建中…' : '注册并进入工作台'}
          </button>
        </form>

        <div className="auth-alt">
          已有账号？<Link href="/login">去登录</Link>
        </div>
        <div className="auth-hint">
          <Icon name="i-shield" size={12} /> 数据按 userId 隔离，多租户强制服务端注入
        </div>
      </div>
    </div>
  );
}