/**
 * harnesses · Agent 运行时插件注册表（M8 · 插件层 2/2）
 *
 * 定义「谁来跑这一轮 Agent」：每个 harness 是一个真实的 CLI（或纯 HTTP）适配器，
 * 声明它消费哪种模型协议、用什么 headless 参数、需要哪些环境变量、怎么探测安装。
 *
 * 与 providers.ts 的关系：harness × provider 组成一次执行；协议是唯一契约。
 * buildExecution() 只产出「可执行的计划」，真正 spawn / fetch 仍由 worker.ts 完成，
 * 保持分层单向：providers/harnesses（纯计算）→ worker（调度 + IO）→ kernel（状态机）。
 *
 * 安全铁律沿用 M7：
 *   - 事件正文只写隔离目录的 context.json，绝不拼进提示词；
 *   - 工具集收敛为只读，禁用会话持久化、MCP、插件、hooks；
 *   - 第三方 CLI 给「干净环境」，不带平台 ACC_PRODUCT_CONFIG_* 凭据，避免串扰；
 *   - 模型输出仍经 worker 的 normalizeReceipt 白名单归一化，任何臆造都进不了事实日志。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Env } from '../env';
import { getEnv } from '../env';
import {
  getProviderSpec, providerEndpoint, safeBaseUrl, safeApiKey, safeModelId,
  legacyGatewayFallback, isProtocol, PROTOCOL_LABEL,
  type ProviderProtocol,
} from './providers';

/* ── 注册表 ─────────────────────────────────────────────────── */
export interface HarnessSpec {
  id: string;
  label: string;
  /** 该 harness 消费的模型协议（决定能配哪些 provider） */
  protocol: ProviderProtocol;
  bin: string;
  /** 是否需要本机安装 CLI；false = 纯 HTTP，无需安装 */
  needsInstall: boolean;
  installHint?: string;
  docs?: string;
  note?: string;
}

export const HARNESS_SPECS: HarnessSpec[] = [
  {
    id: 'codebuddy',
    label: 'CodeBuddy CLI',
    protocol: 'platform',
    bin: 'codebuddy',
    needsInstall: true,
    installHint: '本机已预装（平台登录态）',
    note: '平台默认档，无需 API Key；只与「平台默认」供应商组合，换模型用 LOOP_WORKER_MODEL 或面板指定',
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    protocol: 'anthropic',
    bin: 'claude',
    needsInstall: true,
    installHint: 'npm i -g @anthropic-ai/claude-code',
    docs: 'https://code.claude.com/docs/en/headless',
    note: '需 Anthropic Messages 兼容端点；-p 无交互 + --bare 跳过插件/hooks + 工具收敛只读',
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    protocol: 'openai',
    bin: 'codex',
    needsInstall: true,
    installHint: 'npm i -g @openai/codex',
    note: '需 OpenAI 兼容端点；隔离目录写临时 config.toml（CODEX_HOME 指向），不污染 ~/.codex',
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    protocol: 'google',
    bin: 'gemini',
    needsInstall: true,
    installHint: 'npm i -g @google/gemini-cli',
    note: '需 Google generateContent 兼容端点；OpenAI 兼容网关请改选「HTTP 直连」',
  },
  {
    id: 'http-direct',
    label: 'HTTP 直连（OpenAI 兼容）',
    protocol: 'openai',
    bin: '',
    needsInstall: false,
    note: '无需安装任何 CLI，直接调用 /chat/completions；配好任意供应商的 Key 即可立刻真跑',
  },
];

export function getHarnessSpec(id: string | undefined): HarnessSpec {
  return HARNESS_SPECS.find((h) => h.id === id) ?? HARNESS_SPECS[0];
}

/* ── CLI 解析与环境隔离 ───────────────────────────────────────
 * codebuddy 的包装脚本是 `#!/usr/bin/env node`，服务子进程里 PATH 可能解析到
 * 系统 node 18 导致卡死，故显式用 nvm 的 node v22 执行 CLI 的真实 js 入口。
 * 其它第三方 CLI 走各自 bin，但一律给「干净环境」，不带平台凭据。
 * ------------------------------------------------------------ */
const NVM_BIN = '/root/.nvm/versions/node/v22.13.1/bin';
const NODE_PATH = path.join(NVM_BIN, 'node');
const CODEBUDDY_JS = '/root/.nvm/versions/node/v22.13.1/lib/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy';

export interface CliInvocation {
  bin: string;
  prefix: string[];
  env: Record<string, string | undefined>;
}

