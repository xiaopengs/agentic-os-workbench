/**
 * loop-types · Autoloop 领域契约【前端镜像】
 *
 * 唯一事实源是仓库根目录 `shared/loop.ts`（后端 + 内核共用）。
 * 沿用项目既有惯例：`frontend/lib/types.ts` 镜像 `shared/types.ts`，
 * 前端不跨 `frontend/` 目录 import 后端文件（Next standalone 打包边界），
 * 故此处按展示所需字段做结构镜像，字段名/取值与 shared/loop.ts 严格一致。
 *
 * ⚠️ 本文件只定义「数据形状」，不含运行时逻辑；改字段请先改 shared/loop.ts。
 */

/* ── 规则 / 事件 ─────────────────────────────────────────── */
export type EventFilter = { source: string; types: string[] };
export type RuleWhen = EventFilter | { cron: string };
export type TellMode = 'always' | 'needed' | 'never';
export type AccessMode = 'read' | 'edit' | 'full';

export interface LoopRule {
  name: string;
  when: RuleWhen;
  to: string;
  cwd: string;
  skill?: string;
  prompt?: string;
  title?: string;
  group: string;
  parallel?: number;
  resume?: boolean;
  tell: TellMode;
  emits?: EventFilter;
  channels?: string[];
  paused?: boolean;
  enabled?: boolean;
}

export interface LoopEvent {
  id: string;
  source: string;
  type: string;
  subject?: string;
  summary?: string;
  detail?: string;
  link?: string;
  hops?: number;
  receivedAt?: string;
}

/* ── 插件（四方向）─────────────────────────────────────────── */
export interface LoopAgent {
  id: string;
  name: string;
  worker: string;
  use: string;
  access: AccessMode;
  model?: string;
  kind: 'agent';
}
export interface LoopSource {
  id: string;
  name: string;
  adapter?: string;
  kind: 'source';
}
export interface LoopChannel {
  id: string;
  name: string;
  answerers?: string[];
  links?: boolean;
  kind: 'channel';
}
export interface LoopDelivery {
  id: string;
  name: string;
  repo?: string;
  kind: 'delivery';
}
export type LoopPlugin = LoopAgent | LoopSource | LoopChannel | LoopDelivery;
export type PluginKind = LoopPlugin['kind'];

/* ── 轮次 / 卡片 ─────────────────────────────────────────── */
export type RunState = 'queued' | 'claimed' | 'unknown' | 'done' | 'nothing' | 'cancelled';

export interface LoopUsage {
  input?: number;
  output?: number;
  cached?: number;
  cost?: number;
}

export interface LoopRun {
  id: string;
  seq: number;
  rule: string;
  agent: string;
  lane: string;
  state: RunState;
  attempts: number;
  eventSeqs: number[];
  session?: string;
  summary?: string;
  error?: string;
  usage?: LoopUsage;
  rulesVersion: number;
  hops: number;
  startedAt?: string;
  finishedAt?: string;
}

export type CardKind = 'ask' | 'notice' | 'fyi';
export type CardState = 'open' | 'decided' | 'done' | 'closed';

export interface LoopCard {
  id: string;
  version: number;
  kind: CardKind;
  state: CardState;
  title: string;
  text: string;
  options: string[];
  recommend?: number;
  choice?: number;
  answer?: string;
  by?: string;
  result?: string;
  lane: string;
  about?: string;
  key?: string;
  createdAt: string;
  run?: string;
  /** M4：送达通道与应答者白名单快照（空名单=登录本人可答） */
  channel?: string;
  answerers?: string[];
}

/* ── 事实日志（事件溯源）──────────────────────────────────── */
export type FactKind =
  | 'event.accepted' | 'hop.blocked'
  | 'rule.upserted' | 'rule.paused' | 'rule.resumed' | 'rules.reloaded'
  | 'plugin.upserted' | 'plugin.disabled' | 'plugin.enabled' | 'cron.fired'
  | 'run.queued' | 'run.claimed' | 'run.finished' | 'run.cancelled' | 'manual.run'
  | 'card.created' | 'card.answered' | 'card.closed'
  | 'timer.scheduled' | 'timer.fired' | 'timer.cancelled';

