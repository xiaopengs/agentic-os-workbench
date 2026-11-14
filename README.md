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

### 真实 Agent 自动执行器（M7 / M8 双层插件）

事件命中规则后产生的轮次**不需要人工点按钮**：常驻执行器自动领走、调用真实 Agent
执行并回写真回执，拿不准才发卡片找人拍板。

M8 把「怎么跑」和「模型从哪来」拆成两个**正交、可插拔、可自由组合**的插件层：

- **Harness（Agent 运行时）**：谁跑这一轮 agent 循环、用什么 headless 参数、消费哪种模型协议。
- **Provider（模型供应商）**：模型服务来自哪家、提供哪些协议端点、默认模型、要不要 Key。
- **协议**：二者唯一的耦合契约。组合器 `buildExecution()` 校验协议兼容、CLI 是否安装、
  Key 是否配齐；任一不满足就判「不可用」并给出原因，**绝不降级成模拟成功**。

#### Harness 插件（可替换）

| id | 运行时 | 协议 | 本机安装 | 说明 |
|---|---|---|---|---|
| `codebuddy` | CodeBuddy CLI | 平台登录态 | 已预装 | 默认组合，无需 Key，走平台 CLI 登录态 |
| `claude-code` | `claude -p` | Anthropic Messages | `npm i -g @anthropic-ai/claude-code` | `--bare` + `dontAsk` + 只读工具 |
| `codex` | `codex exec` | OpenAI Chat | `npm i -g @openai/codex` | 隔离目录写临时 `config.toml`（`CODEX_HOME`），不污染 `~/.codex` |
| `gemini-cli` | `gemini -p -y` | Google generateContent | `npm i -g @google/gemini-cli` | 需原生协议端点 |
| `http-direct` | HTTP 直连 `/chat/completions` | OpenAI Chat | 无需安装 | **配好任意一家的 Key 就能立刻真跑** |

#### Provider 插件（可替换）

| id | 供应商 | 提供的协议端点 | 需要 Key |
|---|---|---|---|
| `platform` | 平台默认（CLI 登录态） | 平台登录态 | 否 |
| `openrouter` | OpenRouter | OpenAI | 是 |
| `deepseek` | DeepSeek | OpenAI + Anthropic | 是 |
| `kimi` | Kimi / Moonshot | OpenAI + Anthropic | 是 |
| `glm` | GLM / 智谱 Z.ai | OpenAI + Anthropic | 是 |
| `custom` | 自定义兼容网关 | OpenAI / Anthropic / Google（自选） | 可选 |

各家默认端点写在 `backend/lib/loop/providers.ts`，**只是开箱可填的默认值**——供应商随时
可能改路径和模型名，生产使用请在面板「连接设置」里覆盖为官方文档的当前值。

#### 协议兼容矩阵

| Harness | 需要的协议 | 可直接组合的 Provider |
|---|---|---|
| `codebuddy` | 平台登录态 | `platform` |
| `claude-code` | Anthropic | `deepseek` / `kimi` / `glm` / `custom` |
| `codex` | OpenAI | `openrouter` / `deepseek` / `kimi` / `glm` / `custom` |
| `gemini-cli` | Google | `custom`（填 Google 原生协议端点） |
| `http-direct` | OpenAI | `openrouter` / `deepseek` / `kimi` / `glm` / `custom` |

例如 `claude-code × deepseek` 会自动注入 `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`
+ `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_MODEL`；`http-direct × glm` 只需填 GLM 的 Key，不用装任何 CLI。
**当前线上默认仍是 `codebuddy × platform`**（唯一已验证、无需任何 Key 的组合）；其余组合的
CLI 未安装 / Key 未配置，面板会如实标「未安装 / 不可用」，不会假装在线。

#### 配置

面板「Agent 执行器」里两个下拉分别选 Harness / Provider，「连接设置」填 API Key /
Base URL / 模型 ID / 协议（仅自定义网关需要）。Key 只提交、不回显、不入库，独立存服务端 KV；
切换供应商会自动清空旧 Key，避免误发到别家端点。

部署方可用环境变量设默认组合（写在 `frontend/.env`，被 `.gitignore` 忽略）：

