/**
 * 并发首访播种幂等 · 真实服务 e2e（权威竞态回归）
 *
 * 背景：总览首屏同时发 GET /loop/state 与 GET /loop/facts，两个请求并发进入
 * ensureLoopSeeded。修复前「检查 isSeeded → 写入」非原子，导致：
 *   ① 种子被写两遍（21 条事实而非 11 条）；
 *   ② 某请求读到对方播种到一半的投影（如 0 规则 / 6 插件）。
 * 内存 KV + 单线程微任务调度无法稳定复现，必须连真实 file 驱动服务做 HTTP 并发。
 *
 * 用法：node tests/loop-concurrency-e2e.mjs [baseURL]
 *   默认 http://127.0.0.1:3737（需先启动 server.mjs）
 */
const BASE = (process.argv[2] || 'http://127.0.0.1:3737').replace(/\/+$/, '');

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++; else failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function register(email) {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test123456' }),
  });
  const b = await r.json().catch(() => ({}));
  return b?.data?.token;
}
const H = (t) => ({ Authorization: `Bearer ${t}` });
async function getJSON(path, token) {
  const r = await fetch(`${BASE}/api${path}`, { headers: H(token) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

console.log('── 并发首访播种幂等 · 真实服务 e2e ──\n');

// 多轮、每轮一个全新账号，制造真实并发首访
for (let i = 1; i <= 6; i++) {
  const token = await register(`conc_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}@test.local`);
  if (!token) { check(`第 ${i} 轮注册`, false); continue; }

  // 关键：多个只读请求真正并发（Promise.all），复现总览首屏并发首访。
  // 三个 state 请求同时发出，任何一个读到「播种中途的半成品投影」都会被抓到。
  const [s1, s2, factsRes, s3] = await Promise.all([
    getJSON('/loop/state', token),
    getJSON('/loop/state', token),
    getJSON('/loop/facts', token),
    getJSON('/loop/state', token),
  ]);
  const finalState = await getJSON('/loop/state', token);

  const firstStates = [s1, s2, s3];
  const rulesFirst = firstStates.map((r) => r.body?.data?.totals?.rules);
  const seqFirst = firstStates.map((r) => r.body?.data?.seq);
  const rulesFinal = finalState.body?.data?.totals?.rules;
  const factsLen = factsRes.body?.data?.length ?? -1;
  const seq = finalState.body?.data?.seq;

  check(`第 ${i} 轮：4 个并发只读请求均 200`,
    [...firstStates, factsRes].every((r) => r.status === 200));
  check(`第 ${i} 轮：每个首次 state 响应即含完整 4 规则（不读半成品）`,
    rulesFirst.every((n) => n === 4), `首次 rules=${JSON.stringify(rulesFirst)}`);
  check(`第 ${i} 轮：每个首次 state 响应 seq=11（无中间态）`,
    seqFirst.every((n) => n === 11), `首次 seq=${JSON.stringify(seqFirst)}`);
  check(`第 ${i} 轮：事实日志恰好 11 条（种子只写一遍）`, factsLen === 11,
    `facts=${factsLen} seq=${seq}`);
  check(`第 ${i} 轮：最终状态仍 4 条规则`, rulesFinal === 4, `最终 rules=${rulesFinal}`);
}

console.log(`\n========================================================`);
console.log(`结果：${passed} 通过 / ${failed} 失败`);
console.log(`========================================================`);
if (failed > 0) process.exitCode = 1;
