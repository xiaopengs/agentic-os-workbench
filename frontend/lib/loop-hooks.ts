'use client';

/**
 * loop-hooks · Autoloop 数据层（SWR 声明式订阅）
 *
 * 架构约束（对齐重构文档「单向调用链 / 统一刷新入口」）：
 *  - 所有组件只订阅 SWR key，互不调用、互不触发彼此渲染；
 *  - 任何写操作完成后，只调一个 `revalidateLoop()` 统一失效 `/loop/*` 缓存，
 *    SWR 自行按 key 重拉，形成「事件 → 改数据 → 统一失效 → 各自重渲染」的单向 DAG。
 */
import { useSWRConfig } from 'swr';
import { useApi } from './hooks';
import type { SyncState } from './types';
import type { Fact, LoopCard, LoopRunsResp, LoopState } from './loop-types';

/* ── 读 hooks（key 即 request path，SWR 自动去重）──────────── */

/** 全局快照：totals / rules / plugins / runs / cards / events / usage 一次拿全 */
export function useLoopState(refreshInterval = 8000) {
  return useApi<LoopState>('/loop/state', { refreshInterval });
}

/** 事实日志流（事件溯源；after 用于增量，总览默认全量最近） */
export function useLoopFacts(refreshInterval = 5000) {
  return useApi<Fact[]>('/loop/facts', { refreshInterval });
}

/** 轮次列表 */
export function useLoopRuns(refreshInterval = 8000) {
  return useApi<LoopRunsResp>('/loop/runs', { refreshInterval });
}

/** 卡片列表 */
export function useLoopCards(refreshInterval = 8000) {
  return useApi<LoopCard[]>('/loop/cards', { refreshInterval });
}

/* ── 聚合：总览页各卡片共享同一份订阅（SWR 去重，不重复请求）── */
export interface LoopWorkbench {
  state: LoopState | null;
  totals: LoopState['totals'] | null;
  facts: Fact[];
  loading: boolean;
  sync: SyncState;
  error: unknown;
}

export function useLoopWorkbench(): LoopWorkbench {
  const st = useLoopState();
  const fc = useLoopFacts();

  const state = st.data ?? null;
  const facts = fc.data ?? [];
  const error = st.error || fc.error || null;
  const loading = !!(st.isLoading || fc.isLoading);
  const isValidating = !!(st.isValidating || fc.isValidating);
  const sync: SyncState = error ? 'offline' : isValidating ? 'syncing' : 'ok';

  return {
    state,
    totals: state?.totals ?? null,
    facts,
    loading,
    sync,
    error,
  };
}

/* ── 写后统一刷新入口（唯一失效通道）──────────────────────── */
/** 本模块订阅的全部 SWR key（封闭集合，写后统一失效） */
const LOOP_KEYS = ['/loop/state', '/loop/facts', '/loop/runs', '/loop/cards'] as const;

export function useLoopMutate() {
  const { mutate } = useSWRConfig();
  return {
    /**
     * 统一刷新入口：失效全部 `/loop/*` 快照缓存。
     * 显式列出封闭 key 集合（而非 filter function），规避 SWR 版本差异；
     * 不传 data 故只触发 revalidate，配合 keepPreviousData 不会闪空。
     */
    revalidateLoop: () => Promise.all(LOOP_KEYS.map((key) => mutate(key))),
  };
}
