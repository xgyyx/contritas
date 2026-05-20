# 贡献指南

感谢你对 Contritas 的贡献！以下是参与开发的规范和流程。

## 开发环境搭建

### 前置条件

- Node.js >= 22
- pnpm >= 9
- Docker & Docker Compose

### 安装

```bash
# 克隆仓库
git clone <repo-url> && cd contritas

# 安装依赖
pnpm install

# 启动基础设施（PostgreSQL + Redis）
docker compose up -d

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入必需的 API Key

# 推送数据库 schema
cd apps/api && pnpm db:push
```

### 启动开发

```bash
# 终端 1：前端
cd apps/web && pnpm dev

# 终端 2：API
cd apps/api && pnpm dev

# 终端 3：Worker
cd apps/api && pnpm worker
```

## 分支规范

| 分支类型 | 命名格式 | 示例 |
|----------|----------|------|
| 功能开发 | `feat/<简短描述>` | `feat/dark-mode` |
| Bug 修复 | `fix/<简短描述>` | `fix/sse-reconnect` |
| 文档更新 | `docs/<简短描述>` | `docs/api-reference` |
| 重构 | `refactor/<简短描述>` | `refactor/search-cache` |

从 `main` 分支创建，完成后通过 PR 合并回 `main`。

## Commit Message 约定

遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<type>(<scope>): <description>

[optional body]
```

### Type

| Type | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档变更 |
| `refactor` | 重构（不改变行为） |
| `test` | 添加/修改测试 |
| `chore` | 构建/工具/依赖变更 |

### Scope（可选）

使用 package 名：`shared`、`llm`、`search`、`workflow`、`api`、`web`

### 示例

```
feat(web): add dark mode toggle
fix(search): handle Tavily timeout gracefully
docs: update API endpoint reference
refactor(workflow): extract retry logic to shared utility
```

## Pull Request 流程

1. 提交前本地跑一遍：
   ```bash
   pnpm turbo typecheck
   pnpm turbo test
   ```

2. PR 标题遵循 commit message 格式

3. PR 描述包含：
   - 变更概述（做了什么、为什么）
   - 测试方式
   - 截图（如涉及 UI 变更）

4. 等待 CI 全绿 + Review 通过后合并

## CI 自动检查

每次 push 到 `main` 或开 PR，[GitHub Actions](https://github.com/xgyyx/contritas/actions/workflows/ci.yml) 会跑 `.github/workflows/ci.yml` 里定义的两个 job：

| Job | 内容 | 失败的常见原因 |
| --- | --- | --- |
| `lint-test-build` | `pnpm install --frozen-lockfile` → `turbo typecheck` → `turbo test` → `turbo build` | 类型错误；vitest 失败；`pnpm-lock.yaml` 漂移 |
| `docker-build` | 构建 `apps/api/Dockerfile` 与 `apps/web/Dockerfile`（不推送） | Dockerfile 改动后多阶段构建坏掉 |

CI 用一组 dummy env（`API_AUTH_TOKEN=dummy-ci-token` 等）启动测试，所以本地能跑通 `pnpm turbo typecheck test build` 基本就能过 CI。如果 CI 挂了，去 Actions 页面点进 run 看具体 step 日志。

> **注意**：改 `pnpm-lock.yaml`、`turbo.json`、`tsconfig.base.json` 或任意 `Dockerfile` 时，更容易踩到 CI 才暴露的问题——务必本地先跑一遍上面四步。

## 代码风格

- TypeScript strict mode，所有 package 均为 ESM（`"type": "module"`）
- 实体 ID 使用 ULID（`@contritas/shared` 中的 `generateId()`）
- API 请求/响应通过 Zod schema 校验
- 文件组织：
  - 类型定义放 `types.ts` 或 `types/` 目录
  - 测试文件放 `__tests__/` 目录
  - 使用 Vitest 作为测试框架

## 项目结构

```
packages/shared   → 被所有其他 package 依赖
packages/llm     → 依赖 shared
packages/search  → 依赖 shared, llm
packages/workflow → 依赖 shared, llm, search
apps/api         → 依赖所有 package
apps/web         → 依赖 shared
```

修改 `shared` 中的类型时，注意检查上游所有依赖方的兼容性。
