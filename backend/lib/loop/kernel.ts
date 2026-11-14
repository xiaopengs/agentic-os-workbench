/**
 * kernel · Agent Autoloop 确定性内核（纯函数，零外部依赖）
 *
 * 架构红线（对齐参考系统 kernel/ 与 docs/09 §2.4）：
 *  - 本模块只依赖 shared/loop.ts，不 import 任何后端/框架/存储代码；
 *  - 不读系统时钟、不用随机数、不向外发请求、不写死具体产品名；
 *    now / 随机材料 / 网络 / 定时器全部由外壳注入；
 *  - decide(view, input, now) → Fact[] 为纯函数：不改 view、不改 input、同样输入同样输出；
 *  - evolve(view, facts) 是唯一的投影写入者；状态永远由事实日志重放得出。
 *
 * 四大机制落点：
 *  ① 挂起零消耗  : ask 回执只产 open 卡片，不产 Run；answer 才续跑（见 case 'run.result' / 'card.answer'）
 *  ② 事件溯源    : 只追加 Fact[]，replay() 可从空视图重建；run.result 幂等重交不重复计费
 *  ③ 指令数据分离: validateEvent() 拒收指令字段 / 校验 subject·link 字符（纯函数）
 *  ④ 跳数熔断    : hops > MAX_HOPS 只产 hop.blocked + 熔断卡片，不派活（见 emitEvent）
 */
import {
  CARD_KINDS, CARD_STATES, EVENT_TYPE_RE, FORBIDDEN_EVENT_FIELDS, LIMITS,
  LINK_RE, LOOP_KERNEL_VERSION, MAX_ATTEMPTS, MAX_HOPS, RECEIPT_OUTCOMES, SUBJECT_RE,
  type AccessMode, type CardKind, type CardState, type Fact, type LoopCard, type LoopEvent,
  type LoopInput, type LoopReceipt, type LoopRule, type LoopRun, type LoopState, type LoopTotals,
  type LoopView, type ReceiptAsk, type ReceiptNotice, type RuleWhen, type FactKind,
} from '../../../shared/loop';

/* ══════════════════════════════════════════════════════════════
 * 校验（指令数据分离）
 * ══════════════════════════════════════════════════════════════ */

/** 返回问题列表；空数组表示通过。纯函数，不抛异常（由外壳转成 400）。 */
export function validateEvent(raw: Record<string, unknown>): string[] {
  const issues: string[] = [];

  // 指令字段一律拒收：事件只能携带资料，派给谁/在哪干/什么权限只由规则决定
  for (const field of FORBIDDEN_EVENT_FIELDS) {
    if (field in (raw ?? {})) issues.push(`事件不允许携带指令字段 ${field}（指令数据分离）`);
  }

  const id = raw?.id;
  const type = raw?.type;
  if (typeof id !== 'string' || !id.trim()) issues.push('事件缺少 id');
  else if (id.length > LIMITS.id) issues.push(`id 超过 ${LIMITS.id} 字符`);

  if (typeof type !== 'string' || !EVENT_TYPE_RE.test(type)) {
    issues.push(`type 不合法（需匹配 ${EVENT_TYPE_RE.source}）`);
  } else if (type.length > LIMITS.type) {
    issues.push(`type 超过 ${LIMITS.type} 字符`);
  }

  if (raw?.subject !== undefined) {
    if (typeof raw.subject !== 'string') {
      issues.push('subject 必须是文字');
    } else if (raw.subject.trim() !== '') {
      // 允许中文/空格/标点等可见文字，只挡控制字符与不可见格式符（注入载体）
      if (!SUBJECT_RE.test(raw.subject)) {
        issues.push('subject 不能包含控制字符或不可见格式符（如换行、零宽字符）');
      } else if (raw.subject.length > LIMITS.subject) {
        issues.push(`subject 超过 ${LIMITS.subject} 字符`);
      }
    }
    // 纯空白视为未提供：清空输入框不应报错
  }
  if (raw?.link !== undefined) {
    if (typeof raw.link !== 'string' || !/^https?:\/\//i.test(raw.link) || !LINK_RE.test(raw.link)) {
      issues.push('link 必须是纯 ASCII 的 http(s) 网址');
    } else if (raw.link.length > LIMITS.link) {
      issues.push(`link 超过 ${LIMITS.link} 字符`);
    }
  }
  if (raw?.summary !== undefined && (typeof raw.summary !== 'string' || raw.summary.length > LIMITS.summary)) {
    issues.push(`summary 超过 ${LIMITS.summary} 字符或类型错误`);
  }
  if (raw?.detail !== undefined && (typeof raw.detail !== 'string' || raw.detail.length > LIMITS.detail)) {
    issues.push(`detail 超过 ${LIMITS.detail} 字符或类型错误`);
  }
  return issues;
}