/** 前端展示用：不追求逐 kind 精确收窄，统一成宽松形状 + 可选载荷 */
export interface Fact {
  seq: number;
  at: string;
  kind: FactKind;
  ref?: string;
  event?: LoopEvent;
  duplicate?: boolean;
  routed?: string[];
  mergedInto?: string;
  hops?: number;
  rule?: LoopRule;
  version?: number;
  name?: string;
  reason?: string;
  plugin?: LoopPlugin;
  day?: string;
  run?: LoopRun;
  id?: string;
  receipt?: { outcome: string; summary?: string };
  card?: LoopCard;
  choice?: number;
  text?: string;
  by?: string;
  key?: string;
  dueAt?: string;
  about?: string;
}

/* ── 全局快照 ─────────────────────────────────────────────── */
export interface LoopTotals {
  rules: number;
  activeRules: number;
  openCards: number;
  runs: number;
  queuedRuns: number;
  events: number;
  agents: number;
  sources: number;
  channels: number;
  deliveries: number;
  facts: number;
  hopsBlocked: number;
}

export interface LoopStateEvent {
  seq: number;
  event: LoopEvent;
  routed: string[];
  duplicate: boolean;
}

export interface LoopState {
  seq: number;
  rulesVersion: number;
  timezone: string;
  now: string;
  totals: LoopTotals;
  rules: LoopRule[];
  agents: LoopAgent[];
  sources: LoopSource[];
  channels: LoopChannel[];
  deliveries: LoopDelivery[];
  events: LoopStateEvent[];
  runs: LoopRun[];
  cards: LoopCard[];
  timers: Array<{ key: string; lane: string; rule: string; at: string; about?: string; fired?: boolean }>;
  pauses: Record<string, { since: string; reason?: string }>;
  /** M4：已停用插件 id → 停用信息 */
  disabledPlugins: Record<string, { since: string; reason?: string }>;
  usage: { runs: number; tokens: number; costCents: number };
}

/* ── 各端点响应 ───────────────────────────────────────────── */
export interface LoopRunsResp { runs: LoopRun[]; hasMore: boolean }
export interface LoopWhyResp { run: string; timeline: Fact[] }
export interface LoopPostEventResp {
  event: number;
  duplicate: boolean;
  routed: string[];
  mergedInto: string | null;
  hopBlocked: boolean;
  facts: number[];
}
export interface LoopEmitResp {
  routed: string[];
  wouldBlock: boolean;
  duplicate: boolean;
  matched: string[];
}
export interface LoopRuleCheckResp { valid: boolean; issues: string[] }
/** M4 插件启停响应 */
export interface LoopPluginToggleResp {
  disabled: boolean;
  id: string;
  facts: number[];
}
export interface LoopRunResultResp {
  duplicate: boolean;
  cards: string[];
  derivedRuns: string[];
  facts: number[];
}

/* ── M7 · 真实 Agent 执行器（镜像 shared/loop.ts）──────────── */
export type LoopWorkerMode = 'cli' | 'gateway' | 'off';
export interface LoopWorkerConfig {
  mode: LoopWorkerMode;
  maxPerTick: number;
  timeoutMs: number;
  auto: boolean;
  bin: string;
  intervalMs: number;
}
export interface LoopWorkerJob {
  runId: string;
  rule: string;
  agent: string;
  mode: LoopWorkerMode;
  status: 'running' | 'done' | 'failed' | 'timeout' | 'skipped';
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  outcome?: string;
  summary?: string;
  error?: string;
  real: boolean;
  facts: number[];
}
export interface LoopWorkerStatus {
  config: LoopWorkerConfig;
  busy: boolean;
  available: boolean;
  reason: string;
  totalExecuted: number;
  lastTickAt?: string;
  lastJob?: LoopWorkerJob;
  jobs: LoopWorkerJob[];
}
export interface LoopWorkerRunResp {
  executed: number;
  queuedBefore: number;
  queuedAfter: number;
  jobs: LoopWorkerJob[];
  busy?: boolean;
}
