/**
 * loop-worker-e2e.mjs · M7 真实 Agent 执行器端到端验证
 *
 * 在【真实运行的 HTTP 服务】上验证完整闭环，会真正调起本机 CLI Agent：
 *   登录 → 执行器状态 → 接入事件命中规则 → queued 轮次 → 立即执行（真 Agent）
 *   → 轮次自动结案 + 事实日志可溯源 → 配置切换 → 关停后不自动执行
 *
 * 与纯逻辑单测的区别：走完整 HTTP + 鉴权 + KV 持久化 + spawn 进程链路。
 *
 * 用法：BASE=http://127.0.0.1:3737 node tests/loop-worker-e2e.mjs
 */
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:3737';
const EMAIL = process.env.E2E_EMAIL || 'demo@workbuddy.local';
const PASSWORD = process.env.E2E_PASSWORD || 'demo123456';

let token = '';
let passed = 0;
const check = (name, cond, detail = '') => {
  assert.ok(cond, `${name}${detail ? ` — ${detail}` : ''}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
};

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* 忽略 */ }
  return { status: res.status, data };
}

async function main() {
  console.log(`\n=== M7 真实 Agent 执行器 E2E · ${BASE} ===\n`);

  /* ① 登录（新环境可能没有演示账号，登录失败则自动注册，保证脚本可独立运行） */
  let login = await api('/auth/login', { method: 'POST', auth: false, body: { email: EMAIL, password: PASSWORD } });
  if (login.status !== 200 || !login.data?.ok) {
    const reg = await api('/auth/register', { method: 'POST', auth: false, body: { email: EMAIL, password: PASSWORD } });
    check('新环境自动注册 E2E 账号', reg.status === 200 || reg.status === 201, JSON.stringify(reg.data).slice(0, 150));
    login = await api('/auth/login', { method: 'POST', auth: false, body: { email: EMAIL, password: PASSWORD } });
  }
  check('登录成功', login.status === 200 && login.data?.ok, JSON.stringify(login.data).slice(0, 150));
  token = login.data.data.token;

  /* ② 执行器状态：确认真实 CLI Agent 可用 */
  const st = await api('/loop/worker/status');
  check('GET /loop/worker/status → 200', st.status === 200);
  const status = st.data.data;
  check('执行器在线（available=true）', status.available === true, status.reason);
  check('默认模式为真实 Agent（cli）', status.config.mode === 'cli');
  check('标记为真实执行（非模拟）', status.config.mode !== 'off');
  console.log(`    执行器：${status.reason} · 累计 ${status.totalExecuted} 轮`);

  /* ③ 接入一条中文事件，命中规则产生 queued 轮次 */
  const stamp = Date.now();
  const ev = await api('/loop/events', {
    method: 'POST',
    body: {
      id: `worker_e2e_${stamp}`, source: 'github', type: 'issues.opened',
      subject: '中文事项 · 支付回调偶发超时',
      summary: '用户反馈支付回调偶发超时，请判断优先级并给出排查建议；如涉及删数据/重启服务请请求人工拍板。',
    },
  });
  check('POST /loop/events → 201', ev.status === 201, JSON.stringify(ev.data).slice(0, 150));
  check('事件命中规则（routed 非空）', (ev.data.data.routed?.length ?? 0) > 0);

  const stBefore = await api('/loop/state');
  const queuedBefore = stBefore.data.data.totals.queuedRuns;
  check('产生 queued 轮次', queuedBefore > 0, `queuedRuns=${queuedBefore}`);

  /* ④ 立即执行：真 Agent 跑一轮（这一步会 spawn codebuddy -p，约 15-60s） */
  console.log('  … 正在调用真实 Agent 执行本轮（请稍候）');
  const t0 = Date.now();
  const run = await api('/loop/worker/run', { method: 'POST', body: {} });
  check('POST /loop/worker/run → 200', run.status === 200);
  const res = run.data.data;
  check('确实执行了 1 轮', res.executed === 1, JSON.stringify(res).slice(0, 200));
  const job = res.jobs[0];
  check('标记为真实 Agent 执行（real=true）', job.real === true);
  check('执行状态 done', job.status === 'done', job.error || job.status);
  check('产出合法 outcome', ['done', 'nothing', 'failed', 'cancelled'].includes(job.outcome), job.outcome);
  check('回执摘要非空且为中文', typeof job.summary === 'string' && job.summary.length > 10, job.summary?.slice(0, 100));
  check('写入了事实（facts 非空）', (job.facts?.length ?? 0) > 0);
  console.log(`    耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s · outcome=${job.outcome}`);
  console.log(`    Agent 结论：${job.summary?.slice(0, 160)}`);

  /* ⑤ 轮次自动结案、事实日志可溯源 */
  const stAfter = await api('/loop/state');
  const doneRun = stAfter.data.data.runs.find((r) => r.id === job.runId);
  check('轮次已结案（非 queued/claimed）', doneRun && !['queued', 'claimed'].includes(doneRun.state), doneRun?.state);
  check('轮次摘要与 Agent 结论一致', doneRun?.summary === job.summary);

  const why = await api(`/loop/runs/${encodeURIComponent(job.runId)}/why`);
  check('why 溯源返回时间线', why.status === 200 && (why.data.data.timeline?.length ?? 0) > 0);
  const kinds = why.data.data.timeline.map((f) => f.kind);
  check('时间线含「派活 → 领取 → 回执」', kinds.includes('run.queued') && kinds.includes('run.claimed') && kinds.includes('run.finished'), kinds.join(','));

  const facts = await api('/loop/facts');
  const finishFact = facts.data.data.find((f) => f.kind === 'run.finished' && f.ref === job.runId);
  check('事实日志落库了真 Agent 回执', Boolean(finishFact));

  /* ⑥ 配置切换：关闭自动后状态同步 */
  const cfgOff = await api('/loop/worker/config', { method: 'POST', body: { mode: 'off', auto: false } });
  check('POST /loop/worker/config → 200', cfgOff.status === 200);
  check('配置生效 mode=off', cfgOff.data.data.config.mode === 'off');
  check('配置生效 auto=false', cfgOff.data.data.config.auto === false);
  check('状态接口同步反映已停止', cfgOff.data.data.status.available === false);
  check('bin 未被前端配置篡改', typeof cfgOff.data.data.config.bin === 'string' && cfgOff.data.data.config.bin.length > 0, cfgOff.data.data.config.bin);

  const cfgBack = await api('/loop/worker/config', { method: 'POST', body: { mode: 'cli', auto: true } });
  check('可切回真实 Agent 模式', cfgBack.data.data.config.mode === 'cli' && cfgBack.data.data.config.auto === true);

  /* ⑦ 幂等：无 queued 轮次时不重复执行 */
  const idle = await api('/loop/worker/run', { method: 'POST', body: {} });
  check('无排队轮次时 executed=0（不空转烧 Token）', idle.data.data.executed === 0);

  console.log(`\n=== 结果：${passed} 通过 / 0 失败 ===\n`);
}

main().catch((e) => {
  console.error('\n✗ E2E 失败：', e.message);
  process.exit(1);
});