/** 校验规则草稿：返回问题列表，空数组表示通过。 */
export function validateRule(raw: Record<string, unknown>, registeredAgents: string[]): string[] {
  const issues: string[] = [];
  if (typeof raw?.name !== 'string' || !raw.name.trim()) issues.push('规则缺少 name');
  if (typeof raw?.to !== 'string' || !raw.to.trim()) issues.push('规则缺少 to');
  else if (!registeredAgents.includes(raw.to)) issues.push(`to 不是已登记的 Agent：${raw.to}`);
  if (typeof raw?.cwd !== 'string' || !raw.cwd.trim()) issues.push('规则缺少 cwd');

  const when = raw?.when;
  if (!when || typeof when !== 'object') {
    issues.push('规则缺少 when');
  } else if ('cron' in (when as object)) {
    const cron = (when as { cron?: unknown }).cron;
    if (typeof cron !== 'string' || cron.trim().split(/\s+/).length !== 5) issues.push('cron 需为 5 段表达式');
  } else {
    const w = when as { source?: unknown; types?: unknown };
    if (typeof w.source !== 'string' || !w.source) issues.push('when 缺少 source');
    if (!Array.isArray(w.types) || w.types.length === 0 || w.types.some((t) => typeof t !== 'string' || !EVENT_TYPE_RE.test(t))) {
      issues.push('when.types 需为合法事件类型数组');
    }
  }
  if (raw?.tell !== undefined && !['always', 'needed', 'never'].includes(raw.tell as string)) {
    issues.push('tell 只能是 always / needed / never');
  }
  if (raw?.access !== undefined && !['read', 'edit', 'full'].includes(raw.access as string)) {
    issues.push('access 只能是 read / edit / full');
  }
  return issues;
}

/** 事件类型匹配：支持 `*` 与 `x.*`（对齐 kernel/rules.ts typeMatch） */
export function typeMatches(patterns: string[], type: string): boolean {
  return patterns.some((p) => p === '*' || p === type || (p.endsWith('.*') && type.startsWith(p.slice(0, -1))));
}

/** 规则是否监听外部事件（而非 cron） */
function isEventWhen(when: RuleWhen): when is { source: string; types: string[] } {
  return 'source' in when;
}

/* ══════════════════════════════════════════════════════════════
 * 视图：空视图 / evolve（唯一投影写入者）/ replay
 * ══════════════════════════════════════════════════════════════ */

export function emptyView(timezone = 'Asia/Shanghai'): LoopView {
  return {
    seq: 0, rulesVersion: 0, timezone,
    rules: {},
    plugins: { agents: {}, sources: {}, channels: {}, deliveries: {} },
    dedupe: {}, events: [], runs: {}, cards: {}, lanes: {}, timers: [], pauses: {},
    disabledPlugins: {},
    usage: { runs: 0, tokens: 0, costCents: 0 },
    receipts: {}, cronFired: {},
  };
}

/** 浅层深拷贝视图（evolve 绝不修改传入视图） */
function cloneView(v: LoopView): LoopView {
  return {
    ...v,
    rules: { ...v.rules },
    plugins: {
      agents: { ...v.plugins.agents }, sources: { ...v.plugins.sources },
      channels: { ...v.plugins.channels }, deliveries: { ...v.plugins.deliveries },
    },
    dedupe: { ...v.dedupe },
    events: v.events.map((e) => ({ ...e })),
    runs: Object.fromEntries(Object.entries(v.runs).map(([k, r]) => [k, { ...r, eventSeqs: [...r.eventSeqs] }])),
    cards: Object.fromEntries(Object.entries(v.cards).map(([k, c]) => [k, { ...c, options: [...c.options] }])),
    lanes: Object.fromEntries(Object.entries(v.lanes).map(([k, l]) => [k, { ...l }])),
    timers: v.timers.map((t) => ({ ...t })),
    pauses: { ...v.pauses },
    disabledPlugins: { ...v.disabledPlugins },
    usage: { ...v.usage },
    receipts: { ...v.receipts },
    cronFired: { ...v.cronFired },
  };
}