```
LOOP_WORKER_HARNESS=codebuddy          # harness id
LOOP_WORKER_PROVIDER=platform          # provider id
LOOP_WORKER_BASE_URL=                  # 覆盖供应商默认端点
LOOP_WORKER_MODEL=                     # 显式模型 ID；留空 = 注册表 / 平台默认档
LOOP_WORKER_MODE=cli                   # 兼容别名：cli | gateway | off（仅 off 有执行语义）
LOOP_WORKER_BIN=codebuddy
LOOP_WORKER_INTERVAL_MS=15000
LOOP_WORKER_TIMEOUT_MS=120000
LOOP_WORKER_MAX_PER_TICK=1
LOOP_WORKER_AUTO=1
# 也可把 Key 放部署环境，省去在面板填写：
# OPENROUTER_API_KEY= / DEEPSEEK_API_KEY= / MOONSHOT_API_KEY= / ZHIPU_API_KEY=
# 旧 gateway 配置的 AI_GATEWAY_API_KEY / AI_GATEWAY_BASE_URL / AI_GATEWAY_MODEL 仍兼容
```

`bin` / `timeoutMs` / `intervalMs` 由**部署方管控**（防指向任意程序、把轮询打到 1ms）；
`harness` / `provider` / `protocol` / `baseUrl` / `model` / `apiKey` / `auto` / `mode` 可在面板配置。
`LOOP_WORKER_MODE=gateway` 会自动派生为 `http-direct × custom` 并沿用 `AI_GATEWAY_*`，老部署零改动。

执行器 API：

- `GET /api/loop/worker/status` — 在线状态、当前组合、模型、累计执行、最近一轮
- `GET /api/loop/worker/capabilities` — 两层插件清单 + 本机真实安装状态 + 各家 Key 配置状态
- `POST /api/loop/worker/run` — 立即跑一轮
- `POST /api/loop/worker/config` — 选组合 / 填连接 / 开关

**模型到底用的哪个**：`status.model` 与每轮 `job.model` 都返回实际模型，`null` = 平台默认档
（本环境实测 `hy4free`）。**模型是真的**，但 `codebuddy` 的入口是平台 CLI 登录态、不是项目
自建 API 通道；要用自己账号的模型，选 `http-direct`（或装好对应 CLI）再配 Provider 的 Key。

**安全边界**：CLI 通道下事件正文只写隔离目录 `context.json`，提示词里只出现校验过的结构字段
与文件路径；`http-direct` 没有文件读取工具，执行器会把同一份资料原样内联成明确标注的
「不可信数据块」交给模型——指令在前、事件正文只在数据块里且声明一律无视，指令数据分离边界不变。
每个 CLI harness 收敛为只读工具、禁 MCP / 插件 / 会话持久化，第三方 CLI 给「干净环境」不带平台凭据；
模型输出经白名单归一化后才写入事实日志；Key 不回显、不落日志、不进事实日志；执行记录存独立 key。

#### 实战：用 OpenRouter 免费档真跑（无需安装任何 CLI）

选 `http-direct × openrouter`，在「连接设置」填 Key 与模型 ID：

```
harness  = http-direct
provider = openrouter
baseUrl  = https://openrouter.ai/api/v1        # 注册表默认值，可留空
model    = nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
apiKey   = <你的 OpenRouter Key>
```

- 免费档以 `https://openrouter.ai/api/v1/models` 当前列表为准（`pricing.prompt` 与
  `pricing.completion` 均为 `0`）。**部分免费模型会被上游限流（429）**，例如 Google Gemma 4
  免费档实测不可用，所以显式锁定实测可用的免费模型，而不用 `openrouter/free` 自动路由。
- 注册表中 `openrouter` 的默认模型就是免费档，开箱即用不会产生账单；要换付费模型在面板覆盖。
- `http-direct` 无 `Read` 工具，资料由 `httpPromptWithContext()` 内联为不可信数据块，模型才看得到事件正文。
- Key 只存服务端 KV（`.data/` 已被 `.gitignore` 忽略），只回显 `hasKey`，可在面板清除；
  也可改用部署环境变量 `OPENROUTER_API_KEY`，省去在面板填写。

> 注意：AI Copilot 侧栏由 `LOCAL_AI_MOCK` 控制（模拟流），与 Autoloop 执行器是两条独立链路；
> 执行器走真实 Agent，不受该开关影响。

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
