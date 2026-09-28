'use client';

/**
 * AuthContext · 会话状态与 401 全局处理
 * - 首次挂载探测 GET /api/auth/me（静默，失败即未登录）
 * - 注册 setUnauthorizedHandler：任何请求收到 401 都清空会话并跳 /login
 * - logout：调用后端登出 → 清空 token / SWR 缓存 / 本地持久化 → 跳 /login
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { api, setToken, setUnauthorizedHandler } from './api-client';
import { useMutate } from './hooks';
import type { User } from './types';

export const LOCAL_KEYS = ['agentic_os_copilot', 'agentic_os_wf_form', 'agentic_os_env'];

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function clearLocalState(): void {
  if (typeof window === 'undefined') return;
  try {
    LOCAL_KEYS.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* noop */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const { clearAll } = useMutate();

  const refresh = useCallback(async () => {
    try {
      const res = await api.auth.me();
      setUser(res?.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setToken(null);
      clearAll().catch(() => undefined);
      clearLocalState();
      router.replace('/login');
    });
    return () => setUnauthorizedHandler(null);
  }, [clearAll, router]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.auth.login(email, password);
      setToken(res.token ?? null);
      setUser(res.user);
      return res.user;
    },
    [],
  );

  const register = useCallback(async (email: string, password: string) => {
    const res = await api.auth.register(email, password);
    setToken(res.token ?? null);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      /* 后端登出失败也要清理本地，保证「登出即失效」 */
    }
    setUser(null);
    setToken(null);
    clearAll().catch(() => undefined);
    clearLocalState();
    router.replace('/login');
  }, [clearAll, router]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, register, logout, refresh }),
    [user, loading, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内使用');
  return ctx;
}

/** 未登录守卫：用于工作台布局 */
export function useRequireAuth(): { user: User | null; ready: boolean } {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [redirected, setRedirected] = useState(false);

  useEffect(() => {
    if (!loading && !user && !redirected) {
      setRedirected(true);
      router.replace('/login');
    }
  }, [loading, user, redirected, router]);

  return { user, ready: !!user && !loading };
}

export default AuthProvider;