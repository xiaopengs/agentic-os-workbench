'use client';

import { Icon } from '@/components/icons/Icon';
import { fmtHMS, fmtMS } from '@/lib/format';
import { stageText, type Stage, type SimTelemetry } from '@/lib/simulation';
import type { SimulationApi } from '@/lib/simulation';

function ringSvg(ratio: number, wait = false) {
  const C = 63.3;
  const r = Math.max(0, Math.min(1, ratio));
  const off = (C * (1 - r)).toFixed(1);
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="none" stroke="#e6ede9" strokeWidth="3" />
      <circle
        cx="12"
        cy="12"
        r="10"
        fill="none"
        stroke={wait ? '#c9d4ce' : '#10b981'}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="63.3"
        strokeDashoffset={off}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}

function trendLabel(v: number): string {
  if (v === 0) return '— 0%';
  return v > 0 ? `↑ ${v}%` : `↓ ${Math.abs(v)}%`;
}

function metricTrend(v: number, muted = false) {
  return (
    <span className="m-trend" style={muted ? { color: 'var(--t3)', fontWeight: 500 } : undefined}>
      {trendLabel(v)}
    </span>
  );
}

export function SimulationLab({
  stages,
  ratio,
  p95,
  p95Trend,
  sim,
  onReplay,
}: {
  stages: Stage[];
  ratio: number;
  p95: number | null;
  p95Trend: number;
  sim: SimulationApi;
  onReplay: () => void;
}) {
  const { metrics, trends }: { metrics: SimTelemetry; trends: SimTelemetry } = sim;

  return (
    <div className="card simlab-card">
      <div className="card-head">
        <b>Simulation Lab</b>
        <span className="sub">多端环境仿真 · 验证 Agent 真实表现</span>
        <span className="head-right">
          <span className="env-pill">
            <Icon name="i-device" size={12} />
            Android 14 · Pixel 7
          </span>
        </span>
      </div>

      <div className="simlab-body">
        <div className="phone-col">
          <div className="phone">
            <div className="phone-scr">
              <i className="pnotch" />
              <div className="ptime">{fmtMS(sim.phoneSec)}</div>
              <i className="pbar" />
            </div>
          </div>
          <span className="phone-tag">
            <Icon name="i-device" size={11} />
            Pixel 7
          </span>
        </div>

        <div className="sim-right">
          <div className="metric-grid">
            <div className="metric">
              <div className="m-top">
                <Icon name="i-water" style={{ color: 'var(--cyan)' }} />
                Memory
              </div>
              <div className="m-num">
                <span>{metrics.memory.toFixed(1)}GB</span>
                {metricTrend(trends.memory)}
              </div>
            </div>
            <div className="metric">
              <div className="m-top">
                <Icon name="i-chip" style={{ color: 'var(--purple)' }} />
                NPU
              </div>
              <div className="m-num">
                <span>{Math.round(metrics.npu)}%</span>
                {metricTrend(trends.npu)}
              </div>
            </div>
            <div className="metric">
              <div className="m-top">
                <Icon name="i-zap" style={{ color: 'var(--blue)' }} />
                P95
              </div>
              <div className="m-num">
                <span>{p95 === null ? '—' : `${Math.round(p95)}ms`}</span>
                {metricTrend(p95Trend, p95 === null)}
              </div>
            </div>
            <div className="metric">
              <div className="m-top">
                <Icon name="i-battery" style={{ color: 'var(--green-deep)' }} />
                Power
              </div>
              <div className="m-num">
                <span>{metrics.power.toFixed(1)}W</span>
                {metricTrend(trends.power)}
              </div>
            </div>
          </div>

          <div className="prog-row">
            {stages.map((s) => {
              if (s.wait) {
                return (
                  <div className="prog-item wait" key={s.name}>
                    <div className="prog-ico">
                      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
                        <circle cx="13" cy="13" r="10.5" fill="none" stroke="#d7dfda" strokeWidth="2.4" />
                      </svg>
                    </div>
                    <div>
                      <div className="p-name">{s.name}</div>
                      <div className="p-val">待开始</div>
                    </div>
                  </div>
                );
              }
              if (s.done >= s.total && s.total > 0) {
                return (
                  <div className="prog-item" key={s.name}>
                    <div className="prog-ico" style={{ color: 'var(--green-deep)' }}>
                      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
                        <circle cx="13" cy="13" r="12" fill="#10b981" />
                        <path
                          d="M8 13.4l3.2 3.2L18 10"
                          stroke="#fff"
                          strokeWidth="2.2"
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                    <div>
                      <div className="p-name">{s.name}</div>
                      <div className="p-val">
                        {s.done}/{s.total}
                      </div>
                    </div>
                  </div>
                );
              }
              return (
                <div className="prog-item" key={s.name}>
                  <div className="prog-ico">{ringSvg(s.total ? s.done / s.total : 0)}</div>
                  <div>
                    <div className="p-name">{s.name}</div>
                    <div className="p-val">
                      {s.done}/{s.total}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="sim-footer">
        <button
          className="play-btn"
          onClick={sim.toggle}
          aria-label={sim.running ? '暂停' : '继续'}
          title={sim.running ? '暂停' : '继续'}
        >
          <Icon name="i-play" />
        </button>
        <span className="sim-clock">{fmtHMS(sim.sec)}</span>
        <span className="sim-state">{stageText(stages)}</span>
        <div className="sim-bar">
          <i style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
        <button className="replay-btn" onClick={onReplay}>
          <Icon name="i-refresh" size={14} />
          Replay DAG
        </button>
        <button className="more-btn" aria-label="更多" title="更多">
          <Icon name="i-dots" />
        </button>
      </div>
    </div>
  );
}

export default SimulationLab;