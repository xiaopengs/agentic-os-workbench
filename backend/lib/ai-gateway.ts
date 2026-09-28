/**
 * ai-gateway · EdgeOne Makers AI Gateway 客户端（OpenAI 兼容 /chat/completions）
 *
 * ⚠️ 平台铁律：
 *   - 凭据只从 context.env（经 getEnv）读取，绝不硬编码、绝不要求用户自填三方 Key
 *   - AI_GATEWAY_API_KEY / AI_GATEWAY_BASE_URL 由平台部署时自动注入（见 .env.example 声明）
 *   - 本模块不读 process.env，process.env 兜底仅发生在 getEnv 内部（本地脚本/单测场景）
 *
 * 调用形态：fetch + SSE 增量解析，零第三方 SDK 依赖（冷启动友好）。
 */
import { DEFAULT_AI_MODEL } from '../../shared/types';
import { getEnv, type Env } from './env';
import { aiUnavailable } from './resp';

/** 上游默认超时（毫秒） */
export const GATEWAY_TIMEOUT_MS = 60_000;

export interface GatewayConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * 读取并校验 Gateway 配置。
 * 缺失时抛 503 AI_UNAVAILABLE（不是 500 SERVER_MISCONFIG）——
 * 对前端而言这是「AI 能力暂不可用」，应当可降级重试，而不是服务端配置错误。
 */
export function gatewayConfig(env: Env): GatewayConfig {
  const apiKey = getEnv(env, 'AI_GATEWAY_API_KEY');
  const baseUrl = String(getEnv(env, 'AI_GATEWAY_BASE_URL') || '').replace(/\/+$/, '');

  if (!apiKey || !baseUrl) {
    // 去平台化：本地最小化部署（LOCAL_AI_MOCK=1）时不需要真实 Gateway，
    // 走本地模拟流，保证 SSE/配额/审计整条链路仍可端到端验证。
    if (localAiMockEnabled(env)) {
      return { apiKey: 'local-mock', baseUrl: LOCAL_MOCK_BASE, model: 'local-mock' };
    }
    throw aiUnavailable(
      'AI Gateway 未就绪：未检测到 AI_GATEWAY_API_KEY / AI_GATEWAY_BASE_URL。' +
        '云端部署请在环境变量中声明；本地最小化部署可设置 LOCAL_AI_MOCK=1 使用本地模拟流。',
    );
  }

  return {
    apiKey,
    baseUrl,
    model: getEnv(env, 'AI_GATEWAY_MODEL') || DEFAULT_AI_MODEL,
  };
}

/** 是否存在可用的 Gateway 配置（用于 /health 之类的探测，不抛错） */
export function hasGateway(env: Env): boolean {
  if (localAiMockEnabled(env)) return true;
  return Boolean(getEnv(env, 'AI_GATEWAY_API_KEY') && getEnv(env, 'AI_GATEWAY_BASE_URL'));
}

/** 组装 /chat/completions 地址（兼容 baseUrl 是否已带 /v1 前缀） */
export function chatCompletionsUrl(cfg: GatewayConfig): string {
  return /\/v\d+$/.test(cfg.baseUrl)
    ? `${cfg.baseUrl}/chat/completions`
    : `${cfg.baseUrl}/v1/chat/completions`;
}

/* ── 消息与请求体 ───────────────────────────────────────────── */
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
}

export interface ChatRequestBody {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  tools?: unknown[];
  tool_choice?: 'auto' | 'none' | 'required';
}

/** 发起上游请求（不做 ok 判定，交给调用方决定如何降级） */
export async function openChat(
  cfg: GatewayConfig,
  body: ChatRequestBody,
  signal?: AbortSignal,
): Promise<Response> {
  if (cfg.baseUrl === LOCAL_MOCK_BASE) return openLocalMockChat(body, signal);

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    try {
      controller.abort();
    } catch {
      /* 已结束 */
    }
  }, GATEWAY_TIMEOUT_MS);

  // 客户端断开 → 同步中断上游
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    return await fetch(chatCompletionsUrl(cfg), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ ...body, stream: body.stream !== false }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

/* ── 上游失败归类 ───────────────────────────────────────────── */
/** 把上游非 2xx 响应翻译成可展示的错误（503 AI_UNAVAILABLE） */
export async function toGatewayError(res: Response): Promise<Error> {
  let detail = '';
  try {
    const text = await res.text();
    detail = text.slice(0, 300);
  } catch {
    /* 忽略读取失败 */
  }
  const hint =
    res.status === 401 || res.status === 403
      ? 'AI Gateway 鉴权失败（请确认平台已正确注入 AI_GATEWAY_API_KEY）'
      : res.status === 429
        ? 'AI Gateway 限流，请稍后重试'
        : `AI Gateway 返回 ${res.status}`;
  return aiUnavailable(detail ? `${hint}：${detail}` : hint);
}

