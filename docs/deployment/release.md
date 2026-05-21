# 发布流程

> Contritas 的 CI/CD 集成 ——「PR → 自动 release PR → 自动构建发版」的端到端说明。

## 一、整体流程图

```
你开 PR
   │
   ├── ci.yml ─────────────────► typecheck + test + build + docker smoke
   └── changeset-check.yml ────► 校验是否带 changeset
                  │
                  ▼ (两个都绿)
              你手动 merge PR
                  │
                  ▼
       changesets-release.yml 触发 (push to main)
                  │
                  ▼
       自动开/更新一个 "chore: release" PR
       (bump 所有 package.json 版本,
        消费掉 .changeset/*.md,
        各 package CHANGELOG 自动追加)
                  │
                  ▼ 你 review 后 merge 这个 release PR
                  │
                  ▼
       changesets/action 推 git tag v0.x.y
                  │
                  ▼
           release.yml 触发 (tag v*.*.*)
                  │
                  ├── 多架构构建 amd64+arm64
                  ├── push ghcr.io/xgyyx/contritas-{api,web}:0.x.y
                  ├── push :latest
                  ├── 从 CHANGELOG 抽 0.x.y 段落
                  └── 创建 GitHub Release "v0.x.y"
                  │
                  ▼
            可以 docker pull 了
```

每一步都是**人工操作触发自动化**：merge 普通 PR、merge release PR，最多两次点击。

---

## 二、四个 workflow 各管什么

| 文件 | 触发 | 干啥 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | PR + push to main | 守门员：跑测试、构建、Docker smoke build（不 push） |
| `.github/workflows/changeset-check.yml` | PR | 守门员：PR 必须带 changeset，文档/CI 类 PR 用 `pnpm changeset --empty` 跳过 |
| `.github/workflows/changesets-release.yml` | push to main | 收割机：把 `.changeset/*.md` 消费成版本号变更，开/更新 `chore: release` PR |
| `.github/workflows/release.yml` | tag `v*.*.*` | 出版工：多架构构建 + push GHCR + 创建 GitHub Release |

---

## 三、日常 PR 流程（开发者视角）

```bash
git checkout -b feat/something
# ... 改文件 ...

# 必做：加 changeset
pnpm changeset
# 交互式问 3 个问题:
# 1. 哪些 package 要 bump?     → 空格全选 6 个 @contritas/* + 回车
# 2. major / minor / patch?     → feat/fix → minor or patch; breaking → major
# 3. 写一行说明                 → 用户视角的「这版本做了什么」

git add -A
git commit -m "feat(scope): xxx"
git push -u origin feat/something
gh pr create --fill
```

### 何时加 changeset

| PR 类型 | 是否需要 changeset |
| --- | --- |
| 新功能 / 修复 / 重构 / 依赖升级 | ✅ 需要（patch / minor / major） |
| 纯文档（`docs/**`、根目录 `*.md`）、CI 配置、内部样式 | ❌ 用 `pnpm changeset --empty` 跳过版本变更 |

### 在 PR 上看 CI 状态

```bash
gh pr checks <pr-number>          # 一次性看所有 check
gh pr checks <pr-number> --watch  # 阻塞等到全部完成
```

### Merge

```bash
gh pr merge <pr-number> --squash --delete-branch
```

`--squash`：把 PR 内所有 commit 合并成 1 个进 main（推荐，避免噪音）。`--rebase` / `--merge` 按团队风格选。

---

## 四、Release PR 流程（维护者视角）

merge 普通 PR 后，**几秒内**：

1. `changesets-release.yml` 触发
2. ~30 秒后，Pull Requests 列表出现新 PR：**`chore: release`**
3. 这个 PR 里：
   - 所有 `package.json` `version` 自动 bump（取所有 changeset 中最高级别）
   - `.changeset/*.md`（除 README/config）被删除
   - 各 package 的 `CHANGELOG.md` 自动追加新段落

### 你要做的

1. **Review release PR**：检查版本号 bump 是否符合预期（patch / minor / major）。
2. **同步根 `CHANGELOG.md`**（可选但推荐）：当前根 CHANGELOG 仍按 keepachangelog 中文风格手动维护，把 release PR 里 package CHANGELOG 的英文条目整理一段中文追加到根 CHANGELOG `## [Unreleased]` 下面，commit 进 release PR 分支。
3. **Merge release PR**：

