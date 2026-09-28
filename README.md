# Agentic OS 自动化开发工作台

> 面向「人 + Agent 协作开发」的端到端商业化 SaaS · 前后端分离架构
> Next.js 16 前端 + Cloud Functions 后端 + KV/Blob 持久化 + JWT 鉴权 + AI Copilot 流式对话

---

## 这是什么

一个把 Agent 自动化开发「可见、可控、可交付」的控制中枢。围绕七大核心矛盾（意图模糊 vs 执行精确、上下文膨胀 vs 记忆有限、自由生成 vs 合同约束、单体智能 vs 多智能体协同、模拟环境 vs 真实发布、人机信任鸿沟、迭代速度 vs 质量管控）构建，已具备**真实账号体系、服务端持久化、配额计费、审计日志、AI 流式对话**——不是演示页面。

> 原型阶段产物（单文件 `workbench.html` 与 72 项对比测试）保留在仓库中作为设计基准与视觉参照。

## 架构：前后端分离（方案 A）

源码态关注点分离，部署态构建为自包含单元：

```
源码态                              部署态 dist/（脚本生成）
├── frontend/   Next.js 16          ├── app/ components/ lib/ styles/
├── backend/    Cloud Functions 逻辑 ├── backend/  shared/  agents/
├── shared/     前后端共享契约       ├── cloud-functions/api/[[default]].ts
├── agents/     AI Agent            └── package.json（依赖合并）
└── scripts/build-deploy.mjs
```

**为什么同域统一部署**：零跨域、HttpOnly Cookie 会话天然共享、前后端一次原子生效；契约优先（`shared/types.ts`）意味着将来要拆成物理分离的两套服务，前端只需换 `API_BASE`。详见 [docs/05](docs/05-商业化架构选型与技术方案.md)。

## 核心能力

| 领域 | 实现 |
|---|---|
| 账号体系 | bcrypt 密码哈希 + JWT（jose）+ HttpOnly Cookie，注册/登录/登出/会话保持 |
| 多租户隔离 | 所有业务数据以 `userId` 为前缀，**服务端强制注入**，客户端不可伪造 |
| 持久化 | KV 优先、Blob 回退；禁止内存态（云函数重启不丢数据） |
| 业务资源 | 工作流 CRUD、Trace 写入查询、Skill、Contract、Device |
| 配额计费 | free 100 runs/月、pro 10000 runs/月，超额 402 `QUOTA_EXCEEDED` |
| 审计日志 | 关键写操作全量留痕，可回溯 |
| AI Copilot | SSE 流式对话，走平台 AI Gateway，打字机渲染 + 中断 + 配额专属提示 |
| 前端体验 | 一比一复刻设计稿：Design Tokens、38 个内联 SVG、五断点响应式 |

## 页面

总览 Dashboard（KPI 卡 / Agent Lifecycle 六节点流水线 / Simulation Lab / Live Trace / Recent Workflows / AI Copilot / Attention / Next Step / Canary 灰度）、工作流、技能、合同、设备、设置，以及登录/注册。

## 快速开始

### A. 本地最小化部署（推荐先跑起来，无需任何云平台）

```bash
node scripts/start-local.mjs
```

一条命令启动：后端 API `http://127.0.0.1:8787/api` + 前端 `http://127.0.0.1:3000`。
数据落在 `./.data/store.json`，**无需登录、无需联网、无需 EdgeOne**。详见 [docs/07-本地部署与去平台化.md](docs/07-本地部署与去平台化.md)。

### B. 部署到 EdgeOne Makers

```bash
npm install -g edgeone@latest --registry=https://registry.npmmirror.com
edgeone login --site china --local
node scripts/build-deploy.mjs          # 生成自包含部署单元 dist/
cd dist && npm install
edgeone makers deploy -n <项目名> --json
```

**必配环境变量**：`JWT_SECRET`（缺失会返回 500 `SERVER_MISCONFIG`——故意如此，杜绝硬编码密钥）。
`AI_GATEWAY_API_KEY` / `AI_GATEWAY_BASE_URL` 由平台自动注入。

完整说明见 [docs/06-部署指南.md](docs/06-部署指南.md)。

> 两种形态共用同一套业务代码：平台形态走 `cloud-functions` 的 `onRequest(context)`，
> 本地形态走 `backend/adapter/node.ts`（把 Node `(req,res)` 翻译成同样的 context）。
> 前端只需切换 `NEXT_PUBLIC_API_BASE`。

## API 契约

```
POST /api/auth/register  POST /api/auth/login  POST /api/auth/logout  GET /api/auth/me
GET|POST         /api/workflows        GET|PATCH|DELETE /api/workflows/:id
GET|POST         /api/traces           GET /api/skills  /api/contracts  /api/devices
GET              /api/usage  /api/audit  /health
POST             /api/ai/copilot       ← SSE 流式
```

统一信封：`{ ok: true, data: T } | { ok: false, error: { code, message } }`

## 测试

```bash
# 端到端（需先启动 dev server）
node tests/e2e.mjs
```

16 组断言覆盖：未登录拦截、注册/弱密码/重复注册/无效 token、登录会话、工作流创建→持久化→更新→删除、Trace 写入、用量统计、审计日志、登出失效、运行时零 JS 错误。

## 文档

| 文档 | 内容 |
|---|---|
| [01-需求拆解](docs/01-需求拆解与需求文档.md) | 七大矛盾→能力域映射、FR 规格 |
| [02-架构设计](docs/02-架构设计.md) | 五层架构、模块划分、数据结构 |
| [03-方案设计](docs/03-方案设计.md) | Design Tokens、区域实现规格 |
| [04-测试报告](docs/04-测试用例与对比修正报告.md) | 72 用例对比修正（原型阶段） |
| [05-架构选型](docs/05-商业化架构选型与技术方案.md) | 三方案对比、技术栈、KV 设计、API 契约、商业化矩阵 |
| [06-部署指南](docs/06-部署指南.md) | 构建、环境变量、预览、上线、回滚、故障排查 |

## 路线图

- **已完成**：账号体系、多租户持久化、配额计费、审计、AI Copilot 流式对话、E2E 测试
- **下一步**：订阅支付接入（Pro 升级）、团队协作与角色权限、Trace 回放与回归对比、多设备 Device Farm

---

私有项目，仅授权账号内使用。
