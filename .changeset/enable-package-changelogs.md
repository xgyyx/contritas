---
"@contritas/shared": patch
"@contritas/llm": patch
"@contritas/search": patch
"@contritas/workflow": patch
"@contritas/api": patch
"@contritas/web": patch
---

修 changesets-release.yml: enable the default per-package changelog generator. The action's `version` step always tries to write package-level `CHANGELOG.md` regardless of `createGithubReleases`; setting `"changelog": false` triggers ENOENT. Now per-package CHANGELOGs (English) are auto-generated alongside the hand-maintained root CHANGELOG.md (Chinese, written for end users).
