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
/**
 * subject 允许任意「可见文字」：中文、空格、标点、标识符均可（事项本来就是人写的标题）。
 * 只拒绝控制字符与不可见格式符 —— 它们才是注入与结构破坏的载体：
 *  - C0/C1 控制符 \\u0000-\\u001F / \\u007F-\\u009F：NUL 会破坏 lane 的 \\u0000 分隔，换行可伪造提示词指令行
 *  - 零宽 / 双向 / 不可见格式符 \\u200B-\\u200F \\u202A-\\u202E \\u2060-\\u2064 \\u2066-\\u2069 \\uFEFF：可藏入不可见指令
 * 长度上限见 LIMITS.subject；显示走 React 文本节点，天然转义。
 */
export const SUBJECT_RE = /^[^\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]+$/;
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
  /** M4：送达通道及其应答者白名单快照（创建时固化，重放确定；空名单=登录本人可答） */
  channel?: string;
  answerers?: string[];
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
  /** M4：指定送达通道；内核把该通道的 answerers 名单快照进卡片，做通道级应答身份校验 */
  channel?: string;
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
  | 'rule.upserted' | 'rule.paused' | 'rule.resumed' | 'rules.reloaded' | 'plugin.upserted' | 'plugin.disabled' | 'plugin.enabled' | 'cron.fired'
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
export interface PluginDisabledFact extends FactBase { kind: 'plugin.disabled'; id: string; reason?: string }
export interface PluginEnabledFact extends FactBase { kind: 'plugin.enabled'; id: string }
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
  | CardCreatedFact | CardAnsweredFact | PluginUpsertedFact | PluginDisabledFact | PluginEnabledFact
  | RulePausedFact | RuleResumedFact | RulesReloadedFact | CronFiredFact
  | RunClaimedFact | RunCancelledFact | ManualRunFact | CardClosedFact
  | TimerScheduledFact | TimerFiredFact | TimerCancelledFact;

/* ── 输入（外壳喂给内核）───────────────────────────────────── */
export type LoopInput =
  | { kind: 'event'; event: LoopEvent }
  | { kind: 'plugin.upsert'; plugin: LoopPlugin }
  | { kind: 'plugin.disable'; id: string; reason?: string }
  | { kind: 'plugin.enable'; id: string }
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
  /** M4：已停用插件 id → 停用信息；停用后不派活（对称 rule.pause 的 pauses） */
  disabledPlugins: Record<string, { since: string; reason?: string }>;
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
  disabledPlugins: LoopView['disabledPlugins'];
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
  /* M7 真实 Agent 执行器 */
  WORKER_STATUS: '/loop/worker/status',
  WORKER_RUN: '/loop/worker/run',
  WORKER_CONFIG: '/loop/worker/config',
  WORKER_CAPABILITIES: '/loop/worker/capabilities',
  PLUGIN_DISABLE: (id: string) => `/loop/plugins/${encodeURIComponent(id)}/disable`,
  PLUGIN_ENABLE: (id: string) => `/loop/plugins/${encodeURIComponent(id)}/enable`,
} as const;

/* ── M7 · 真实 Agent 执行器 ────────────────────────────────────
 * 内核是纯确定性的状态机，不认识模型；「领活 → 让 Agent 干活 → 交回执」
 * 由外壳（worker）完成，语义对齐参考系统的 worker/ + plugins/ 分层。
 * ------------------------------------------------------------ */

/**
 * 执行模式（M7 遗留别名，M8 起仅 off 有执行语义）：
 *   cli / gateway 仍可写入，后端会翻译成对应的 harness × provider 组合；
 *   真正决定「怎么跑」的是 harness + provider 两个插件维度。
 */
export type LoopWorkerMode = 'cli' | 'gateway' | 'off';

/** 模型 API 方言，是 harness 与 provider 之间唯一的耦合契约 */
export type LoopProviderProtocol = 'platform' | 'anthropic' | 'openai' | 'google';

/** 能力清单：harness 插件的可选项（含本机真实安装状态） */
export interface LoopHarnessCapability {
  id: string;
  label: string;
  protocol: LoopProviderProtocol;
  installed: boolean;
  version?: string;
  reason: string;
  installHint?: string;
  docs?: string;
  note?: string;
}