/** 单事实投影。纯函数：不修改入参，返回新视图。 */
export function evolve(view: LoopView, fact: Fact): LoopView {
  const v = cloneView(view);
  v.seq = Math.max(v.seq, fact.seq);

  switch (fact.kind) {
    case 'event.accepted': {
      const f = fact as Extract<Fact, { kind: 'event.accepted' }>;
      if (!f.duplicate) {
        const key = `${f.event.source}\u0000${f.event.id}`;
        if (!(key in v.dedupe)) v.dedupe[key] = f.seq;
        v.events.push({ seq: f.seq, event: { ...f.event }, routed: [...f.routed], duplicate: false });
      } else {
        v.events.push({ seq: f.seq, event: { ...f.event }, routed: [], duplicate: true });
      }
      // 同事项合并：把事件 seq 追加进已有活跃轮次
      if (f.mergedInto && v.runs[f.mergedInto]) {
        const run = v.runs[f.mergedInto];
        if (!run.eventSeqs.includes(f.seq)) run.eventSeqs.push(f.seq);
      }
      break;
    }
    case 'hop.blocked': {
      const f = fact as Extract<Fact, { kind: 'hop.blocked' }>;
      v.events.push({ seq: f.seq, event: { ...f.event }, routed: [], duplicate: false });
      break;
    }
    case 'rule.upserted': {
      const f = fact as Extract<Fact, { kind: 'rule.upserted' }>;
      v.rules[f.rule.name] = { ...f.rule };
      v.rulesVersion = Math.max(v.rulesVersion, f.version);
      break;
    }
    case 'plugin.upserted': {
      const f = fact as Extract<Fact, { kind: 'plugin.upserted' }>;
      const p = f.plugin;
      if (p.kind === 'agent') v.plugins.agents[p.id] = { ...p };
      else if (p.kind === 'source') v.plugins.sources[p.id] = { ...p };
      else if (p.kind === 'channel') v.plugins.channels[p.id] = { ...p };
      else if (p.kind === 'delivery') v.plugins.deliveries[p.id] = { ...p };
      break;
    }
    case 'plugin.disabled': {
      const f = fact as Extract<Fact, { kind: 'plugin.disabled' }>;
      v.disabledPlugins[f.id] = { since: f.at, reason: f.reason };
      break;
    }
    case 'plugin.enabled': {
      const f = fact as Extract<Fact, { kind: 'plugin.enabled' }>;
      delete v.disabledPlugins[f.id];
      break;
    }
    case 'cron.fired': {
      const f = fact as Extract<Fact, { kind: 'cron.fired' }>;
      v.cronFired[f.name] = f.day;
      break;
    }
    case 'rules.reloaded': {
      const f = fact as Extract<Fact, { kind: 'rules.reloaded' }>;
      v.rulesVersion = f.version;
      break;
    }
    case 'rule.paused': {
      const f = fact as Extract<Fact, { kind: 'rule.paused' }>;
      if (v.rules[f.name]) v.rules[f.name] = { ...v.rules[f.name], paused: true };
      v.pauses[f.name] = { since: f.at, reason: f.reason };
      break;
    }
    case 'rule.resumed': {
      const f = fact as Extract<Fact, { kind: 'rule.resumed' }>;
      if (v.rules[f.name]) v.rules[f.name] = { ...v.rules[f.name], paused: false };
      delete v.pauses[f.name];
      break;
    }
    case 'run.queued': {
      const f = fact as Extract<Fact, { kind: 'run.queued' }>;
      v.runs[f.run.id] = { ...f.run, eventSeqs: [...f.run.eventSeqs] };
      // 事项（lane）也由事实重建，保证重放后 lanes 不丢
      const [group, subject] = f.run.lane.split('\u0000');
      const existingLane = v.lanes[f.run.lane];
      if (existingLane) {
        existingLane.hops = Math.max(existingLane.hops, f.run.hops);
      } else {
        v.lanes[f.run.lane] = {
          key: f.run.lane, rule: f.run.rule, subject: subject ?? group ?? '', hops: f.run.hops,
        };
      }
      break;
    }
    case 'run.claimed': {
      const f = fact as Extract<Fact, { kind: 'run.claimed' }>;
      if (v.runs[f.id] && v.runs[f.id].state === 'queued') {
        v.runs[f.id] = { ...v.runs[f.id], state: 'claimed', startedAt: f.at };
      }
      break;
    }
    case 'manual.run': {
      // 手动运行标记，无需改状态（run.queued 已随之产生）
      break;
    }
    case 'run.finished': {
      const f = fact as Extract<Fact, { kind: 'run.finished' }>;
      if (f.duplicate) break; // 幂等重交：不改状态、不重复计费
      const run = v.runs[f.id];
      if (!run) break;
      const r = f.receipt;
      v.receipts[f.id] = JSON.stringify(r);

      let nextState: LoopRun['state'];
      if (r.outcome === 'failed') {
        const attempts = run.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          nextState = 'cancelled';
          v.runs[f.id] = { ...run, state: nextState, attempts, error: r.error, finishedAt: f.at, summary: r.summary };
        } else {
          // 失败回 queued 等重试
          nextState = 'queued';
          v.runs[f.id] = {
            ...run, state: nextState, attempts, error: r.error, finishedAt: undefined,
            summary: r.summary, session: r.session ?? run.session,
          };
        }
        break;
      }
      nextState = r.outcome === 'cancelled' ? 'cancelled' : r.outcome === 'nothing' ? 'nothing' : 'done';
      v.runs[f.id] = {
        ...run, state: nextState, summary: r.summary, error: r.error,
        session: r.session ?? run.session, usage: r.usage ?? run.usage, finishedAt: f.at,
      };
      // 累计用量（只在此处、且非 duplicate，保证重放不重复计）
      const u = r.usage ?? {};
      v.usage.runs += 1;
      v.usage.tokens += (u.input ?? 0) + (u.output ?? 0) + (u.cached ?? 0);
      v.usage.costCents += Math.round((u.cost ?? 0) * 100);
      break;
    }
    case 'run.cancelled': {
      const f = fact as Extract<Fact, { kind: 'run.cancelled' }>;
      if (v.runs[f.id]) v.runs[f.id] = { ...v.runs[f.id], state: 'cancelled', finishedAt: f.at };
      break;
    }
    case 'card.created': {
      const f = fact as Extract<Fact, { kind: 'card.created' }>;
      v.cards[f.card.id] = { ...f.card, options: [...f.card.options] };
      break;
    }
    case 'card.answered': {
      const f = fact as Extract<Fact, { kind: 'card.answered' }>;
      const card = v.cards[f.id];
      if (card && card.state === 'open') {
        v.cards[f.id] = {
          ...card, state: 'decided', version: card.version + 1,
          choice: f.choice,
          answer: f.text ?? (f.choice !== undefined ? card.options[f.choice] : undefined),
          by: f.by,
        };
      }
      break;
    }
    case 'card.closed': {
      const f = fact as Extract<Fact, { kind: 'card.closed' }>;
      const card = v.cards[f.id];
      if (card) v.cards[f.id] = { ...card, state: 'closed', version: card.version + 1, result: f.reason };
      break;
    }
    case 'timer.scheduled': {
      const f = fact as Extract<Fact, { kind: 'timer.scheduled' }>;
      const idx = v.timers.findIndex((t) => t.key === f.key);
      const timer = { key: f.key, lane: f.lane ?? '', rule: f.rule ?? '', at: f.dueAt ?? '', about: f.about, fired: false };
      if (idx >= 0) v.timers[idx] = timer; else v.timers.push(timer);
      break;
    }
    case 'timer.fired': {
      const f = fact as Extract<Fact, { kind: 'timer.fired' }>;
      const idx = v.timers.findIndex((t) => t.key === f.key);
      if (idx >= 0) v.timers[idx] = { ...v.timers[idx], fired: true };
      break;
    }
    case 'timer.cancelled': {
      const f = fact as Extract<Fact, { kind: 'timer.cancelled' }>;
      v.timers = v.timers.filter((t) => t.key !== f.key);
      break;
    }
    default:
      break;
  }
  return v;
}

