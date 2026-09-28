'use client';

/**
 * Simulation Lab 表现层
 *
 * 说明：05 文档契约中没有「仿真遥测 / 灰度进度」端点，因此：
 *   · 五阶段进度、Next Step、Canary 比例 —— 全部由真实 API 数据推导（contracts/skills/traces/workflows）
 *   · Memory / NPU / Power 三项端侧遥测 —— 无后端来源，保留本地动画基线（与原型一致）
 *   · P95 —— 由真实 Trace 耗时计算（见 lib/format.ts p95）
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { clamp } from './format';

export interface Stage {
  name: string;
  done: number;
  total: number;
  wait?: boolean;
}

export type StepState = 'done' | 'doing' | 'wait';

export interface NextStep {
  name: string;
  st: StepState;
}

/** 五阶段进度：全部来自真实资源统计 */
export function buildStages(input: {
  contracts: number;
  skills: number;
  traces: { total: number; ok: number };
  workflows: { total: number; done: number; running: number };
}): Stage[] {
  const { contracts, skills, traces, workflows } = input;
  return [
    { name: '编译构建', done: contracts, total: contracts },
    { name: '单元测试', done: skills, total: skills },
    { name: '性能测试', done: traces.ok, total: traces.total },
    { name: '场景回归', done: workflows.done, total: workflows.total },
    {
      name: '结果分析',
      done: workflows.total > 0 && workflows.running === 0 ? 1 : 0,
      total: 1,
      wait: !(workflows.total > 0 && workflows.running === 0),
    },
  ];
}

/** 整体完成度 0~1 */
export function stageRatio(stages: Stage[]): number {
  let done = 0;
  let total = 0;
  for (const s of stages) {
    total += s.total;
    done += Math.min(s.done, s.total);
  }
  return total === 0 ? 0 : clamp(done / total, 0, 1);
}

/** 当前所处阶段文案（原型 simStateText 等价实现） */
export function stageText(stages: Stage[]): string {
  const label: Record<string, string> = {
    编译构建: '编译构建',
    单元测试: '单元测试',
    性能测试: '性能测试',
    场景回归: '场景回归测试',
    结果分析: '结果分析',
  };
  for (const s of stages) {
    if (!s.wait && s.done < s.total) return `运行中：${label[s.name] || s.name}`;
  }
  if (stages[4]?.wait) return '运行中：场景回归测试';
  return '本轮仿真全部通过 · 灰度观察中';
}

/** Next Step：由真实进度推导（原型为写死四步） */
export function buildNextStep(stages: Stage[], ratio: number): NextStep[] {
  const running = stages.some((s) => !s.wait && s.done < s.total);
  const allDone = ratio >= 1;
  return [
    { name: 'Mock 联调', st: stages[0].total > 0 ? 'done' : 'wait' },
    { name: '场景回归', st: running ? 'doing' : stages[3].total > 0 ? 'done' : 'wait' },
    { name: '安全扫描', st: allDone ? 'doing' : running ? 'wait' : 'wait' },
    { name: '灰度发布', st: allDone ? 'doing' : 'wait' },
  ];
}

/** Canary 灰度比例：由整体完成度推导（10% → 25%） */
export function buildCanary(ratio: number): number {
  if (ratio <= 0) return 10;
  if (ratio >= 1) return 25;
  return Math.max(10, Math.round(ratio * 25));
}

export interface SimTelemetry {
  memory: number;
  npu: number;
  power: number;
}

export interface SimulationApi {
  /** 仿真计时（秒） */
  sec: number;
  /** 手机屏显时钟（秒） */
  phoneSec: number;
  running: boolean;
  metrics: SimTelemetry;
  /** 相对上一次采样的变化百分比（遥测无后端来源，仅反映本地采样差） */
  trends: SimTelemetry;
  toggle: () => void;
  replay: () => void;
}

/** 本地时钟 + 端侧遥测动画（仅在无后端遥测端点时承载 Memory/NPU/Power） */
export function useSimulation(): SimulationApi {
  const [sec, setSec] = useState(756); // 00:12:36
  const [phoneSec, setPhoneSec] = useState(37440); // 10:24
  const [running, setRunning] = useState(true);
  const BASE: SimTelemetry = { memory: 1.8, npu: 72, power: 1.2 };
  const [metrics, setMetrics] = useState<SimTelemetry>(BASE);
  const [trends, setTrends] = useState<SimTelemetry>({ memory: 0, npu: 0, power: 0 });
  const metricsRef = useRef<SimTelemetry>(BASE);
  const runningRef = useRef(running);
  runningRef.current = running;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPhoneSec((s) => (s + 1) % 86400);
      // 暂停时仿真计时停走（与原型一致：state.sim.running 为 false 不累加）
      setSec((s) => (runningRef.current ? s + 1 : s));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const m = metricsRef.current;
      const next: SimTelemetry = {
        memory: clamp(+(m.memory + (Math.random() - 0.5) * 0.12).toFixed(2), 1.2, 2.4),
        npu: clamp(Math.round(m.npu + (Math.random() - 0.5) * 6), 48, 92),
        power: clamp(+(m.power + (Math.random() - 0.5) * 0.1).toFixed(2), 0.8, 1.9),
      };
      const delta = (a: number, b: number) => (a === 0 ? 0 : Math.round(((b - a) / a) * 100));
      setTrends({
        memory: delta(m.memory, next.memory),
        npu: delta(m.npu, next.npu),
        power: delta(m.power, next.power),
      });
      metricsRef.current = next;
      setMetrics(next);
    }, 2500);
    return () => window.clearInterval(timer);
  }, []);

  const toggle = useCallback(() => setRunning((r) => !r), []);
  const replay = useCallback(() => setSec(0), []);

  return { sec, phoneSec, running, metrics, trends, toggle, replay };
}

export default useSimulation;
