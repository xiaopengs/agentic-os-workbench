/**
 * shared/loop · Agent Autoloop 领域契约（唯一事实源）
 *
 * 设计约束（对齐 docs/09 与参考系统 kernel/）：
 *  - 本文件只定义「数据形状 + 常量」，不含任何运行时逻辑、不依赖框架；
 *  - 内核 backend/lib/loop/kernel.ts 只依赖本文件，保持纯函数、可独立重放测试；
 *  - 与既有 shared/types.ts 完全隔离：旧接口（workflows/skills/auth）零改动、平滑迁移。
 */

/* ── 常量 ───────────────────────────────────────────────────── */
/** 跳数熔断：超过 8 层只记录、不再派活 */
export const MAX_HOPS = 8;
/** 连续失败上限，达到后轮次终态 cancelled */
export const MAX_ATTEMPTS = 10;
/** 字段长度上限（指令数据分离） */
export const LIMITS = {
  id: 200,
  type: 64,
  subject: 100,
  summary: 200,
  detail: 4000,
  link: 500,
} as const;

/** 事件 type 合法格式：小写字母开头，可用 x.* 通配 */
export const EVENT_TYPE_RE = /^(\*|[a-z][a-z0-9_.-]{0,63}(\.\*)?)$/;
/** subject 只允许标识符字符（会进提示词，必须收窄） */
export const SUBJECT_RE = /^[A-Za-z0-9#._:/@-]+$/;
/** link 只允许纯 ASCII 可打印字符 */
export const LINK_RE = /^[\x20-\x7E]+$/;

/**
 * 指令数据分离：这些字段属于「本机指令」，绝不允许出现在外部事件里。
 * 事件只能携带资料；交给谁、在哪个目录、什么权限，只由 rules 决定。
 */
export const FORBIDDEN_EVENT_FIELDS = [
  'cwd', 'agent', 'access', 'to', 'use', 'worker',
  'prompt', 'skill', 'channels', 'parallel', 'group', 'command', 'program',
] as const;

/* ── 事件 / 规则 / 插件 ─────────────────────────────────────── */
export interface LoopEvent {
  id: string;
  source: string;
  type: string;
  subject?: string;
  summary?: string;
  detail?: string;
  link?: string;
  /** 内核内部字段：跳数。客户端可传用于预演/测试，回执派生事件时由内核继承 +1 */
  hops?: number;
  receivedAt?: string;
}

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
  /** 暂停状态由 pauses 表达，这里保留只读标记便于前端展示 */
  paused?: boolean;
  enabled?: boolean;
}

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

/* ── 事项 / 轮次 / 卡片 ─────────────────────────────────────── */
export interface LoopLane {
  key: string;
  rule: string;
  subject: string;
  lastSession?: string;
  hops: number;
}

export type RunState = 'queued' | 'claimed' | 'unknown' | 'done' | 'nothing' | 'cancelled';
export const RUN_STATES: RunState[] = ['queued', 'claimed', 'unknown', 'done', 'nothing', 'cancelled'];

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
  /** 本轮领到的事件 fact seq */
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
export const CARD_KINDS: CardKind[] = ['ask', 'notice', 'fyi'];
export const CARD_STATES: CardState[] = ['open', 'decided', 'done', 'closed'];

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
}

/* ── 回执 ───────────────────────────────────────────────────── */
export type ReceiptOutcome = 'done' | 'nothing' | 'failed' | 'cancelled';
export const RECEIPT_OUTCOMES: ReceiptOutcome[] = ['done', 'nothing', 'failed', 'cancelled'];

export interface ReceiptAsk {
  title: string;
  text?: string;
  options: string[];
  recommend?: number;
  about?: string;
  key?: string;
}
export interface ReceiptNotice {
  title: string;
  text?: string;
  key?: string;
  fyi?: boolean;
}
export interface ReceiptLater {
  key: string;
  at?: string;
  about?: string;
  cancel?: boolean;
}

