---
"@contritas/shared": patch
"@contritas/llm": patch
"@contritas/search": patch
"@contritas/workflow": patch
"@contritas/api": patch
"@contritas/web": patch
---

修 `changesets-release.yml`：禁用 `createGithubReleases`（自带的实现要读 per-package CHANGELOG.md，但本项目配置 `changelog: false` 没生成这些文件，导致 release PR workflow 报 ENOENT）。GitHub Release 由 `release.yml` 在 tag 触发时基于根 CHANGELOG 创建。

新增 `docs/deployment/release.md`：完整的 CI/CD 集成流程与发布操作文档。
