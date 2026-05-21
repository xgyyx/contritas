#!/usr/bin/env node
// Extract a single version's section from the root CHANGELOG.md.
// Usage: node scripts/extract-changelog.mjs <version-without-v>
// Example: node scripts/extract-changelog.mjs 0.6.0
//
// Output goes to stdout. If the version is not found, prints a fallback
// notice and exits 0 (so the release workflow doesn't fail on missing notes).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const version = process.argv[2];
if (!version) {
  console.error("Usage: extract-changelog.mjs <version>");
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const changelogPath = path.resolve(here, "..", "CHANGELOG.md");

let content;
try {
  content = readFileSync(changelogPath, "utf8");
} catch (err) {
  console.log(`Release v${version}\n\n(CHANGELOG.md not found: ${err.message})`);
  process.exit(0);
}

// Match the heading for this version, e.g. "## [0.6.0] - 2026-05-21".
// Capture everything until the next "## [" heading or EOF.
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const re = new RegExp(
  `^##\\s+\\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=^##\\s+\\[|\\Z)`,
  "m",
);
const match = content.match(re);

if (!match) {
  console.log(
    `Release v${version}\n\n(No matching \`## [${version}]\` section in CHANGELOG.md — please fill in manually.)`,
  );
  process.exit(0);
}

console.log(match[1].trim());
