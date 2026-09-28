/**
 * functions/copilot · AI Copilot 流式对话
 *
 * POST /api/ai/copilot  { messages, context }  →  SSE
 *   流式帧：data: {"delta":"..."}      文本增量
 *           data: {"type":"ping",...}  心跳（5s）
 *           data: {"type":"usage",...} 用量回执
 *           data: {"error":{...}}      流内错误
 *   结束帧：data: [DONE]
 *
 * 执行顺序（关键）：
 *   401 鉴权 → 400 校验 → 503 Gateway 预检 → **402 配额拦截** → 审计 → 才返回 200 流
 *   配额必须在流开始之前拦截：一旦响应头以 200 提交，就无法再用 402 表达超额。
 *   且配额扣减放在 Gateway 预检之后——上游不可用时不应消耗用户额度。
 */
import { requireUser } from '../lib/auth';
import { copilotTarget, parseCopilotRequest, buildCopilotMessages, COPILOT_TEMPERATURE, COPILOT_MAX_TOKENS } from '../lib/copilot';
import {
  estimateTokens,
  gatewayConfig,
  iterChatStream,
  openChat,
  toGatewayError,
} from '../lib/ai-gateway';
import { readJsonBody, type ApiCtx } from '../lib/http';
import { repo } from '../lib/kv';
import { writeAudit } from '../lib/audit';
import { consume } from '../lib/quota';
import { aiUnavailable } from '../lib/resp';
import { sseFrame, sseResponse } from '../lib/sse';
import type { Usage } from '../../shared/types';

export async function postCopilot(ctx: ApiCtx): Promise<Response> {
  const r = await repo(ctx.env);

  /* 1) 鉴权：未登录 401 */
  const user = await requireUser(ctx, r);

  /* 2) 入参：400 */
  const body = await readJsonBody(ctx.req, ctx.raw);
  const { messages, context } = parseCopilotRequest(body);
  const promptMessages = buildCopilotMessages(messages, context);

  /* 3) Gateway 配置 + 预连接：不可用 → 503（不消耗配额） */
  const cfg = gatewayConfig(ctx.env);
  const signal = (ctx.req?.signal ?? ctx.raw?.signal) as AbortSignal | undefined;

  let upstream: Response;
  try {
    upstream = await openChat(
      cfg,
      {
        model: cfg.model,
        messages: promptMessages,
        stream: true,
        temperature: COPILOT_TEMPERATURE,
        max_tokens: COPILOT_MAX_TOKENS,
      },
      signal,
    );
  } catch (error) {
    // 网络层失败（DNS / 超时 / 连接重置）统一降级为 503 AI_UNAVAILABLE
    const err = error as Error;
    if (err?.name === 'AbortError') throw err;
    throw aiUnavailable(`AI Gateway 连接失败：${err?.message || '未知错误'}`);
  }
  if (!upstream.ok) {
    try {
      await upstream.body?.cancel();
    } catch {
      /* noop */
    }
    throw await toGatewayError(upstream);
  }

  /* 4) 配额拦截（流式开始前）：402 QUOTA_EXCEEDED */
  // 超额时 consume 内部抛 402；走到这里说明已成功预扣 1 次 run
  await consume(r, user, { runs: 1 });

  /* 5) 审计 */
  await writeAudit(r, user.id, {
    action: 'ai.copilot',
    target: copilotTarget(context),
    actor: user.email,
  });

  /* 6) 流式转发 */
  return sseResponse(async function* (sig) {
    let text = '';
    let reported: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;

    try {
      for await (const chunk of iterChatStream(upstream, sig)) {
        if (sig?.aborted) break;
        if (chunk.delta) {
          text += chunk.delta;
          yield sseFrame({ delta: chunk.delta });
        }
        if (chunk.usage) reported = chunk.usage;
      }
    } finally {
      // tokens 记账：优先用上游回传值，缺失时按字符数粗估（失败不影响主流程）
      const tokens =
        reported?.total_tokens ??
        estimateTokens(text) + estimateTokens(promptMessages.map((m) => m.content).join(''));
      let usage: Usage | null = null;
      try {
        usage = await consume(r, user, { tokens });
      } catch {
        /* 记账失败不打断对话 */
      }
      if (usage) {
        yield sseFrame({ type: 'usage', usage: { runs: usage.runs, tokens: usage.tokens, limit: usage.limit } });
      }
      if (!text) {
        yield sseFrame({
          error: { code: 'EMPTY_RESPONSE', message: '模型未返回内容，请稍后重试或换个说法' },
        });
      }
    }
  }, signal);
}

export default postCopilot;