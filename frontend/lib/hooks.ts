'use client';

/**
 * SWR 数据层：所有业务数据均来自后端 REST API（/api/*）
 * 返回结构与 05 文档契约一致，见 lib/types.ts
 */
import { useMemo } from 'react';
import useSWR, { useSWRConfig, type SWRConfiguration } from 'swr';
import { api, request } from './api-client';
import { weeklyTrend, type TrendResult } from './format';
import {
  buildCanary,
  buildNextStep,
  buildStages,
  stageRatio,
  type NextStep,
  type Stage,
} from './simulation';
import type { AuditLog, Contract, Device, Skill, SyncState, Trace, Usage, Workflow } from './types';

/** 通用 fetcher（path 直接作为 SWR key） */
const fetcher = <T,>(path: string) => request<T>(path);

export function useApi<T>(path: string | null, config?: SWRConfiguration<T>) {
  return useSWR<T>(path, fetcher as (p: string) => Promise<T>, {
    revalidateOnFocus: true,
    keepPreviousData: true,
    ...config,
  });
}

/* ── 资源 hooks ──────────────────────────────────────────────── */

/** Trace 实时性最强：5s 轮询重验证 */
export function useTraces(refreshInterval = 5000) {
  return useApi<Trace[]>('/traces', { refreshInterval });
}

export function useWorkflows(refreshInterval = 15000) {
  return useApi<Workflow[]>('/workflows', { refreshInterval });
}

export function useSkills(refreshInterval = 60000) {
  return useApi<Skill[]>('/skills', { refreshInterval });
}

export function useContracts(refreshInterval = 60000) {
  return useApi<Contract[]>('/contracts', { refreshInterval });
}

export function useUsage(refreshInterval = 60000) {
  return useApi<Usage>('/usage', { refreshInterval });
}

export function useAudit(refreshInterval = 30000) {
  return useApi<AuditLog[]>('/audit', { refreshInterval });
}

/** 契约中暂无 /devices，失败降级为空数组，不打扰用户 */
export function useDevices(refreshInterval = 60000) {
  return useSWR<Device[]>('/devices', () => api.devices.list(), {
    refreshInterval,
    keepPreviousData: true,
  });
}

/* ── 工作台聚合数据（总览 + 右侧栏共用，SWR 自动去重） ──────── */
export interface WorkbenchData {
  workflows: Workflow[];
  traces: Trace[];
  skills: Skill[];
  contracts: Contract[];
  usage: Usage | null;
  audit: AuditLog[];
  devices: Device[];
  loading: boolean;
  isValidating: boolean;
  error: unknown;
  sync: SyncState;
  kpis: {
    contract: { value: number; trend: TrendResult };
    skills: { value: number; trend: TrendResult };
    tests: { value: number; trend: TrendResult };
    devices: { value: number; trend: TrendResult };
  };
  stages: Stage[];
  ratio: number;
  nextStep: NextStep[];
  canary: number;
  runningCount: number;
  doneCount: number;
  failedCount: number;
}

export function useWorkbench(): WorkbenchData {
  const wf = useWorkflows();
  const tr = useTraces();
  const sk = useSkills();
  const ct = useContracts();
  const us = useUsage();
  const au = useAudit();
  const dv = useDevices();

  const workflows = wf.data ?? [];
  const traces = tr.data ?? [];
  const skills = sk.data ?? [];
  const contracts = ct.data ?? [];
  const audit = au.data ?? [];
  const devices = dv.data ?? [];

  const loading = !!(wf.isLoading || tr.isLoading || sk.isLoading || ct.isLoading);
  const isValidating = !!(wf.isValidating || tr.isValidating || sk.isValidating || ct.isValidating);
  const error = wf.error || tr.error || sk.error || ct.error || null;

  const runningCount = workflows.filter((w) => w.status === 'running').length;
  const doneCount = workflows.filter((w) => w.status === 'done').length;
  const failedCount = workflows.filter((w) => w.status === 'failed').length;

  const kpis = useMemo(
    () => ({
      contract: { value: contracts.length, trend: weeklyTrend(contracts) },
      skills: { value: skills.length, trend: weeklyTrend(skills) },
      tests: { value: runningCount, trend: weeklyTrend(workflows) },
      devices: {
        value: workflows.reduce((sum, w) => sum + (w.devices || 0), 0),
        trend: weeklyTrend(workflows),
      },
    }),
    [contracts, skills, workflows, runningCount],
  );

  const stages = useMemo(
    () =>
      buildStages({
        contracts: contracts.length,
        skills: skills.length,
        traces: {
          total: traces.length,
          ok: traces.filter((t) => t.status === 'Success').length,
        },
        workflows: { total: workflows.length, done: doneCount, running: runningCount },
      }),
    [contracts.length, skills.length, traces, workflows.length, doneCount, runningCount],
  );

  const ratio = useMemo(() => stageRatio(stages), [stages]);
  const nextStep = useMemo(() => buildNextStep(stages, ratio), [stages, ratio]);
  const canary = useMemo(() => buildCanary(ratio), [ratio]);

  const sync: SyncState = error ? 'offline' : isValidating ? 'syncing' : 'ok';

  return {
    workflows,
    traces,
    skills,
    contracts,
    usage: us.data ?? null,
    audit,
    devices,
    loading,
    isValidating,
    error,
    sync,
    kpis,
    stages,
    ratio,
    nextStep,
    canary,
    runningCount,
    doneCount,
    failedCount,
  };
}

/* ── 写操作 + 缓存失效 ──────────────────────────────────────── */
export function useMutate() {
  const { mutate } = useSWRConfig();
  return {
    revalidateWorkflows: () => mutate('/workflows'),
    revalidateTraces: () => mutate('/traces'),
    revalidateUsage: () => mutate('/usage'),
    revalidateAudit: () => mutate('/audit'),
    revalidateAll: () => {
      void mutate('/workflows');
      void mutate('/traces');
      void mutate('/skills');
      void mutate('/contracts');
      void mutate('/usage');
      void mutate('/audit');
    },
    /** 登出时清空全部本地缓存，避免跨账号数据残留 */
    clearAll: () =>
      mutate(() => true, undefined, { revalidate: false }),
  };
}