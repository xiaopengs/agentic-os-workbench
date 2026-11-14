# Agentic OS 工作台 · 精简基线版

> **当前状态：v0.2 · 移动端重构基线**
> 本轮把产品收敛到最小可用形态，**只开放「工作流」「技能」两个业务模块**，
> 其余模块按「一次补一个」的节奏逐步恢复。本文档描述的是当前可用版本，历史设计见 `docs/01–07`。

---

## 当前开放的能力

| 模块 | 路由 | 说明 |
|---|---|---|
| 登录 / 注册 | `/login` `/register` | bcrypt + JWT + HttpOnly Cookie，服务端会话 |
| 总览 | `/` | 2 张 KPI（工作流 / 技能）、Live Trace、Recent Workflows |
| 工作流 | `/workflows` | 列表、搜索、新建、状态切换、删除（CRUD 五端点） |
| 技能 | `/skills` | 技能注册表 |
| 设置 | `/settings` | 账号信息、配额用量、审计日志、登出 |

导航由 `frontend/lib/nav.ts` 的 `NAV_ITEMS` 单一数据源驱动，顶栏与侧栏共用。

## 已从基线下线的模块

| 模块 | 下线方式 | 源码位置 | 恢复方式 |
|---|---|---|---|
| 合同 | 导航移除 + 路由 `redirect('/')` | `frontend/app/(workbench)/contracts/page.tsx.bak` | 把 `.bak` 改回 `page.tsx`，并在 `NAV_ITEMS` 加回一项 |
| 设备 | 同上 | `frontend/app/(workbench)/devices/page.tsx.bak` | 同上 |
| Agent Lifecycle | 总览页不再渲染 | `components/dashboard/LifecycleCard.tsx` | 在总览页恢复引用 |
| Simulation Lab | 总览页不再渲染 | `components/dashboard/SimulationLab.tsx` | 同上 |
| 右侧 Copilot 侧栏 | `AppShell` 不再渲染 | `components/aside/Aside.tsx` | 同上 |

> **后端 API 未删除**（`/api/contracts`、`/api/devices`、Copilot SSE 仍在），
> 这样逐个补充功能时只需接回前端，不必重建数据层。Live Trace 会在展示层过滤掉 `Contract` 类型条目。

---

## 本轮修复：移动端适配

窄屏下曾出现：内容被右侧裁切、SVG 图标变成巨大黑色色块、装饰曲线溢出、文字竖排、按钮遮挡正文。

**根因**：把 `workbench.html` 原型迁移到 `frontend/styles/app.css` 时，只搬了组件类名规则，
**漏掉了原型第 25–33 行的全局基础样式**——尤其是

```css
svg.ic{width:1em;height:1em;fill:none;stroke:currentColor;...}
```

`<Icon />` 渲染的是不带 `viewBox` 的 `<svg><use/></svg>`，完全依赖这条规则约束尺寸与描边。
Tailwind v4 的 preflight 不会补它，于是 SVG 回落成默认 300×150、填充黑色，窄屏下被 flex 容器进一步放大。

**修复清单**：

| 问题 | 处理 |
|---|---|
| 图标黑色巨块 | `app/globals.css` 补回原型 9 行基础样式；`app.css` 追加 `svg.ic` 尺寸兜底 |
| 横向溢出被裁切 | `html,body{overflow-x:clip}`；卡片/网格子项统一 `min-width:0;max-width:100%` |
| 多列网格挤压 | 900px 起 KPI 两列、520px 起单列；`.wf-grid`、`.row-2col` 窄屏单列 |
| Live Trace 耗时被切 | 520px 起 `flex-wrap` 两行排布，隐藏进度条与状态徽标，名称 `text-overflow:ellipsis` |
| 「全部工作流 →」竖排 | `.wf-top .head-right` 整行换行 + `white-space:nowrap` |
| 表格撑破页面 | `.tbl-wrap` 容器内横向滚动，表格 `min-width` 降到 560px |
| 顶栏元素过多 | 900px 起隐藏搜索框 / 环境切换 / 通知，只留品牌、菜单、用户 |
| 点击区与输入框 | 按钮 ≥44px，输入 ≥16px（防 iOS 缩放），`touch-action:manipulation` |
| iPhone 底部 | `env(safe-area-inset-bottom)` 用于页面与 toast |
| 动效 | 支持 `prefers-reduced-motion`；焦点态 `:focus-visible` 可见 |

