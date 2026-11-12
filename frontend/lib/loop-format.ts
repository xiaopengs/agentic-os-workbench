/**
 * loop-format · Autoloop 语义 → 现有视觉槽位的映射层
 *
 * 设计约束（UI 视觉零改动）：
 *  - 图标只使用 IconSprite 中已有的 40 个 symbol（IconName），不新增图标；
 *  - 时间线色调只复用 LiveTrace 既有的 4 个 `.tr-ico.{Agent|Skill|Tool|Contract}` 类；
 *  - 状态徽标只复用 `.chip.{ok|warn|err|info|mute}` 与 `.wf-status.{running|done|failed}`。
 * 本文件只做「语义 → 文案 / 既有类名」的翻译，零 CSS、零新组件。
 */
import type { IconName } from '@/components/icons/Icon';
import type {
  CardKind, CardState, Fact, FactKind, LoopCard, LoopRule, RuleWhen, RunState, TellMode,
} from './loop-types';

/** 事实时间线的 4 个既有色调槽位（对应 .tr-ico.Agent/.Skill/.Tool/.Contract） */
export type TraceTone = 'Agent' | 'Skill' | 'Tool' | 'Contract';

interface FactMeta {
  label: string;
  tone: TraceTone;
  icon: IconName;
}

/**
 * 把 20+ 种 fact kind 归入 4 个既有视觉槽位：
 *  事件 → Agent(绿) / 规则·插件·定时触发 → Skill(紫) / 轮次 → Tool(蓝) / 卡片·复查 → Contract(青)
 */
export const FACT_META: Record<FactKind, FactMeta> = {
  'event.accepted': { label: '事件接入', tone: 'Agent', icon: 'i-bolt' },
  'hop.blocked': { label: '跳数熔断', tone: 'Agent', icon: 'i-warn' },
  'rule.upserted': { label: '规则登记', tone: 'Skill', icon: 'i-list' },
  'rule.paused': { label: '规则暂停', tone: 'Skill', icon: 'i-list' },
  'rule.resumed': { label: '规则恢复', tone: 'Skill', icon: 'i-list' },
  'rules.reloaded': { label: '规则重载', tone: 'Skill', icon: 'i-refresh' },
  'plugin.upserted': { label: '插件登记', tone: 'Skill', icon: 'i-cube' },
  'cron.fired': { label: '定时触发', tone: 'Skill', icon: 'i-calendar' },
  'run.queued': { label: '轮次排队', tone: 'Tool', icon: 'i-play' },
  'run.claimed': { label: '轮次领取', tone: 'Tool', icon: 'i-wrench' },
  'run.finished': { label: '轮次回执', tone: 'Tool', icon: 'i-check' },
  'run.cancelled': { label: '轮次终止', tone: 'Tool', icon: 'i-x' },
  'manual.run': { label: '手动触发', tone: 'Tool', icon: 'i-play' },
  'card.created': { label: '卡片创建', tone: 'Contract', icon: 'i-doc' },
  'card.answered': { label: '卡片回答', tone: 'Contract', icon: 'i-send' },
  'card.closed': { label: '卡片结案', tone: 'Contract', icon: 'i-check' },
  'timer.scheduled': { label: '复查排期', tone: 'Contract', icon: 'i-calendar' },
  'timer.fired': { label: '复查到期', tone: 'Contract', icon: 'i-bell' },
  'timer.cancelled': { label: '复查取消', tone: 'Contract', icon: 'i-x' },
};

/** 事实主标题（对应 LiveTrace 的 .tr-name） */
export function factTitle(f: Fact): string {
  switch (f.kind) {
    case 'event.accepted':
    case 'hop.blocked':
      return f.event ? `${f.event.type}` : '外部事件';
    case 'run.queued':
      return f.run ? `${f.run.rule} → ${f.run.agent}` : '新轮次';
    case 'run.finished':
      return f.receipt?.summary || `轮次 ${f.id ?? f.ref ?? ''} · ${receiptOutcomeText(f.receipt?.outcome)}`;
    case 'card.created':
      return f.card?.title || '待拍板卡片';
    case 'rule.upserted':
      return f.rule?.name || f.name || '规则登记';
    case 'rule.paused':
    case 'rule.resumed':
      return f.name || '规则';
    case 'plugin.upserted':
      return f.plugin?.name || '插件';
    case 'cron.fired':
      return f.name || '定时任务';
    case 'timer.scheduled':
    case 'timer.fired':
    case 'timer.cancelled':
      return f.about || f.key || '复查';
    case 'run.claimed':
    case 'run.cancelled':
    case 'manual.run':
    case 'card.answered':
    case 'card.closed':
      return f.id || f.ref || f.key || FACT_META[f.kind].label;
    default:
      return FACT_META[f.kind].label;
  }
}

