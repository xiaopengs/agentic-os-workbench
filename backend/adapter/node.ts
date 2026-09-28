/**
 * Node.js 适配器 · 让后端脱离 EdgeOne 平台独立运行
 *
 * 平台的 cloud-functions 契约是 `onRequest(context)`，其中 context 提供
 * { env, request, params, ... }。本适配器把标准 Node http 的
 * (IncomingMessage, ServerResponse) 翻译成同样的 context，
 * 从而**完全复用 backend/functions/router.ts 的全部业务逻辑**，
 * 实现「一套业务代码，多种运行形态」：
 *
 *   - 平台形态：cloud-functions/api/[[default]].ts → handleRequest(context)
 *   - 本地形态：node backend/adapter/server.ts      → 同一 handleRequest
 *   - 单端口形态：frontend/server.mjs               → 同一 handleRequest（与 Next 同进程）
 *
 * 依赖仅为 Node 标准库，无平台 SDK、无框架。
 *
 * 导出的三块能力（collectBody / buildContext / writeResponse）是「翻译层」的
 * 全部内容，单端口 server.mjs 直接复用它们，避免逻辑重复。
 */
import http from 'node:http';
import { handleRequest } from '../functions/router';

export interface NodeServerOptions {
  port?: number;
  host?: string;
}

/** 读取请求体为 utf8 字符串（无框架，Node 标准流） */
export function collectBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** 把 Node IncomingMessage 翻译成平台契约的 context（含鸭子类型 Headers / json / text） */
export function buildContext(nodeReq: http.IncomingMessage, raw: string): Record<string, unknown> {
  const host = nodeReq.headers.host || '127.0.0.1';
  const url = `http://${host}${nodeReq.url || '/'}`;
  return {
    env: { ...(process.env as Record<string, string>) },
    url,
    request: {
      url,
      method: nodeReq.method || 'GET',
      headers: {
        get: (name: string) => {
          const v = (nodeReq.headers as Record<string, string | string[] | undefined>)[
            name.toLowerCase()
          ];
          return Array.isArray(v) ? v[0] : (v ?? null);
        },
      },
      json: async () => (raw ? JSON.parse(raw) : null),
      text: async () => raw,
    },
  };
}

/** CORS 预检响应头（本地跨域开发用；单端口同域部署时不会走到这里） */
export function preflightHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,makers-conversation-id',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}

/** 把平台 Response 写回 Node ServerResponse（支持 SSE 流式逐块下发） */
export async function writeResponse(
  res: http.ServerResponse,
  response: Response,
): Promise<void> {
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

/**
 * 把一次 Node 请求交由后端业务逻辑处理（含预检快通道与异常兜底）。
 * 独立后端进程与单端口 server 都调用这个函数。
 */
export async function serveApiRequest(
  nodeReq: http.IncomingMessage,
  nodeRes: http.ServerResponse,
): Promise<void> {
  const origin = (nodeReq.headers.origin as string) || '';

  // CORS 预检快速通道
  if (nodeReq.method === 'OPTIONS') {
    nodeRes.writeHead(204, preflightHeaders(origin));
    nodeRes.end();
    return;
  }

  try {
    const raw = await collectBody(nodeReq);
    const response = await handleRequest(buildContext(nodeReq, raw));
    await writeResponse(nodeRes, response);
  } catch (err) {
    if (nodeRes.headersSent) {
      try {
        nodeRes.end();
      } catch {
        /* 已关闭 */
      }
      return;
    }
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
}

export function createNodeServer(): http.Server {
  return http.createServer((nodeReq, nodeRes) => {
    void serveApiRequest(nodeReq, nodeRes);
  });
}

export function startServer(options: NodeServerOptions = {}): http.Server {
  const port = options.port ?? Number(process.env.PORT || 8787);
  // 默认绑定 0.0.0.0：沙箱/容器/反代场景下必须可被外部访问，
  // 仅回环会导致「本机 curl 通、外部打不开」。如需限制用 HOST=127.0.0.1 覆盖。
  const host = options.host || process.env.HOST || '0.0.0.0';
  const server = createNodeServer();
  server.listen(port, host, () => {
    console.log(`[api] 后端服务已启动: http://${host}:${port}/api`);
    console.log(
      `[api] 存储驱动: ${process.env.LOCAL_STORE === 'file' ? '本地文件 .data/store.json' : '自动选择'}`,
    );
  });
  return server;
}