/**
 * 解析实际要执行的 bin。
 * LOOP_WORKER_BIN 是 codebuddy 专属配置，绝不能套到 claude/codex/gemini 上——
 * 否则会拿 codebuddy 给别的 harness 做 --version 探测，把没装的运行时误判成已装，
 * 执行时更会张冠李戴地跑错程序。绝对路径视为部署方对某 CLI 的显式指定，对所有 harness 生效。
 */
function effectiveBin(spec: HarnessSpec, binOverride?: string): string {
  if (!binOverride) return spec.bin;
  if (binOverride.includes('/')) return binOverride;
  return spec.id === 'codebuddy' ? binOverride : spec.bin;
}

/** 平台 CLI 的认证环境：只放行必需项，显式禁 MCP/自动记忆，避免派生子进程挂起 */
function platformEnv(): Record<string, string | undefined> {
  const base = process.env;
  const passthrough: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(base)) {
    if (k.startsWith('ACC_PRODUCT_CONFIG') || k.startsWith('X_IDE_SPACE')
      || k === 'X_IDE_AUTH_PROXY' || k === 'HOME' || k === 'LANG' || k === 'LC_ALL'
      || k === 'NODE_ENV' || k === 'ACC_USER_ID') passthrough[k] = v;
  }
  return {
    ...passthrough,
    PATH: `${NVM_BIN}:${base.PATH || ''}`,
    CODEBUDDY_INTERNET_ENVIRONMENT: 'internal',
    CODEBUDDY_FORCE_HEADLESS_BUNDLE: '1',
    CODEBUDDY_DISABLE_AUTO_MEMORY: '1',
    CODEBUDDY_MCP_CONFIG: '',
    CODEBUDDY_DISABLE_CRON: '1',
  };
}

/** 第三方 CLI 的干净环境：无平台凭据，PATH 前置 nvm v22 */
function cleanEnv(): Record<string, string | undefined> {
  const base = process.env;
  return {
    HOME: base.HOME,
    LANG: base.LANG,
    LC_ALL: base.LC_ALL,
    PATH: `${NVM_BIN}:${base.PATH || ''}`,
    NODE_ENV: 'production',
  };
}

export function resolveInvocation(spec: HarnessSpec, binOverride?: string): CliInvocation {
  const bin = effectiveBin(spec, binOverride);
  if (spec.id === 'codebuddy') {
    if ((bin === 'codebuddy' || bin.endsWith('/bin/codebuddy'))
      && existsSync(NODE_PATH) && existsSync(CODEBUDDY_JS)) {
      return { bin: NODE_PATH, prefix: [CODEBUDDY_JS], env: platformEnv() };
    }
    return { bin, prefix: [], env: platformEnv() };
  }
  return { bin, prefix: [], env: cleanEnv() };
}

/** 同步探测：CLI 是否存在（供 capabilities 与启动日志） */
export function harnessInstalled(spec: HarnessSpec, binOverride?: string): boolean {
  if (!spec.needsInstall) return true;
  const bin = effectiveBin(spec, binOverride);
  if (bin.includes('/')) return existsSync(bin);
  const dirs = String(process.env.PATH || '').split(':');
  if (dirs.some((d) => existsSync(path.join(d, bin)))) return true;
  return spec.id === 'codebuddy' && existsSync(NODE_PATH) && existsSync(CODEBUDDY_JS);
}

function quickVersion(
  bin: string, prefix: string[], env: Record<string, string | undefined>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, [...prefix, '--version'], {
        env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      reject(e);
      return;
    }
    let out = '';
    let err = '';
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      done(() => { try { child.kill('SIGKILL'); } catch { /* 已退出 */ } reject(new Error('探测超时（8s）')); });
    }, 8_000);
    child.stdout?.on('data', (d: Buffer) => { out += d.toString('utf8'); });
    child.stderr?.on('data', (d: Buffer) => { err += d.toString('utf8'); });
    child.on('error', (e) => done(() => reject(e)));
    child.on('close', (code) => done(() => {
      if (code === 0) resolve((out || err).trim().slice(0, 80));
      else reject(new Error(`--version 退出码 ${code}：${(out + err).trim().slice(0, 80)}`));
    }));
  });
}

/** 已安装 CLI 的 --version 结果缓存 60s：面板轮询不必每次都 spawn */
const versionCache = new Map<string, { at: number; version: string; reason: string }>();