所有移动端规则追加在 `frontend/styles/app.css` 末尾独立小节，**不改动任何原型规则**，
便于与 `workbench.html` 继续做 1:1 比对。

---

## 快速开始

### 本地开发

前置：Node.js ≥ 20.9。

```bash
node scripts/start-local.mjs
```

自动装依赖并起两个进程：前端 `http://127.0.0.1:3737`、后端 `http://127.0.0.1:8787/api`。
数据落在 `./.data/store.json`，删掉即重置；`NO_OPEN=1` 关闭自动开浏览器。

> 预览请用 `127.0.0.1`，不要用 `localhost`（`next.config.ts` 的 `allowedDevOrigins` 约束）。

### 单端口生产部署（沙箱 / 容器 / 托管）

前端与 `/api` 合并到同一进程同一端口，前后端同源、无 CORS：

```bash
cd frontend && npm run build
cd ..
PORT=3737 HOST=0.0.0.0 NODE_ENV=production LOCAL_STORE=file LOCAL_AI_MOCK=1 \
JWT_SECRET='<≥32 位随机串>' node --import tsx/esm frontend/server.mjs
```

`server.mjs` 会读取 `PORT` 环境变量并绑定 `0.0.0.0`，可直接交给平台发布。
`build:app` / `build-deploy` 生成自包含部署单元的用法见 [docs/07](./docs/07-本地部署与去平台化.md)。

### 真实 Agent 自动执行器（M7）

事件命中规则后产生的轮次**不需要人工点按钮**：常驻执行器会自动领走，调用真实 Agent
执行并回写真回执，遇到拿不准的事才发卡片找你拍板，回答后自动续跑。

两种真实模型通道，都不需要项目自带 API Key：

| 模式 | 说明 | 配置 |
|---|---|---|
| `cli`（默认） | spawn 本机**已登录**的命令行 Agent（默认 `codebuddy -p`），凭据算在你自己账号下，与参考项目 `agent-autoloop` 的 worker 语义一致 | `LOOP_WORKER_MODE=cli` |
| `gateway` | 走 OpenAI 兼容 `/chat/completions` | `AI_GATEWAY_API_KEY` / `AI_GATEWAY_BASE_URL` |
| `off` | 停自动执行（仍可手动「立即执行」） | `LOOP_WORKER_MODE=off` |

常用环境变量（均可写在 `frontend/.env`，该文件被 `.gitignore` 忽略）：

```
LOOP_WORKER_MODE=cli                    # cli | gateway | off
LOOP_WORKER_BIN=codebuddy              # 或 CLI 绝对路径
LOOP_WORKER_INTERVAL_MS=15000           # 自动轮询间隔
LOOP_WORKER_TIMEOUT_MS=120000           # 单轮 Agent 超时
LOOP_WORKER_MAX_PER_TICK=1              # 每轮最多执行几个轮次
LOOP_WORKER_AUTO=1                     # 0 = 关自动轮询
LOOP_WORKER_DISABLE=1                  # 完全不加载执行器
```

执行器 API：`GET /api/loop/worker/status`（在线状态 / 累计执行 / 最近一轮）、
`POST /api/loop/worker/run`（立即跑一轮）、`POST /api/loop/worker/config`
（切模式 / 自动开关，仅放行 `mode`、`maxPerTick`、`auto` 三个字段）。
总览页「Agent 执行器」面板可直接操作和查看。

