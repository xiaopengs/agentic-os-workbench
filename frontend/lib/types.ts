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
export interface CopilotMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CopilotRequest {
  messages: CopilotMessage[];
  context?: {
    page?: string;
    workflowId?: string;
    env?: string;
  };
}

/* ── UI 派生类型 ────────────────────────────────────────────── */
export type SyncState = 'ok' | 'syncing' | 'offline';

export interface Trend {
  /** 相对上周的百分比变化，null 表示无可比数据 */
  pct: number | null;
  label: string;
  flat: boolean;
}