/** 从空视图重放整条事实日志（事件溯源重建）。纯函数。 */
export function replay(facts: Fact[], timezone = 'Asia/Shanghai'): LoopView {
  let v = emptyView(timezone);
  for (const f of facts) v = evolve(v, f);
  return v;
}

/* ══════════════════════════════════════════════════════════════
 * decide · 纯函数：view + input + now → Fact[]
 * ══════════════════════════════════════════════════════════════ */

interface DecideCtx {
  view: LoopView;
  now: string;
  seq: number;
  facts: Fact[];
}
function mk(ctx: DecideCtx, kind: FactKind, payload: Record<string, unknown>, ref?: string): Fact {
  ctx.seq += 1;
  const fact = { seq: ctx.seq, at: ctx.now, kind, ref, ...payload } as unknown as Fact;
  ctx.facts.push(fact);
  return fact;
}

function laneKey(view: LoopView, rule: LoopRule, subject: string): string {
  // 未写 parallel 时整条规则（group）是一个事项
  return `${rule.group}\u0000${rule.parallel ? subject : ''}`;
}

function activeRunFor(view: LoopView, lane: string, rule: string): LoopRun | undefined {
  return Object.values(view.runs).find(
    (r) => r.lane === lane && r.rule === rule && ['queued', 'claimed', 'unknown'].includes(r.state),
  );
}

/** 四类插件是否含某 id */
function hasPlugin(view: LoopView, id: string): boolean {
  const p = view.plugins;
  return !!(p.agents[id] || p.sources[id] || p.channels[id] || p.deliveries[id]);
}

/**
 * 匹配一条事件应派给哪些规则（跳过暂停/停用规则）。
 * M4：规则指向的 Agent 或事件来源 Source 被停用时不再派活；
 *     `when.source` 对应已登记且被停用的 Source 插件时同样跳过。
 */
export function matchRules(view: LoopView, event: LoopEvent): LoopRule[] {
  const disabled = view.disabledPlugins ?? {};
  if (disabled[event.source] && view.plugins.sources[event.source]) return [];
  return Object.values(view.rules).filter((rule) => {
    if (rule.enabled === false || rule.paused || view.pauses[rule.name]) return false;
    if (disabled[rule.to] && view.plugins.agents[rule.to]) return false;
    if (!isEventWhen(rule.when)) return false;
    return rule.when.source === event.source && typeMatches(rule.when.types, event.type);
  });
}

