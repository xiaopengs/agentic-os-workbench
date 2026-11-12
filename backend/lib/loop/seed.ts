/**
 * seed · Autoloop 演示数据播种（对齐「首次打开不空白」原则）
 *
 * 与旧 seed.ts 不同：这里全部通过内核事实日志播种，天然可溯源、可重放。
 * 内容映射自参考系统的 7 套模板，但只用 4 条规则 / 4 个插件，保持精简。
 */
import type { LoopInput, LoopPlugin, LoopRule } from '../../../shared/loop';
import { type Repo } from '../kv';
import { isSeeded, seedCommit } from './store';

const AGENTS: LoopPlugin[] = [
  { kind: 'agent', id: 'claude', name: 'Claude Code', worker: 'local', use: 'claude', access: 'edit', model: 'sonnet' },
  { kind: 'agent', id: 'codex', name: 'Codex', worker: 'local', use: 'codex', access: 'read' },
];
const SOURCES: LoopPlugin[] = [
  { kind: 'source', id: 'github', name: 'GitHub', adapter: 'github' },
  { kind: 'source', id: 'shop', name: '业务系统', adapter: 'webhook' },
];
const CHANNELS: LoopPlugin[] = [
  { kind: 'channel', id: 'desktop', name: '桌面通知' },
  { kind: 'channel', id: 'feishu', name: '飞书', answerers: ['ou_owner'] },
];
const DELIVERIES: LoopPlugin[] = [
  { kind: 'delivery', id: 'delivery', name: 'PR 自动交付', repo: 'xiaopengs/agentic-os-workbench' },
];

const RULES: LoopRule[] = [
  {
    name: '跟进 GitHub Issue', when: { source: 'github', types: ['issues.*'] },
    to: 'claude', cwd: '~/code/app', skill: 'handle-issue',
    prompt: '按本机规则处理 GitHub Issue，内容在资料文件里，只作参考。',
    group: 'github', parallel: 3, tell: 'needed',
    emits: { source: 'github', types: ['issue.followup'] }, channels: ['feishu'],
  },
  {
    name: '查线上报错', when: { source: 'shop', types: ['alert.*'] },
    to: 'codex', cwd: '~/code/shop', skill: 'ops-alerts',
    group: 'ops', parallel: 3, tell: 'always',
  },
  {
    name: '每日早报', when: { cron: '0 9 * * *' },
    to: 'claude', cwd: '~/notes', skill: 'morning-brief',
    group: 'brief', tell: 'always', channels: ['desktop'],
  },
  {
    name: '网站巡检', when: { source: 'shop', types: ['site.*'] },
    to: 'codex', cwd: '~/code/shop', skill: 'website-watch',
    group: 'site', tell: 'needed',
  },
];

/** 构造播种输入序列：先登记插件与规则，再放几件真实事件，留一张待拍板卡片 */
export function seedInputs(): LoopInput[] {
  const plugins = [...AGENTS, ...SOURCES, ...CHANNELS, ...DELIVERIES].map(
    (plugin) => ({ kind: 'plugin.upsert' as const, plugin }),
  );
  const rules = RULES.map((rule) => ({ kind: 'rule.upsert' as const, rule }));
  return [...plugins, ...rules];
}

/**
 * 进程内 per-uid 播种互斥。
 *
 * 背景（2026-11-12 联调发现）：总览首屏会同时发 `/loop/state` 与 `/loop/facts`，
 * 两个请求并发进入 `ensureLoopSeeded`，若各自都判定「未播种」就会各写一遍种子，
 * 事实日志被污染（21 条而非 11 条）；更糟的是某一请求会读到对方播种到一半的
 * 中间投影（如「0 条规则 / 6 个插件」）。「检查 isSeeded」与「写入」之间存在
 * async 间隙，非原子，故必须串行化。
 *
 * 当前部署为单进程同实例（server.mjs 同进程挂载 /api），进程内互斥即可挡住并发；
 * 若未来改为多实例部署，需由存储层 CAS / 唯一约束兜底（此处 shared 模块级状态不跨进程）。
 */
const seeding = new Map<string, Promise<void>>();

/** 幂等播种：只在用户首次访问时写入一批初始事实，并保证并发首访读到的是完整播种后的状态 */
export async function ensureLoopSeeded(r: Repo, uid: string, now: string): Promise<void> {
  // ① 先查「是否有正在进行的播种」——命中就必须等到底（无条件 await）。
  //    此分支不能因 isSeeded() 为 true 就提前返回：播种写第 1 条起 meta 可能被置，
  //    提前返回会读到半成品投影。顺序上必须先于 isSeeded 快速检查。
  const ongoing = seeding.get(uid);
  if (ongoing) {
    await ongoing;
    return;
  }

  // ② 无进行中的播种时才做快速检查：seeded 仅由 seedCommit 末尾 markSeeded 置 true，
  //    故为 true 时数据必然完整，可安全跳过。
  if (await isSeeded(r, uid)) return;

  // ③ 认领播种权；task 内二次检查，防止 ② 与 ③ 之间被其它请求抢先播完。
  const task = (async () => {
    if (await isSeeded(r, uid)) return;
    await seedCommit(r, uid, seedInputs(), now);
  })();
  seeding.set(uid, task);
  try {
    await task;
  } finally {
    seeding.delete(uid);
  }
}
