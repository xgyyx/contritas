---
"@contritas/shared": minor
"@contritas/llm": minor
"@contritas/search": minor
"@contritas/workflow": minor
"@contritas/api": minor
"@contritas/web": minor
---

Phase 6 CD 前置批：
- BullMQ 短期降级 attempts:1 + completed/failed 状态短路（6.3.4）
- api/web Dockerfile 加 HEALTHCHECK 指令（6.8.3）
- Drizzle 自动 migration（首版 migrations + docker-entrypoint.sh + RUN_MIGRATIONS 开关）（6.8.7）
- 全仓 package.json 版本对齐 0.6.0（6.9.5）
- GHCR release workflow（多架构 amd64+arm64 + CHANGELOG 段落抽取作 Release notes）（6.9.8）
- changesets 版本自动化（fixed 共版本 + PR 守卫 + 自动 release PR）（6.9.9）