/**
 * 派一条事件：去重 → 熔断 → 规则匹配 → 派活/合并。
 * 供 decide 内部（含回执派生事件）复用，hops 由调用方给定。
 */
function emitEvent(ctx: DecideCtx, event: LoopEvent, hops: number): void {
  const ev: LoopEvent = { ...event, hops, receivedAt: ctx.now };
  const key = `${ev.source}\u0000${ev.id}`;

  // ② 事件去重：同 source+id 只记一次
  if (key in ctx.view.dedupe) {
    mk(ctx, 'event.accepted', { event: ev, duplicate: true, routed: [] });
    return;
  }

  // ④ 跳数熔断：超过 8 层只记录、不派活，并发一张熔断卡片
  if (hops > MAX_HOPS) {
    mk(ctx, 'hop.blocked', { event: ev, hops });
    createCard(ctx, {
      kind: 'fyi', state: 'closed', title: '跳数熔断',
      text: `事件 ${ev.type}（${ev.source}/${ev.id}）跳数 ${hops} 超过 ${MAX_HOPS}，已停止派活止损。`,
      options: [], lane: '', key: `hop-${ev.id}`,
    });
    return;
  }

  const matched = matchRules(ctx.view, ev);
  const routed = matched.map((r) => r.name);

  // 为每个命中规则派一轮；同事项已有活跃轮次则合并（不新建进程）
  const toCreate: Array<{ rule: LoopRule; lane: string }> = [];
  let mergedInto: string | undefined;
  for (const rule of matched) {
    const lane = laneKey(ctx.view, rule, ev.subject ?? '');
    const existing = activeRunFor(ctx.view, lane, rule.name);
    if (existing) { mergedInto = existing.id; continue; }
    if (!ctx.view.lanes[lane]) {
      ctx.view.lanes[lane] = { key: lane, rule: rule.name, subject: ev.subject ?? '', hops };
    }
    toCreate.push({ rule, lane });
  }

  // 先落 event.accepted 拿到 seq，再把该 seq 直接写进本批新建轮次的 eventSeqs
  const accepted = mk(ctx, 'event.accepted', { event: ev, duplicate: false, routed, mergedInto });
  const aSeq = accepted.seq;

  for (const { rule, lane } of toCreate) {
    const fact = mk(ctx, 'run.queued', {
      run: {
        id: '', seq: 0, rule: rule.name, agent: rule.to, lane, state: 'queued', attempts: 0,
        eventSeqs: [aSeq], rulesVersion: ctx.view.rulesVersion, hops,
      } satisfies LoopRun,
    }, rule.name);
    const run = (fact as Extract<Fact, { kind: 'run.queued' }>).run;
    run.id = `run_${fact.seq}`;
    run.seq = fact.seq;
    (fact as Fact & { ref?: string }).ref = run.id;
  }
}

function makeCard(ctx: DecideCtx, spec: {
  kind: CardKind; state: CardState; title: string; text: string; options: string[];
  recommend?: number; lane: string; about?: string; key?: string; run?: string;
  channel?: string;
}): LoopCard {
  // M4：回执指定 channel 时，把该通道当前的 answerers 名单快照进卡片（重放确定）；
  //      未指定或通道无名单 → answerers 为空，沿用 M1「登录本人即可回答」。
  const answerers = spec.channel
    ? ctx.view.plugins.channels[spec.channel]?.answerers
    : undefined;
  return {
    id: `card_placeholder`, version: 1, kind: spec.kind, state: spec.state,
    title: spec.title, text: spec.text, options: spec.options, recommend: spec.recommend,
    lane: spec.lane, about: spec.about, key: spec.key, run: spec.run, createdAt: ctx.now,
    channel: spec.channel, answerers: answerers ? [...answerers] : undefined,
  };
}

/** 创建卡片并回填由 seq 派生的 id */
function createCard(ctx: DecideCtx, spec: Parameters<typeof makeCard>[1]): void {
  const fact = mk(ctx, 'card.created', { card: makeCard(ctx, spec) });
  const card = (fact as Extract<Fact, { kind: 'card.created' }>).card;
  card.id = `card_${fact.seq}`;
  (fact as Fact & { ref?: string }).ref = spec.run ?? card.id;
}

