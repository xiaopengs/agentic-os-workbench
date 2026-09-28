/**
 * sse · SSE 响应构造（与平台 agents/_shared.ts 同构）
 *
 * 统一四条响应头：text/event-stream + no-cache + keep-alive + X-Accel-Buffering:no
 * 5 秒心跳保活，流结束固定发 `data: [DONE]\n\n`。
 */
import { SSE_DONE } from '../../shared/types';

export const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // 关闭 Nginx / 网关缓冲，否则增量会被攒批，前端看不到打字机效果
  'X-Accel-Buffering': 'no',
};

/** 单帧：data: <JSON>\n\n */
export function sseFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export const SSE_DONE_FRAME = `data: ${SSE_DONE}\n\n`;

const HEARTBEAT_MS = 5_000;

/**
 * 把异步生成器包装成 SSE 响应。
 * @param produce 产出 SSE 帧字符串；内部需自行捕获业务异常
 * @param signal  客户端断开信号（cloud-functions 可能不提供，故可选）
 */
export function sseResponse(
  produce: (signal?: AbortSignal) => AsyncGenerator<string>,
  signal?: AbortSignal,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (text: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };

      const heartbeat = setInterval(() => {
        safeEnqueue(sseFrame({ type: 'ping', ts: Date.now() }));
      }, HEARTBEAT_MS);

      try {
        for await (const frame of produce(signal)) {
          if (signal?.aborted) break;
          safeEnqueue(frame);
        }
      } catch (error) {
        const err = error as Error;
        if (err?.name === 'AbortError' || signal?.aborted) {
          /* 客户端主动中断，静默结束 */
        } else {
          safeEnqueue(
            sseFrame({
              error: { code: 'STREAM_ERROR', message: err?.message || '流式响应异常中断' },
            }),
          );
        }
      } finally {
        clearInterval(heartbeat);
        try {
          safeEnqueue(SSE_DONE_FRAME);
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

  return new Response(stream, { status: 200, headers: { ...SSE_HEADERS } });
}