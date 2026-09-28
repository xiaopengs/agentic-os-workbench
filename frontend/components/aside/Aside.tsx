'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import { CopilotModal, COP_TITLE, type CopilotKind } from '@/components/modals/CopilotModal';
import { useWorkbench } from '@/lib/hooks';
import { relTime } from '@/lib/format';
import type { AuditLog } from '@/lib/types';
import type { NextStep } from '@/lib/simulation';
import { emitToast } from '@/lib/toast-bus';

/* ───────── AI Copilot ───────── */
const COP_BUTTONS: { kind: CopilotKind; icon: IconName; label: string; cls: string }[] = [
  { kind: 'skill', icon: 'i-cube', label: '生成 Skill', cls: 'p' },
  { kind: 'contract', icon: 'i-doc', label: '生成 Contract', cls: 'g' },
  { kind: 'regression', icon: 'i-play', label: '运行回归', cls: 'b' },
  { kind: 'trace', icon: 'i-wave', label: '分析 Trace', cls: 'c' },
];

function CopilotCard({ onPick }: { onPick: (kind: CopilotKind) => void }) {
  return (
    <div className="card copilot-card">
      <div className="cop-head">
        <span className="bot-avatar">
          <Icon name="i-bot" />
        </span>
        <b>AI Copilot</b>
        <span className="online-pill">
          <i />
          Online
        </span>
        <button
          className="mini-more"
          aria-label="更多"
          title="更多"
          onClick={() => emitToast('AI Copilot 由服务端 Agent（/api/ai/copilot）提供')}
        >
          <Icon name="i-dots" />
        </button>
      </div>
      <div className="cop-grid">
        {COP_BUTTONS.map((b) => (
          <button key={b.kind} className={`cop-btn ${b.cls}`} onClick={() => onPick(b.kind)}>
            <Icon name={b.icon} />
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ───────── Attention ───────── */
function toneOf(action: string): { tone: string; icon: IconName } {
  if (/失败|错误|异常|拒绝|超时/.test(action)) return { tone: 'r', icon: 'i-warn' };
  if (/通过|完成|成功|就绪/.test(action)) return { tone: 'g', icon: 'i-check' };
  return { tone: 'a', icon: 'i-sun' };
}

function AttentionCard({ items }: { items: AuditLog[] }) {
  const rows = items.slice(0, 3);
  return (
    <div className="card">
      <div className="mini-head">
        <Icon name="i-bell" />
        <b>Attention</b>
        <span className="count-pill">{rows.length}</span>
      </div>
      <div>
        {rows.length ? (
          rows.map((a) => {
            const { tone, icon } = toneOf(a.action);
            return (
              <Link className="attn-item" href="/settings" key={a.id}>
                <span className={`attn-ico ${tone}`}>
                  <Icon name={icon} />
                </span>
                <span className="attn-txt">
                  <span className="attn-title">{a.action}</span>
                  <span className="attn-time">{relTime(a.at)}</span>
                </span>
                <span className="chev">
                  <Icon name="i-chev-r" />
                </span>
              </Link>
            );
          })
        ) : (
          <div className="empty-tip">暂无待处理事项</div>
        )}
      </div>
    </div>
  );
}

/* ───────── Next Step ───────── */
function NextStepCard({ steps }: { steps: NextStep[] }) {
  return (
    <div className="card">
      <div className="mini-head">
        <Icon name="i-bolt" style={{ color: 'var(--amber)' }} />
        <b>Next Step</b>
        <span className="count-pill">{steps.length}</span>
      </div>
      <div className="steps">
        {steps.map((s, i) => (
          <div className={`step ${s.st}`} key={s.name}>
            <span className={`step-ico ${s.st}`}>
              {s.st === 'done' ? (
                <Icon name="i-check" size={13} />
              ) : s.st === 'doing' ? (
                ''
              ) : (
                String(i + 1)
              )}
            </span>
            <span className="step-name">{s.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────── Trusted Release ───────── */
function TrustedReleaseCard({ canary, securePassed, compatChecked }: { canary: number; securePassed: boolean; compatChecked: boolean }) {
  const C = 219.9;
  const off = C * (1 - canary / 100);
  return (
    <div className="card">
      <div className="mini-head">
        <Icon name="i-shield" style={{ color: 'var(--green-deep)' }} />
        <b>Trusted Release</b>
        <span className="q-mark">?</span>
        <button
          className="mini-more"
          aria-label="更多"
          title="更多"
          onClick={() => emitToast('发布流水线：静态扫描 → 动态沙箱 → Contract 校验 → 灰度')}
        >
          <Icon name="i-dots" />
        </button>
      </div>
      <div className="rel-body">
        <div className="rel-left">
          <div className="rel-name-row">
            <b>Skill v2.4.1</b>
            <span className="ver-pill">版本发布</span>
          </div>
          <div className={`rel-check${securePassed ? '' : ' muted'}`}>
            <Icon name={securePassed ? 'i-check' : 'i-refresh'} />
            安全扫描 {securePassed ? '通过' : '进行中'}
          </div>
          <div className={`rel-check${compatChecked ? '' : ' muted'}`}>
            <Icon name={compatChecked ? 'i-check' : 'i-refresh'} />
            兼容性检查 {compatChecked ? '通过' : '待校验'}
          </div>
          <div className="rel-check muted">
            <Icon name="i-refresh" />
            灰度发布 进行中 ({canary}%)
          </div>
        </div>
        <div className="rel-ring">
          <svg viewBox="0 0 84 84" aria-hidden="true">
            <circle cx="42" cy="42" r="35" fill="none" stroke="#eef2f0" strokeWidth="9" />
            <circle
              cx="42"
              cy="42"
              r="35"
              fill="none"
              stroke="#10b981"
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={off.toFixed(1)}
              transform="rotate(-90 42 42)"
            />
          </svg>
          <div className="rr-num">{canary}%</div>
          <div className="rr-cap">Canary</div>
        </div>
      </div>
      <button
        className="rel-btn"
        onClick={() => emitToast(`Skill v2.4.1 · Canary ${canary}% · 安全扫描${securePassed ? '通过' : '进行中'}`)}
      >
        查看发布详情
        <Icon name="i-arrow-r" size={14} />
      </button>
    </div>
  );
}

/* ───────── Aside 组合 ───────── */
export function Aside() {
  const data = useWorkbench();
  const [kind, setKind] = useState<CopilotKind | null>(null);

  return (
    <>
      <aside className="aside">
        <CopilotCard onPick={setKind} />
        <AttentionCard items={data.audit} />
        <NextStepCard steps={data.nextStep} />
        <TrustedReleaseCard
          canary={data.canary}
          securePassed={data.ratio >= 1}
          compatChecked={data.contracts.length > 0}
        />
      </aside>
      <CopilotModal open={kind !== null} kind={kind ?? 'skill'} onClose={() => setKind(null)} />
    </>
  );
}

export default Aside;