/** 处理回执的动作（ask/notice/resolve/later/events）——在一个 decide 批次里一次生效 */
function applyReceiptActions(ctx: DecideCtx, run: LoopRun, receipt: LoopReceipt): void {
  const rule = ctx.view.rules[run.rule];

  for (const a of receipt.ask ?? []) {
    // ① 挂起零消耗：只建 open 卡片，绝不派新 Run
    createCard(ctx, {
      kind: 'ask', state: 'open', title: a.title, text: a.text ?? '', options: a.options,
      recommend: a.recommend, lane: run.lane, about: a.about, key: a.key, run: run.id,
      channel: a.channel,
    });
  }
  for (const n of receipt.notice ?? []) {
    createCard(ctx, {
      kind: n.fyi ? 'fyi' : 'notice', state: n.fyi ? 'closed' : 'open',
      title: n.title, text: n.text ?? '', options: [], lane: run.lane, key: n.key, run: run.id,
    });
  }
  for (const r of receipt.resolve ?? []) {
    if (ctx.view.cards[r.card]) mk(ctx, 'card.closed', { id: r.card, reason: r.reason }, r.card);
  }
  for (const l of receipt.later ?? []) {
    if (l.cancel) mk(ctx, 'timer.cancelled', { key: l.key }, run.id);
    else {
      mk(ctx, 'timer.scheduled', {
        key: l.key, dueAt: l.at ?? ctx.now, about: l.about, lane: run.lane, rule: run.rule,
      }, run.id);
    }
  }
  // 回执派生事件：hops 继承 +1，可能触发 A→B 链，直到熔断
  for (const e of receipt.events ?? []) {
    const source = rule?.emits?.source ?? e.source ?? run.rule;
    const allowed = !rule?.emits || typeMatches(rule.emits.types, e.type);
    if (!allowed) continue; // emits 约束：规则没许可的事件不派
    emitEvent(ctx, { ...e, source, id: e.id || `derived_${ctx.seq}_${e.type}` }, run.hops + 1);
  }
}

