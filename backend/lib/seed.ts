/**
 * seed · 新用户演示数据播种
 *
 * 原则：
 *  - 只在用户首次访问时执行一次（user.seeded 幂等标记）
 *  - 数据为固定字面量，真实写入持久化存储（KV/Blob），绝不每次随机生成
 *  - 播种内容：1 条示例工作流 + 5 条 Trace + 4 个技能 + 3 个合同 + 4 台设备 + 当月用量基线
 */
import type { Contract, Device, Skill, Trace, Workflow } from '../../shared/types';
import { k, type Repo, type UserRecord } from './kv';
import { monthKey, setUsage } from './quota';

/** 相对用户注册时间的固定偏移（毫秒），保证数据稳定可复现 */
const OFFSET = {
  workflow: 60_000,
  traceBase: 90_000,
  asset: 30_000,
};

function at(iso: string, offsetMs: number): string {
  const base = Date.parse(iso) || Date.now();
  return new Date(base + offsetMs).toISOString();
}

/* ── 固定演示数据 ───────────────────────────────────────────── */
const DEMO_WORKFLOW_ID = 'wf_demo_checkout_regression';

function demoWorkflow(createdAt: string): Workflow {
  return {
    id: DEMO_WORKFLOW_ID,
    name: '跨端结账回归',
    category: 'E2E',
    description: '覆盖 iOS / Android / Web 三端的下单支付主链路回归，含优惠券与库存校验。',
    devices: 4,
    steps: 12,
    coverage: 92,
    duration: 18,
    status: 'done',
    env: 'staging',
    createdAt,
    updatedAt: createdAt,
  };
}

const DEMO_TRACES: Array<Omit<Trace, 'id' | 'createdAt'>> = [
  { kind: 'Agent', name: 'orchestrator.plan', cost: 820, status: 'Success', time: '09:41:02' },
  { kind: 'Skill', name: 'navigator.goto_checkout', cost: 260, status: 'Success', time: '09:41:03' },
  { kind: 'Tool', name: 'screenshot.diff', cost: 340, status: 'Success', time: '09:41:04' },
  { kind: 'Contract', name: 'checkout.place_order', cost: 210, status: 'Failed', time: '09:41:05' },
  { kind: 'Skill', name: 'form.fill_address', cost: 120, status: 'Running', time: '09:41:06' },
];

const DEMO_SKILLS: Array<Omit<Skill, 'updatedAt'>> = [
  {
    id: 'skill_navigator',
    name: 'Smart Navigator',
    version: '1.4.0',
    category: 'Navigation',
    description: '语义化页面导航，自动等待关键元素稳定后再执行下一步。',
    status: 'active',
  },
  {
    id: 'skill_form_filler',
    name: 'Form Filler',
    version: '2.1.3',
    category: 'Input',
    description: '按合同字段约束自动填充表单，支持地址、支付与优惠券组合。',
    status: 'active',
  },
  {
    id: 'skill_visual_diff',
    name: 'Visual Diff',
    version: '0.9.2',
    category: 'Verification',
    description: '跨端截图diff，容忍动态区域，输出差异热力图。',
    status: 'draft',
  },
  {
    id: 'skill_report_writer',
    name: 'Report Writer',
    version: '1.0.7',
    category: 'Reporting',
    description: '汇总 Trace 生成结构化回归报告，支持 JUnit / HTML 导出。',
    status: 'deprecated',
  },
];

const DEMO_CONTRACTS: Array<Omit<Contract, 'updatedAt'>> = [
  {
    id: 'contract_checkout',
    name: 'Checkout Flow',
    version: 'v3',
    toolName: 'checkout.place_order',
    permissionLevel: 'write',
    status: 'active',
  },
  {
    id: 'contract_catalog',
    name: 'Product Search',
    version: 'v1',
    toolName: 'catalog.search',
    permissionLevel: 'read',
    status: 'active',
  },
  {
    id: 'contract_payment',
    name: 'Payment Capture',
    version: 'v2',
    toolName: 'payment.capture',
    permissionLevel: 'admin',
    status: 'draft',
  },
];

const DEMO_DEVICES: Device[] = [
  { id: 'device_iphone15', name: 'iPhone 15 Pro', model: 'A3101', os: 'iOS 17.4', status: 'online' },
  { id: 'device_pixel8', name: 'Pixel 8', model: 'G9BQD', os: 'Android 14', status: 'busy' },
  { id: 'device_mbp14', name: 'MacBook Pro 14"', model: 'M3 Pro', os: 'macOS 14.4', status: 'online' },
  { id: 'device_galaxy_s24', name: 'Galaxy S24', model: 'SM-S921B', os: 'Android 14', status: 'offline' },
];

/* ── 播种 ───────────────────────────────────────────────────── */
/**
 * 幂等播种。已播种用户直接返回，避免每个请求都写库。
 */
export async function ensureSeeded(r: Repo, user: UserRecord): Promise<void> {
  if (user.seeded) return;

  const uid = user.id;
  const createdAt = user.createdAt || new Date().toISOString();
  const assetAt = at(createdAt, OFFSET.asset);

  const wf = demoWorkflow(at(createdAt, OFFSET.workflow));
  await r.put(k.wf(uid, wf.id), wf);

  await Promise.all(
    DEMO_TRACES.map((trace, index) =>
      r.put(k.trace(uid, `trace_demo_${index + 1}`), {
        ...trace,
        id: `trace_demo_${index + 1}`,
        createdAt: at(createdAt, OFFSET.traceBase + index * 1_000),
      } satisfies Trace),
    ),
  );

  await Promise.all(
    DEMO_SKILLS.map((skill) => r.put(k.skill(uid, skill.id), { ...skill, updatedAt: assetAt })),
  );

  await Promise.all(
    DEMO_CONTRACTS.map((contract) =>
      r.put(k.contract(uid, contract.id), { ...contract, updatedAt: assetAt }),
    ),
  );

  await Promise.all(DEMO_DEVICES.map((device) => r.put(k.device(uid, device.id), device)));

  // 用量基线：与示例工作流的一次执行对齐（真实写入，可被后续配额累加）
  await setUsage(r, uid, { runs: 1, tokens: 4800, costCents: 36 }, monthKey());

  // 标记已播种，落库持久化
  await r.put(k.user(user.email), { ...user, seeded: true });
}
