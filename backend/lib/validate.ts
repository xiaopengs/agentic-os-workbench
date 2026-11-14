/**
 * validate · 输入校验（失败统一抛 400 VALIDATION_ERROR）
 */
import { badRequest } from './resp';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: unknown): value is string {
  return typeof value === 'string' && EMAIL_RE.test(value.trim()) && value.trim().length <= 254;
}

export function assertEmail(value: unknown): string {
  if (!isEmail(value)) throw badRequest('邮箱格式不正确');
  return String(value).trim().toLowerCase();
}

export function assertPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8) throw badRequest('密码至少 8 位');
  if (value.length > 200) throw badRequest('密码长度超出限制');
  return value;
}

export function assertString(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`${field} 不能为空`);
  const text = value.trim();
  if (text.length > maxLength) throw badRequest(`${field} 长度不能超过 ${maxLength} 字符`);
  return text;
}

export function optionalString(value: unknown, field: string, maxLength = 2000): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw badRequest(`${field} 必须是字符串`);
  if (value.length > maxLength) throw badRequest(`${field} 长度不能超过 ${maxLength} 字符`);
  return value;
}

export function assertNumber(
  value: unknown,
  field: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number {
  // 只接受 number 或非空白字符串：JSON body 里的 null / 布尔 / 数组 / 对象
  // 会被 Number() 静默转成 0 / 1 / NaN，属于类型混淆，必须显式拒绝而不是放行。
  // 保留字符串→数字是为了兼容 query 参数与表单输入。
  let num: number;
  if (typeof value === 'number') num = value;
  else if (typeof value === 'string' && value.trim() !== '') num = Number(value);
  else throw badRequest(`${field} 必须是数字`);
  if (!Number.isFinite(num)) throw badRequest(`${field} 必须是数字`);
  if (options.integer && !Number.isInteger(num)) throw badRequest(`${field} 必须是整数`);
  if (options.min !== undefined && num < options.min) throw badRequest(`${field} 不能小于 ${options.min}`);
  if (options.max !== undefined && num > options.max) throw badRequest(`${field} 不能大于 ${options.max}`);
  return num;
}

export function optionalNumber(
  value: unknown,
  field: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return assertNumber(value, field, options);
}

export function assertEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw badRequest(`${field} 取值非法，可选值：${allowed.join(' / ')}`);
  }
  return value as T;
}

export function optionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return assertEnum(value, allowed, field);
}
