/**
 * Node.js 适配器 · 让后端脱离 EdgeOne 平台独立运行
 *
 * 平台的 cloud-functions 契约是 `onRequest(context)`，其中 context 提供
 * { env, request, params, ... }。本适配器把标准 Node http 的
 * (IncomingMessage, ServerResponse) 翻译成同样的 context，
 * 从而**完全复用 backend/functions/router.ts 的全部业务逻辑**，
 * 实现「一套业务代码，两种运行形态」：
 *
 *   - 平台形态：cloud-functions/api/[[default]].ts → handleRequest(context)
 *   - 本地形态：node backend/adapter/server.ts      → 同一 handleRequest
 *
 * 依赖仅为 Node 标准库，无平台 SDK、无框架。
 */
import http from 'node:http';
import { handleRequest } from '../functions/router';

export interface NodeServerOptions {
  port?: number;
  host?: string;
}

function collectBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** 把平台 Response 写回 Node ServerResponse（支持 SSE 流式逐块下发） */
async function writeResponse(res: http.ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === 'set-cookie') {
      const prev = headers[key];
      if (Array.isArray(prev)) prev.push(value);
      else headers[key] = prev ? [prev as string, value] : [value];
    } else {
      headers[key] = value;
    }
  });
  res.writeHead(response.status, headers);

  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
    // SSE 场景需要立即冲刷，否则前端收不到增量
    if (typeof (res as any).flushHeaders === 'function' && value) {
      /* noop：flushHeaders 仅在未发送头时有意义，这里保持逐块 write 即可 */
    }
  }
  res.end();
}

export function createNodeServer(): http.Server {
  return http.createServer(async (nodeReq, nodeRes) => {
    // 健康检查与 CORS 预检的快速通道
    const origin = (nodeReq.headers.origin as string) || '';
    if (nodeReq.method === 'OPTIONS') {
      nodeRes.writeHead(204, {
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,makers-conversation-id',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
      });
      nodeRes.end();
      return;
    }

    const raw = await collectBody(nodeReq);
    const host = nodeReq.headers.host || '127.0.0.1';
    const context = {
      env: { ...(process.env as Record<string, string>) },
      url: `http://${host}${nodeReq.url || '/'}`,
      request: {
        url: `http://${host}${nodeReq.url || '/'}`,
        method: nodeReq.method || 'GET',
        headers: {
          get: (name: string) => {
            const v = (nodeReq.headers as Record<string, string | string[] | undefined>)[name.toLowerCase()];
            return Array.isArray(v) ? v[0] : (v ?? null);
          },
        },
        json: async () => (raw ? JSON.parse(raw) : null),
        text: async () => raw,
      },
    };

    try {
      const response = await handleRequest(context);
      await writeResponse(nodeRes, response);
    } catch (err) {
      nodeRes.writeHead(500, {
        'content-type': 'application/json; charset=utf-8',
        ...(origin
          ? {
              'Access-Control-Allow-Origin': origin,
              'Access-Control-Allow-Credentials': 'true',
              Vary: 'Origin',
            }
          : {}),
      });
      nodeRes.end(
        JSON.stringify({
          ok: false,
          error: { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) },
        }),
      );
    }
  });
}

export function startServer(options: NodeServerOptions = {}): http.Server {
  const port = options.port ?? Number(process.env.PORT || 8787);
  const host = options.host || '127.0.0.1';
  const server = createNodeServer();
  server.listen(port, host, () => {
    console.log(`[api] 后端服务已启动: http://${host}:${port}/api`);
    console.log(`[api] 存储驱动: ${process.env.LOCAL_STORE === 'file' ? '本地文件 .data/store.json' : '自动选择'}`);
  });
  return server;
}