/** 主决策函数（纯函数，不改 view/input）。 */
export function decide(view: LoopView, input: LoopInput, now: string): Fact[] {
  // 用视图的浅拷贝作为「本批次的活跃状态」，避免污染传入视图
  const ctx: DecideCtx = {
    view: cloneView(view), now, seq: view.seq, facts: [],
  };

  switch (input.kind) {
    case 'event':
      emitEvent(ctx, input.event, input.event.hops ?? 0);
      break;

    case 'plugin.upsert':
      mk(ctx, 'plugin.upserted', { plugin: input.plugin }, input.plugin.id);
      break;

    case 'plugin.disable':
      if (hasPlugin(ctx.view, input.id) && !ctx.view.disabledPlugins[input.id]) {
        mk(ctx, 'plugin.disabled', { id: input.id, reason: input.reason }, input.id);
      }
      break;
    case 'plugin.enable':
      if (ctx.view.disabledPlugins[input.id]) {
        mk(ctx, 'plugin.enabled', { id: input.id }, input.id);
      }
      break;

    case 'rule.upsert': {
      const rule: LoopRule = {
        ...input.rule, group: input.rule.group || input.rule.name,
        tell: input.rule.tell ?? 'needed', enabled: input.rule.enabled ?? true,
      };
      mk(ctx, 'rule.upserted', { rule, version: ctx.view.rulesVersion + 1 }, rule.name);
      break;
    }
    case 'rule.pause':
      if (ctx.view.rules[input.name]) mk(ctx, 'rule.paused', { name: input.name, reason: input.reason }, input.name);
      break;
    case 'rule.resume':
      if (ctx.view.rules[input.name]) mk(ctx, 'rule.resumed', { name: input.name }, input.name);
      break;
    case 'rule.run': {
      const rule = ctx.view.rules[input.name];
      if (rule && !ctx.view.pauses[rule.name] && rule.enabled !== false) {
        const lane = laneKey(ctx.view, rule, input.subject ?? '');
        mk(ctx, 'manual.run', { id: input.name }, input.name);
        const fact = mk(ctx, 'run.queued', {
          run: {
            id: '', seq: 0, rule: rule.name, agent: rule.to, lane, state: 'queued', attempts: 0,
            eventSeqs: [], rulesVersion: ctx.view.rulesVersion, hops: 0,
          } satisfies LoopRun,
        }, rule.name);
        const run = (fact as Extract<Fact, { kind: 'run.queued' }>).run;
        run.id = `run_${fact.seq}`;
        run.seq = fact.seq;
      }
      break;
    }
    case 'run.claim': {
      const run = ctx.view.runs[input.id];
      if (run && run.state === 'queued') mk(ctx, 'run.claimed', { id: input.id }, input.id);
      break;
    }
    case 'run.result': {
      const run = ctx.view.runs[input.id];
      if (!run) break;
      const fingerprint = JSON.stringify(input.receipt);
      // 失败重试中的轮次（failed 回执会把 state 退回 queued 等下次重交）仍允许提交新回执：
      // 若此时沿用旧指纹做幂等拦截，任何不同内容的重试回执都会被判 409，轮次永久卡在 claimed。
      // 只有「已终态」的轮次才启用幂等去重。
      const retrying = run.state === 'queued' || run.state === 'claimed';
      if (ctx.view.receipts[input.id] !== undefined && !retrying) {
        // 幂等重交：内容相同只确认一次，不同则冲突（外壳据此返回 409）
        if (ctx.view.receipts[input.id] === fingerprint) {
          mk(ctx, 'run.finished', { id: input.id, receipt: input.receipt, duplicate: true }, input.id);
        }
        break;
      }
      mk(ctx, 'run.finished', { id: input.id, receipt: input.receipt }, input.id);
      // failed 只允许 notice，其余动作不生效
      if (input.receipt.outcome === 'failed') {
        for (const n of input.receipt.notice ?? []) {
          createCard(ctx, {
            kind: n.fyi ? 'fyi' : 'notice', state: n.fyi ? 'closed' : 'open',
            title: n.title, text: n.text ?? '', options: [], lane: run.lane, key: n.key, run: run.id,
          });
        }
        break;
      }
      applyReceiptActions(ctx, run, input.receipt);
      break;
    }
    case 'card.answer': {
      const card = ctx.view.cards[input.id];
      if (!card || card.state !== 'open' || card.kind !== 'ask') break;
      // M4 通道级应答身份校验：卡片快照了白名单时，by 必须在名单内，否则拒绝（不产任何事实）。
      // 名单为空（未指定 channel 或通道未配 answerers）沿用 M1「登录本人即可回答」。
      if (card.answerers?.length && !card.answerers.includes(input.by)) break;
      mk(ctx, 'card.answered', { id: input.id, choice: input.choice, text: input.text, by: input.by }, input.id);
      // 回答是一条新事件：接上原来的事项续跑（挂起零消耗 → 现在才启动）
      const rule = ctx.view.rules[card.lane.split('\u0000')[0]] ?? undefined;
      const ruleName = card.run ? ctx.view.runs[card.run]?.rule : rule?.name;
      const relatedRun = card.run ? ctx.view.runs[card.run] : undefined;
      const answerEvent: LoopEvent = {
        id: `answer_${input.id}`, source: '__answer__', type: 'card.answered',
        subject: card.key ?? card.id, summary: input.text ?? String(input.choice ?? ''),
        hops: (relatedRun?.hops ?? 0) + 1,
      };
      // 直接为原规则续一轮（会话接续），不重新匹配全部规则
      const targetRule = ruleName ? ctx.view.rules[ruleName] : undefined;
      if (targetRule) {
        const lane = relatedRun?.lane ?? card.lane;
        const fact = mk(ctx, 'event.accepted', {
          event: { ...answerEvent, receivedAt: now }, duplicate: false, routed: [ruleName],
        }, relatedRun?.id);
        const a = fact as Extract<Fact, { kind: 'event.accepted' }>;
        const rf = mk(ctx, 'run.queued', {
          run: {
            id: '', seq: 0, rule: ruleName, agent: targetRule.to, lane, state: 'queued', attempts: 0,
            eventSeqs: [a.seq], session: relatedRun?.session, rulesVersion: ctx.view.rulesVersion,
            hops: (relatedRun?.hops ?? 0) + 1,
          } satisfies LoopRun,
        }, ruleName);
        const run = (rf as Extract<Fact, { kind: 'run.queued' }>).run;
        run.id = `run_${rf.seq}`;
        run.seq = rf.seq;
        (rf as Fact & { ref?: string }).ref = run.id;
      }
      break;
    }
    case 'card.resolve': {
      const card = ctx.view.cards[input.id];
      if (card && card.state !== 'closed' && card.state !== 'done') {
        mk(ctx, 'card.closed', { id: input.id, reason: input.reason }, input.id);
      }
      break;
    }
    case 'tick': {
      // 到期复查：触发 timer 并续一轮
      for (const timer of ctx.view.timers) {
        if (timer.fired || !timer.at || timer.at > now) continue;
        mk(ctx, 'timer.fired', { key: timer.key }, timer.rule);
        const rule = ctx.view.rules[timer.rule];
        if (rule && !ctx.view.pauses[rule.name]) {
          const fact = mk(ctx, 'event.accepted', {
            event: {
              id: `review_${timer.key}_${now.slice(0, 10)}`, source: '__timer__', type: 'review.due',
              subject: timer.key, hops: 1, receivedAt: now,
            } as LoopEvent,
            duplicate: false, routed: [rule.name],
          });
          const a = fact as Extract<Fact, { kind: 'event.accepted' }>;
          const rf = mk(ctx, 'run.queued', {
            run: {
              id: '', seq: 0, rule: rule.name, agent: rule.to, lane: timer.lane, state: 'queued',
              attempts: 0, eventSeqs: [a.seq], rulesVersion: ctx.view.rulesVersion, hops: 1,
            } satisfies LoopRun,
          });
          const run = (rf as Extract<Fact, { kind: 'run.queued' }>).run;
          run.id = `run_${rf.seq}`;
          run.seq = rf.seq;
        }
      }
      // cron 规则：每个 UTC 日期最多触发一次（简化版，内核不读时钟、以 now 派生）
      const day = now.slice(0, 10);
      for (const rule of Object.values(ctx.view.rules)) {
        if (rule.paused || ctx.view.pauses[rule.name] || rule.enabled === false) continue;
        if (isEventWhen(rule.when)) continue;
        if (ctx.view.cronFired[rule.name] === day) continue;
        // 触发标记必须落成事实，否则重放无法还原 cronFired
        mk(ctx, 'cron.fired', { name: rule.name, day }, rule.name);
        const lane = laneKey(ctx.view, rule, '');
        const fact = mk(ctx, 'event.accepted', {
          event: {
            id: `cron_${rule.name}_${day}`, source: '__schedule__', type: 'schedule.due',
            subject: rule.name, hops: 0, receivedAt: now,
          } as LoopEvent,
          duplicate: false, routed: [rule.name],
        });
        const a = fact as Extract<Fact, { kind: 'event.accepted' }>;
        const rf = mk(ctx, 'run.queued', {
          run: {
            id: '', seq: 0, rule: rule.name, agent: rule.to, lane, state: 'queued',
            attempts: 0, eventSeqs: [a.seq], rulesVersion: ctx.view.rulesVersion, hops: 0,
          } satisfies LoopRun,
        });
        const run = (rf as Extract<Fact, { kind: 'run.queued' }>).run;
        run.id = `run_${rf.seq}`;
        run.seq = rf.seq;
      }
      break;
    }
    default:
      break;
  }

  return ctx.facts;
}

