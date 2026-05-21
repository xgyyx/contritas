---
"@contritas/api": patch
---

`changesets-release.yml`: read the release version from
`apps/api/package.json` instead of the root `package.json`. `changeset
version` bumps workspace packages but does not touch the root, so the
old code would have pushed a stale tag (e.g. `v0.6.0` after a 0.7.x
bump). The `fixed` group keeps the six workspace packages on the same
version, so reading any one of them is correct; `apps/api` is the
natural source of truth.