**安全边界**（对齐参考项目「指令数据分离」）：事件正文只写进隔离目录的 `context.json`，
提示词里只出现校验过的类型 / 编号 / 文件路径；CLI 以 `--tools Read` 只读、`--strict-mcp-config`
隔离运行，禁止写文件、执行命令、联网；模型输出经严格白名单归一化后才写入事实日志。
执行记录存独立 key，不侵入可重放的事实日志。

> 注意：AI Copilot 侧栏由 `LOCAL_AI_MOCK` 控制（模拟流），与 Autoloop 执行器是两条独立链路；
> 执行器走真实 CLI Agent，不受该开关影响。

---

## API 契约（当前仍全部可用）

```
POST /api/auth/register   POST /api/auth/login   POST /api/auth/logout   GET /api/auth/me
GET  /api/workflows       POST /api/workflows
GET  /api/workflows/:id   PATCH /api/workflows/:id   DELETE /api/workflows/:id
GET  /api/traces          POST /api/traces
GET  /api/skills          GET /api/contracts   GET /api/devices
GET  /api/usage           GET /api/audit       GET /api/health
GET  /api/loop/healthz     GET  /api/loop/state      GET  /api/loop/facts
GET  /api/loop/runs        GET  /api/loop/cards       GET  /api/loop/rules
POST /api/loop/events      POST /api/loop/emit        POST /api/loop/tick
POST /api/loop/rules       POST /api/loop/rules/check
POST /api/loop/runs/:id/claim    POST /api/loop/runs/:id/result
POST /api/loop/cards/:id/answer  POST /api/loop/cards/:id/resolve
GET  /api/loop/worker/status     POST /api/loop/worker/run    POST /api/loop/worker/config
POST /api/ai/copilot      ← SSE 流式
```

统一信封 `{ ok:true, data:T } | { ok:false, error:{ code, message } }`；
鉴权请求顺序固定为 `鉴权 → 校验 → 配额 → 业务 → 审计`。

## 架构

```
frontend/   Next.js 16（App Router）+ React 19 + Tailwind v4 + SWR
backend/    无框架 REST（Node 标准库 HTTP）+ 本地 JSON 持久化
shared/     前后端共享类型契约
scripts/    start-local / build-app / build-deploy / capture-screenshots
docs/       01–07 工程文档 + 08 补充需求（脑暴稿）
```

三个可替换抽象层（存储 `StoreDriver`、配置 `Env`、运行时 `handleRequest(ApiCtx)`）
使业务代码零平台依赖，详见 [docs/02-架构设计](./docs/02-架构设计.md)。

---

## 后续逐个补充清单

> 每次只补 1 个模块，补完先本地验证，再决定是否同步线上。

- [ ] **架构设计决策面板**（新增，见 [docs/08](./docs/08-架构设计决策面板-补充需求.md) · 本轮先脑暴）
- [ ] 合同（恢复 `.bak` + 导航项）
- [ ] 设备（恢复 `.bak` + 导航项）
- [ ] Agent Lifecycle / Simulation Lab（总览页恢复渲染）
- [ ] AI Copilot 侧栏（AppShell 恢复引用）
- [ ] 列表分页 / Trace 回放 / 团队协作（远期）

## 文档

| 文档 | 状态 |
|---|---|
| [01 需求拆解](./docs/01-需求拆解与需求文档.md) · [02 架构设计](./docs/02-架构设计.md) · [03 方案设计](./docs/03-方案设计.md) | 历史设计，仍可参考 |
| [04 测试报告](./docs/04-测试用例与对比修正报告.md) · [05 架构选型](./docs/05-商业化架构选型与技术方案.md) | 历史记录 |
| [06 部署指南](./docs/06-部署指南.md) · [07 本地部署与去平台化](./docs/07-本地部署与去平台化.md) | 部署参考 |
| [08 架构设计决策面板 · 补充需求](./docs/08-架构设计决策面板-补充需求.md) | **待确认（脑暴稿）** |

---

私有项目，仅授权账号内使用。
