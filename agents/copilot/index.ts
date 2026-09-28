/**
 * agents/copilot · 平台原生 Agent 端点（POST /copilot）
 *
 * 与后端 /api/ai/copilot 共享同一套提示词与工具定义（backend/lib/copilot.ts），
 * 差异在于本端点跑在 Agent 运行时，因此额外获得平台注入能力：
 *   · context.env             —— AI_GATEWAY_*（禁止 process.env）
 *   · context.conversation_id —— 来自前端 makers-conversation-id 请求头
 *   · context.store           —— 会话历史持久化（bare model → 通用消息 API）
 *   · context.tools           —— 平台工具集（此处按需启用 web_search，需 WSA_API_KEY）
 *   · context.request.signal  —— 客户端断开信号
 *
 * 工具循环有硬上限（最多 1 轮工具决策 + 1 轮回答），禁止无界 while。
 *
 * 关于框架声明：本端点不引入任何 Agent SDK（平台支持框架无关的 onRequest），
 * 但 edgeone.json 的 agents.framework 设为 openai-agents-sdk —— 该取值决定
 * context.tools 返回「OpenAI function 格式」的工具对象（{ name, parameters, execute }），
 * 与这里手写的 /chat/completions 工具调用协议天然对齐，无需二次转换。
 */
import type { ChatMessage, ChatToolCall } from '../../backend/lib/ai-gateway';
import {
  chatOnce,
  estimateTokens,
  gatewayConfig,
  iterChatStream,
  openChat,
  toGatewayError,
} from '../../backend/lib/ai-gateway';
import {
  COPILOT_MAX_TOKENS,
  COPILOT_TEMPERATURE,
  COPILOT_TOOL_DEFS,
  buildCopilotMessages,
  parseCopilotRequest,
} from '../../backend/lib/copilot';
import { ApiError } from '../../backend/lib/resp';
import type { CopilotMessage } from '../../shared/types';
import { createLogger, createSSEResponse, jsonResponse, sseEvent, SSE_DONE } from '../_shared';

const log = createLogger('copilot');

/* ── 平台工具 → OpenAI function 定义 ────────────────────────── */
interface OpenAIToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface PlatformTool {
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  execute?: (args: unknown) => unknown | Promise<unknown>;
  invoke?: (args: unknown) => unknown | Promise<unknown>;
  function?: { name?: string; description?: string; parameters?: Record<string, unknown> };
}

function toOpenAIToolDef(tool: PlatformTool): OpenAIToolDef | null {
  const name = tool?.name || tool?.function?.name;
  if (!name) return null;
  // 优先复用共享定义（与后端端点保持一致），缺失时再从平台工具推导
  const shared = COPILOT_TOOL_DEFS[name];
  if (shared) return shared as OpenAIToolDef;
  return {
    type: 'function',
    function: {
      name,
      description: tool?.description || tool?.function?.description || name,
      parameters: tool?.parameters || tool?.function?.parameters || { type: 'object', properties: {} },
    },
  };
}

async function runTool(tool: PlatformTool, args: unknown): Promise<string> {
  const fn = tool?.execute || tool?.invoke;
  if (typeof fn !== 'function') return '';
  const result = await (fn as (a: unknown) => Promise<unknown>).call(tool, args);
  if (typeof result === 'string') return result.slice(0, 1500);
  try {
    return JSON.stringify(result).slice(0, 1500);
  } catch {
    return '';
  }
}

/* ── 会话历史（context.store 通用消息 API） ─────────────────── */
async function loadHistory(store: any, conversationId: string): Promise<CopilotMessage[]> {
  if (!conversationId || typeof store?.getMessages !== 'function') return [];
  try {
    const messages = await store.getMessages({ conversationId, limit: 20, order: 'asc' });
    const list = Array.isArray(messages) ? messages : messages?.messages ?? [];
    return list
      .map((m: { role?: string; content?: string }) => ({
        role: m?.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: String(m?.content ?? ''),
      }))
      .filter((m: CopilotMessage) => m.content.trim().length > 0);
  } catch (error) {
    log.error('读取会话历史失败：', error);
    return [];
  }
}

async function persistTurn(
  store: any,
  conversationId: string,
  question: string,
  answer: string,
): Promise<void> {
  if (!conversationId || !answer || typeof store?.appendMessage !== 'function') return;
  try {
    if (question) {
      await store.appendMessage({ conversationId, role: 'user', content: question.slice(0, 4000) });
    }
    await store.appendMessage({
      conversationId,
      role: 'assistant',
      content: answer.slice(0, 8000),
    });
  } catch (error) {
    log.error('写入会话历史失败：', error);
  }
}

