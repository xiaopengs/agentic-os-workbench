/** 格式化与派生计算工具（时钟格式与原型保持完全一致） */

export function pad(n: number): string {
  return (n < 10 ? '0' : '') + n;
}

/** 秒 → HH:MM:SS */
export function fmtHMS(sec: number): string {
  const s = ((sec % 86400) + 86400) % 86400;
  return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60);
}

/** 秒 → HH:MM（手机屏显） */
export function fmtMS(sec: number): string {
  const s = ((sec % 86400) + 86400) % 86400;
  return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor((s % 3600) / 60));
}

/** Date → HH:MM:SS */
export function fmtClock(d: Date): string {
  return fmtHMS(d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds());
}

/** 相对时间：刚刚 / N分钟前 / N小时前 / M月D日 */
export function relTime(iso?: string | number | Date): string {
  if (!iso) return '—';
  const t = typeof iso === 'number' ? iso : new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}天前`;
  const d = new Date(t);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function fmtMoney(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

/** P95：从 trace 耗时集合取 95 分位 */
export function p95(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[Math.max(0, idx)];
}

export type TrendResult = { pct: number | null; label: string; flat: boolean };

/**
 * 周环比：取 [now-7d, now) 与 [now-14d, now-7d) 两个窗口的条目数对比。
 * 无历史数据时返回 { pct: null } → UI 显示为「— 持平」。
 */
export function weeklyTrend(items: { createdAt?: string; updatedAt?: string }[]): TrendResult {
  if (!items.length) return { pct: null, label: '— 持平', flat: true };
  const now = Date.now();
  const day = 86_400_000;
  let cur = 0;
  let prev = 0;
  for (const it of items) {
    const raw = it.createdAt || it.updatedAt;
    if (!raw) continue;
    const t = new Date(raw).getTime();
    if (!Number.isFinite(t)) continue;
    const age = now - t;
    if (age >= 0 && age < 7 * day) cur++;
    else if (age >= 7 * day && age < 14 * day) prev++;
  }
  if (prev === 0) {
    if (cur === 0) return { pct: null, label: '— 持平', flat: true };
    return { pct: null, label: `↑ 新增 ${cur}`, flat: false };
  }
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct > 0) return { pct, label: `↑ ${pct}%`, flat: false };
  if (pct < 0) return { pct, label: `↓ ${Math.abs(pct)}%`, flat: true };
  return { pct: 0, label: '↑ 0%', flat: true };
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