export interface LoopReceipt {
  outcome: ReceiptOutcome;
  summary?: string;
  error?: string;
  session?: string;
  usage?: LoopUsage;
  ask?: ReceiptAsk[];
  notice?: ReceiptNotice[];
  resolve?: Array<{ card: string; reason?: string }>;
  later?: ReceiptLater[];
  events?: LoopEvent[];
}

/* ── 事实日志（只追加，内核唯一写入物）──────────────────────── */
export type FactKind =
  | 'event.accepted' | 'hop.blocked'
  | 'rule.upserted' | 'rule.paused' | 'rule.resumed' | 'rules.reloaded' | 'plugin.upserted' | 'cron.fired'
  | 'run.queued' | 'run.claimed' | 'run.finished' | 'run.cancelled' | 'manual.run'
  | 'card.created' | 'card.answered' | 'card.closed'
  | 'timer.scheduled' | 'timer.fired' | 'timer.cancelled';

export interface FactBase {
  seq: number;
  at: string;
  kind: FactKind;
  /** 归属轮次 / 卡片 / 规则名，用于 why 溯源索引 */
  ref?: string;
}
export interface EventAcceptedFact extends FactBase {
  kind: 'event.accepted';
  event: LoopEvent;
  duplicate: boolean;
  routed: string[];
  /** 同事项已有活跃轮次时，本事件合并进该轮（不新建 Run） */
  mergedInto?: string;
}
export interface HopBlockedFact extends FactBase {
  kind: 'hop.blocked';
  event: LoopEvent;
  hops: number;
}
export interface RuleUpsertedFact extends FactBase {
  kind: 'rule.upserted';
  rule: LoopRule;
  version: number;
}
export interface RunQueuedFact extends FactBase {
  kind: 'run.queued';
  run: LoopRun;
}
export interface RunFinishedFact extends FactBase {
  kind: 'run.finished';
  id: string;
  receipt: LoopReceipt;
  duplicate?: boolean;
}
export interface CardCreatedFact extends FactBase {
  kind: 'card.created';
  card: LoopCard;
}
export interface CardAnsweredFact extends FactBase {
  kind: 'card.answered';
  id: string;
  choice?: number;
  text?: string;
  by: string;
}
export interface PluginUpsertedFact extends FactBase {
  kind: 'plugin.upserted';
  plugin: LoopPlugin;
}
/* 每种 kind 单独定义，保证 Extract<Fact,{kind:'X'}> 能精确收窄（合并 kind 会退化成 never） */
export interface RulePausedFact extends FactBase { kind: 'rule.paused'; name: string; reason?: string }
export interface RuleResumedFact extends FactBase { kind: 'rule.resumed'; name: string }
export interface RulesReloadedFact extends FactBase { kind: 'rules.reloaded'; version: number }
export interface CronFiredFact extends FactBase { kind: 'cron.fired'; name: string; day: string }
export interface RunClaimedFact extends FactBase { kind: 'run.claimed'; id: string }
export interface RunCancelledFact extends FactBase { kind: 'run.cancelled'; id: string }
export interface ManualRunFact extends FactBase { kind: 'manual.run'; id: string }
export interface CardClosedFact extends FactBase { kind: 'card.closed'; id: string; reason?: string }
export interface TimerScheduledFact extends FactBase {
  kind: 'timer.scheduled'; key: string; dueAt?: string; about?: string;
  /** 事项与规则（evolve 用于重建复查归属） */
  lane?: string; rule?: string;
}
export interface TimerFiredFact extends FactBase { kind: 'timer.fired'; key: string }
export interface TimerCancelledFact extends FactBase { kind: 'timer.cancelled'; key: string }
export type Fact =
  | EventAcceptedFact | HopBlockedFact | RuleUpsertedFact | RunQueuedFact | RunFinishedFact
  | CardCreatedFact | CardAnsweredFact | PluginUpsertedFact
  | RulePausedFact | RuleResumedFact | RulesReloadedFact | CronFiredFact
  | RunClaimedFact | RunCancelledFact | ManualRunFact | CardClosedFact
  | TimerScheduledFact | TimerFiredFact | TimerCancelledFact;

