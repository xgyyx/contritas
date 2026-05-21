---
"@contritas/shared": patch
"@contritas/llm": patch
"@contritas/search": patch
"@contritas/workflow": patch
"@contritas/api": patch
"@contritas/web": patch
---

`changeset-check.yml`: 跳过 `changeset-release/main` 分支（由 `github-actions[bot]` 开的 release PR）。release PR 按设计会消费所有 changeset，自然没法满足「必须带 changeset」规则——之前这条规则会把 release PR 锁死。
