/**
 * store · 持久化存储驱动（平台存储适配层）
 *
 * ⚠️ 平台事实：KV Storage 仅在 Edge Functions（V8）中作为全局变量可用，
 *    Cloud Functions（Node.js）无法访问 KV 全局变量。
 *    本后端必须使用 Node.js 运行时（bcryptjs / jose 为 npm 包），
 *    因此主驱动为 Blob Storage（@edgeone/pages-blob），用于存放结构化 KV 数据。
 *
 * 驱动选择顺序：
 *   1. 若运行环境中存在 KV 命名空间全局变量（默认绑定名 my_kv，可用 KV_BINDING 覆盖）→ 使用 KV
 *   2. 否则 → 使用 Blob Storage（强一致读，避免 read-after-write 读不到刚写入的数据）
 *
 * 两种驱动暴露统一接口，对上层 kv.ts 完全透明。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getEnv, type Env } from './env';

export interface StoreDriver {
  /** 驱动标识，便于日志排查 */
  readonly name: string;
  get<T = unknown>(key: string): Promise<T | null>;
  put(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  /** 按前缀扫描，返回完整 key 列表（自动翻页） */
  list(prefix: string): Promise<string[]>;
}

/* ── KV Storage 驱动（Edge Functions 全局变量） ─────────────── */
function createKvDriver(binding: any, bindingName: string): StoreDriver {
  return {
    name: `kv:${bindingName}`,
    async get<T>(key: string): Promise<T | null> {
      const value = await binding.get(key, 'json');
      return (value ?? null) as T | null;
    },
    async put(key: string, value: unknown): Promise<void> {
      await binding.put(key, JSON.stringify(value));
    },
    async del(key: string): Promise<void> {
      await binding.delete(key);
    },
    async list(prefix: string): Promise<string[]> {
      const keys: string[] = [];
      let cursor: string | undefined;
      // KV list 单页上限 256，需手工翻页
      for (let guard = 0; guard < 200; guard += 1) {
        const res = (await binding.list({ prefix, limit: 256, cursor })) as {
          complete?: boolean;
          cursor?: string;
          keys?: Array<{ name: string }>;
        };
        for (const item of res.keys || []) keys.push(item.name);
        if (res.complete || !res.cursor) break;
        cursor = res.cursor;
      }
      return keys;
    },
  };
}

/* ── Blob Storage 驱动（Cloud Functions · npm SDK） ─────────── */
async function createBlobDriver(env: Env): Promise<StoreDriver> {
  // 动态 import：若运行环境已绑定 KV 则不强制依赖该 SDK
  const mod: any = await import('@edgeone/pages-blob');
  const getStore = mod?.getStore;
  if (typeof getStore !== 'function') {
    throw new Error('@edgeone/pages-blob 未正确加载，请确认已安装 ^0.0.14 或更高版本');
  }

  const name = getEnv(env, 'BLOB_STORE') || 'agentic-os-workbench';
  const consistency = 'strong'; // 读己之写：计数器 / 会话 / 刚创建即读取的场景必须强一致
  const store = getStore({ name, consistency });

  return {
    name: `blob:${name}`,
    async get<T>(key: string): Promise<T | null> {
      const value = await store.get(key, { type: 'json', consistency });
      return (value ?? null) as T | null;
    },
    async put(key: string, value: unknown): Promise<void> {
      await store.setJSON(key, value);
    },
    async del(key: string): Promise<void> {
      await store.delete(key);
    },
    async list(prefix: string): Promise<string[]> {
      const res = (await store.list({ prefix, consistency })) as {
        blobs?: Array<{ key: string }>;
      };
      return (res.blobs || []).map((b) => b.key);
    },
  };
}

/* ── 本地文件驱动（脱离平台运行：本地部署 / 自托管 / 单元测试） ── */
async function createFileDriver(file: string): Promise<StoreDriver> {
  const abs = path.resolve(process.cwd(), file);
  await mkdir(path.dirname(abs), { recursive: true });

  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(await readFile(abs, 'utf8'));
  } catch {
    data = {};
  }
  const flush = () => writeFile(abs, JSON.stringify(data, null, 2), 'utf8');

  return {
    name: `file:${file}`,
    async get<T>(key: string): Promise<T | null> {
      return (data[key] ?? null) as T | null;
    },
    async put(key: string, value: unknown): Promise<void> {
      data[key] = value;
      await flush();
    },
    async del(key: string): Promise<void> {
      delete data[key];
      await flush();
    },
    async list(prefix: string): Promise<string[]> {
      return Object.keys(data)
        .filter((k) => !prefix || k.startsWith(prefix))
        .sort();
    },
  };
}

/* ── 驱动解析（进程内缓存，降低冷启动后的重复初始化开销） ───── */
let cached: { sig: string; driver: StoreDriver } | null = null;
let inflight: Promise<StoreDriver> | null = null;

export async function getDriver(env: Env): Promise<StoreDriver> {
  /* 本地文件模式：显式声明 LOCAL_STORE=file 时直接走本地 JSON 文件，
     完全不加载任何平台 SDK —— 本地部署 / 自托管 / 单元测试均可独立运行。 */
  const localMode = (getEnv(env, 'LOCAL_STORE') || '').toLowerCase();
  if (localMode === 'file' || localMode === '1' || localMode === 'true') {
    const file = getEnv(env, 'LOCAL_STORE_PATH') || '.data/store.json';
    const sigLocal = `file:${file}`;
    if (cached && cached.sig === sigLocal) return cached.driver;
    const localDriver = await createFileDriver(file);
    cached = { sig: sigLocal, driver: localDriver };
    return localDriver;
  }

  const bindingName = getEnv(env, 'KV_BINDING') || 'my_kv';
  const sig = `${bindingName}|${getEnv(env, 'BLOB_STORE') || 'agentic-os-workbench'}`;

  if (cached && cached.sig === sig) return cached.driver;
  if (inflight) return inflight;

  inflight = (async () => {
    const binding = (globalThis as any)?.[bindingName];
    if (binding && typeof binding.get === 'function' && typeof binding.put === 'function') {
      const driver = createKvDriver(binding, bindingName);
      cached = { sig, driver };
      return driver;
    }
    try {
      const driver = await createBlobDriver(env);
      cached = { sig, driver };
      return driver;
    } catch {
      // 平台 SDK 不可用（本地运行 / 自托管）→ 本地文件兜底，保证服务可用
      const file = getEnv(env, 'LOCAL_STORE_PATH') || '.data/store.json';
      const driver = await createFileDriver(file);
      cached = { sig: `file:${file}`, driver };
      return driver;
    }
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** 仅供测试：清空驱动缓存 */
export function __resetDriverCache(): void {
  cached = null;
  inflight = null;
}
