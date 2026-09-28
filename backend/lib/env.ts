/**
 * env · 环境变量读取
 *
 * 平台铁律：cloud-functions/ 内优先读取 context.env（平台注入），
 * 禁止依赖 process.env（多 handler 共享进程，易串扰）。
 * 这里保留 process.env 作为「本地脚本 / 单元测试 / CLI」的兜底读取，
 * 读取顺序：context.env → process.env。
 */
export type Env = Record<string, string | undefined>;

export function getEnv(env: Env | undefined, key: string): string | undefined {
  const fromCtx = env ? env[key] : undefined;
  if (fromCtx !== undefined && fromCtx !== '') return String(fromCtx);

  try {
    const fromProc = typeof process !== 'undefined' ? process.env?.[key] : undefined;
    if (fromProc !== undefined && fromProc !== '') return String(fromProc);
  } catch {
    /* 非 Node 环境忽略 */
  }
  return undefined;
}

export function isProduction(env: Env | undefined): boolean {
  const nodeEnv = (getEnv(env, 'NODE_ENV') || '').toLowerCase();
  if (nodeEnv === 'production') return true;
  if (nodeEnv === 'development' || nodeEnv === 'test') return false;
  // 平台上未显式声明时，若已注入项目标识则视为生产环境
  return Boolean(getEnv(env, 'MAKERS_PROJECT_ID') || getEnv(env, 'EDGEONE_PROJECT_ID'));
}