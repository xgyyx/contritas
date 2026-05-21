# @contritas/api

## 0.7.1

### Patch Changes

- d9cbfa9: Fix release pipeline so merging a release PR actually publishes images to GHCR.

  The previous setup never produced a git tag — `pnpm changeset tag` is a
  no-op when all packages are private with `privatePackages.tag: false`,
  and the default `GITHUB_TOKEN` cannot trigger downstream workflows
  even when tags are pushed. As a result, v0.6.0's release PR merged
  silently and `release.yml` never ran.

  `changesets-release.yml` now uses a fine-grained PAT (`RELEASE_PAT`,
  Contents+PRs RW on this repo) and pushes a single repo-wide `vX.Y.Z`
  tag derived from the root `package.json` version on the post-merge
  run. This first proper release exercises that path end-to-end.

- dea95c0: `changesets-release.yml`: read the release version from
  `apps/api/package.json` instead of the root `package.json`. `changeset
version` bumps workspace packages but does not touch the root, so the
  old code would have pushed a stale tag (e.g. `v0.6.0` after a 0.7.x
  bump). The `fixed` group keeps the six workspace packages on the same
  version, so reading any one of them is correct; `apps/api` is the
  natural source of truth.
  - @contritas/shared@0.7.1
  - @contritas/llm@0.7.1
  - @contritas/search@0.7.1
  - @contritas/workflow@0.7.1

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
  - @contritas/llm@0.7.0
  - @contritas/search@0.7.0
  - @contritas/workflow@0.7.0
