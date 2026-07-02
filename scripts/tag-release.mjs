import { spawnSync } from "node:child_process";

const tag = process.argv[2];

if (tag === "-h" || tag === "--help") {
  console.log(`Usage: npm run release -- <tag>

Creates an annotated git tag with the message "Release <tag>".

Examples:
  npm run release -- v0.1.0
  npm run release -- v1.2.3-beta.1`);
  process.exit(0);
}

if (!tag) {
  console.error("Usage: npm run release -- v0.1.0");
  process.exit(1);
}

if (!/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tag)) {
  console.error(`Invalid release tag "${tag}". Use a semver tag like v0.1.0.`);
  process.exit(1);
}

const result = spawnSync("git", ["tag", "-a", tag, "-m", `Release ${tag}`], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
