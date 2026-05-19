# @contritas/web

Contritas 前端应用，基于 Next.js 14 App Router 构建。

## 启动

```bash
# 配置 API 地址
cp .env.local.example .env.local

# 启动开发服务器 (port 3000)
pnpm dev
```

## 页面路由

| 路由 | 说明 |
|------|------|
| `/` | 首页 — 命题输入表单 |
| `/research/[id]` | 研究详情 — 实时进度面板或报告查看 |
| `/history` | 历史列表 — 所有研究会话 |

## 组件结构

```
src/components/
├── ui/           # shadcn/ui 原子组件（Button、Card、Dialog 等）
├── layout/       # Header 导航栏
├── research/     # 进度面板组件（10 个）
│   ├── input-form          命题输入
│   ├── progress-panel      进度面板容器
│   ├── phase-timeline      6 阶段时间线
│   ├── dimension-progress  维度进度卡片
│   ├── search-log          搜索日志
│   ├── evidence-feed       证据采集流
│   ├── eta-display         ETA 倒计时
│   ├── session-stats       Token/搜索统计
│   ├── clarification-dialog 追问弹窗
│   └── cancel-button       取消按钮
├── report/       # 报告查看组件（6 个）
│   ├── report-viewer       报告布局容器
│   ├── report-header       评分/结论头
│   ├── report-toc          侧边栏目录
│   ├── report-content      内容区
│   ├── markdown-renderer   Markdown 渲染
│   └── iterate-panel       迭代交互面板
└── history/      # 历史列表组件
    ├── session-list        列表容器
    └── session-card        会话卡片
```

## 技术栈

- **框架**: Next.js 14 (App Router, RSC)
- **样式**: Tailwind CSS + shadcn/ui
- **状态**: Zustand（research-store + history-store）
- **实时通信**: SSE (EventSource) + REST 轮询降级
- **Markdown**: react-markdown + remark-gfm
- **类型**: 全部来自 `@contritas/shared`

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | API 服务地址 |

## 开发

```bash
pnpm typecheck   # 类型检查
pnpm build       # 生产构建
pnpm lint        # ESLint 检查
```