/* ── 输入（外壳喂给内核）───────────────────────────────────── */
export type LoopInput =
  | { kind: 'event'; event: LoopEvent }
  | { kind: 'plugin.upsert'; plugin: LoopPlugin }
  | { kind: 'rule.upsert'; rule: LoopRule }
  | { kind: 'rule.pause'; name: string; reason?: string }
  | { kind: 'rule.resume'; name: string }
  | { kind: 'rule.run'; name: string; subject?: string }
  | { kind: 'run.claim'; id: string }
  | { kind: 'run.result'; id: string; receipt: LoopReceipt }
  | { kind: 'card.answer'; id: string; choice?: number; text?: string; by: string }
  | { kind: 'card.resolve'; id: string; reason?: string }
  | { kind: 'tick' };

/* ── 投影视图（由事实日志重放得出）──────────────────────────── */
export interface LoopTimer {
  key: string;
  lane: string;
  rule: string;
  at: string;
  about?: string;
  fired?: boolean;
}

export interface LoopView {
  seq: number;
  rulesVersion: number;
  timezone: string;
  rules: Record<string, LoopRule>;
  plugins: {
    agents: Record<string, LoopAgent>;
    sources: Record<string, LoopSource>;
    channels: Record<string, LoopChannel>;
    deliveries: Record<string, LoopDelivery>;
  };
  /** `${source}\u0000${id}` → 首个 fact seq，事件去重 */
  dedupe: Record<string, number>;
  events: Array<{ seq: number; event: LoopEvent; routed: string[]; duplicate: boolean }>;
  runs: Record<string, LoopRun>;
  cards: Record<string, LoopCard>;
  lanes: Record<string, LoopLane>;
  timers: LoopTimer[];
  pauses: Record<string, { since: string; reason?: string }>;
  /** 已确认的累计用量（幂等重放不重复计） */
  usage: { runs: number; tokens: number; costCents: number };
  /** 回执内容指纹：`${runId}` → receipt JSON，用于幂等重交判定 */
  receipts: Record<string, string>;
  /** cron 规则最近一次触发的日期串（外壳注入 now 派生，内核不读时钟） */
  cronFired: Record<string, string>;
}

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
  events: LoopView['events'];
  runs: LoopRun[];
  cards: LoopCard[];
  timers: LoopTimer[];
  pauses: LoopView['pauses'];
  usage: LoopView['usage'];
}

/* ── API 路径常量 ───────────────────────────────────────────── */
export const LOOP_API = {
  STATE: '/loop/state',
  HEALTHZ: '/loop/healthz',
  EVENTS: '/loop/events',
  EVENT_BY_SEQ: (seq: number | string) => `/loop/events/${seq}`,
  EMIT: '/loop/emit',
  RULES: '/loop/rules',
  RULES_CHECK: '/loop/rules/check',
  RULE_PAUSE: (name: string) => `/loop/rules/${encodeURIComponent(name)}/pause`,
  RULE_RESUME: (name: string) => `/loop/rules/${encodeURIComponent(name)}/resume`,
  RULE_RUN: (name: string) => `/loop/rules/${encodeURIComponent(name)}/run`,
  RUNS: '/loop/runs',
  RUN_WHY: (id: string) => `/loop/runs/${encodeURIComponent(id)}/why`,
  RUN_CLAIM: (id: string) => `/loop/runs/${encodeURIComponent(id)}/claim`,
  RUN_RESULT: (id: string) => `/loop/runs/${encodeURIComponent(id)}/result`,
  CARDS: '/loop/cards',
  CARD_ANSWER: (id: string) => `/loop/cards/${encodeURIComponent(id)}/answer`,
  CARD_RESOLVE: (id: string) => `/loop/cards/${encodeURIComponent(id)}/resolve`,
  FACTS: '/loop/facts',
  TICK: '/loop/tick',
} as const;

/** 内核版本：参与事实日志格式指纹，变更时触发投影重建 */
export const LOOP_KERNEL_VERSION = 'autoloop-web-0.3.0';