/** 异步真实探测：跑一次 --version，不装就是不可用，绝不假装在线 */
export async function probeHarness(
  spec: HarnessSpec, binOverride?: string,
): Promise<{ installed: boolean; version: string; reason: string }> {
  if (!spec.needsInstall) {
    return { installed: true, version: '', reason: '纯 HTTP 调用，无需安装 CLI' };
  }
  // 未安装状态不缓存：用户可能随时装上，existsSync 本身足够轻量
  if (!harnessInstalled(spec, binOverride)) {
    return {
      installed: false, version: '',
      reason: `${spec.label} 未安装${spec.installHint ? `（${spec.installHint}）` : ''}`,
    };
  }
  const cached = versionCache.get(spec.id);
  if (cached && Date.now() - cached.at < 60_000) {
    return { installed: true, version: cached.version, reason: cached.reason };
  }
  try {
    const inv = resolveInvocation(spec, binOverride);
    const version = await quickVersion(inv.bin, inv.prefix, inv.env);
    const reason = `${spec.label} 已就绪 · ${version}`;
    versionCache.set(spec.id, { at: Date.now(), version, reason });
    return { installed: true, version, reason };
  } catch (e) {
    return { installed: false, version: '', reason: `${spec.label} 不可用：${(e as Error).message}` };
  }
}

/* ── 组合器：harness × provider → 可执行计划 ────────────────── */
export interface ExecutionPlan {
  ok: boolean;
  reason?: string;
  harness: string;
  harnessLabel: string;
  provider: string;
  providerLabel: string;
  protocol: ProviderProtocol;
  /** 本轮实际使用的模型；null = 平台默认档 */
  model: string | null;
  kind?: 'cli' | 'http';
  bin?: string;
  prefix?: string[];
  argv?: string[];
  env?: Record<string, string | undefined>;
  /** 需在隔离目录额外写出的文件（codex 的 config.toml） */
  files?: Array<{ name: string; content: string }>;
  http?: { baseUrl: string; apiKey: string; model: string; systemPrompt: string; prompt: string };
}

export interface BuildInput {
  harnessId: string;
  providerId: string;
  /** custom 供应商由用户指定协议 */
  protocolOverride?: string;
  baseUrl?: string;
  model?: string;
  /** 用户在面板填写、存服务端 KV 的 Key（明文，仅在进程内使用） */
  apiKey?: string;
  bin?: string;
  env: Env;
  systemPrompt: string;
  prompt: string;
  /** 隔离目录绝对路径 */
  addDir: string;
}

/**
 * 纯函数：把「选了哪个 harness + 哪个 provider + 凭据」翻译成一次可执行的计划。
 * 任何不满足真实执行条件的组合都返回 ok=false + 明确原因，绝不降级成模拟成功。
 */
