/**
 * 前后端共享契约 · 唯一事实源（Contract-First）
 * 来源：docs/05-商业化架构选型与技术方案.md §五 API 契约
 *
 * ⚠️ 本文件与 frontend/lib/types.ts 的实体字段必须逐字一致。
 *    前端镜像文件位于 frontend/lib/types.ts，后端实现以本文件为准。
 *    实体定义之外，本文件额外补充：API 路径常量、错误码常量、配额常量（后端所需）。
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

/* ══════════════════════════════════════════════════════════════
 * 以下为后端所需常量（前端可直接使用，避免硬编码字符串）
 * ══════════════════════════════════════════════════════════════ */

/* ── API 路径常量（不含 /api 前缀，前端 API_BASE 默认为 /api） ── */
export const API = {
  AUTH_ME: '/auth/me',
  AUTH_LOGIN: '/auth/login',
  AUTH_REGISTER: '/auth/register',
  AUTH_LOGOUT: '/auth/logout',

  WORKFLOWS: '/workflows',
  WORKFLOW_BY_ID: (id: string) => `/workflows/${encodeURIComponent(id)}`,

  TRACES: '/traces',
  SKILLS: '/skills',
  CONTRACTS: '/contracts',
  DEVICES: '/devices',
  USAGE: '/usage',
  AUDIT: '/audit',

  AI_COPILOT: '/ai/copilot',
} as const;

/* ── 错误码常量 ─────────────────────────────────────────────── */
export const ERROR_CODES = {
  /** 未登录 / 会话失效 → HTTP 401 */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** 配额耗尽 → HTTP 402 */
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  /** 资源不存在 → HTTP 404 */
  NOT_FOUND: 'NOT_FOUND',
  /** 入参校验失败 → HTTP 400 */
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  /** 资源冲突（如邮箱已注册）→ HTTP 409 */
  CONFLICT: 'CONFLICT',
  /** AI Gateway 未配置 / 不可用 → HTTP 503 */
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** 错误码 → HTTP 状态码映射 */
export const HTTP_STATUS_BY_CODE: Record<string, number> = {
  [ERROR_CODES.UNAUTHORIZED]: 401,
  [ERROR_CODES.QUOTA_EXCEEDED]: 402,
  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.VALIDATION_ERROR]: 400,
  [ERROR_CODES.CONFLICT]: 409,
  [ERROR_CODES.AI_UNAVAILABLE]: 503,
};

/* ── 配额常量 ───────────────────────────────────────────────── */
export const FREE_LIMIT = 100;
export const PRO_LIMIT = 10000;

export const PLAN_LIMITS: Record<Plan, number> = {
  free: FREE_LIMIT,
  pro: PRO_LIMIT,
};

/* ── AI Gateway 常量（平台自动注入，禁止硬编码到业务代码） ──── */
export const AI_GATEWAY_ENV_KEYS = {
  API_KEY: 'AI_GATEWAY_API_KEY',
  BASE_URL: 'AI_GATEWAY_BASE_URL',
  MODEL: 'AI_GATEWAY_MODEL',
} as const;

/** 未显式配置 AI_GATEWAY_MODEL 时的默认模型 */
export const DEFAULT_AI_MODEL = '@makers/deepseek-v4-flash';

/* ── 其他共享常量 ───────────────────────────────────────────── */
export const WORKFLOW_STATUSES: WorkflowStatus[] = ['running', 'done', 'failed', 'queued'];
export const TRACE_KINDS: TraceKind[] = ['Agent', 'Skill', 'Tool', 'Contract'];
export const TRACE_STATUSES: TraceStatus[] = ['Success', 'Failed', 'Running'];