/** 能力清单：provider 插件的可选项（Key 只回显「有没有」，绝不回显值） */
export interface LoopProviderCapability {
  id: string;
  label: string;
  protocols: LoopProviderProtocol[];
  endpoints: Partial<Record<LoopProviderProtocol, string>>;
  defaultModels: Partial<Record<LoopProviderProtocol, string>>;
  requiresKey: boolean;
  hasKey: boolean;
  keyEnv?: string;
  docs?: string;
  note?: string;
}

export interface LoopWorkerCapabilities {
  harnesses: LoopHarnessCapability[];
  providers: LoopProviderCapability[];
  protocols: Array<{ id: LoopProviderProtocol; label: string }>;
}

export interface LoopWorkerConfig {
  mode: LoopWorkerMode;
  /** Agent 运行时插件 id（codebuddy / claude-code / codex / gemini-cli / http-direct） */
  harness: string;
  /** 模型供应商插件 id（platform / openrouter / deepseek / kimi / glm / custom） */
  provider: string;
  /** 自定义网关时用户指定的协议；留空则用 harness 默认协议 */
  protocol?: LoopProviderProtocol;
  /** 覆盖供应商默认 Base URL */
  baseUrl?: string;
  /** 显式模型 ID；留空由注册表默认值或端点决定 */
  model?: string;
  /** 是否已配置 API Key（仅布尔，值不回显、不入库） */
  hasKey: boolean;
  /** 单轮最多执行多少个 queued 轮次（默认 1，避免一次烧太多 Token） */
  maxPerTick: number;
  /** 单轮 Agent 超时（毫秒，默认 120000） */
  timeoutMs: number;
  /** 是否自动高频轮询（默认 true；关掉则仅手动触发） */
  auto: boolean;
  /** CLI 可执行文件名/路径（部署方管控） */
  bin: string;
  /** 自动轮询间隔（毫秒，默认 15000） */
  intervalMs: number;
}

export const DEFAULT_WORKER_CONFIG: LoopWorkerConfig = {
  mode: 'cli', harness: 'codebuddy', provider: 'platform', hasKey: false,
  maxPerTick: 1, timeoutMs: 120_000, auto: true, bin: 'codebuddy', intervalMs: 15_000,
};

/** 单次执行的记录（写入独立 key，不侵入事实日志） */
export interface LoopWorkerJob {
  runId: string;
  rule: string;
  agent: string;
  mode: LoopWorkerMode;
  status: 'running' | 'done' | 'failed' | 'timeout' | 'skipped';
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  outcome?: ReceiptOutcome;
  summary?: string;
  error?: string;
  /** 真实执行标记：是否确实调用了外部 Agent（非模拟） */
  real: boolean;
  /** 本轮使用的模型；null = 未显式指定，交由 CLI 平台默认档 */
  model?: string | null;
  /** 本轮实际组合的插件（可选字段，兼容 M7 时期的历史执行记录） */
  harness?: string;
  provider?: string;
  facts: number[];
}

export interface LoopWorkerStatus {
  config: LoopWorkerConfig;
  /** 当前进程内是否有一个 tick 正在跑 */
  busy: boolean;
  /** 执行器可用性与原因（如 CLI 不存在 / Gateway 未配置） */
  available: boolean;
  reason: string;
  /** 当前生效模型（显式配置值；null = CLI 平台默认档） */
  model?: string | null;
  /** 当前生效的插件组合 */
  harness?: string;
  provider?: string;
  protocol?: LoopProviderProtocol;
  /** 已累计执行的轮次数 */
  totalExecuted: number;
  lastTickAt?: string;
  lastJob?: LoopWorkerJob;
  jobs: LoopWorkerJob[];
}

/** 单次 /loop/worker/run 的返回 */
export interface LoopWorkerRunResp {
  executed: number;
  queuedBefore: number;
  queuedAfter: number;
  jobs: LoopWorkerJob[];
  /** 已有 Agent 正在执行，本轮让路（前端应提示稍候，而非「没有轮次」） */
  busy?: boolean;
}

/** 内核版本：参与事实日志格式指纹，变更时触发投影重建 */
export const LOOP_KERNEL_VERSION = 'autoloop-web-0.4.0';
