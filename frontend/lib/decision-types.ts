/**
 * decision-types · 架构设计决策面板前端契约镜像
 *
 * 镜像自 shared/decision.ts（唯一事实源）；前端不跨目录 import shared，与 loop-types.ts 同构。
 * 字段逐字一致，新增字段需两端同步。
 */

export type DecisionStatus = 'draft' | 'review' | 'accepted' | 'deprecated' | 'superseded';

export const DECISION_STATUSES: readonly DecisionStatus[] = [
  'draft', 'review', 'accepted', 'deprecated', 'superseded',
] as const;

export const DECISION_TRANSITIONS: Record<DecisionStatus, readonly DecisionStatus[]> = {
  draft: ['review'],
  review: ['accepted', 'draft'],
  accepted: ['deprecated', 'superseded'],
  deprecated: [],
  superseded: [],
};

export interface DecisionCriterion {
  id: string;
  name: string;
  weight: number;
  description?: string;
}

export interface DecisionOption {
  id: string;
  name: string;
  summary: string;
  scores: Record<string, number>;
  pros: string[];
  cons: string[];
  assumptions: string[];
}

export interface DecisionConsequences {
  positive: string[];
  negative: string[];
  risks: string[];
}

export type DecisionLinkType = 'rule' | 'skill' | 'pr' | 'doc' | 'trace' | 'event';

export interface DecisionLink {
  type: DecisionLinkType;
  ref: string;
}

export interface DecisionHistoryEntry {
  at: string;
  action: 'created' | 'status' | 'edit' | 'score' | 'execute';
  from?: DecisionStatus;
  to?: DecisionStatus;
  note?: string;
  by?: string;
}

export interface Decision {
  id: string;
  seq: number;
  title: string;
  status: DecisionStatus;
  context: string;
  drivers: string[];
  criteria: DecisionCriterion[];
  options: DecisionOption[];
  decision: string;
  chosenOptionId?: string;
  consequences: DecisionConsequences;
  confirmation?: string;
  owner: string;
  tags: string[];
  links: DecisionLink[];
  reviewAt?: string;
  supersedes?: string;
  supersededBy?: string;
  createdAt: string;
  updatedAt: string;
  acceptedAt?: string;
  history: DecisionHistoryEntry[];
  /** 服务端只读派生字段（到期复核），不落库 */
  reviewDue?: boolean;
}

export interface DecisionInput {
  title: string;
  context: string;
  drivers?: string[];
  criteria?: DecisionCriterion[];
  options?: DecisionOption[];
  decision?: string;
  chosenOptionId?: string;
  consequences?: Partial<DecisionConsequences>;
  confirmation?: string;
  owner: string;
  tags?: string[];
  reviewAt?: string;
}

export interface ScoredOption {
  id: string;
  name: string;
  score: number;
  breakdown: Record<string, number>;
  rank: number;
}

export interface DecisionScoreResp {
  id: string;
  at: string;
  criteria: DecisionCriterion[];
  scores: ScoredOption[];
  gap: number;
}

export interface DecisionRuleDraft {
  name: string;
  when: { source: string; types: string[] };
  to: string;
  cwd: string;
  group: string;
  tell: 'needed';
  title: string;
  prompt: string;
}

export interface DecisionToRuleResp {
  draft: DecisionRuleDraft;
  valid: boolean;
  issues: string[];
  agents: string[];
}
