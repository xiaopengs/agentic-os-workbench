/**
 * copilot · AI Copilot 提示词 / 工具定义 / 入参校验
 *
 * 这是「后端 SSE 端点（backend/functions/copilot.ts）」与
 * 「平台 Agent 端点（agents/copilot/index.ts）」共享的唯一事实源：
 * 两边都从这里取系统提示词与工具定义，保证人格与能力描述一致。
 */
import type { CopilotContext, CopilotKind, CopilotMessage } from '../../shared/types';
import { badRequest } from './resp';

export { type CopilotContext, type CopilotKind };

/* ── 采样参数 ───────────────────────────────────────────────── */
export const COPILOT_TEMPERATURE = 0.3;
export const COPILOT_MAX_TOKENS = 1200;
/** 只携带最近 N 轮对话，控制 token 与延迟 */
export const COPILOT_MAX_HISTORY = 12;
/** 单条消息最大字符数（防恶意超长输入） */
export const COPILOT_MAX_CHARS = 4000;

/* ── 场景人格 ───────────────────────────────────────────────── */
const KIND_BRIEF: Record<CopilotKind, string> = {
  skill: '生成 Skill：先确认能力边界与入参出参，再给出目录结构、manifest 字段、核心实现骨架与自测建议。',
  contract:
    '生成 Contract：先界定工具名、权限等级、参数 Schema 与错误码，再给出影响面分析（哪些 Skill 会被波及）。',
  regression:
    '运行回归：按「设备矩阵 → 用例集 → 执行顺序 → 判定阈值」四段给出可执行的回归方案，并标注风险点。',
  trace: '分析 Trace：按 Agent / Skill / Tool / Contract 四类 Span 拆解链路，定位耗时与失败根因，给出修复优先级。',
};

export const COPILOT_PERSONA = `你是「Agentic OS 自动化开发工作台」内置的 AI Copilot，服务于端侧 Agent 的研发与验证闭环。

【你的专业范围】
1. 工作流编排：多设备/多步骤的自动化流程设计、并行与串行取舍、失败重试与补偿。
2. Skill 设计：能力边界、入参出参、版本与兼容性、幂等与超时。
3. Contract 设计：系统应用能力契约、工具名与参数 Schema、权限等级、变更影响面。
4. Trace 分析：Agent/Skill/Tool/Contract 四类 Span 的耗时分布、失败根因、P95 基线与优化建议。
5. 设备回归测试：设备矩阵选取、用例集组织、执行顺序、判定阈值与灰度策略。

【回答规范】
- 用中文回答，简洁专业，避免空话与重复提问。
- 默认先给结论，再给 3-5 条要点或步骤；必要时用简短代码块/表格表达结构。
- 不知道或数据不足时明确说明缺口，并给出获取方式；绝不编造 API、参数或指标。
- 涉及风险操作（删除、发布、权限提升）时，主动提示前置校验与回滚方案。
- 一次回答控制在 400 字以内，除非用户要求展开。`;

/** 组装系统提示词（含当前工作台上下文与场景侧重） */
export function buildSystemPrompt(context?: CopilotContext): string {
  const parts: string[] = [COPILOT_PERSONA];

  const facts: string[] = [];
  if (context?.page) facts.push(`当前页面：${context.page}`);
  if (context?.env) facts.push(`当前环境：${context.env}`);
  if (context?.workflowId) facts.push(`当前工作流：${context.workflowId}`);
  if (facts.length) {
    parts.push(`【当前上下文】\n${facts.join('；')}。回答时优先结合该上下文，不要反问已知的页面/环境信息。`);
  }

  if (context?.kind && KIND_BRIEF[context.kind]) {
    parts.push(`【本轮侧重】\n${KIND_BRIEF[context.kind]}`);
  }

  return parts.join('\n\n');
}

/** 转成上游 messages（截断历史 + 注入 system） */
export function buildCopilotMessages(
  messages: CopilotMessage[],
  context?: CopilotContext,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const history = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .slice(-COPILOT_MAX_HISTORY)
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: String(m.content ?? '').slice(0, COPILOT_MAX_CHARS),
    }))
    .filter((m) => m.content.trim().length > 0);

  return [{ role: 'system', content: buildSystemPrompt(context) }, ...history];
}

/* ── 工具定义（OpenAI function 格式，供 agents/ 侧按需启用） ── */
export interface CopilotToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * 联网检索工具定义。
 * ⚠️ 仅在平台 context.tools 确实提供 web_search（且已配置 WSA_API_KEY）时下发，
 *    否则模型会产生无法执行的工具调用。
 */
export const WEB_SEARCH_TOOL: CopilotToolDef = {
  type: 'function',
  function: {
    name: 'web_search',
    description: '联网检索端侧 Agent、系统应用能力、设备回归相关的最新资料。仅在需要外部事实时使用。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索关键词，中文或英文均可' },
        maxResults: { type: 'integer', description: '返回条数，默认 5', minimum: 1, maximum: 10 },
      },
      required: ['query'],
    },
  },
};

/** 工具白名单（按名称索引，便于执行时查表） */
export const COPILOT_TOOL_DEFS: Record<string, CopilotToolDef> = {
  web_search: WEB_SEARCH_TOOL,
};

/* ── 入参校验 ───────────────────────────────────────────────── */
const KINDS: CopilotKind[] = ['skill', 'contract', 'regression', 'trace'];

function optionalText(value: unknown, field: string, max = 200): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw badRequest(`${field} 必须是字符串`);
  const text = value.trim().slice(0, max);
  return text || undefined;
}

export interface ParsedCopilotRequest {
  messages: CopilotMessage[];
  context?: CopilotContext;
}

/** 校验 CopilotRequest，失败抛 400 VALIDATION_ERROR */
export function parseCopilotRequest(body: unknown): ParsedCopilotRequest {
  const raw = (body ?? {}) as { messages?: unknown; context?: unknown };
  const list = raw.messages;

  if (!Array.isArray(list) || list.length === 0) {
    throw badRequest('messages 不能为空');
  }
  if (list.length > 50) throw badRequest('messages 最多 50 条');

  const messages: CopilotMessage[] = list.map((item) => {
    const m = (item ?? {}) as { role?: unknown; content?: unknown };
    if (m.role !== 'user' && m.role !== 'assistant') {
      throw badRequest('messages[].role 只能是 user 或 assistant');
    }
    if (typeof m.content !== 'string' || !m.content.trim()) {
      throw badRequest('messages[].content 不能为空');
    }
    return { role: m.role, content: m.content.slice(0, COPILOT_MAX_CHARS) };
  });

  const rawCtx = (raw.context ?? {}) as Record<string, unknown>;
  const kindRaw = rawCtx.kind;
  const context: CopilotContext = {
    page: optionalText(rawCtx.page, 'context.page'),
    workflowId: optionalText(rawCtx.workflowId, 'context.workflowId'),
    env: optionalText(rawCtx.env, 'context.env'),
    kind: KINDS.includes(kindRaw as CopilotKind) ? (kindRaw as CopilotKind) : undefined,
  };

  return { messages, context };
}

/** 审计 target：便于回溯「谁在哪个场景用了 Copilot」 */
export function copilotTarget(context?: CopilotContext): string {
  const parts = [context?.kind, context?.page, context?.env, context?.workflowId].filter(Boolean);
  return parts.length ? parts.join('/') : 'general';
}