```bash
gh pr merge <release-pr-number> --squash --delete-branch
```

merge 后 `changesets/action` 会自动 push git tag `v0.x.y` 到 origin。

---

## 五、自动发版（tag 触发）

git tag push 后**立刻**触发 `release.yml`：

| 步骤 | 大约耗时 |
| --- | --- |
| QEMU + buildx 初始化 | 30s |
| GHCR login | 5s |
| Build & push api 镜像（amd64 + arm64） | 5-8 min |
| Build & push web 镜像（amd64 + arm64） | 5-8 min |
| 从 CHANGELOG 抽段落 | 2s |
| 创建 GitHub Release | 5s |
| **合计** | **10-20 min** |

### 监控

```bash
gh run list --workflow=release.yml --limit 1
gh run watch                       # 选最新的 run 阻塞看
```

### 发版后验收

1. **GHCR 镜像**：
   ```bash
   docker pull ghcr.io/xgyyx/contritas-api:0.x.y
   docker pull ghcr.io/xgyyx/contritas-web:0.x.y
   ```
   - 首次 push 镜像后默认 private。如需公开，到 `https://github.com/users/xgyyx/packages/container/contritas-api/settings` → Change visibility → Public。同样操作 `contritas-web`。

2. **GitHub Release 页面**：`https://github.com/xgyyx/contritas/releases` 应出现 `v0.x.y` 条目，body 就是 CHANGELOG 对应段落。

3. **Tag**：`git fetch --tags && git tag | grep v0.x.y` 应能看到。

---

## 六、一次性配置（仓库 Settings）

发布前必须配好，否则 `release.yml` 会失败：

| 位置 | 名字 | 作用 | 示例值 |
| --- | --- | --- | --- |
| Settings → Secrets and variables → Actions → **Variables** | `RELEASE_NEXT_PUBLIC_API_URL` | 构建 web 镜像时烤进 JS bundle 的 API URL | `https://api.contritas.local`（占位也行，部署时重 build） |
| Settings → Secrets and variables → Actions → **Secrets** | `RELEASE_NEXT_PUBLIC_API_TOKEN` | web 镜像内置的 token；部署 api 时 `API_AUTH_TOKEN` 必须包含此值 | `openssl rand -hex 32` |
| Settings → Actions → General → **Workflow permissions** | — | 让 workflow 能创建 release / 推 commit | ☑️ Read and write |
| Settings → Actions → General → **Allow GitHub Actions to create and approve pull requests** | — | 让 `changesets-release.yml` 能开 release PR | ☑️ 勾上 |

**注意**：`Variables` 和 `Secrets` 都选 **Repository** 级别（不是 Environment）。当前 workflow 没声明 `environment:` 字段，读不到 Environment 级别的。

---

## 七、常见场景

### 跳过版本变更（文档/CI PR）

```bash
pnpm changeset --empty
git add .changeset/*.md && git commit -m "chore: empty changeset"
```

### 我已经 merge PR 但忘了带 changeset

`changeset-check.yml` 会拦在 PR 上，merge 不进去。如果是 force-push 或绕过保护合进去了，下一次 release PR 不会包含你这次的变更说明，但代码已经在 main 里 —— 在下一个 PR 里补一个 changeset，描述里说明「补 #xxx」即可。

### 我想发 0.x.y 但 release.yml 失败

1. `gh run list --workflow=release.yml` 找到失败的 run
2. `gh run view <run-id>` 看 log
3. 修问题后：
   - 如果只是 workflow 本身的 bug：fix workflow，commit 进 main，重新 push 同一个 tag：`git tag -d v0.x.y && git push origin :v0.x.y && git tag v0.x.y && git push origin v0.x.y`
   - 如果是构建环境问题：去 Actions 页面手动 re-run failed jobs

### 我要紧急回滚发布的镜像

```bash
# GHCR 镜像不可删（除非整个 package 设 private）
# 但可以发新版本覆盖 latest tag:
git tag v0.x.y+1
git push origin v0.x.y+1
# 部署端 docker pull ghcr.io/xgyyx/contritas-api:latest 会拿到新版本
# 或者直接 pin 到上一个安全版本: docker pull ghcr.io/xgyyx/contritas-api:0.x.y-1
```

### 我要本地试跑 release.yml

