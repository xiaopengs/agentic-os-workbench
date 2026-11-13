/**
 * decision-api · `/api/decisions/*` 端点封装（M6）
 *
 * 复用 api-client 的 request()（统一信封 / 401 跳转 / toast / Bearer + Cookie）。
 * 路径与 shared/decision.ts 的 DECISION_API 常量一致。
 */
import { request } from './api-client';
import { emitToast } from './toast-bus';
import type {
  Decision, DecisionInput, DecisionScoreResp, DecisionStatus, DecisionToRuleResp,
} from './decision-types';

export const decisionApi = {
  list: (params?: { status?: string; tag?: string; q?: string }) =>
    request<Decision[]>('/decisions', { query: params }),
  get: (id: string) => request<Decision>(`/decisions/${encodeURIComponent(id)}`),
  create: (input: DecisionInput) =>
    request<Decision>('/decisions', { method: 'POST', body: input }),
  update: (id: string, patch: Partial<DecisionInput>) =>
    request<Decision>(`/decisions/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  remove: (id: string) =>
    request<{ ok: boolean }>(`/decisions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  review: (id: string, to: DecisionStatus, note?: string) =>
    request<Decision>(`/decisions/${encodeURIComponent(id)}/review`, {
      method: 'POST', body: { to, ...(note ? { note } : {}) },
    }),
  score: (id: string, weights?: Record<string, number>) =>
    request<DecisionScoreResp>(`/decisions/${encodeURIComponent(id)}/score`, {
      query: weights ? { weights: JSON.stringify(weights) } : undefined,
    }),
  /** D1：只生成并校验规则草案，不落库；落库由调用方用 loopApi.postRule 完成 */
  toRule: (id: string, agent?: string) =>
    request<DecisionToRuleResp>(`/decisions/${encodeURIComponent(id)}/to-rule`, {
      method: 'POST', body: agent ? { agent } : {},
    }),
};

export function decisionToast(text: string): void {
  emitToast(text);
}
