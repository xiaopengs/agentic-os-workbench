'use client';

import { Icon, type IconName } from '@/components/icons/Icon';
import type { WorkbenchData } from '@/lib/hooks';

const ARROW = (
  <svg
    className="lc-arrow"
    width="34"
    height="14"
    viewBox="0 0 34 14"
    aria-hidden="true"
  >
    <path
      d="M1 7h27M24 2.5 29 7l-5 4.5"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeDasharray="4 3.5"
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);

interface NodeDef {
  key: string;
  name: string;
  desc: string;
  icon: IconName;
  tone: string;
}

const NODES: NodeDef[] = [
  { key: 'intent', name: 'Intent', desc: '用户需求 / 任务目标', icon: 'i-bulb', tone: 'c-g' },
  { key: 'contract', name: 'Contract', desc: '契约定义 / 规范校验', icon: 'i-doc', tone: 'c-g' },
  { key: 'skill', name: 'Skill', desc: '技能开发 / 单元测试', icon: 'i-cube', tone: 'c-p' },
  { key: 'agent', name: 'Agent', desc: '智能体编排 / 能力组合', icon: 'i-bot', tone: 'c-g' },
  { key: 'sim', name: 'Simulation', desc: '场景仿真 / 结果验证', icon: 'i-monitor', tone: 'c-b' },
  { key: 'release', name: 'Secure Release', desc: '安全扫描 / 灰度发布', icon: 'i-shield', tone: 'c-dg' },
];

/** Agent Lifecycle 六节点流水线 · 视觉 1:1，节点标签由真实数据推导 */
export function LifecycleCard({ data }: { data: WorkbenchData }) {
  const { contracts, skills, workflows, runningCount, canary } = data;

  const tagFor = (key: string): { cls: string; text: string; dot?: boolean } => {
    switch (key) {
      case 'intent':
        return workflows.length
          ? { cls: 'done', text: '已完成', dot: true }
          : { cls: 'tests', text: '待录入' };
      case 'contract':
        return contracts.length
          ? { cls: 'done', text: '已完成', dot: true }
          : { cls: 'tests', text: '待定义' };
      case 'skill':
        return { cls: 'mock', text: skills.length ? `${skills.length} 可用` : 'Mock Ready' };
      case 'agent':
        return { cls: 'tests', text: `${workflows.length} workflows` };
      case 'sim':
        return runningCount
          ? { cls: 'running', text: '进行中', dot: true }
          : { cls: 'tests', text: '空闲' };
      default:
        return { cls: 'canary', text: `Canary ${canary}%` };
    }
  };

  return (
    <div className="card lifecycle-card">
      <div className="card-head">
        <b>Agent Lifecycle</b>
        <span className="sub">从意图到发布全链路自动化</span>
      </div>
      <svg
        className="lc-deco"
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        viewBox="0 0 1000 220"
        aria-hidden="true"
      >
        <path d="M0 150 C 150 90, 260 190, 420 130 S 720 60, 1000 120" stroke="#bfe8d6" strokeWidth="1.6" fill="none" opacity=".7" />
        <path d="M0 190 C 200 130, 380 210, 560 150 S 840 90, 1000 150" stroke="#d9f0e4" strokeWidth="1.4" fill="none" opacity=".8" />
        <circle cx="120" cy="70" r="3.5" fill="#34d399" opacity=".5" />
        <circle cx="330" cy="46" r="2.6" fill="#8b5cf6" opacity=".45" />
        <circle cx="520" cy="72" r="3" fill="#3b82f6" opacity=".4" />
        <circle cx="700" cy="40" r="2.4" fill="#10b981" opacity=".5" />
        <circle cx="880" cy="66" r="3.2" fill="#34d399" opacity=".45" />
        <circle cx="240" cy="180" r="2.4" fill="#93c5fd" opacity=".5" />
        <circle cx="620" cy="188" r="2.8" fill="#6ee7b7" opacity=".55" />
        <circle cx="940" cy="180" r="2.4" fill="#c4b5fd" opacity=".5" />
      </svg>
      <div className="lc-flow">
        {NODES.map((n, i) => {
          const tag = tagFor(n.key);
          return (
            <div key={n.key} style={{ display: 'contents' }}>
              <div className="lc-node">
                <div className={`lc-ico ${n.tone}`}>
                  <Icon name={n.icon} />
                </div>
                <div className="lc-txt">
                  <div className="lc-name">{n.name}</div>
                  <div className="lc-desc">{n.desc}</div>
                  <span className={`lc-tag ${tag.cls}`}>
                    {tag.dot ? <i /> : null}
                    {tag.text}
                  </span>
                </div>
              </div>
              {i < NODES.length - 1 ? ARROW : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default LifecycleCard;