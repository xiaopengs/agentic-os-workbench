/**
 * providers · 模型供应商插件注册表（M8 · 插件层 1/2）
 *
 * 定义「模型从哪来」：每家供应商声明自己提供的协议端点、示例模型、Key 需求。
 * Provider 与 Harness 正交——换供应商不动 Agent 运行时，换运行时不动供应商配置；
 * 二者唯一的耦合契约是「协议」，由 harnesses.ts 的 buildExecution() 做兼容校验。
 *
 * ⚠️ 下面的端点 / 示例模型只是「开箱可填的默认值」。各家随时可能调整路径与模型名，
 *    生产使用时请在面板「连接设置」里覆盖为供应商文档的当前值，不要当成永久事实。
 *    本项目不内置、不代理任何一家的 Key，凭据只存服务端 KV 或部署环境变量。
 */
import type { Env } from '../env';
import { getEnv } from '../env';

/** 协议 = harness 消费的模型 API 方言 */
export type ProviderProtocol = 'platform' | 'anthropic' | 'openai' | 'google';

export const PROTOCOL_LABEL: Record<ProviderProtocol, string> = {
  platform: '平台登录态',
  anthropic: 'Anthropic Messages',
  openai: 'OpenAI Chat Completions',
  google: 'Google generateContent',
};

export interface LoopProviderSpec {
  id: string;
  label: string;
  /** 这家供应商提供哪些协议的端点（决定能和哪些 harness 组合） */
  protocols: ProviderProtocol[];
  /** 各协议的默认 Base URL，可被用户覆盖 */
  endpoints: Partial<Record<ProviderProtocol, string>>;
  /** 各协议的示例默认模型，仅占位，强烈建议在面板里按当前模型列表覆盖 */
  defaultModels: Partial<Record<ProviderProtocol, string>>;
  /** 是否必须有 API Key */
  requiresKey: boolean;
  /** 部署环境里可兜底读取的 Key 变量名 */
  keyEnv?: string;
  docs?: string;
  note?: string;
}

export const PROVIDER_SPECS: LoopProviderSpec[] = [
  {
    id: 'platform',
    label: '平台默认（CLI 登录态）',
    protocols: ['platform'],
    endpoints: {},
    defaultModels: {},
    requiresKey: false,
    note: 'CodeBuddy CLI 使用平台已登录会话，无需 API Key；模型由平台默认档决定，可用 LOOP_WORKER_MODEL 或在面板指定',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    protocols: ['openai'],
    endpoints: { openai: 'https://openrouter.ai/api/v1' },
    defaultModels: { openai: 'openai/gpt-4o-mini' },
    requiresKey: true,
    keyEnv: 'OPENROUTER_API_KEY',
    docs: 'https://openrouter.ai/keys',
    note: '聚合多家的 OpenAI 兼容网关，模型 ID 形如 openai/gpt-4o-mini、anthropic/claude-sonnet-4.5；Anthropic 协议请用「自定义」覆盖端点',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    protocols: ['openai', 'anthropic'],
    endpoints: {
      openai: 'https://api.deepseek.com',
      anthropic: 'https://api.deepseek.com/anthropic',
    },
    defaultModels: { openai: 'deepseek-chat', anthropic: 'deepseek-chat' },
    requiresKey: true,
    keyEnv: 'DEEPSEEK_API_KEY',
    docs: 'https://platform.deepseek.com/api_keys',
    note: '同时提供 OpenAI 兼容与 Anthropic 兼容端点，可分别供 Codex / Claude Code 使用',
  },
  {
    id: 'kimi',
    label: 'Kimi（Moonshot）',
    protocols: ['openai', 'anthropic'],
    endpoints: {
      openai: 'https://api.moonshot.cn/v1',
      anthropic: 'https://api.moonshot.cn/anthropic',
    },
    defaultModels: { openai: 'kimi-k2', anthropic: 'kimi-k2' },
    requiresKey: true,
    keyEnv: 'MOONSHOT_API_KEY',
    docs: 'https://platform.moonshot.cn/console/api-keys',
    note: '国际站可改为 api.moonshot.ai；模型 ID 请按控制台当前列表覆盖',
  },
  {
    id: 'glm',
    label: 'GLM（智谱 / Z.ai）',
    protocols: ['openai', 'anthropic'],
    endpoints: {
      openai: 'https://open.bigmodel.cn/api/paas/v4',
      anthropic: 'https://open.bigmodel.cn/api/anthropic',
    },
    defaultModels: { openai: 'glm-4.6', anthropic: 'glm-4.6' },
    requiresKey: true,
    keyEnv: 'ZHIPU_API_KEY',
    docs: 'https://open.bigmodel.cn/usercenter/apikeys',
    note: '国际站 Z.ai 可用 api.z.ai/api/anthropic；Coding Plan 与按量端点不同，请覆盖',
  },
  {
    id: 'custom',
    label: '自定义兼容网关',
    protocols: ['openai', 'anthropic', 'google'],
    endpoints: {},
    defaultModels: {},
    requiresKey: false,
    note: '自填 Base URL / 协议 / 模型 ID / API Key，适配任意兼容网关、中转服务或本地无 Key 服务（如 Ollama）',
  },
];

