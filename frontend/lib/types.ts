/**
 * 前后端共享契约 · 前端镜像
 * 来源：docs/05-商业化架构选型与技术方案.md §五 API 契约（Contract-First）
 *
 * ⚠️ 若仓库根目录 shared/types.ts 已由后端生成，请以该文件为唯一事实源，
 *    本文件仅作为后端契约就绪前的过渡镜像；两处字段命名保持一致。
 */

/* ── 统一响应规范 ───────────────────────────────────────────── */
export type ApiOk<T> = { ok: true; data: T };
export type ApiErrBody = { code: string; message: string };
export type ApiErr = { ok: false; error: ApiErrBody };
export type ApiResp<T> = ApiOk<T> | ApiErr;

/* ── 鉴权 ───────────────────────────────────────────────────── */
export type Plan = 'free' | 'pro';

export interface User {
  id: string;
  email: string;
  plan: Plan;
  createdAt?: string;
}

export interface AuthResult {
  user: User;
  token: string;
}

/* ── 业务资源 ───────────────────────────────────────────────── */
export type WorkflowStatus = 'running' | 'done' | 'failed' | 'queued';

export interface Workflow {
  id: string;
  name: string;
  category: string;
  description?: string;
  /** 参与设备数 */
  devices: number;
  /** 编排步骤数 */
  steps: number;
  /** 场景覆盖率 0-100 */
  coverage: number;
  /** 回归时长（分钟） */
  duration: number;
  status: WorkflowStatus;
  env?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type WorkflowInput = Omit<Workflow, 'id' | 'createdAt' | 'updatedAt'>;

export type TraceKind = 'Agent' | 'Skill' | 'Tool' | 'Contract';
export type TraceStatus = 'Success' | 'Failed' | 'Running';

export interface Trace {
  id: string;
  /** Span 类型 */
  kind: TraceKind;
  /** Span 名称 */
  name: string;
  /** 耗时毫秒 */
  cost: number;
  status: TraceStatus;
  /** HH:MM:SS */
  time: string;
  createdAt?: string;
}

export type TraceInput = Pick<Trace, 'kind' | 'name' | 'cost' | 'status' | 'time'>;

export interface Skill {
  id: string;
  name: string;
  version: string;
  category?: string;
  description?: string;
  status?: 'draft' | 'active' | 'deprecated';
  updatedAt?: string;
}

export interface Contract {
  id: string;
  name: string;
  version?: string;
  toolName?: string;
  permissionLevel?: string;
  status?: 'draft' | 'active' | 'deprecated';
  updatedAt?: string;
}

export interface Usage {
  month: string;
  plan: Plan;
  runs: number;
  tokens: number;
  costCents: number;
  /** 当月配额上限（free 100 / pro 10000） */
  limit: number;
}

export interface AuditLog {
  id: string;
  action: string;
  target?: string;
  actor?: string;
  at: string;
}

export interface Device {
  id: string;
  name: string;
  model?: string;
  os?: string;
  status?: 'online' | 'busy' | 'offline';
}

/* ── AI Copilot（SSE） ──────────────────────────────────────── */

/** Copilot 快捷场景（右侧栏 4 个入口） */
export type CopilotKind = 'skill' | 'contract' | 'regression' | 'trace';

export interface CopilotMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CopilotContext {
  page?: string;
  workflowId?: string;
  env?: string;
  /** 快捷场景：用于定制系统提示词与预设开场白 */
  kind?: CopilotKind;
}

export interface CopilotRequest {
  messages: CopilotMessage[];
  context?: CopilotContext;
}

/* ── AI Copilot · SSE 事件（data: <JSON>） ──────────────────── */

/** 文本增量：data: {"delta":"..."} */
export interface CopilotDeltaEvent {
  delta: string;
}

/** 心跳保活（5s 一次，前端忽略） */
export interface CopilotPingEvent {
  type: 'ping';
  ts: number;
}

/** 流已开启后再出错，只能用事件表达（HTTP 状态码已提交） */
export interface CopilotErrorEvent {
  error: { code: string; message: string };
}

/** 用量回执（后端端点回传 runs/tokens/limit；平台 agents 端点仅有 tokens） */
export interface CopilotUsageEvent {
  type: 'usage';
  usage: { tokens: number; runs?: number; limit?: number };
}

/** 工具调用进度（仅 agents/ 平台端点产出） */
export interface CopilotToolEvent {
  type: 'tool_call' | 'tool_result';
  name: string;
  content?: string;
}

export type CopilotStreamEvent =
  | CopilotDeltaEvent
  | CopilotPingEvent
  | CopilotErrorEvent
  | CopilotUsageEvent
  | CopilotToolEvent;

/** SSE 结束标记 */
export const SSE_DONE = '[DONE]';

/* ── UI 派生类型 ────────────────────────────────────────────── */
export type SyncState = 'ok' | 'syncing' | 'offline';

export interface Trend {
  /** 相对上周的百分比变化，null 表示无可比数据 */
  pct: number | null;
  label: string;
  flat: boolean;
}
