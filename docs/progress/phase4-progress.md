# Phase 4：前端 — 完成进度

> 状态：✅ 已完成

## 交付物

### 1. Next.js 应用搭建 ✅

- Next.js 14.2 + App Router
- shadcn/ui + Tailwind CSS 组件库
- Zustand 状态管理
- TypeScript strict mode
- `@contritas/shared` workspace 共享类型
- Turbo pipeline 集成

### 2. 输入页面 + 实时进度面板 ✅

**输入页面** (`/`)：
- 命题输入（Textarea, 10-2000 字符验证）
- 语言切换（中文/English）
- 提交后自动跳转到研究页面

**进度面板** (`/research/[id]`)：
- SSE 实时连接（指数退避重连）
- 6 阶段时间线（带图标状态指示）
- 维度进度卡片（轮次 + 来源数）
- 搜索日志（实时滚动）
- 证据采集流（可信度标签）
- ETA 倒计时
- Token 用量统计
- 错误横幅（可恢复/不可恢复）
- 追问弹窗（`clarification` 事件触发）
- 取消按钮（二次确认）
- 连接状态指示器

### 3. 报告查看器 ✅

- react-markdown + remark-gfm 渲染
- 自定义 heading 渲染器（ID 锚点）
- 粘性侧边栏 TOC（IntersectionObserver 追踪）
- 报告头部：评分、结论徽章、字数、来源数
- 响应式布局（桌面双栏，移动端隐藏 TOC）

### 4. 历史列表 ✅

- localStorage 持久化 session ID
- 批量刷新状态（Promise.allSettled）
- 状态筛选（全部/进行中/已完成/失败/已取消）
- 空状态引导

### 5. 迭代/深挖交互 ✅

- 报告底部迭代操作面板
- 深挖已有维度
- 新增研究维度
- 创建 child session 后自动跳转

## 技术架构

```
src/
├── app/              3 个路由页面
├── components/
│   ├── ui/           shadcn/ui 原子组件 (10 个)
│   ├── layout/       Header
│   ├── research/     进度面板组件 (10 个)
│   ├── report/       报告查看组件 (6 个)
│   └── history/      历史列表组件 (2 个)
├── hooks/            2 个 React hooks (SSE + polling)
├── lib/              API 客户端 + SSE 客户端 + 常量
├── stores/           2 个 Zustand store
└── types/            类型重导出
```

## 开发命令

```bash
# 启动前端
cd apps/web && pnpm dev

# 类型检查
cd apps/web && pnpm typecheck

# 构建
cd apps/web && pnpm build
```

## 环境变量

```
NEXT_PUBLIC_API_URL=http://localhost:4000
```
