/**
 * decision-format · 决策语义 → 当前项目视觉槽位映射（M6）
 *
 * 与 loop-format.ts 同构：把决策状态/动作映射到既有 .chip / .tr-ico 色调，
 * 不新增任何 CSS 类、不引入新视觉体系。
 */
import type { DecisionStatus } from './decision-types';

export const DECISION_STATUS_META: Record<DecisionStatus, {
  label: string;
  chip: 'ok' | 'warn' | 'err' | 'info' | 'mute';
  tone: 'g' | 'p' | 'b' | 'c' | 'o'; // 复用 dev-ic 的 design token 色调
  icon: 'i-doc' | 'i-search' | 'i-check' | 'i-x' | 'i-refresh';
  column: string;
}> = {
  draft: { label: '提议', chip: 'mute', tone: 'b', icon: 'i-doc', column: '提议 · Draft' },
  review: { label: '评审中', chip: 'info', tone: 'p', icon: 'i-search', column: '评审 · Review' },
  accepted: { label: '已接受', chip: 'ok', tone: 'g', icon: 'i-check', column: '已接受 · Accepted' },
  deprecated: { label: '已废弃', chip: 'warn', tone: 'o', icon: 'i-x', column: '废弃 · Deprecated' },
  superseded: { label: '被取代', chip: 'err', tone: 'c', icon: 'i-refresh', column: '被取代 · Superseded' },
};

/** 看板列顺序（状态机主线） */
export const BOARD_COLUMNS: DecisionStatus[] = ['draft', 'review', 'accepted', 'deprecated'];

/** dev-ic 内联底色（与 skills/page.tsx 的 TONE_STYLE 一致） */
export const TONE_BG: Record<string, { background: string; color: string }> = {
  g: { background: 'var(--green-bg)', color: 'var(--green-deep)' },
  p: { background: 'var(--purple-bg)', color: 'var(--purple)' },
  b: { background: 'var(--blue-bg)', color: 'var(--blue)' },
  c: { background: 'var(--cyan-bg)', color: 'var(--cyan)' },
  o: { background: 'var(--orange-bg)', color: 'var(--orange)' },
};

export function statusText(s: DecisionStatus): string {
  return DECISION_STATUS_META[s]?.label ?? s;
}

/** 日期 YYYY-MM-DD → MM月DD日（国内习惯） */
export function shortDate(iso?: string): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[2]}月${m[3]}日` : iso.slice(0, 10);
}

/** 流转动作 → 按钮文案 */
export function transitionLabel(from: DecisionStatus, to: DecisionStatus): string {
  if (to === 'review' && from === 'draft') return '提交评审';
  if (to === 'draft' && from === 'review') return '打回修改';
  if (to === 'accepted') return '接受决策';
  if (to === 'deprecated') return '标记废弃';
  if (to === 'superseded') return '标记被取代';
  return `流转为${DECISION_STATUS_META[to]?.label ?? to}`;
}
