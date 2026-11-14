/**
 * scheduler · Autoloop 常驻自动执行器（M7）
 *
 * 与 HTTP 请求解耦：服务启动后按固定间隔轮询所有有 loop 数据的用户，
 * 发现 queued 轮次就自动领走、调用真实 Agent、回写真回执。
 * 这是「人走开也能自己跟进到底」的关键——不再依赖前端点按钮。
 *
 * 设计要点：
 *   - 单进程单实例，串行 tick；worker 内部 busyUsers 互斥，重复 tick 不会重复领活。
 *   - 每个用户的 auto/mode 由 effectiveConfig 决定；mode=off 或 auto=false 的用户跳过。
 *   - 轮询不阻塞 HTTP：全部异步，异常只记日志不影响服务。
 *   - shutdown 时清 timer，不留悬挂进程。
 */
import type { Env } from '../env';
import { repo } from '../kv';
import { effectiveConfig, listLoopUsers, runWorkerTick } from './worker';

export interface SchedulerHandle {
  stop: () => void;
  /** 立即跑一轮（供测试 / 运维手动触发） */
  tickNow: () => Promise<{ users: number; executed: number }>;
}

export function startLoopScheduler(env: Env): SchedulerHandle {
  let running = true;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function tick(): Promise<{ users: number; executed: number }> {
    if (inFlight || !running) return { users: 0, executed: 0 };
    inFlight = true;
    let users = 0;
    let executed = 0;
    try {
      const r = await repo(env);
      const uids = await listLoopUsers(r);
      for (const uid of uids) {
        if (!running) break;
        try {
          const cfg = await effectiveConfig(r, uid, env);
          if (!cfg.auto || cfg.mode === 'off') continue;
          users += 1;
          const res = await runWorkerTick(r, uid, env, new Date().toISOString());
          if (res.busy) break; // 已有 Agent 在跑，本轮结束，别再给其他用户派活
          executed += res.executed;
          if (executed >= 1) break; // 全局每轮最多 1 个，串行消化积压、不拥塞
          if (res.executed > 0) {
            console.log(`[worker] uid=${uid} 真实 Agent 执行 ${res.executed} 轮（${res.jobs.map((j) => `${j.runId}:${j.outcome ?? j.status}`).join(', ')}）`);
          }
        } catch (e) {
          console.error(`[worker] uid=${uid} tick 失败:`, (e as Error).message);
        }
      }
    } catch (e) {
      console.error('[worker] 调度器异常:', (e as Error).message);
    } finally {
      inFlight = false;
    }
    return { users, executed };
  }

  const baseInterval = Math.max(3_000, Number(env.LOOP_WORKER_INTERVAL_MS) || 15_000);

  function schedule(): void {
    if (!running) return;
    timer = setTimeout(async () => {
      await tick();
      schedule();
    }, baseInterval);
    timer.unref?.();
  }

  // 启动后延迟一个间隔再首轮，避开 Next 构建/预热窗口
  schedule();
  console.log(`[worker] 自动执行器已启动 · 间隔 ${baseInterval}ms · 模式由 LOOP_WORKER_MODE / 用户配置决定`);

  return {
    stop: () => {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    tickNow: tick,
  };
}