不能完整本地跑（需要 GHCR push 权限），但可以验证关键脚本：

```bash
node scripts/extract-changelog.mjs 0.6.0    # 验证 CHANGELOG 抽取
docker buildx build --platform linux/amd64,linux/arm64 \
  -f apps/api/Dockerfile -t test/api:dev .  # 验证多架构 build
```

---

## 八、消费 GHCR 镜像（部署方视角）

### 私有镜像拉取

```bash
# 创建 GitHub Personal Access Token (classic), 勾 read:packages
echo $GITHUB_PAT | docker login ghcr.io -u <username> --password-stdin
docker pull ghcr.io/xgyyx/contritas-api:0.6.0
```

公开后则无需 login。

### 切换 compose 到 GHCR 镜像

把 `docker-compose.prod.yml` 中 api / worker / web 的 `build` 块替换为：

```yaml
api:
  image: ghcr.io/xgyyx/contritas-api:0.6.0   # 锁版本,不要用 latest
  # ... 其余 environment / depends_on / healthcheck 不变

worker:
  image: ghcr.io/xgyyx/contritas-api:0.6.0   # worker 复用 api 镜像
  command: ["node", "dist/worker.js"]
  # ...

web:
  image: ghcr.io/xgyyx/contritas-web:0.6.0
  # ...
```

升级版本：改 tag → `docker compose pull && docker compose up -d`。

### Tag 策略

| Tag | 含义 | 建议 |
| --- | --- | --- |
| `<version>` 如 `0.6.0` | 不可变 immutable，对应一次 release | **生产环境锁版本用** |
| `latest` | 最新一次 release | 仅本地试用；生产环境**不要**用 |

### `NEXT_PUBLIC_API_URL` 与部署目标不匹配怎么办

`NEXT_PUBLIC_*` 是构建时烤进 JS bundle 的常量。如果你的部署目标 API 地址与 release 时 `RELEASE_NEXT_PUBLIC_API_URL` 配置的不同，三个选择：

1. **重 build web 镜像**：在部署机上 `docker build` 自定义 `NEXT_PUBLIC_API_URL`（最干净）。
2. **反代**：部署一层 nginx，把 bundled URL 反向代理到真实 API。
3. **改 release 配置 + 重发版**：把 `RELEASE_NEXT_PUBLIC_API_URL` 改成最终 URL → 推一个新 tag。

未来如果需要 deploy-time runtime 注入（同一镜像支持多个域名），需要把这套切到 next runtime config，不在当前架构内。

---

## 九、相关文件

| 文件 | 用途 |
| --- | --- |
| `.changeset/config.json` | changesets 配置：`fixed` 共版本、`changelog: false` |
| `.changeset/README.md` | changesets 自带的工具说明 |
| `.changeset/*.md` | 单次变更说明（PR 必带，merge release PR 时被消费删除） |
| `.github/workflows/ci.yml` | PR 守门 |
| `.github/workflows/changeset-check.yml` | PR 必须带 changeset |
| `.github/workflows/changesets-release.yml` | 自动开 release PR |
| `.github/workflows/release.yml` | tag 触发的真正发版 |
| `scripts/extract-changelog.mjs` | 从根 CHANGELOG 抽某版本段落作 GitHub Release notes |
| `CHANGELOG.md` | 根 changelog，手动维护中文版（与 package 级 changelog 并存） |
| `CONTRIBUTING.md` | 贡献指南，含 Changesets 章节 |
| `docs/deployment/docker.md` | 部署细节（环境变量、compose、健康检查、迁移） |

---

## 十、为什么这套设计

1. **版本号不漂移**：`package.json` 与 CHANGELOG 由工具同步 bump，杜绝 0.1.0 vs 0.6.0 的历史问题。
2. **强制写发布说明**：忘了带 changeset 直接 CI 红，强制开发者在 PR 里就把「这次发什么」想清楚。
3. **多人协作不打架**：每个 PR 独立 changeset 文件，merge 顺序无关；release PR 一次性聚合所有未发布的。
4. **回滚清晰**：每个 release 都有 git tag + GitHub Release + 不可变镜像 tag，定位某版本只看 tag。
5. **部署目标无关**：发布产物是 OCI 镜像，VPS / K8s / PaaS / 云容器都能 `docker pull` 后直接用，CD 编排器是部署方的选择，不绑定 GitHub Actions。