/* ══════════════════════════════════════════════════════════════
 * 查询：state / why / events of run
 * ══════════════════════════════════════════════════════════════ */

function sortedRuns(v: LoopView): LoopRun[] {
  return Object.values(v.runs).sort((a, b) => b.seq - a.seq);
}
function sortedCards(v: LoopView): LoopCard[] {
  return Object.values(v.cards).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.id.localeCompare(a.id));
}

export function stateOf(view: LoopView, now: string): LoopState {
  const rules = Object.values(view.rules);
  const cards = sortedCards(view);
  const events = view.events;
  const totals: LoopTotals = {
    rules: rules.length,
    activeRules: rules.filter((r) => r.enabled !== false && !r.paused && !view.pauses[r.name]).length,
    openCards: cards.filter((c) => c.state === 'open').length,
    runs: Object.keys(view.runs).length,
    queuedRuns: Object.values(view.runs).filter((r) => r.state === 'queued').length,
    events: events.length,
    agents: Object.keys(view.plugins.agents).length,
    sources: Object.keys(view.plugins.sources).length,
    channels: Object.keys(view.plugins.channels).length,
    deliveries: Object.keys(view.plugins.deliveries).length,
    facts: view.seq,
    hopsBlocked: events.filter((e) => e.routed.length === 0 && !e.duplicate && e.event.hops !== undefined && e.event.hops > MAX_HOPS).length,
  };
  return {
    seq: view.seq, rulesVersion: view.rulesVersion, timezone: view.timezone, now,
    totals,
    rules, agents: Object.values(view.plugins.agents), sources: Object.values(view.plugins.sources),
    channels: Object.values(view.plugins.channels), deliveries: Object.values(view.plugins.deliveries),
    events, runs: sortedRuns(view), cards,
    timers: view.timers, pauses: view.pauses,
    disabledPlugins: { ...(view.disabledPlugins ?? {}) }, usage: { ...view.usage },
  };
}

/** why <轮次>：返回与该轮相关的全部事实（事件/规则版本/领取/回执/卡片回答/接续轮次） */
export function whyOf(facts: Fact[], runId: string): Fact[] {
  const runFact = facts.find((f) => f.kind === 'run.queued' && (f as Extract<Fact, { kind: 'run.queued' }>).run.id === runId) as
    | Extract<Fact, { kind: 'run.queued' }> | undefined;
  if (!runFact) return [];
  const eventSeqs = new Set(runFact.run.eventSeqs);
  return facts.filter((f) => {
    if (f.ref === runId) return true;
    if (f.kind === 'event.accepted' && eventSeqs.has(f.seq)) return true;
    if (f.kind === 'card.created' && (f as Extract<Fact, { kind: 'card.created' }>).card.run === runId) return true;
    if (f.kind === 'card.answered' && facts.some((c) => c.kind === 'card.created' && (c as any).card?.id === (f as any).id && (c as any).card?.run === runId)) return true;
    return false;
  });
}

export const KERNEL_VERSION = LOOP_KERNEL_VERSION;
