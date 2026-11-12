# Agent Autoloop 重构 · 需求文档（v0.3）

> 状态：**当前权威需求文档**（取代 `docs/01` 的历史需求拆解，历史文档仅作参考保留）
> 参考系统：[KKKKhazix/agent-autoloop](https://github.com/KKKKhazix/agent-autoloop) · [设计全文](./Agent-Autoloop-Agent自动化系统-全文.md)
> 基线版本：v0.2「移动端重构基线」（见 README 历史记录）
> 更新日期：2026-11-12

---

## 1. 背景与目标

### 1.1 现状

`agentic-os-workbench` 目前是一个 **UI 优先** 的工作台：视觉完成度高（响应式、设计 tokens、卡片化表格、移动端/宽屏适配均已验证），但业务语义是原型 `workbench.html` 迁移过来的演示数据——「工作流 / 技能 / 合同 / 设备」这套概念**没有真实运转的机制**，后端只是 CRUD + 种子数据。

v0.2 已把模块精简到「工作流 + 技能 + 设置」，为逐个补功能留了干净基线。

### 1.2 目标

用 **Agent Autoloop 的功能模型与架构思想**重构本项目，把它从「演示型 UI」升级为「**可运转的事件驱动自动化中台（Web 形态）**」：

- 让「发生了一件事 → 按规则派活 → Agent 跑一轮 → 交回执 → 需要拍板才发卡片 → 回答后续跑」这条主链路真实跑起来；
- 把 autoloop 的**四大机制**做成后端确定性内核，且**可复现、可测试、可溯源**；
- **保持现有 UI 完全一致**：不重新设计视觉、不换组件、不改响应式规则、不动登录/注册流程与导航骨架。

### 1.3 一句话

> **壳不变，核换掉**：界面还是那个界面，里面跑的从「假的 CRUD 演示」变成「真的事件驱动内核」。

---

## 2. 参考系统功能解构

来源：仓库 README / `docs/protocol.md` / `docs/state-machines.md` / `docs/plugins.md` / `kernel/*.ts` / `protocol/rules.ts`（已完整下载核对）。

### 2.1 六个核心词

| 词 | 含义 | 本项目落点 |
|---|---|---|
| **事件 Event** | 发生了一件事：来源、编号、类型、对象、摘要、详情、链接；时间到/点卡片也是事件 | `LoopEvent` |
| **规则 Rule** | `rules.json` 里：什么事件 → 交给哪个 Agent → 在哪个目录 → 用什么 Skill → 何时告知 | `LoopRule` |
| **事项 Lane** | 同一规则下同一对象的事；卡片、复查、会话挂在事项上 | `LoopLane` |
| **一轮 Run** | 一次执行：领一批事件、交一份回执、结束；`queued→claimed→done/nothing/cancelled` | `LoopRun` |
| **回执 Receipt** | Agent 最后一条消息；`ask/notice/resolve/later/events` 在一个事务里生效 | `LoopReceipt` |
| **卡片 Card** | 给你看的东西：带选项=提问（拍板），不带=通知；`open→decided→done/closed` | `LoopCard` |

### 2.2 四方向插件

| 方向 | 作用 | 内置示例 |
|---|---|---|
| **事件来源 Source** | 把世界变成事件（GitHub/GitLab Webhook、HTTP、定时、轮询） | `github`/`gitlab`/`webhook`/`schedule` |
| **Agent** | 干活；只要能接提示词、打印最后一条消息 | Claude Code / Codex / ACP / command / dsh / zcode |
| **通道 Channel** | 把卡片送到你面前、收回答 | 桌面通知 / 飞书 / 钉钉 / 企微 / Slack / Discord |
| **交付 Delivery** | CI/CD 也做成插件：`deliver` 标签 → 审查→等 CI→合并→等发布→核对线上 | `delivery` |

### 2.3 四大机制（**本次必须真正实现并验证**）

| 机制 | 原理 | 可验证断言 |
|---|---|---|
| **① 挂起零消耗** | 要拍板时进程直接退出，等待状态存库；三天不回就不跑、不花 Token | `ask` 卡片 `open` 期间：**不产生新 Run、不产生 usage**；`answer` 后才续跑 |
| **② 事件溯源** | 只追加事实日志，状态全由日志投影；写完才应答；`why <轮次>` 翻来龙去脉 | 同一 `Fact[]` 重放两次得到**完全相同的 View**；幂等重放不重复计费/不重复派活 |
| **③ 指令数据分离** | 外部文字只作资料，`cwd/agent/access` 等指令字段一律拒收；`summary/detail` 不进提示词 | 带 `cwd`/`agent`/`access` 的事件 **400 拒收**；`subject` 非标识符、`link` 非 ASCII 网址拒收 |
| **④ 跳数熔断** | 类似 IP TTL，每叫醒下一个 Agent 加一层，>8 层只记录、不再派活并发卡片 | `hops > 8` 的事件**只记录不派 Run**，且生成一张熔断通知卡片 |

### 2.4 确定性内核约束（架构红线）

内核 **不读系统时钟、不用随机数、不向外发请求、不写死具体产品名**；时间 `now`、随机材料、网络、定时器全部由外壳注入。
`decide(view, input, now) → Fact[]` 为纯函数：不改入参、同样输入永远同样输出。

---

## 3. 约束：UI 保持一致

**不改动**：`frontend/styles/*`（tokens/app.css/globals.css）、所有响应式断点与移动端收敛层、`svg.ic` 图标体系、卡片/表格卡片化样式、`AppShell/TopNav/SideNav` 布局骨架、登录/注册页、`icon.svg`、配色与圆角。

**允许改动**：组件读取的**数据字段与文案标签**（由新 API 提供）、导航项 label/crumb/title/badge 的措辞、页面内展示的业务内容。

> 即：`workflows/client.tsx` 的表格还是那个表格（含移动端 `data-label` 卡片化），只是列从「设备/步骤/覆盖率」变成「触发/交给/目录/状态」；`KpiGrid` 还是两张卡，只是数值来自 `LoopState.totals`。

### 3.1 概念映射表（现有 UI ↔ Autoloop）

| 现有页面 / 组件 | 保持的视觉 | 换成的新语义 | 数据来源 |
|---|---|---|---|
| 总览 `/` · `KpiGrid` | 2 张 KPI 卡 | 「活跃规则 / 待拍板卡片」（或「今日轮次 / 已登记 Agent」） | `/api/loop/state` |
| 总览 `/` · `LiveTrace` | 时间线列表 | **事实日志流**（事件溯源，逐条 fact） | `/api/loop/facts` |
| 总览 `/` · `RecentWorkflows` | 最近列表卡片 | **最近轮次 Runs**（含状态/回执摘要） | `/api/loop/runs` |
| 总览 `/` · `WorkflowFormModal` | 表单弹窗 | **新建规则 / 手动发事件** | `POST /api/loop/rules` |
| 工作流 `/workflows` | 列表+搜索+新建+状态+删除（含移动端卡片化） | **规则 Rules**（`when/to/cwd/skill/tell`、暂停/恢复/立即运行） | `/api/loop/rules` |
| 技能 `/skills` | 注册表列表 | **插件注册表**（Agent / Source / Channel / Delivery 四类） | `/api/loop/state` |
| 设置 `/settings` | 账号/配额/审计/登出 | 账号不变；审计 → **事实日志溯源**；配额 → **用量与跳数** | `/api/loop/facts` |
| **待拍板卡片（新增块）** | 复用 `card` + `chip` + `primary-btn` 样式 | **审批台**：选项按钮 → `answer` → 续跑 | `/api/loop/cards` |

导航仍为 **4 项**（总览 / 规则 / 插件 / 设置），沿用 `NAV_ITEMS` 单一数据源与 `navByKey`，保持「增删模块不索引错位」的既有修复。

---

## 4. 领域数据模型

新增 `shared/loop.ts`（独立文件，**不破坏** `shared/types.ts` 与前端镜像 `frontend/lib/types.ts` 的既有契约）。

```ts
// 只追加的事实日志；内核唯一写入物
Fact: { seq, at, kind, ... }   // kind: event.accepted | rule.upserted | rule.paused |
                               // rule.resumed | run.queued | run.claimed | run.finished |
                               // card.created | card.answered | card.closed |
                               // timer.scheduled | timer.fired | hop.blocked | rules.reloaded

LoopEvent:   { id, source, type, subject?, summary?, detail?, link?, receivedAt, hops }
LoopRule:    { name, when: {source,types[]} | {cron}, to, cwd, skill?, prompt?, title?,
               group, parallel?, resume?, tell, emits?, channels?, enabled, paused? }
LoopAgent:   { id, name, worker, use, access, model? }       // 插件：Agent 方向
LoopSource:  { id, name, adapter? }                          // 插件：事件方向
LoopChannel: { id, name, answerers?, links? }                // 插件：通道方向
LoopLane:    { key, rule, subject, lastSession?, hops }
LoopRun:     { id, seq, rule, agent, lane, state, attempts, eventSeqs[], session?,
               summary?, error?, usage?, startedAt?, finishedAt? }
LoopCard:    { id, version, kind: ask|notice|fyi, state: open|decided|done|closed,
               title, text, options[], recommend?, choice?, answer?, by?, result?,
               lane, about?, key?, createdAt }
LoopReceipt: { outcome: done|nothing|failed|cancelled, summary?, error?, session?,
               usage?, ask?, notice?, resolve?, later?, events? }
LoopState:   { seq, rulesVersion, timezone, totals, rules[], agents[], sources[],
               channels[], events[], runs[], cards[], timers[], pauses, now }
```

**状态机**（对齐 `docs/state-machines.md`）：
- Run：`queued → claimed → done | nothing | cancelled`；`claimed → unknown`（迟到结果照收）；失败回 `queued`，连续失败 ≤10 次终态 `cancelled`。
- Card：`open → decided → done` 或 `open → closed`；FYI 创建即 `closed`。
- 事项：无独立状态列，由 `rule + lane` 对应的轮次、未结卡片、未来复查共同表达。

---

## 5. API 契约

统一信封沿用 `{ ok:true, data:T } | { ok:false, error:{code,message} }`；鉴权顺序沿用 `鉴权 → 校验 → 配额 → 业务 → 审计`；**userId 由服务端会话注入**，客户端不可伪造。

新增 `/api/loop/*`（与现有 `/api/workflows` 等**并存**，平滑迁移、随时可回退）：

```
GET    /api/loop/state                     全局快照（totals + 各类列表 + now）
GET    /api/loop/healthz                  内核版本 / 日志序号（无需业务鉴权也可读）

POST   /api/loop/events                   接入事件（去重 + 规则匹配 + 派活）
GET    /api/loop/events/:seq              查某事件去向（routed / runs / duplicate）
POST   /api/loop/emit                     预演：这条事件会派给谁（不落库、不写真日志）

GET    /api/loop/rules                    规则列表
POST   /api/loop/rules                    新增/更新规则（含校验）
POST   /api/loop/rules/check              校验一份规则草稿（不落库）
POST   /api/loop/rules/:name/pause        暂停（不补跑）
POST   /api/loop/rules/:name/resume       恢复
POST   /api/loop/rules/:name/run          立即跑一轮（manual run）

GET    /api/loop/runs                     轮次列表（支持 before 翻页）
GET    /api/loop/runs/:id/why             溯源时间线（该轮相关全部 facts）
POST   /api/loop/runs/:id/claim           领活（演示用，推进 queued→claimed）
POST   /api/loop/runs/:id/result          交回执（ask/notice/resolve/later/events 一次生效）

GET    /api/loop/cards                    卡片列表
POST   /api/loop/cards/:id/answer         回答（choice | text）→ 产生 answer_event 续跑
POST   /api/loop/cards/:id/resolve        结案

GET    /api/loop/facts?after=<seq>        事实日志（事件溯源 / 增量拉取）
POST   /api/loop/tick                     驱动到期复查与定时（外壳注入 now）
```

---

## 6. 分期实施计划（规模闸门）

autoloop 完整能力折算 **远超 4 个模块**，一次性全量搭建必然崩溃或零交付。按「一次只补 1 个模块、每期可独立验证、不丢数据」分 5 期：

| 期 | 模块 | 交付 | 验收 |
|---|---|---|---|
| **M1（本轮）** | ① 领域模型 ② 确定性内核（四大机制）③ 事实日志+投影 ④ REST API | `shared/loop.ts`、`backend/lib/loop/*`、`backend/functions/loop.ts`、路由注册、演示种子、内核测试 | 构建通过；内核单测全绿；API 冒烟（去重/指令分离/跳数熔断/挂起零消耗/why 溯源/幂等重放）；**现有接口零回归** |
| **M2** | 前端接线：总览 + 规则页 + 插件页 + 设置页换语义（**UI 视觉零改动**） | 4 个页面组件改造 + `frontend/lib/loop-*` | 375/768/1440/1920 四视口：横向溢出 0、超大图标 0、页面错误 0；KPI/LiveTrace/Recent 显示真实内核数据 |
| **M3** | 审批卡片台（挂起零消耗的可视化闭环） | 卡片列表 + 选项回答 + 续跑动画（复用现有 card/chip/btn） | `ask → open（无新 run）→ answer → 新 run → done` 全链路可见 |
| **M4** | 插件体系（Source/Agent/Channel/Delivery 注册与启停）+ `why` 溯源视图 + 规则校验/预演 | 插件管理 + 溯源时间线 | 可登记/停用插件；`why` 能重现任意一轮；`check`/`emit` 可用 |
| **M5** | 部署上线 + 端到端验证 | 重新发布到现有外网链接 | 线上四视口 + 全链路冒烟通过；README/文档同步 |

> 每期只追加 1 组能力，新 key 不影响老数据；`localStorage`/`.data` 向后兼容。

---

## 7. M1 验收标准（可执行的验证清单）

| # | 断言 | 方法 |
|---|---|---|
| 1 | **确定性**：同一 `Fact[]` 重放两次得到字节级相同的 View | 内核单测 `replay(facts) === replay(facts)` |
| 2 | **事件去重**：同 `source+id` 的事件只记一次 | 连续 POST 两次 → 第二次 `duplicate:true`、`routed:[]`、无新 Run |
| 3 | **指令数据分离**：事件带 `cwd/agent/access/to/use` 任一字段 → 400 | POST 注入字段 → `VALIDATION_ERROR` |
| 4 | **指令数据分离**：`subject` 含非法字符、`link` 非 ASCII → 400 | 同上 |
| 5 | **规则匹配**：`when.source + types`（支持 `x.*` 与 `*`）命中正确规则并派活 | POST 事件 → `routed:[规则名]`，生成 `queued` Run |
| 6 | **暂停/恢复**：暂停规则期间事件不派活、恢复后不补跑 | pause → emit → resume → emit 对比 |
| 7 | **跳数熔断**：`hops=9` 事件只记 `hop.blocked`，不生成 Run，生成熔断卡片 | POST + 查 state |
| 8 | **挂起零消耗**：回执带 `ask` → 卡片 `open`、Run `done`、**无新 Run / 无 usage** | result → 查 runs/cards |
| 9 | **回答续跑**：`answer` 后产生 `answer_event`、新 Run 接原 lane | answer → 查 runs 与 facts |
| 10 | **why 溯源**：任一轮能返回其关联的全部 facts（事件/规则版本/领取/回执/回答） | `GET /runs/:id/why` |
| 11 | **幂等重放**：同样回执重交两次只确认一次 | result 重交 → runs/usage 不重复 |
| 12 | **零回归**：现有 `/api/workflows`、`/api/skills`、`/api/auth/*` 全部 200 | API 冒烟脚本 |
| 13 | **构建**：TypeScript 全绿、Next 生产构建成功 | `npm run build` |

---

## 8. 非目标（明确不做）

- ❌ 不真实拉起 Claude Code / Codex 等 CLI 进程（沙箱内无这些程序；用「模拟 Agent 交回执」表达一轮执行）
- ❌ 不接公网 Webhook / 飞书 / 钉钉真实回调（事件来源用 HTTP 手动发送 + 演示种子表达）
- ❌ 不引入 SQLite / 第三方依赖（沿用现有 `Repo` + 文件驱动，事实日志以单键 append 表达，符合事件溯源语义）
- ❌ 不实现完整 PR 交付流水线（delivery 作为插件注册项登记，M4 再展开）
- ❌ 不重做 UI 视觉、不改设计 tokens、不动响应式规则
- ❌ 不做多用户协作 / 账号体系升级（沿用现有单用户 + JWT 会话）

---

## 9. 风险与开放问题

| 项 | 说明 | 当前决策 |
|---|---|---|
| 「UI 一致」的边界 | 指标签文案可否改 | **可改文案、不可改视觉**（见 §3） |
| 旧 `workflows/skills` API | 直接删还是并存 | **并存**，M2 前端切换后 M5 再评估下线 |
| 事实日志存储 | 单键数组 vs 分段 | M1 用单键 append（规模足够）；后续可分段不改接口 |
| 卡片回答身份 | 通道 `answerers` 校验 | **M4 已闭环**：卡片创建时按通道快照名单，`by` 由会话注入，名单外 403 且不产事实 |
| 定时/复查 | 需要真实时钟 | 内核不读时钟，由 `POST /tick` 外壳注入 `now` 驱动 |

---

## 10. 交付物索引

| 期 | 文件 |
|---|---|
| M1 | `shared/loop.ts` · `backend/lib/loop/kernel.ts` · `backend/lib/loop/store.ts` · `backend/lib/loop/seed.ts` · `backend/functions/loop.ts` · `backend/functions/router.ts`（注册 21 条 `/loop/*` 路由）· `tests/loop-kernel.test.ts`（68 断言）· `tests/loop-api-smoke.ts`（39 项 REST 全链路）· `package.json`（`test:loop*` 脚本）· 本文档 |
| M2 | 前端数据层 `frontend/lib/loop-{types,format,api,hooks}.ts`（镜像/映射/端点/SWR，零新 CSS）；改造 `KpiGrid`/`LiveTrace`/`RecentWorkflows`/`WorkflowFormModal` + 4 页面（`page.tsx`/`workflows`/`skills`/`settings`）+ `nav.ts`/`TopNav` 文案；`tests/loop-ui-viewports.mjs`（56 项四视口）、`tests/loop-concurrency-e2e.mjs`（30 项并发）|
| M3 | 审批卡片台 `frontend/components/dashboard/ApprovalCards.tsx`（复用 `.card/.wf-card/.chip/.run-btn`，零新增 CSS）+ 总览接线 `page.tsx`（审批台置顶 + 待拍板条目跳 `#approval`）；`tests/loop-approval-e2e.mjs`（37 项全链路 e2e）；`tests/loop-ui-viewports.mjs`（扩至 74 项，含审批台四视口 + 拍板续跑实操）；`package.json`（`test:loop-approval` 脚本）· 本文档 |
| M4 | 后端：`shared/loop.ts`（`plugin.disabled/enabled` 事实+输入+`disabledPlugins` 投影+卡片 `channel/answerers` 快照+`LOOP_API.PLUGIN_*`+版本 `0.4.0`）· `backend/lib/loop/kernel.ts`（evolve/decide/matchRules/makeCard/card.answer 校验/stateOf）· `backend/functions/loop.ts`（`postPluginDisable/Enable`、`postCardAnswer` 会话注入 `by` + 403 映射）· `backend/lib/resp.ts`（`forbidden`）· `router.ts`（2 条启停路由）。前端：`frontend/lib/loop-{types,api,format}.ts` 同步 · `skills/page.tsx`（停用/启用 + 登记插件表单）· `components/modals/RunWhyModal.tsx`（why 溯源时间线）· `components/dashboard/RulePreview.tsx`（check/emit 预演）· `RecentWorkflows`（溯源按钮）· `page.tsx`/`workflows/client.tsx` 接线。`tests/loop-kernel.test.ts`（91）· `tests/loop-api-smoke.ts`（61）· `tests/loop-m4-e2e.mjs`（36 项全链路）· `tests/loop-ui-viewports.mjs`（扩至 102）· `package.json`（`test:loop-m4`）· 本文档 |
| M5+ | 见各期实施记录（追加于本文末「实施日志」） |

---

## 实施日志

- **2026-11-12 M1 启动**：完成参考系统调研（README/协议/状态机/插件/规则 schema/内核源码），确定「壳不变、核换掉」方案与 5 期分期。
- **2026-11-12 M1 完成**：领域模型 / 确定性内核（四大机制）/ append-only 事实日志+可重建投影 / 21 条 REST 端点 / 幂等播种落地。前端与既有 UI 未改动，符合「M1 只做后端」边界。
- **2026-11-12 联调修复**：REST 全链路冒烟暴露一处幂等缺陷——`postRunResult` 在 HTTP 层前置「轮次已结束→409」状态检查并自行比对回执指纹，抢在内核 `decide` 之前把「相同回执重交」拒掉，导致内核的 `duplicate:true` 语义无法到达客户端，且违反「业务逻辑零写在 HTTP 层」红线。修复：移除两处 HTTP 层判定，改为 commit 后按产出事实映射（无事实→409 冲突，`run.finished{duplicate:true}`→幂等确认）。修复后 REST 冒烟 35/35。
- **2026-11-12 M1 验收（全绿）**：

| 验证项 | 命令 | 结果 |
|---|---|---|
| 确定性内核（去重/指令分离/跳数熔断/挂起零消耗/回答续跑/why/幂等/重放） | `npm run test:loop-kernel` | 68 通过 / 0 失败 |
| `/loop/*` REST 全链路（鉴权/信封/播种/21 端点/多租户隔离） | `npm run test:loop-api` | 35 通过 / 0 失败 |
| 现有接口零回归 | `npm run test:api` | 34 通过 / 0 失败 |
| 后端类型检查 | `npm run typecheck:backend` | 通过，无错误 |
| 前端生产构建 | `cd frontend && npm run build` | 编译/TS/11 页静态生成成功 |
| 本地预览服务 | `PORT=3737 ... node --import tsx/esm frontend/server.mjs` | `/` 200、`/api/loop/healthz` 200 |

> **部署状态**：线上 3000 实例与外网链接（`https://a00b3c39736f37990.app.workbuddy.host/?sharecode=Q4ABTA5LR3`）仍为 M1 之前的基线版本，`/api/loop/*` 返回 404 属预期——按分期，重新发布在 **M5** 执行，避免把半成品推到线上。M2 的验证全部在本地 3737 预览服务完成。

- **2026-11-12 M2 完成（前端接线 · UI 视觉零改动）**：按用户要求「UI 以当前项目风格为准」落地，`frontend/styles/*`、图标体系、响应式断点、布局骨架、登录注册页**一行未动**；仅替换组件读取的数据字段与文案标签（`工作流→规则`、`技能→插件`、`Trace→事实日志`、审计→事实溯源）。具体：
  - 新增前端数据层 4 文件（`loop-types` 镜像 `shared/loop.ts` / `loop-format` 把 20+ fact kind 归入既有 4 个 `.tr-ico` 色调槽位+现有 40 个图标 / `loop-api` 复用 `request()` / `loop-hooks` SWR 订阅+单一 `revalidateLoop()` 刷新入口，无渲染函数互调环）。
  - 总览 KPI（活跃规则/已登记插件，值来自 `LoopState.totals`）、LiveTrace（事实日志流）、RecentWorkflows（最近轮次）、WorkflowFormModal（接入事件/新建规则两模式）、顶部「今天要处理」块（复用 `.attn-*`/`.chip`，零新 CSS）。
  - 规则页表格列换 `触发/交给/目录/通知/分组` + 暂停恢复/立即运行；插件页四方向注册表；设置页用量与跳数/事实日志溯源；导航 4 项措辞同步（`NAV_ITEMS` 单一数据源）。
- **2026-11-12 并发播种缺陷（两处，联调截图发现并修复）**：总览首屏并发发 `/loop/state`+`/loop/facts`，暴露
  ① `store.commit()` 每写一条事实就置 `meta.seeded=true`，播种到第 1 条即误报「已完成」；
  ② `ensureLoopSeeded()` 锁外 `isSeeded` 快速检查让并发请求绕过等待，**读到播种中途的半成品投影**（截图曾出现「活跃规则 0 / 插件 6 / 事实 #6」，规则登记丢失）。
  修复：`seeded` 改由 `markSeeded()` 在种子全部写完后才置 true（普通提交保留原值，中途崩溃可自愈重播）；`ensureLoopSeeded` 增加进程内 per-uid 互斥，等待分支无条件 await 到底，等待者必读到完整状态。
  验证：真实服务并发 e2e **双向证伪**——无锁/污染版稳定复现 `facts=21`（6 轮全 FAIL）、修复版 `facts=11 / 首次响应即 4 规则 / seq=11`（30/30 PASS）。内存 KV + 单线程微任务调度无法稳定复现竞态，故权威回归落在连真实 file 驱动服务的 `loop-concurrency-e2e.mjs`，内存冒烟仅保留「结果契约」检查。
- **2026-11-12 M2 验收（全绿）**：

| 验证项 | 命令 | 结果 |
|---|---|---|
| 前端 TypeScript | `cd frontend && npx tsc --noEmit` | 通过 |
| 前端生产构建 | `cd frontend && npm run build` | 编译/TS/11 页静态生成成功 |
| 确定性内核 | `npm run test:loop-kernel` | 68 / 0 |
| `/loop/*` REST 全链路（含并发结果契约） | `npm run test:loop-api` | 39 / 0 |
| 现有接口零回归 | `npm run test:api` | 34 / 0 |
| 并发首访播种幂等（真实服务） | `npm run test:loop-concurrency` | 30 / 0 |
| 四视口 375/768/1440/1920 × 4 页（溢出/超大图标/运行时错误/真实内核数据） | `npm run test:loop-ui` | 56 / 0 |
| 目视核对 | 总览 + 规则页截图 | KPI 4/7、事实 #11、8 列规则表，视觉与原项目一致，无异常 |

- **2026-11-12 GitHub 提交（M1+M2+PC 宽屏）**：commit `43746ca4`（parent `3c5030d8`，历史连续、非 force），28 文件（14 新增 + 14 修改）。因沙箱 git 传输通道 TLS 不可用，沿用 `sandbox-github-commit` skill 的 Git Data API 路径（blob→tree→commit→PATCH ref），用**显式 28 文件清单**隔离含凭证的 `SECRET.md`，Token 仅以单次环境变量注入、不落盘不回显，提交后清理平台脚本写入 `~/.zshrc` 的明文残留。已提醒用户 revoke。
- **2026-11-12 M3 完成（审批卡片台 · 挂起零消耗可视化闭环）**：严格「UI 以当前项目风格为准」，**纯前端增量、零后端改动**（内核/种子/REST/既有测试断言全部不动，零回归风险）：
  - 新增 `ApprovalCards`：展示 open 的 ask 卡片 + 选项按钮（推荐项绿色高亮）+「挂起中 · 0 新轮次 / 0 Token」佐证；点选项走 `answerCard` → 内核产 `card.answered`+`event.accepted`+`run.queued` 接原事项续跑 → 卡片转 decided → `revalidateLoop()` 统一刷新；「演示一次拍板」按钮走真实 API 链路（接入事件→对 queued run 交带 `ask` 的回执→产出 open 卡片）。全部复用既有语义类与 40 个内联图标，**零新增 CSS**。
  - 总览页把审批台置于「今天要处理」与 KPI 之间，待拍板 chev 从 `/workflows` 改跳 `#approval` 锚点。
  - 数据流严格单向：交互→写事实→统一失效→SWR 各自重渲染，无渲染函数互调环（对齐 §2.4 架构红线）。
- **2026-11-12 M3 验收（全绿）**：

| 验证项 | 命令 | 结果 |
|---|---|---|
| 前端 TypeScript / 生产构建 | `npx tsc --noEmit` / `npm run build` | 通过 / 11 页静态生成 |
| 审批卡片台全链路 e2e（挂起零消耗/续跑/溯源/幂等/越界/多租户） | `npm run test:loop-approval` | 37 / 0 |
| 确定性内核 / REST 冒烟 / 既有接口 / 并发（**零回归**） | `test:loop-kernel` / `test:loop-api` / `test:api` / `test:loop-concurrency` | 68 / 39 / 34 / 30 |
| 四视口 × 4 页 + 审批台 + 拍板续跑实操 | `npm run test:loop-ui` | 74 / 0（按钮触控区全部 ≥44px） |
| 目视核对 | 审批台总览截图 | 「今天要处理」1 张待拍板、审批台 3 选项、事实日志「事件→排队→回执→卡片创建」闭环，视觉与原项目一致 |

  > 说明：M3 未改种子，首次打开审批台为空态并引导「演示一次拍板」——这是刻意设计，让 `ask→open（无新 run）→answer→新 run` 由用户**实操触发、真实写事实日志**，而非预置静态假数据；同时保住 M1/M2 已验证的 `facts=11 / seq=11` 等并发断言不被改动。

- **2026-11-12 GitHub 提交（M3 审批卡片台）**：commit `04158c14`（parent `43746ca4`，历史连续、非 force），6 文件（4 修改 + 2 新增），沿用 `sandbox-github-commit` skill 的 Git Data API 路径（`blob → tree → commit → PATCH ref`）与显式文件清单隔离凭证，Token 仅单次环境变量注入、不落盘不回显；远端 tree 与 commit 已独立校验通过。
- **2026-11-12 M4 完成（插件体系启停 + why 溯源视图 + 规则校验/预演 + 通道级应答身份）**：继续严格「UI 以当前项目风格为准」，`frontend/styles/*`、图标体系、响应式断点、布局骨架、登录注册页**一行未动**；三块新 UI 全部复用既有语义类（`.card/.wf-form/.tbl/.chip/.primary-btn/.icon-btn/.trace-row/.tr-ico/.tr-mid/.tr-bar/.tr-badge`），**零新增 CSS**：
  - **后端 · 插件启停事实化**：`shared/loop.ts` 增 `plugin.disabled/plugin.enabled` 事实与输入、`LoopView/LoopState.disabledPlugins` 投影、`LOOP_API.PLUGIN_DISABLE/ENABLE`；内核 `evolve` 维护停用表，`decide` 拒绝对未登记/已停用插件的操作，`matchRules` 过滤停用 Source/Agent → **停用后不派活**，`stateOf` 输出停用表。投影结构变更，`LOOP_KERNEL_VERSION` 从 `0.3.0` bump 到 **`autoloop-web-0.4.0`**，旧投影按版本不匹配自动重放重建。
  - **后端 · 通道级应答身份**：`ReceiptAsk.channel` → 卡片创建时按通道把 `answerers` **快照**进 `LoopCard`；`by` 改由服务端会话 `user.email` 注入（客户端不可伪造）；内核 `card.answer` 拒绝名单外身份且**不产事实**；HTTP 层映射 `403 FORBIDDEN`。挂起零消耗语义不变。
  - **前端 · 插件页**：停用/启用 `.icon-btn` + 「登记插件」表单（Agent/Source/Channel/Delivery，Channel 的 `answerers` 逗号分隔），写后统一 `revalidateLoop()`。
  - **前端 · why 溯源**：`RunWhyModal` 用 `/loop/runs/:id/why` 拉 `{run,timeline}`，按 seq 升序复用事实日志时间线视觉；总览 Recent Runs 增「溯源」入口。
  - **前端 · 规则预演**：`RulePreview` 调 `emit`（只读演算、不写事实日志）与 `checkRule`（合法/非法/重名草稿校验），界面明确「不落库」。
  - 数据流仍严格单向：交互 → 写事实 → 统一失效 → SWR 各自重渲染，无渲染函数互调环（§2.4 架构红线）。
- **2026-11-12 联调修复（healthz 版本漂移）**：重启 M4 服务后发现 `/loop/healthz` 仍报 `autoloop-web-0.3.0`——`getHealthz()` 把版本**硬编码成字面量**，M4 bump 时漏改。修复为引用 `LOOP_KERNEL_VERSION` 单一事实源；REST 冒烟仅断言 `status:'ok'`，故不影响既有断言。重启后探针正确返回 `0.4.0`。此后版本号一律以常量引用为唯一写法，杜绝散落。
- **2026-11-12 M4 验收（全绿）**：

| 验证项 | 命令 | 结果 |
|---|---|---|
| 确定性内核（含 ⑭ 插件启停 / ⑮ 通道级应答身份） | `npm run test:loop-kernel` | 91 / 0 |
| `/loop/*` REST 全链路（含启停、越权 403、why/emit） | `npm run test:loop-api` | 61 / 0 |
| 现有接口零回归 | `npm run test:api` | 34 / 0 |
| 并发首访播种幂等（真实服务） | `npm run test:loop-concurrency` | 30 / 0 |
| M3 审批卡片台全链路（零回归） | `npm run test:loop-approval` | 37 / 0 |
| M4 专项全链路 e2e（启停/预演/越权/溯源/多租户隔离） | `npm run test:loop-m4` | 36 / 0 |
| 四视口 375/768/1440/1920（含 M4 三块 UI 实操） | `npm run test:loop-ui` | 102 / 0 |
| 后端 / 前端 TypeScript | `npm run typecheck:backend` / `npx tsc --noEmit` | 通过，无错误 |
| 前端生产构建 | `cd frontend && npm run build` | 通过，11 页静态生成 |
| 本地预览服务（M4 构建） | 3737 `server.mjs` | `/` 200 · healthz `autoloop-web-0.4.0` |
| 目视核对 | 规则页 / 插件页 / 溯源 Modal 三张截图 | 白底绿系圆角卡片、复用原视觉，无溢出/黑块/错位 |

  > **部署状态**：线上 3000 实例与外网链接（`https://a00b3c39736f37990.app.workbuddy.host/?sharecode=Q4ABTA5LR3`）仍为 M1 之前基线版；按分期，重新发布在 **M5** 执行，避免把半成品推到线上。M4 全部验证在本地 3737 预览服务完成。
  > **提交状态**：M3 已提交（`04158c14`）；M4 已提交（`6c72a157`，20 文件，parent `04158c14`，历史连续、非 force）。

- **2026-11-12 GitHub 提交（M4）**：commit `6c72a157ae9a3d71dfefba0e3405fd7d367a4e1b`（parent `04158c14`），20 文件（17 修改 + 3 新增）。沿用 `sandbox-github-commit` skill 的 Git Data API 路径；提交前以 M3 codeload 快照作基线逐文件比对，剔除三类误报——`package-lock.json`（本地陈旧版，提交会回退远端 `optionalDependencies` 修复）、`frontend/next-env.d.ts`、`frontend/tsconfig.tsbuildinfo`（构建产物）；显式 20 文件清单隔离凭证，Token 仅单次环境变量注入、不落盘不回显。提交后独立校验：ref 指向新 commit、`parents[0]` = 原 HEAD、20 文件状态分布、关键内容（`shared/loop.ts` 版本 `0.4.0`、`getHealthz` 引用常量）、`frontend/styles/tokens.css` 未被 `.gitignore` 误伤、tree 未截断（134 blob）。项目内凭证残留 / `.git` / remote URL / shell 配置扫描均干净。已提醒用户 revoke 该 classic PAT。