/* ── 端点入口 ───────────────────────────────────────────────── */
export async function onRequest(context: any): Promise<Response> {
  const env = (context?.env ?? {}) as Record<string, string | undefined>;
  const body = context?.request?.body ?? {};
  const conversationId: string = context?.conversation_id ?? '';
  const signal = context?.request?.signal as AbortSignal | undefined;
  const store = context?.store;
  const tools = context?.tools;

  // 1) 入参校验
  let parsed: ReturnType<typeof parseCopilotRequest>;
  try {
    parsed = parseCopilotRequest(body);
  } catch (error) {
    const err = error as ApiError;
    return jsonResponse(
      { ok: false, error: { code: err?.code || 'VALIDATION_ERROR', message: err?.message || '入参校验失败' } },
      err?.status || 400,
    );
  }

  // 2) Gateway 配置（context.env，绝不 process.env）
  let cfg: ReturnType<typeof gatewayConfig>;
  try {
    cfg = gatewayConfig(env);
  } catch (error) {
    const err = error as ApiError;
    return jsonResponse(
      { ok: false, error: { code: err?.code || 'AI_UNAVAILABLE', message: err?.message || 'AI Gateway 未就绪' } },
      err?.status || 503,
    );
  }

  // 3) 历史 + 提示词（与后端端点同源）
  const history = await loadHistory(store, conversationId);
  const lastUser = [...parsed.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const promptMessages: ChatMessage[] = buildCopilotMessages(
    [...history, ...parsed.messages],
    parsed.context,
  );

  // 4) 平台工具（仅当确实可执行时才下发，最多启用 web_search）
  const searchTool = typeof tools?.get === 'function' ? (tools.get('web_search') as PlatformTool | undefined) : undefined;
  const searchDef = searchTool ? toOpenAIToolDef(searchTool) : null;

  log.log(`conv=${conversationId || '-'} 历史 ${history.length} 条，工具 ${searchDef ? 'web_search' : '无'}`);

  return createSSEResponse(async function* (sig) {
    const toolMessages: ChatMessage[] = [];

    // 4.1 工具决策轮（有界：只跑 1 轮，最多 2 个调用，绝不循环到模型自己喊停）
    if (searchDef && searchTool) {
      try {
        const decision = await chatOnce(
          cfg,
          {
            model: cfg.model,
            messages: promptMessages,
            tools: [searchDef],
            tool_choice: 'auto',
            temperature: COPILOT_TEMPERATURE,
            max_tokens: COPILOT_MAX_TOKENS,
          },
          sig,
        );

        const calls: ChatToolCall[] = (decision.toolCalls || []).slice(0, 2);
        if (calls.length) {
          yield sseEvent({ type: 'tool_call', name: 'web_search' });
          for (const call of calls) {
            let args: unknown = {};
            try {
              args = JSON.parse(call?.function?.arguments || '{}');
            } catch {
              args = {};
            }
            const content = await runTool(searchTool, args);
            if (content) {
              yield sseEvent({ type: 'tool_result', name: 'web_search', content: content.slice(0, 500) });
              toolMessages.push({
                role: 'assistant',
                content: '',
                tool_calls: [call],
              });
              toolMessages.push({
                role: 'tool',
                name: 'web_search',
                tool_call_id: call.id,
                content,
              });
            }
          }
        }
      } catch (error) {
        const err = error as Error;
        log.error('工具决策轮失败：', err?.message);
        // 工具失败不阻断对话：回退为普通问答
      }
    }

    // 4.2 回答轮（流式）
    let text = '';
    let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;

    try {
      const upstream = await openChat(
        cfg,
        {
          model: cfg.model,
          messages: [...promptMessages, ...toolMessages],
          stream: true,
          temperature: COPILOT_TEMPERATURE,
          max_tokens: COPILOT_MAX_TOKENS,
        },
        sig,
      );

      if (!upstream.ok) {
        const err = await toGatewayError(upstream);
        yield sseEvent({ error: { code: 'AI_UNAVAILABLE', message: err.message } });
      } else {
        for await (const chunk of iterChatStream(upstream, sig)) {
          if (sig?.aborted) break;
          if (chunk.delta) {
            text += chunk.delta;
            yield sseEvent({ delta: chunk.delta });
          }
          if (chunk.usage) usage = chunk.usage;
        }
      }
    } catch (error) {
      const err = error as Error;
      if (err?.name !== 'AbortError' && !sig?.aborted) {
        yield sseEvent({ error: { code: 'AI_UNAVAILABLE', message: err?.message || 'AI Gateway 调用失败' } });
      }
    }

    if (!text) {
      yield sseEvent({ error: { code: 'EMPTY_RESPONSE', message: '模型未返回内容，请换个说法再试' } });
    } else {
      yield sseEvent({
        type: 'usage',
        usage: { tokens: usage?.total_tokens ?? estimateTokens(text) },
      });
      await persistTurn(store, conversationId, lastUser, text);
    }

    yield SSE_DONE;
  }, signal);
}

export default onRequest;