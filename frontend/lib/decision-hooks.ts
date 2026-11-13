'use client';

/**
 * decision-hooks · 决策面板数据层（SWR 声明式订阅）
 *
 * 与 loop-hooks.ts 同构，遵守「统一刷新入口 / 单向调用链」：
 *  - 组件只订阅 key，互不触发彼此渲染；
 *  - 任何写操作完成后只调 revalidateDecisions() 失效决策快照，SWR 自行重拉；
 *  - 决策数据独立 key，不与 /loop/* 交叉，避免误失效。
 */
import { useSWRConfig } from 'swr';
import { useApi } from './hooks';
import type { Decision } from './decision-types';

/** 决策列表（服务端已按 seq 升序，附 reviewDue 派生字段） */
export function useDecisions(refreshInterval = 15000) {
  return useApi<Decision[]>('/decisions', { refreshInterval });
}

/** 写后统一刷新入口（唯一失效通道） */
const DECISION_KEYS = ['/decisions'] as const;

export function useDecisionMutate() {
  const { mutate } = useSWRConfig();
  return {
    revalidateDecisions: () => Promise.all(DECISION_KEYS.map((key) => mutate(key))),
  };
}