export function buildExecution(input: BuildInput): ExecutionPlan {
  const h = getHarnessSpec(input.harnessId);
  const p = getProviderSpec(input.providerId);
  const protocol: ProviderProtocol = isProtocol(input.protocolOverride)
    ? input.protocolOverride : h.protocol;
  const base: ExecutionPlan = {
    ok: false, harness: h.id, harnessLabel: h.label,
    provider: p.id, providerLabel: p.label, protocol, model: null,
  };

  // ① 协议兼容矩阵：harness 要的方言，provider 必须真的提供
  if (!p.protocols.includes(protocol)) {
    return {
      ...base,
      reason: `协议不兼容：${h.label} 需要「${PROTOCOL_LABEL[protocol]}」端点，`
        + `而 ${p.label} 提供 ${p.protocols.map((x) => PROTOCOL_LABEL[x]).join('、')}。`
        + ' 请换供应商，或选「自定义兼容网关」自行填写端点与协议。',
    };
  }

  // ② 真实安装探测：没装的 CLI 明确不可用
  if (!harnessInstalled(h, input.bin)) {
    return {
      ...base,
      reason: `${h.label} 未安装${h.installHint ? `（${h.installHint}）` : ''}，当前组合不可执行；`
        + ' 可先安装，或改选「HTTP 直连」（无需安装 CLI）。',
    };
  }

  // ③ 凭据：面板 Key > 部署环境该家专属变量 > 旧 AI_GATEWAY_API_KEY 兜底
  const legacy = legacyGatewayFallback(input.env);
  const key = safeApiKey(input.apiKey)
    ?? safeApiKey(p.keyEnv ? getEnv(input.env, p.keyEnv) : undefined)
    ?? safeApiKey(legacy.apiKey);
  if (p.requiresKey && !key) {
    return {
      ...base,
      reason: `${p.label} 需要 API Key：请在「连接设置」填写，`
        + `或在部署环境配置 ${p.keyEnv || 'AI_GATEWAY_API_KEY'}。`,
    };
  }

  // ④ 端点：用户覆盖 > 注册默认值 > 旧 AI_GATEWAY_BASE_URL 兜底（platform 协议不需要）
  const endpoint = providerEndpoint(p, protocol, safeBaseUrl(input.baseUrl))
    ?? safeBaseUrl(legacy.baseUrl);
  if (protocol !== 'platform' && !endpoint) {
    return {
      ...base,
      reason: `${p.label} 在「${PROTOCOL_LABEL[protocol]}」协议下没有默认 Base URL，请在「连接设置」填写。`,
    };
  }

  // ⑤ 模型：用户指定 > 该协议示例默认 > 旧 AI_GATEWAY_MODEL 兜底
  const model = safeModelId(input.model)
    ?? safeModelId(p.defaultModels[protocol])
    ?? safeModelId(legacy.model);

  // ⑥ 按 harness 生成真实执行参数
  const inv = resolveInvocation(h, input.bin);
  const envBase = h.id === 'codebuddy' ? platformEnv() : cleanEnv();
  // codebuddy 有专用 --system-prompt；其余 CLI 把系统指令作为 prompt 前缀
  // （外部事件正文仍只在 context.json，前缀里只有规则性指令，指令数据分离不变）
  const promptWithSystem = h.id === 'codebuddy'
    ? input.prompt
    : `${input.systemPrompt}\n\n${input.prompt}`;

  if (h.id === 'http-direct') {
    // hy4free 仅为旧 gateway（未配 AI_GATEWAY_MODEL）的兼容兜底；
    // 新组合一律用面板/注册表指定的模型。
    const httpModel = model || 'hy4free';
    return {
      ...base, ok: true, kind: 'http', model: httpModel,
      http: {
        baseUrl: endpoint!, apiKey: key || '', model: httpModel,
        systemPrompt: input.systemPrompt, prompt: input.prompt,
      },
    };
  }

  if (h.id === 'codebuddy') {
    return {
      ...base, ok: true, kind: 'cli', model: model ?? null,
      bin: inv.bin, prefix: inv.prefix, env: inv.env,
      argv: [
        '-p', ...(model ? ['--model', model] : []),
        '--tools', 'Read', '--add-dir', input.addDir,
        '--strict-mcp-config', '--mcp-config', '{}', '--setting-sources', '',
        '--no-session-persistence',
        '--system-prompt', input.systemPrompt,
        input.prompt,
      ],
    };
  }

  if (h.id === 'claude-code') {
    const env: Record<string, string | undefined> = {
      ...envBase,
      ANTHROPIC_BASE_URL: endpoint,
      ANTHROPIC_AUTH_TOKEN: key,
      ANTHROPIC_API_KEY: key,
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
      ...(model ? {
        ANTHROPIC_MODEL: model,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
        ANTHROPIC_DEFAULT_SONNET_MODEL: model,
        ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      } : {}),
    };
    return {
      ...base, ok: true, kind: 'cli', model: model ?? null,
      bin: inv.bin, prefix: inv.prefix, env,
      argv: [
        '-p', '--bare', '--output-format', 'text',
        '--permission-mode', 'dontAsk',
        '--allowedTools', 'Read',
        '--disallowedTools', 'Write,Edit,Bash',
        '--append-system-prompt', input.systemPrompt,
        '--no-session-persistence',
        ...(model ? ['--model', model] : []),
        input.prompt,
      ],
    };
  }

  if (h.id === 'codex') {
    const configToml = [
      'model_provider = "autoloop"',
      `model = ${JSON.stringify(model || '')}`,
      'disable_response_storage = true',
      '',
      '[model_providers.autoloop]',
      'name = "autoloop"',
      `base_url = ${JSON.stringify(endpoint)}`,
      'env_key = "OPENAI_API_KEY"',
      'wire_api = "chat"',
    ].join('\n');
    return {
      ...base, ok: true, kind: 'cli', model: model ?? null,
      bin: inv.bin, prefix: inv.prefix,
      env: { ...envBase, CODEX_HOME: input.addDir, OPENAI_API_KEY: key },
      argv: [
        'exec', '--skip-git-repo-check', '--sandbox', 'read-only',
        ...(model ? ['--model', model] : []),
        promptWithSystem,
      ],
      files: [{ name: 'config.toml', content: configToml }],
    };
  }

  if (h.id === 'gemini-cli') {
    return {
      ...base, ok: true, kind: 'cli', model: model ?? null,
      bin: inv.bin, prefix: inv.prefix,
      env: {
        ...envBase,
        GOOGLE_GEMINI_BASE_URL: endpoint,
        GEMINI_API_KEY: key,
        ...(model ? { GEMINI_MODEL: model } : {}),
      },
      argv: ['-p', '-y', promptWithSystem],
    };
  }

  return { ...base, reason: `未知的 harness：${h.id}` };
}
