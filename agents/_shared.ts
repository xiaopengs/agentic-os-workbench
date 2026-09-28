/**
 * agents/_shared · 平台 Agent 内部模块（下划线前缀不会被注册为路由）
 *
 * 提供日志、SSE 帧与 SSE 响应封装，所有 agents/<name>/ 端点共用。
 * 事件约定与后端 /api/ai/copilot 完全一致：
 *   data: {"delta":"..."}        文本增量
 *   data: {"type":"ping","ts":N} 心跳
 *   data: {"type":"tool_call"|"tool_result",...}
 *   data: {"type":"usage",...}
 *   data: {"error":{"code","message"}}
 *   data: [DONE]                 结束
 */
export function createLogger(name: string) {
  return {
    log(...args: unknown[]): void {
      console.log(`[${name}][${new Date().toISOString()}]`, ...args);
    },
    error(...args: unknown[]): void {
      console.error(`[${name}][${new Date().toISOString()}]`, ...args);
    },
  };
}

/** 单帧：data: <JSON>\n\n */
export function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/** 结束帧 */
export const SSE_DONE = 'data: [DONE]\n\n';

/**
 * SSE 响应封装：5s 心跳 + 客户端断开感知 + 异常不炸流。
 * @param generator 产出 SSE 帧的异步生成器（内部自行捕获业务异常）
 * @param signal    context.request.signal
 */
export function createSSEResponse(
  generator: (signal?: AbortSignal) => AsyncGenerator<string>,
  signal?: AbortSignal,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const push = (text: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };

      const heartbeat = setInterval(() => {
        push(sseEvent({ type: 'ping', ts: Date.now() }));
      }, 5_000);

      try {
        for await (const chunk of generator(signal)) {
          if (signal?.aborted) break;
          push(chunk);
        }
      } catch (error) {
        const err = error as Error;
        if (err?.name !== 'AbortError' && !signal?.aborted) {
          push(sseEvent({ error: { code: 'STREAM_ERROR', message: err?.message || '流式响应异常' } }));
        }
      } finally {
        clearInterval(heartbeat);
        // 结束帧由生成器自己 yield（平台约定），这里只负责关闭
        try {
          controller.close();
        } catch {
          /* 已关闭 */
        }
        closed = true;
      }
    },
    cancel() {
      /* 客户端断开 */
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

/** JSON 响应（入参/配置类错误在流开始之前返回） */
export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}