/**
 * store · Autoloop 事实日志持久化（复用既有 Repo，零新依赖）
 *
 * 事件溯源：每个用户一条只追加日志 `loop:{uid}:log`，另存一份投影缓存 `loop:{uid}:view`
 * 作为可丢弃的加速索引——任何时刻都能用 replay(facts) 从日志完整重建。
 * 参考系统用 SQLite WAL 同事务提交日志+投影；这里用文件/KV 驱动，语义等价：
 *   commit = 读日志 → decide 产事实 → append → evolve 投影 → 同一批写回。
 */
import {
  LOOP_KERNEL_VERSION, type Fact, type LoopInput, type LoopState, type LoopView,
} from '../../../shared/loop';
import { type Repo } from '../kv';
import { decide, emptyView, evolve, KERNEL_VERSION, replay, stateOf, whyOf } from './kernel';

const K = {
  log: (uid: string) => `loop:${uid}:log`,
  view: (uid: string) => `loop:${uid}:view`,
  meta: (uid: string) => `loop:${uid}:meta`,
};

interface StoredLog { facts: Fact[] }
interface StoredMeta { version: string; seeded: boolean }

/** 读取事实日志（不存在返回空） */
export async function readFacts(r: Repo, uid: string): Promise<Fact[]> {
  const log = await r.get<StoredLog>(K.log(uid));
  return Array.isArray(log?.facts) ? log!.facts : [];
}

/** 读取/重建投影：缓存版本不符或缺失、或与日志末尾不一致时，从日志全量重放 */
export async function readView(r: Repo, uid: string, knownFacts?: Fact[]): Promise<LoopView> {
  const meta = await r.get<StoredMeta>(K.meta(uid));
  const cached = await r.get<LoopView>(K.view(uid));
  const facts = knownFacts ?? await readFacts(r, uid);
  const lastSeq = facts.length ? facts[facts.length - 1].seq : 0;
  if (cached && meta?.version === KERNEL_VERSION && cached.seq === lastSeq) {
    return cached;
  }
  const view = replay(facts);
  await r.put(K.view(uid), view);
  await r.put(K.meta(uid), { version: KERNEL_VERSION, seeded: meta?.seeded ?? false } satisfies StoredMeta);
  return view;
}

/**
 * 核心提交：把一次输入产生的全部事实追加进日志，并同步推进投影。
 * 返回 { facts: 本次新增事实, view: 最新投影 }。
 * 幂等由内核保证（重复事件 / 重复回执不会重复改变状态）。
 */
export async function commit(r: Repo, uid: string, input: LoopInput, now: string): Promise<{ facts: Fact[]; view: LoopView }> {
  const facts = await readFacts(r, uid);
  const before = await readView(r, uid, facts);
  const produced = decide(before, input, now);
  if (produced.length === 0) return { facts: [], view: before };

  const all = [...facts, ...produced];
  let view = before;
  for (const f of produced) view = evolve(view, f);

  // 同一批写回：日志、投影、元信息。file/KV 驱动下顺序写，读己之写由强一致驱动保证。
  // ⚠️ seeded 只由 markSeeded() 在「种子全部播完」后显式置 true；普通提交保留原值。
  //    否则播种写第 1 条时 isSeeded() 就会误报完成，并发请求会绕过等待读到半成品投影。
  await r.put(K.log(uid), { facts: all } satisfies StoredLog);
  await r.put(K.view(uid), view);
  const meta = await r.get<StoredMeta>(K.meta(uid));
  await r.put(K.meta(uid), { version: KERNEL_VERSION, seeded: meta?.seeded ?? false } satisfies StoredMeta);

  return { facts: produced, view };
}

export async function loopState(r: Repo, uid: string, now: string): Promise<LoopState> {
  const view = await readView(r, uid);
  return stateOf(view, now);
}

export async function loopWhy(r: Repo, uid: string, runId: string): Promise<Fact[]> {
  const facts = await readFacts(r, uid);
  return whyOf(facts, runId);
}

export async function loopFacts(r: Repo, uid: string, after: number): Promise<Fact[]> {
  const facts = await readFacts(r, uid);
  return facts.filter((f) => f.seq > after);
}

export async function isSeeded(r: Repo, uid: string): Promise<boolean> {
  const meta = await r.get<StoredMeta>(K.meta(uid));
  return meta?.seeded === true;
}

/** 标记「种子已完整播完」——只由 seedCommit 在所有事实写完后调用一次 */
export async function markSeeded(r: Repo, uid: string): Promise<void> {
  await r.put(K.meta(uid), { version: KERNEL_VERSION, seeded: true } satisfies StoredMeta);
}

/** 写入一组初始配置事实（插件登记 + 规则）——只在首次播种时调用 */
export async function seedCommit(r: Repo, uid: string, inputs: LoopInput[], now: string): Promise<void> {
  for (const input of inputs) await commit(r, uid, input, now);
  // 全部事实写完后才置完成标记：中途崩溃时 isSeeded 仍为 false，下次访问会重新播种（可自愈）
  await markSeeded(r, uid);
}

export { KERNEL_VERSION, LOOP_KERNEL_VERSION };
