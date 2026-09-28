/**
 * audit · 审计日志（关键写操作落库，可回溯）
 *
 * Key: audit:{uid}:{ts}:{id}  → AuditLog { id, action, target, actor, at }
 * ts 为 14 位定宽时间戳，保证同一前缀内按时间字典序可排。
 */
import type { AuditLog } from '../../shared/types';
import { k, newId, type Repo } from './kv';

export interface AuditEntry {
  action: string;
  target?: string;
  actor?: string;
}

function padTs(date: Date): string {
  return String(date.getTime()).padStart(14, '0');
}

/** 写一条审计日志（失败不影响主流程，仅记录） */
export async function writeAudit(r: Repo, uid: string, entry: AuditEntry): Promise<void> {
  try {
    const now = new Date();
    const id = newId('log');
    const record: AuditLog = {
      id,
      action: entry.action,
      target: entry.target,
      actor: entry.actor,
      at: now.toISOString(),
    };
    await r.put(k.audit(uid, padTs(now), id), record);
  } catch (error) {
    console.error('[audit] 写入失败:', error);
  }
}

/** 读取审计日志（按时间倒序，默认最近 200 条） */
export async function listAudit(r: Repo, uid: string, limit = 200): Promise<AuditLog[]> {
  const items = await r.list<AuditLog>(`audit:${uid}:`);
  const sorted = [...items].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return sorted.slice(0, limit);
}