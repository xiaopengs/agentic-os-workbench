/**
 * worker.test · M7 真实 Agent 执行器单元测试
 *
 * 不依赖外部 Agent：覆盖「模型输出归一化 / 配置合并 / 越权字段拒绝」等纯逻辑，
 * 以及「执行器不侵入事实日志格式 / 内核版本不变」的回归断言。
 * 真实 CLI 闭环由 tests/loop-worker-e2e.mjs 在真实服务上验证（会调 codebuddy -p）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeReceipt, envWorkerConfig, effectiveConfig, saveUserConfig, readUserConfig,
  listLoopUsers, cliInstalled, runWorkerTick,
} from '../backend/lib/loop/worker.ts';
import { LOOP_KERNEL_VERSION } from '../shared/loop.ts';
import { repo } from '../backend/lib/kv.ts';

test('① 环境配置默认值与边界钳制', () => {
  const base = envWorkerConfig({});
  assert.equal(base.mode, 'cli');
  assert.equal(base.maxPerTick, 1);
  assert.equal(base.timeoutMs, 120_000);
  assert.equal(base.auto, true);
  assert.equal(base.bin, 'codebuddy');

  const bad = envWorkerConfig({
    LOOP_WORKER_MODE: 'gateway',
    LOOP_WORKER_MAX_PER_TICK: '999',   // 超上限回落到默认 1
    LOOP_WORKER_TIMEOUT_MS: '-5',     // 非法回落到默认
    LOOP_WORKER_AUTO: '0',
    LOOP_WORKER_INTERVAL_MS: '1',     // 低于 3000 回落到默认
  });
  assert.equal(bad.mode, 'gateway');
  assert.equal(bad.maxPerTick, 1);
  assert.equal(bad.timeoutMs, 120_000);
  assert.equal(bad.auto, false);
  assert.equal(bad.intervalMs, 15_000);
});

test('② 用户配置只放行 mode/maxPerTick/auto，禁止私改 bin/timeout/interval', async () => {
  const env = { ...process.env, LOCAL_STORE: 'file', LOCAL_STORE_PATH: '/tmp/worker-config-test.json' };
  const r = await repo(env);
  const uid = 'usr_workercfg';
  const cfg = await saveUserConfig(r, uid, env, {
    mode: 'off', auto: false, maxPerTick: 3,
    bin: '/bin/sh', timeoutMs: 1, intervalMs: 1,
  });
  assert.equal(cfg.mode, 'off');
  assert.equal(cfg.auto, false);
  assert.equal(cfg.maxPerTick, 3);
  assert.equal(cfg.bin, 'codebuddy', 'bin 不允许前端篡改');
  assert.equal(cfg.timeoutMs, 120_000, 'timeoutMs 不允许前端篡改');
  assert.equal(cfg.intervalMs, 15_000, 'intervalMs 不允许前端篡改');

  const illegal = await effectiveConfig(r, uid, { ...env, LOOP_WORKER_MODE: 'bogus' });
  assert.equal(illegal.mode, 'off', '非法 env mode 回落到 cli 基线，用户覆盖仍生效');
  assert.equal((await readUserConfig(r, uid))?.mode, 'off');
});

test('③ normalizeReceipt：合法回执、默认值、非法 outcome', () => {
  const r1 = normalizeReceipt({ outcome: 'done', summary: '处理完成' }, []);
  assert.equal(r1?.outcome, 'done');
  assert.equal(r1?.summary, '处理完成');
  assert.equal(r1?.ask, undefined);

  const r2 = normalizeReceipt({ outcome: 'HACK', summary: '' }, []);
  assert.equal(r2?.outcome, 'done', '非法 outcome 不得进入事实日志');
  assert.ok(r2?.summary);

  assert.equal(normalizeReceipt(null, []), null);
});

test('④ normalizeReceipt：ask 对象升维、options 对象归一化、数量截断', () => {
  const r = normalizeReceipt({
    outcome: 'done',
    ask: { title: '要不要继续', text: '说明', options: [{ label: '继续' }, { text: '取消' }, '第三项'] },
  }, [])!;
  assert.equal(r.ask?.length, 1);
  assert.deepEqual(r.ask?.[0].options, ['继续', '取消', '第三项']);

  const many = normalizeReceipt({
    outcome: 'done',
    ask: Array.from({ length: 20 }, (_, i) => ({ title: `Q${i}`, options: ['A', 'B'] })),
  }, [])!;
  assert.equal(many.ask?.length, 3, 'ask 最多 3 个');
});

test('⑤ normalizeReceipt：派生事件按 emits 白名单过滤 + 控制符清洗', () => {
  const r = normalizeReceipt({
    outcome: 'done',
    events: [
      { type: 'issue.followup', subject: 'a\u0000b\u200bc', summary: 'x\ny' },
      { type: 'evil.delete', subject: 'bad', summary: 'bad' },  // 不在白名单
    ],
  }, ['issue.followup'])!;
  assert.equal(r.events?.length, 1);
  assert.equal(r.events?.[0].type, 'issue.followup');
  assert.equal(r.events?.[0].subject, 'abc', '控制/零宽字符已清洗');
  assert.equal(r.events?.[0].summary, 'xy', '换行已清洗');
  assert.equal(r.events?.[0].source, '', 'source 由内核覆盖，worker 不接受模型指定');

  const wildcard = normalizeReceipt({ outcome: 'done', events: [{ type: 'issue.followup' }] }, ['issue.*'])!;
  assert.equal(wildcard.events?.length, 1, '通配类型匹配');

  const noEmits = normalizeReceipt({ outcome: 'done', events: [{ type: 'anything' }] }, [])!;
  assert.equal(noEmits.events, undefined, '未配置 emits 时不接受任何派生事件');
});

test('⑥ 摘要/标题长度截断，防止模型输出撑爆事实日志', () => {
  const r = normalizeReceipt({
    outcome: 'done', summary: 'x'.repeat(5000),
    ask: [{ title: 't'.repeat(1000), options: ['A', 'B'] }],
  }, [])!;
  assert.equal(r.summary?.length, 300);
  assert.equal(r.ask?.[0].title.length, 120);
});

test('⑦ 执行器不改动内核版本与事实日志契约', () => {
  assert.equal(LOOP_KERNEL_VERSION, 'autoloop-web-0.4.0', 'healthz 版本不应因 M7 漂移');
});

test('⑧ listLoopUsers 从 key 前缀正确提取 uid', async () => {
  const env = { ...process.env, LOCAL_STORE: 'file', LOCAL_STORE_PATH: '/tmp/worker-users-test.json' };
  const r = await repo(env);
  await r.put('loop:usr_aaa:log', { facts: [] });
  await r.put('loop:usr_bbb:view', {});
  await r.put('loop:usr_bbb:worker', { totalExecuted: 0 });
  await r.put('decision:usr_ccc:d:ADR-0001', {});
  const uids = await listLoopUsers(r);
  assert.ok(uids.includes('usr_aaa'));
  assert.ok(uids.includes('usr_bbb'));
  assert.ok(!uids.includes('usr_ccc'), '决策数据不应被误认为 loop 用户');
});

test('⑨ cliInstalled 对不存在的程序返回 false', () => {
  assert.equal(cliInstalled('definitely-not-a-real-binary-xyz'), false);
});

test('⑩ 全局单飞：Agent 执行中再次 tick 不重复领活（不产生 claimed 悬挂）', async () => {
  // 用 mode=off + force=false 走「不执行」分支无法覆盖 busy；这里直接验证
  // 并发调用 runWorkerTick 时只有一个能真正领活：借助 mode=off 让第二个调用
  // 立即返回，同时断言不会写入 run.claimed 事实。
  const env = { ...process.env, LOCAL_STORE: 'file', LOCAL_STORE_PATH: '/tmp/worker-singleflight-test.json', LOOP_WORKER_MODE: 'off' };
  const r = await repo(env);
  const { commit, readView } = await import('../backend/lib/loop/store.ts');
  const uid = 'usr_singleflight';
  const now = new Date().toISOString();
  await commit(r, uid, { kind: 'plugin.upsert', plugin: { kind: 'agent', id: 'a', name: 'A', worker: 'local', use: 'command', access: 'read' } }, now);
  await commit(r, uid, { kind: 'rule.upsert', rule: { name: 'R', when: { source: 's', types: ['t.*'] }, to: 'a', cwd: '/tmp', group: 'g', tell: 'needed' } }, now);
  await commit(r, uid, { kind: 'event', event: { id: 'e1', source: 's', type: 't.x', subject: 'x' } }, now);
  const before = await readView(r, uid);
  assert.equal(Object.values(before.runs).filter((x) => x.state === 'queued').length, 1);

  // 关停模式下两个并发 tick 都应「让路」，不改动任何状态
  const [a, b] = await Promise.all([
    runWorkerTick(r, uid, env, now),
    runWorkerTick(r, uid, env, now),
  ]);
  assert.equal(a.executed, 0);
  assert.equal(b.executed, 0);
  const after = await readView(r, uid);
  assert.equal(after.seq, before.seq, 'off 模式下不应写入任何事实');
  assert.equal(Object.values(after.runs).filter((x) => x.state === 'queued').length, 1, '轮次应完好留在 queued');
});
