# @contritas/llm

## 0.7.2

### Patch Changes

- 0d5ea7c: Phase 6 R2 6.2.9 + 6.2.10：Phase 0 / Phase 3 LLM token usage 接入预算守门，budget-exceeded 三分支落盘。
- 014cc07: Phase 6 R2 6.1.8：cross-validate actor 接入 wrapExternalContent + EXTERNAL_CONTENT_SAFETY_CLAUSE，关掉最后一个未围栏的 prompt-injection 入口。
- ec10345: Phase 6 R2 6.4.8：sse-client.ts 维护 lastEventId 并在重连 URL 上传递，前端真正用上服务端的 SSE 增量回放。
- Updated dependencies [0d5ea7c]
- Updated dependencies [014cc07]
- Updated dependencies [ec10345]
  - @contritas/shared@0.7.2

## 0.7.1

### Patch Changes

- @contritas/shared@0.7.1

## 0.7.0

### Minor Changes

- 79414c1: Phase 6 CD 前置批：
  - BullMQ 短期降级 attempts:1 + completed/failed 状态短路（6.3.4）
  - api/web Dockerfile 加 HEALTHCHECK 指令（6.8.3）
  - Drizzle 自动 migration（首版 migrations + docker-entrypoint.sh + RUN_MIGRATIONS 开关）（6.8.7）
  - 全仓 package.json 版本对齐 0.6.0（6.9.5）
  - GHCR release workflow（多架构 amd64+arm64 + CHANGELOG 段落抽取作 Release notes）（6.9.8）
  - changesets 版本自动化（fixed 共版本 + PR 守卫 + 自动 release PR）（6.9.9）

### Patch Changes

- 7187785: 修 changesets-release.yml: enable the default per-package changelog generator. The action's `version` step always tries to write package-level `CHANGELOG.md` regardless of `createGithubReleases`; setting `"changelog": false` triggers ENOENT. Now per-package CHANGELOGs (English) are auto-generated alongside the hand-maintained root CHANGELOG.md (Chinese, written for end users).
- fecba60: 修 `changesets-release.yml`：禁用 `createGithubReleases`（自带的实现要读 per-package CHANGELOG.md，但本项目配置 `changelog: false` 没生成这些文件，导致 release PR workflow 报 ENOENT）。GitHub Release 由 `release.yml` 在 tag 触发时基于根 CHANGELOG 创建。

  新增 `docs/deployment/release.md`：完整的 CI/CD 集成流程与发布操作文档。

- af50213: `changeset-check.yml`: 跳过 `changeset-release/main` 分支（由 `github-actions[bot]` 开的 release PR）。release PR 按设计会消费所有 changeset，自然没法满足「必须带 changeset」规则——之前这条规则会把 release PR 锁死。
- Updated dependencies [7187785]
- Updated dependencies [79414c1]
- Updated dependencies [fecba60]
- Updated dependencies [af50213]
  - @contritas/shared@0.7.0
