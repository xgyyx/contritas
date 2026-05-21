---
"@contritas/api": patch
---

Fix release pipeline so merging a release PR actually publishes images to GHCR.

The previous setup never produced a git tag — `pnpm changeset tag` is a
no-op when all packages are private with `privatePackages.tag: false`,
and the default `GITHUB_TOKEN` cannot trigger downstream workflows
even when tags are pushed. As a result, v0.6.0's release PR merged
silently and `release.yml` never ran.

`changesets-release.yml` now uses a fine-grained PAT (`RELEASE_PAT`,
Contents+PRs RW on this repo) and pushes a single repo-wide `vX.Y.Z`
tag derived from the root `package.json` version on the post-merge
run. This first proper release exercises that path end-to-end.