export function isProtocol(v: unknown): v is ProviderProtocol {
  return v === 'platform' || v === 'anthropic' || v === 'openai' || v === 'google';
}

export function getProviderSpec(id: string | undefined): LoopProviderSpec {
  return PROVIDER_SPECS.find((p) => p.id === id) ?? PROVIDER_SPECS[0];
}

export function providerSupports(id: string | undefined, protocol: ProviderProtocol): boolean {
  const p = PROVIDER_SPECS.find((x) => x.id === id);
  return Boolean(p && p.protocols.includes(protocol));
}

/** 取某协议下的端点：用户覆盖优先，其次注册默认值；统一去掉尾部斜杠 */
export function providerEndpoint(
  spec: LoopProviderSpec, protocol: ProviderProtocol, override?: string,
): string | undefined {
  const v = (override || spec.endpoints[protocol] || '').trim();
  return v ? v.replace(/\/+$/, '') : undefined;
}

/** Base URL 清洗：只放行 http(s) 开头的可见字符，杜绝把注入内容拼进环境变量 / 参数 */
export function safeBaseUrl(raw: string | undefined): string | undefined {
  const v = String(raw ?? '').trim();
  if (!/^https?:\/\/[^\s"'\\`$;|&<>\u0000-\u001F\u007F-\u009F]+$/i.test(v)) return undefined;
  return v.length <= 300 ? v.replace(/\/+$/, '') : undefined;
}

/** Key 清洗：拒绝空白与控制符，绝不写日志、绝不回显到前端 */
export function safeApiKey(raw: string | undefined): string | undefined {
  const v = String(raw ?? '').trim();
  if (!v || v.length > 512) return undefined;
  return /[\s\u0000-\u001F\u007F-\u009F]/.test(v) ? undefined : v;
}

/**
 * 模型 ID 清洗（插件层用）：比 M7 的 safeModel 更宽松，放行 OpenRouter 的 `/`、
 * DeepSeek 的 `[1m]`、`@` 等常见模型 ID 字符；仍拒绝空白、引号、反斜杠与控制符。
 */
export function safeModelId(raw: string | undefined): string | undefined {
  const v = String(raw ?? '').trim();
  return /^[A-Za-z0-9._:/\[\]@+\-]{1,96}$/.test(v) ? v : undefined;
}

/**
 * 旧 gateway 模式（LOOP_WORKER_MODE=gateway）的环境变量兜底，保持向后兼容：
 * 老配置不用改任何东西，仍走 AI_GATEWAY_* 那套凭据。
 */
export function legacyGatewayFallback(env: Env): { apiKey?: string; baseUrl?: string; model?: string } {
  const rawBase = getEnv(env, 'AI_GATEWAY_BASE_URL');
  const trimmed = rawBase ? rawBase.replace(/\/+$/, '') : undefined;
  // 旧 gateway 允许省略 /v1，这里补上；注册表里的新端点一律按原样使用，不再自动补后缀。
  const baseUrl = trimmed && !/\/v\d+$/.test(trimmed) ? `${trimmed}/v1` : trimmed;
  return {
    apiKey: getEnv(env, 'AI_GATEWAY_API_KEY'),
    baseUrl,
    // 不在这里塞默认模型：否则会污染「自定义网关」等新组合。
    // 旧 gateway 行为的 hy4free 兜底放在 http-direct 分支里。
    model: getEnv(env, 'AI_GATEWAY_MODEL'),
  };
}
