/**
 * kv · KV 仓储封装（多租户隔离的唯一入口）
 *
 * Key 规范（服务端强制注入 userId，任何接口绝不接受客户端传入 userId）：
 *   user:{email}              → UserRecord（含 passHash，永不外泄）
 *   session:{sid}             → SessionRecord
 *   wf:{uid}:{wfId}           → Workflow
 *   trace:{uid}:{traceId}     → Trace
 *   skill:{uid}:{skillId}     → Skill
 *   contract:{uid}:{cid}      → Contract
 *   device:{uid}:{did}        → Device   （架构文档未列，前端设备页需要，按同构范式补充）
 *   usage:{uid}:{yyyymm}      → UsageRecord
 *   audit:{uid}:{ts}:{id}     → AuditLog
 *   decision:{uid}:d:{adrId}  → Decision  （M6 架构决策面板，独立前缀，不侵入 loop 事实日志）
 *   decision:{uid}:meta       → { seeded }（M6 独立播种标记，前缀 d: 与之天然隔离）
 *
 * 提供 list / get / put / del，列表按前缀扫描。
 */
import type { Decision } from '../../shared/decision';
import type { Contract, Device, Skill, Trace, User, Workflow } from '../../shared/types';
import { getDriver, type StoreDriver } from './store';
import type { Env } from './env';

/* ── 实体记录（含服务端私有字段） ───────────────────────────── */
export interface UserRecord extends User {
  /** bcrypt 哈希，绝不返回给客户端 */
  passHash: string;
  createdAt: string;
  /** 演示数据是否已播种（幂等标记） */
  seeded?: boolean;
}

export interface SessionRecord {
  userId: string;
  email: string;
  /** 过期时间（Unix 秒）；0 表示已吊销 */
  exp: number;
  /** 登出墓碑标记：登出时写入而非删除，避免最终一致存储把「已吊销」读成「不存在」 */
  revoked?: boolean;
}

export interface UsageRecord {
  runs: number;
  tokens: number;
  costCents: number;
}

/* ── 工具 ───────────────────────────────────────────────────── */
export function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

/** 生成带前缀的短 ID（16 位十六进制，避免 KV key 过长） */
export function newId(prefix: string): string {
  const raw =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}_${raw.replace(/-/g, '').slice(0, 16)}`;
}

/* ── Key 构造器（唯一出口，禁止在业务代码里手拼 key） ───────── */
export const k = {
  user: (email: string) => `user:${normalizeEmail(email)}`,
  session: (sid: string) => `session:${sid}`,
  wf: (uid: string, wfId: string) => `wf:${uid}:${wfId}`,
  trace: (uid: string, traceId: string) => `trace:${uid}:${traceId}`,
  skill: (uid: string, skillId: string) => `skill:${uid}:${skillId}`,
  contract: (uid: string, cid: string) => `contract:${uid}:${cid}`,
  device: (uid: string, did: string) => `device:${uid}:${did}`,
  usage: (uid: string, yyyymm: string) => `usage:${uid}:${yyyymm}`,
  audit: (uid: string, ts: string, id: string) => `audit:${uid}:${ts}:${id}`,
  /** M6 决策实体（adrId 如 ADR-0001） */
  decision: (uid: string, adrId: string) => `decision:${uid}:d:${adrId}`,
  /** M6 决策列表前缀（只扫实体，不含 meta） */
  decisionPrefix: (uid: string) => `decision:${uid}:d:`,
  /** M6 独立播种标记 */
  decisionMeta: (uid: string) => `decision:${uid}:meta`,
} as const;

/* ── 仓储 ───────────────────────────────────────────────────── */
export class Repo {
  constructor(public readonly driver: StoreDriver) {}

  async get<T>(key: string): Promise<T | null> {
    if (!key) return null;
    return this.driver.get<T>(key);
  }

  async put(key: string, value: unknown): Promise<void> {
    await this.driver.put(key, value);
  }

  async del(key: string): Promise<void> {
    await this.driver.del(key);
  }

  async keys(prefix: string): Promise<string[]> {
    return this.driver.list(prefix);
  }

  /** 按前缀扫描并批量取值（并发读取，过滤空值） */
  async list<T>(prefix: string): Promise<T[]> {
    const keys = await this.driver.list(prefix);
    if (keys.length === 0) return [];
    // Awaited<T> 在泛型下会展开，这里显式收敛回 T | null
    const values = (await Promise.all(
      keys.map((key) => this.driver.get<T>(key)),
    )) as Array<T | null>;
    return values.filter((v): v is T => v !== null && v !== undefined);
  }
}

export async function repo(env: Env): Promise<Repo> {
  return new Repo(await getDriver(env));
}

/* ── 集合快捷访问（uid 由服务端注入） ───────────────────────── */
export function listWorkflows(r: Repo, uid: string): Promise<Workflow[]> {
  return r.list<Workflow>(`wf:${uid}:`);
}
export function listTraces(r: Repo, uid: string): Promise<Trace[]> {
  return r.list<Trace>(`trace:${uid}:`);
}
export function listSkills(r: Repo, uid: string): Promise<Skill[]> {
  return r.list<Skill>(`skill:${uid}:`);
}
export function listContracts(r: Repo, uid: string): Promise<Contract[]> {
  return r.list<Contract>(`contract:${uid}:`);
}
export function listDevices(r: Repo, uid: string): Promise<Device[]> {
  return r.list<Device>(`device:${uid}:`);
}
export function listDecisions(r: Repo, uid: string): Promise<Decision[]> {
  return r.list<Decision>(k.decisionPrefix(uid));
}

export function sortByCreatedAtDesc<T extends { createdAt?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export function sortByUpdatedAtDesc<T extends { updatedAt?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}