/** 事实副标题（对应 LiveTrace 的 .tr-type，展示类型标签 + 关键上下文） */
export function factSub(f: Fact): string {
  const base = FACT_META[f.kind]?.label ?? f.kind;
  switch (f.kind) {
    case 'event.accepted':
      if (f.duplicate) return `${base} · 重复事件（已去重）`;
      if (f.routed?.length) return `${base} · 命中 ${f.routed.join('、')}`;
      return `${base} · ${f.event?.source ?? ''}`;
    case 'hop.blocked':
      return `${base} · hops=${f.hops ?? f.event?.hops ?? '—'}`;
    case 'run.queued':
      return `${base} · ${f.run?.state ?? 'queued'}`;
    case 'run.finished':
      return f.duplicate ? `${base} · 幂等重交` : `${base} · ${receiptOutcomeText(f.receipt?.outcome)}`;
    case 'card.created':
      return `${base} · ${cardKindText(f.card?.kind)}`;
    default:
      return base;
  }
}

/** 事实状态徽标文案（对应 .tr-badge；异常返回 warn=true 用琥珀色） */
export function factBadge(f: Fact): { text: string; warn: boolean } {
  switch (f.kind) {
    case 'event.accepted':
      if (f.duplicate) return { text: '已去重', warn: true };
      if (f.routed?.length) return { text: `已派 ${f.routed.length} 活`, warn: false };
      return { text: '已记录', warn: false };
    case 'hop.blocked':
      return { text: '已熔断', warn: true };
    case 'run.finished':
      if (f.duplicate) return { text: '幂等', warn: true };
      return { text: receiptOutcomeText(f.receipt?.outcome), warn: f.receipt?.outcome === 'failed' };
    case 'run.cancelled':
    case 'card.closed':
      return { text: '已结案', warn: true };
    case 'card.created':
      return { text: cardKindText(f.card?.kind), warn: f.card?.kind === 'ask' };
    default:
      return { text: '已确认', warn: false };
  }
}

/* ── 规则 / 轮次 / 卡片 文案 ─────────────────────────────── */

/** 触发条件 → 人类可读（列表页「触发」列） */
export function whenText(when: RuleWhen): string {
  if ('cron' in when) return `定时 ${when.cron}`;
  const types = when.types.join(' / ');
  return `${when.source} · ${types}`;
}

export function tellText(tell: TellMode): string {
  return { always: '总是', needed: '按需', never: '从不' }[tell] ?? tell;
}

/** 轮次状态 → 既有 .wf-status / .chip 视觉 + 中文 */
export function runStateChip(state: RunState): { tone: 'ok' | 'warn' | 'err' | 'info' | 'mute'; text: string } {
  const map: Record<RunState, { tone: 'ok' | 'warn' | 'err' | 'info' | 'mute'; text: string }> = {
    queued: { tone: 'info', text: '排队中' },
    claimed: { tone: 'warn', text: '执行中' },
    unknown: { tone: 'warn', text: '待确认' },
    done: { tone: 'ok', text: '已完成' },
    nothing: { tone: 'mute', text: '无变更' },
    cancelled: { tone: 'err', text: '已终止' },
  };
  return map[state] ?? { tone: 'mute', text: state };
}

export function cardKindText(kind?: CardKind): string {
  const map: Record<CardKind, string> = { ask: '待拍板', notice: '通知', fyi: '知会' };
  return kind ? map[kind] ?? '卡片' : '卡片';
}

export function cardStateChip(state: CardState): { tone: 'ok' | 'warn' | 'err' | 'info' | 'mute'; text: string } {
  const map: Record<CardState, { tone: 'ok' | 'warn' | 'err' | 'info' | 'mute'; text: string }> = {
    open: { tone: 'warn', text: '待处理' },
    decided: { tone: 'info', text: '已回答' },
    done: { tone: 'ok', text: '已完成' },
    closed: { tone: 'mute', text: '已结案' },
  };
  return map[state] ?? { tone: 'mute', text: state };
}

export function receiptOutcomeText(outcome?: string): string {
  return { done: '已完成', nothing: '无变更', failed: '失败', cancelled: '已取消' }[outcome ?? ''] ?? outcome ?? '回执';
}

/** 插件四方向 → 中文 + 既有图标 + 既有 KPI 色调（g/p/b/c） */
export const PLUGIN_KIND_META: Record<
  'agent' | 'source' | 'channel' | 'delivery',
  { label: string; icon: IconName; tone: 'g' | 'p' | 'b' | 'c' }
> = {
  agent: { label: 'Agent · 执行体', icon: 'i-bot', tone: 'g' },
  source: { label: 'Source · 事件源', icon: 'i-bolt', tone: 'p' },
  channel: { label: 'Channel · 通知通道', icon: 'i-bell', tone: 'b' },
  delivery: { label: 'Delivery · 交付', icon: 'i-plane', tone: 'c' },
};

/** 规则是否处于暂停（pauses 由 state 提供，rule.paused 为只读标记） */
export function rulePaused(rule: LoopRule, pauses: LoopStatePauses): boolean {
  return rule.paused === true || rule.enabled === false || pauses[rule.name] !== undefined;
}

type LoopStatePauses = Record<string, { since: string; reason?: string }>;

/** 卡片一句话摘要（卡片台复用 .tbl-sub） */
export function cardSummary(card: LoopCard): string {
  const first = card.options?.[0];
  if (card.kind === 'ask' && card.options?.length) {
    return `${card.options.length} 个选项${first ? ` · 如「${first}」` : ''}`;
  }
  return card.text || card.about || '—';
}
