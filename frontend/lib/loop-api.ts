/**
 * loop-api · `/api/loop/*` 端点封装
 *
 * 复用 api-client 的 `request()`（统一信封拆解 / 401 跳转 / toast / Bearer + Cookie），
 * 不修改 api-client.ts 既有内容。所有路径与 shared/loop.ts 的 LOOP_API 常量一致。
 */
import { request } from './api-client';
import { emitToast } from './toast-bus';
import type {
  Fact, LoopCard, LoopEmitResp, LoopEvent, LoopPlugin, LoopPluginToggleResp, LoopPostEventResp,
  LoopRule, LoopRuleCheckResp, LoopRunResultResp, LoopRunsResp, LoopState, LoopWhyResp,
  LoopWorkerConfig, LoopWorkerRunResp, LoopWorkerStatus,
  LoopWorkerCapabilities, LoopWorkerConfigPatch,
} from './loop-types';

/** 外壳注入的固定 now 仅用于演示复现；正常留空由服务端取真实时间 */
export const loopApi = {
  /* 只读快照 / 日志 */
  state: () => request<LoopState>('/loop/state'),
  facts: (after?: number) =>
    request<Fact[]>('/loop/facts', { query: { after: after && after > 0 ? after : undefined } }),
  runs: (before?: number) =>
    request<LoopRunsResp>('/loop/runs', { query: { before: before && before > 0 ? before : undefined } }),
  why: (id: string) => request<LoopWhyResp>(`/loop/runs/${encodeURIComponent(id)}/why`),
  cards: () => request<LoopCard[]>('/loop/cards'),
  rules: () => request<LoopRule[]>('/loop/rules'),
  eventBySeq: (seq: number) => request<Fact>(`/loop/events/${seq}`),

  /* 事件 / 预演 */
  postEvent: (event: LoopEvent) =>
    request<LoopPostEventResp>('/loop/events', { method: 'POST', body: event }),
  emit: (event: LoopEvent) =>
    request<LoopEmitResp>('/loop/emit', { method: 'POST', body: event }),

  /* 规则 */
  postRule: (rule: LoopRule) =>
    request<{ rule: LoopRule; facts: number[] }>('/loop/rules', { method: 'POST', body: rule }),
  checkRule: (draft: LoopRule | LoopRule[]) =>
    request<LoopRuleCheckResp>('/loop/rules/check', {
      method: 'POST',
      body: Array.isArray(draft) ? { rules: draft } : { rule: draft },
    }),
  pauseRule: (name: string, reason?: string) =>
    request<{ paused: boolean; facts: number[] }>(
      `/loop/rules/${encodeURIComponent(name)}/pause`,
      { method: 'POST', body: reason ? { reason } : {} },
    ),
  resumeRule: (name: string) =>
    request<{ paused: boolean; facts: number[] }>(
      `/loop/rules/${encodeURIComponent(name)}/resume`,
      { method: 'POST', body: {} },
    ),
  runRule: (name: string, subject?: string) =>
    request<{ run: string; facts: number[] }>(
      `/loop/rules/${encodeURIComponent(name)}/run`,
      { method: 'POST', body: subject ? { subject } : {} },
    ),

  /* 轮次 */
  claimRun: (id: string) =>
    request<{ claimed: boolean; facts: number[] }>(
      `/loop/runs/${encodeURIComponent(id)}/claim`,
      { method: 'POST', body: {} },
    ),
  resultRun: (id: string, receipt: Record<string, unknown>) =>
    request<LoopRunResultResp>(
      `/loop/runs/${encodeURIComponent(id)}/result`,
      { method: 'POST', body: receipt },
    ),

  /* 卡片 */
  answerCard: (id: string, body: { choice?: number; text?: string }) =>
    request<{ decided: boolean; resumedRun: string | null; facts: number[] }>(
      `/loop/cards/${encodeURIComponent(id)}/answer`,
      { method: 'POST', body },
    ),
  resolveCard: (id: string, reason?: string) =>
    request<{ closed: boolean; facts: number[] }>(
      `/loop/cards/${encodeURIComponent(id)}/resolve`,
      { method: 'POST', body: reason ? { reason } : {} },
    ),

  /* M7/M8 真实 Agent 执行器 */
  workerStatus: () => request<LoopWorkerStatus>('/loop/worker/status'),
  /** 两层插件的可选项 + 本机真实安装/凭据状态 */
  workerCapabilities: () => request<LoopWorkerCapabilities>('/loop/worker/capabilities'),
  workerRun: () => request<LoopWorkerRunResp>('/loop/worker/run', { method: 'POST', body: {} }),
  workerConfig: (patch: LoopWorkerConfigPatch) =>
    request<{ config: LoopWorkerConfig; status: LoopWorkerStatus }>('/loop/worker/config', { method: 'POST', body: patch }),

  /* 时钟 / 插件 */
  tick: () => request<{ fired: number; newRuns: number; facts: number[] }>('/loop/tick', { method: 'POST', body: {} }),
  postPlugin: (plugin: LoopPlugin) =>
    request<{ plugin: LoopPlugin; facts: number[] }>('/loop/plugins', { method: 'POST', body: plugin }),
  disablePlugin: (id: string, reason?: string) =>
    request<LoopPluginToggleResp>(
      `/loop/plugins/${encodeURIComponent(id)}/disable`,
      { method: 'POST', body: reason ? { reason } : {} },
    ),
  enablePlugin: (id: string) =>
    request<LoopPluginToggleResp>(
      `/loop/plugins/${encodeURIComponent(id)}/enable`,
      { method: 'POST', body: {} },
    ),
};

/** 统一写后提示（保持与旧 workflow 创建一致的 toast 反馈） */
export function loopToast(text: string): void {
  emitToast(text);
}
