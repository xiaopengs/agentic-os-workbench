/**
 * EdgeOne Makers Cloud Functions · API 统一入口（catch-all）
 *
 * 路由：/api/* → backend/functions/router.ts
 * 平台要求入口文件位于 cloud-functions/ 目录，业务逻辑全部沉淀在 backend/，
 * 这里只做一层薄转发，保持前后端逻辑分离（方案 A）。
 *
 * ⚠️ 环境变量一律通过 context.env 读取（平台铁律），backend 内部已封装 getEnv。
 */
import { handleRequest } from '../../backend/functions/router';

/**
 * ⚠️ 这里只导出 onRequest（Handler 模式）。
 * 切勿 `export default` 一个函数——平台会把 [[default]] 的 default 导出
 * 识别为 Express/Koa 框架实例并按 (req, res) 调用，导致运行失败。
 */
export async function onRequest(context: any): Promise<Response> {
  return handleRequest(context);
}

export async function onRequestGet(context: any): Promise<Response> {
  return handleRequest(context);
}

export async function onRequestPost(context: any): Promise<Response> {
  return handleRequest(context);
}

export async function onRequestPatch(context: any): Promise<Response> {
  return handleRequest(context);
}

export async function onRequestDelete(context: any): Promise<Response> {
  return handleRequest(context);
}
