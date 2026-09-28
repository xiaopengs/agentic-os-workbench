# Agentic OS Workbench · Frontend

Next.js 16（App Router）+ TypeScript + Tailwind CSS v4 + SWR。
视觉 1:1 迁移自 `../workbench.html`，数据源全部改为后端 REST API（同域 `/api/*`）。

## 快速开始

```bash
npm install
cp .env.example .env.local   # 可选，默认 NEXT_PUBLIC_API_BASE=/api
npm run dev                  # http://127.0.0.1:3000
```

> ⚠️ 预览请使用 `127.0.0.1`，不要用 `localhost`。
> `next.config.ts` 中的 `allowedDevOrigins: ['127.0.0.1']` 是必需的——Next 16 dev server 默认只信任
> `localhost`，会把 `127.0.0.1` 视作跨源拦截 HMR WebSocket，导致 hydration 失败、页面全部交互失效。

## 页面清单

| 路由 | 说明 |
|---|---|
| `/login` | 登录页（HttpOnly Cookie 会话） |
| `/register` | 注册页（校验两次密码一致性） |
| `/` | **总览 Dashboard** — 完整还原：KPI 卡 / Agent Lifecycle 六节点流水线 / Simulation Lab / Live Trace / Recent Workflows / AI Copilot 抽屉 / Attention / Next Step / Trusted Release Canary |
| `/workflows` | 工作流列表（搜索、状态切换、删除、新建） |
| `/skills` | 技能注册表 |
| `/contracts` | 合同注册表 |
| `/devices` | 设备集群 |
| `/settings` | 账号 · 配额用量 · 审计日志 · 登出 |

未登录访问工作台路由会自动重定向至 `/login`；顶栏展示当前账号邮箱、计划徽标与登出入口。
登出会清空 token、SWR 全量缓存以及 `agentic_os_*` 本地持久化键。

## 目录结构

```
frontend/
├── app/
│   ├── layout.tsx              # Root layout：IconSprite + Providers
│   ├── providers.tsx           # AuthProvider + ToastHost
│   ├── login/ · register/      # 鉴权页
│   └── (workbench)/            # 工作台路由组（AppShell 统一套壳）
├── components/
│   ├── icons/                  # 40 个 SVG symbol（1:1 迁移）+ <Icon />
│   ├── layout/                 # TopNav / SideNav / AppShell
│   ├── dashboard/              # KpiGrid / LifecycleCard / SimulationLab / LiveTrace / RecentWorkflows
│   ├── aside/                  # 右侧栏（Copilot / Attention / Next Step / Trusted Release）
│   ├── modals/                 # Modal / CopilotModal / WorkflowFormModal
│   └── ui/                     # PageHeader / Toast / WorkflowBits
├── lib/
│   ├── api-client.ts           # 统一 ApiResp<T> 拆包、401/402/404 处理
│   ├── hooks.ts                # SWR hooks + useWorkbench 聚合 + 缓存失效
│   ├── auth.tsx                # AuthProvider / useRequireAuth
│   ├── simulation.ts           # Simulation Lab 表现层
│   ├── format.ts               # 时钟 / 相对时间 / 周环比 / P95
│   ├── nav.ts · toast-bus.ts · types.ts
└── styles/
    ├── tokens.css              # Design Tokens（原样迁移）
    └── app.css                 # 组件样式（原样迁移 + 商业化新增）
```

## Design Tokens 迁移方式

- `styles/tokens.css` 逐条迁移原型 `:root` 的全部 CSS 变量（配色、圆角、字体族、阴影），**取值零改动**。
- `styles/app.css` 保留原型全部类名与规则，含**五个响应式断点**（1360 / 1180 / 900 / 520px）原样复制。
- 原型外的商业化新增（鉴权页、列表表格、配额条、骨架屏、用户菜单）追加在文件末尾独立小节，不改动任何原型规则。
- `app/globals.css` 按 `tailwindcss → tokens → app` 顺序 `@import`；Tailwind v4 只提供 preflight 与构建期能力，
  组件样式由迁移的语义类承担，因此输出与原型的 class 语义完全一致。

## API 接入点

| 页面 / 组件 | 端点 | SWR 策略 |
|---|---|---|
| AuthProvider | `GET /api/auth/me` | 挂载时探测，静默失败 |
| 登录 / 注册 | `POST /api/auth/login` `/register` | 提交后写入会话 |
| 顶栏登出 / 设置页 | `POST /api/auth/logout` | 清缓存后跳 `/login` |
| KPI / Lifecycle / Simulation | `GET /api/workflows` `/skills` `/contracts` `/traces` | 由真实数据聚合推导 |
| Live Trace | `GET /api/traces` | 5s 轮询（写入 `POST /api/traces` 由后端产生） |
| Recent Workflows / 工作流页 | `GET/POST/PATCH/DELETE /api/workflows` | 15s 轮询 + 写后失效 |
| 技能页 | `GET /api/skills` | 60s |
| 合同页 | `GET /api/contracts` | 60s |
| 设备页 | `GET /api/devices` | 60s（契约未定义，失败降级空态） |
| 设置页 · 配额 | `GET /api/usage` | 60s，超额返回 402 时 toast 提示 |
| 设置页 · 审计 | `GET /api/audit` | 30s |
| AI Copilot 抽屉 | `POST /api/ai/copilot` | SSE 流式，自动兼容整包 JSON |

`lib/api-client.ts` 统一处理：`ApiResp<T>` 拆包（同时兼容裸数据响应）、401 清会话跳登录、
402 配额耗尽提示、404/5xx toast、网络异常兜底。

## 与原型的一致性说明

- **像素级一致**：配色、字号、间距、圆角、阴影、动画（`pagein`/`fadein`/`blink`/`spin`/`skel`）、
  五个响应式断点、全部 40 个 SVG 图标、卡片栅格与右侧栏结构。
- **有意的差异**（商业化所需，不影响视觉）：
  1. 所有数据由真实 API 驱动，原型中的三个定时器（假 Trace / 假进度 / 假时钟漂移）已移除；
  2. KPI 数值与「较上周」环比由真实数据计算，无历史数据时显示「— 持平」；
  3. `Agent Lifecycle` 节点标签、`Next Step` 四步状态、`Canary` 比例由真实进度推导；
  4. `Memory / NPU / Power` 三项端侧遥测无后端来源，保留本地动画基线，趋势值改为真实采样差；
      `P95` 改为真实 Trace 耗时 95 分位，并对比前后半段给出趋势。
- 原型 `workbench.html` 保留在仓库根目录作为视觉基准，未做改动。

## 校验

```bash
npx tsc --noEmit      # 类型检查：通过
npm run build         # Next 16 生产构建：通过（9 条路由全部预渲染）
```