/* ── SSE 增量解析 ───────────────────────────────────────────── */
export interface ChatStreamChunk {
  /** 增量文本 */
  delta?: string;
  /** 工具调用（增量累积后由调用方合并） */
  toolCalls?: ChatToolCall[];
  finishReason?: string | null;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/**
 * 逐行解析上游 SSE：data: {...}\n\n，遇 [DONE] 结束。
 * 解析失败的单行静默跳过（上游偶发注释/心跳行不应中断整条流）。
 */
export async function* iterChatStream(
  res: Response,
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamChunk> {
  const body = res.body as ReadableStream<Uint8Array> | null;
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (!trimmed.startsWith('data:')) continue;

        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{
              delta?: { content?: string; tool_calls?: ChatToolCall[] };
              finish_reason?: string | null;
            }>;
            usage?: ChatStreamChunk['usage'];
          };
          const choice = json.choices?.[0];
          const chunk: ChatStreamChunk = {
            delta: choice?.delta?.content ?? '',
            finishReason: choice?.finish_reason ?? null,
          };
          if (choice?.delta?.tool_calls?.length) chunk.toolCalls = choice.delta.tool_calls;
          if (json.usage) chunk.usage = json.usage;
          yield chunk;
        } catch {
          /* 单行解析失败跳过 */
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* 已关闭 */
    }
  }
}

/* ── 非流式（工具决策轮使用） ───────────────────────────────── */
export async function chatOnce(
  cfg: GatewayConfig,
  body: ChatRequestBody,
  signal?: AbortSignal,
): Promise<{ content: string; toolCalls: ChatToolCall[]; usage?: ChatStreamChunk['usage'] }> {
  const res = await openChat(cfg, { ...body, stream: false }, signal);
  if (!res.ok) throw await toGatewayError(res);

  const json = (await res.json()) as {
    choices?: Array<{
      message?: { content?: string | null; tool_calls?: ChatToolCall[] };
      finish_reason?: string | null;
    }>;
    usage?: ChatStreamChunk['usage'];
  };
  const message = json.choices?.[0]?.message ?? {};
  return {
    content: message.content ?? '',
    toolCalls: message.tool_calls ?? [],
    usage: json.usage,
  };
}

/**
 * token 粗估（上游未回传 usage 时兜底）。
 * 中英文混排下 1 token ≈ 1.5~3 字符，这里取保守的 1/2.5 上限估算。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 2.5));
}

/* ── 本地模拟流（去平台化） ─────────────────────────────────────
 * 仅在 LOCAL_AI_MOCK=1 且未配置 AI Gateway 时启用。
 * 目的：本地最小化部署不依赖任何外部 LLM 服务，也能端到端验证
 *       SSE 流式协议 / 配额扣减 / 审计落库 / 前端渲染 全链路。
 * 产出与 OpenAI /chat/completions 完全同构的 SSE 帧，因此上层
 * iterChatStream 无需任何改动即可解析。
 * ------------------------------------------------------------ */

/** 本地模拟模式下的伪 baseUrl（用于分流，不发起真实网络请求） */
export const LOCAL_MOCK_BASE = 'local://mock';

/** 是否开启本地模拟流 */
export function localAiMockEnabled(env: Env): boolean {
  const v = String(getEnv(env, 'LOCAL_AI_MOCK') || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}

/** 依据最后一条用户消息生成确定性回复（不联网、不随机） */
function mockReply(messages: ChatMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  const q = (last?.content || '').trim();
  return [
    `【本地模拟流 · LOCAL_AI_MOCK】当前未连接 AI Gateway，以下为离线占位回复，用于验证链路通畅。`,
    ``,
    q ? `你问的是：${q.slice(0, 200)}` : `（未捕获到用户消息）`,
    ``,
    `我理解的意图可以拆成三步：`,
    `1. 明确目标与约束 —— 把需求收敛成可验收的条目；`,
    `2. 拆解执行路径 —— 选最小可行方案，先跑通再优化；`,
    `3. 定义验收标准 —— 用测试用例固化结果，避免回归。`,
    ``,
    `接入真实模型：设置 AI_GATEWAY_API_KEY / AI_GATEWAY_BASE_URL 后重启即可，业务代码无需改动。`,
  ].join('\n');
}

/** 构造一个本地 SSE 响应（200 + text/event-stream），逐 token 推送 */
export function openLocalMockChat(body: ChatRequestBody, signal?: AbortSignal): Response {
  const text = mockReply(body.messages || []);
  // 按 2~6 字切片，模拟真实模型的增量节奏
  const chunks: string[] = [];
  for (let i = 0; i < text.length; ) {
    const n = 2 + (i % 5);
    chunks.push(text.slice(i, i + n));
    i += n;
  }

  const encoder = new TextEncoder();
  const frame = (obj: unknown) => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const piece of chunks) {
          if (signal?.aborted) break;
          controller.enqueue(
            frame({ choices: [{ delta: { content: piece }, finish_reason: null }] }),
          );
          await new Promise((r) => setTimeout(r, 18));
        }
        controller.enqueue(
          frame({
            choices: [{ delta: {}, finish_reason: 'stop' }],
            usage: {
              prompt_tokens: estimateTokens(body.messages?.map((m) => m.content).join('') || ''),
              completion_tokens: estimateTokens(text),
              total_tokens:
                estimateTokens(body.messages?.map((m) => m.content).join('') || '') +
                estimateTokens(text),
            },
          }),
        );
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } finally {
        try {
          controller.close();
        } catch {
          /* 已关闭 */
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}