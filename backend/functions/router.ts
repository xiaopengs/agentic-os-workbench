/**
 * router · 轻量无框架路由（Express 风格匹配，零依赖，冷启动友好）
 *
 * 路由表（统一去掉 /api 前缀后匹配）：
 *   POST /auth/register   POST /auth/login   POST /auth/logout   GET /auth/me
 *   GET|POST              /workflows
 *   GET|PATCH|DELETE      /workflows/:id
 *   GET|POST              /traces
 *   GET                   /skills
 *   GET                   /contracts
 *   GET                   /devices
 *   GET                   /usage
 *   GET                   /audit
 *   GET                   /health
 */
import { corsHeaders, guard, notFound } from '../lib/resp';
import { getHeader, methodOf, safeUrl, type ApiCtx } from '../lib/http';
import type { Env } from '../lib/env';

import { authMe, login, logout, register } from './auth';
import { createWorkflow, deleteWorkflow, getWorkflow, listWorkflows, updateWorkflow } from './workflows';
import { createTrace, listTraces } from './traces';
import { listContracts, listDevices, listSkills } from './assets';
import { getUsage } from './usage';
import { listAudit } from './audit';

export type Handler = (ctx: ApiCtx) => Promise<Response>;

interface Route {
  method: string;
  segs: string[];
  handler: Handler;
}

const routes: Route[] = [];

function route(method: string, path: string, handler: Handler): void {
  routes.push({ method, segs: path.split('/').filter(Boolean), handler });
}

/* ── 鉴权 ───────────────────────────────────────────────────── */
route('POST', '/auth/register', register);
route('POST', '/auth/login', login);
route('POST', '/auth/logout', logout);
route('GET', '/auth/me', authMe);

/* ── 工作流 ─────────────────────────────────────────────────── */
route('GET', '/workflows', listWorkflows);
route('POST', '/workflows', createWorkflow);
route('GET', '/workflows/:id', getWorkflow);
route('PATCH', '/workflows/:id', updateWorkflow);
route('DELETE', '/workflows/:id', deleteWorkflow);

/* ── Trace ──────────────────────────────────────────────────── */
route('GET', '/traces', listTraces);
route('POST', '/traces', createTrace);

/* ── 资产 / 用量 / 审计 ─────────────────────────────────────── */
route('GET', '/skills', listSkills);
route('GET', '/contracts', listContracts);
route('GET', '/devices', listDevices);
route('GET', '/usage', getUsage);
route('GET', '/audit', listAudit);

/* ── 健康检查 ───────────────────────────────────────────────── */
route('GET', '/health', async () =>
  new Response(JSON.stringify({ ok: true, data: { status: 'ok', at: new Date().toISOString() } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  }),
);

/* ── 匹配 ───────────────────────────────────────────────────── */
function match(
  method: string,
  segs: string[],
): { handler: Handler; params: Record<string, string> } | null {
  for (const r of routes) {
    if (r.method !== method) continue;
    if (r.segs.length !== segs.length) continue;

    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < r.segs.length; i += 1) {
      const pattern = r.segs[i];
      const actual = segs[i];
      if (pattern.startsWith(':')) {
        try {
          params[pattern.slice(1)] = decodeURIComponent(actual);
        } catch {
          params[pattern.slice(1)] = actual;
        }
      } else if (pattern !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return { handler: r.handler, params };
  }
  return null;
}

/* ── 平台入口（cloud-functions 由 shim 调用） ───────────────── */
export async function handleRequest(context: any): Promise<Response> {
  return guard(async () => {
    const env = (context?.env || {}) as Env;
    const req = context?.request ?? context ?? {};

    const method = methodOf(req, context);
    const url = safeUrl(req?.url ?? context?.url);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const segs = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    // 兼容 Headers API 与 plain object 两种 header 形态
    const origin = getHeader(req, 'origin');

    // 预检请求
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(origin),
          'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const ctx: ApiCtx = {
      env,
      method,
      path: `/${segs.join('/')}`,
      segs,
      params: {},
      query: url.searchParams,
      origin,
      req,
      raw: context,
    };

    const found = match(method, segs);
    if (!found) throw notFound(`接口不存在：${method} ${pathname}`);
    ctx.params = found.params;

    const response = await found.handler(ctx);

    // 统一附加 CORS（同域部署时 origin 为空，不产生副作用）
    const cors = corsHeaders(origin);
    Object.entries(cors).forEach(([key, value]) => {
      try {
        response.headers.set(key, value);
      } catch {
        /* 只读响应头忽略 */
      }
    });

    return response;
  });
}

export default handleRequest;
