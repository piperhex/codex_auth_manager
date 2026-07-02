import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const beta = args.includes("--beta");
const userArgs = args.filter((arg) => arg !== "--beta");
const requested = userArgs[0];
const cwd = process.cwd();
const packageJsonPath = join(cwd, "package.json");
const packageLockPath = join(cwd, "package-lock.json");
const tauriConfigPath = join(cwd, "src-tauri", "tauri.conf.json");
const packageJson = readJson(packageJsonPath);
const currentVersion = parseVersion(packageJson.version, "package.json version");
const branch = gitOutput(["branch", "--show-current"]);

if (requested === "-h" || requested === "--help") {
  printHelp();
  process.exit(0);
}

if (userArgs.length > 1) {
  fail(`Too many arguments: ${userArgs.join(" ")}`);
}

const nextVersion = requested
  ? explicitVersion(requested, beta)
  : beta
    ? nextBetaVersion(currentVersion)
    : nextReleaseVersion(currentVersion);
const releaseTag = `v${formatVersion(nextVersion)}`;

if (tagExists(releaseTag)) {
  fail(`Tag ${releaseTag} already exists.`);
}

if (!branch) {
  fail("Release must be run from a branch, not a detached HEAD.");
}

ensureCleanWorkingTree();
syncVersionFiles(nextVersion);

const versionFiles = ["package.json"];
if (existsSync(packageLockPath)) versionFiles.push("package-lock.json");
if (existsSync(tauriConfigPath)) versionFiles.push("src-tauri/tauri.conf.json");

if (gitOutput(["status", "--porcelain", "--", ...versionFiles])) {
  run("git", ["add", ...versionFiles]);
  run("git", ["commit", "-m", `chore(release): ${releaseTag}`]);
}
run("git", ["tag", "-a", releaseTag, "-m", `Release ${releaseTag}`]);

console.log(`Created ${releaseTag}.`);
console.log(`Pushing ${branch} and ${releaseTag} to origin...`);
run("git", ["push", "origin", branch]);
run("git", ["push", "origin", releaseTag]);
console.log(`Pushed ${releaseTag}. GitHub Actions will start from the tag push.`);

function printHelp() {
  console.log(`Usage: npm run ${beta ? "release-beta" : "release"} -- [version-or-tag]

Creates a version bump commit, creates an annotated git tag, and pushes both to origin.

Default behavior:
  npm run release       ${packageJson?.version ? `# ${packageJson.version} -> ${formatVersion(nextReleaseVersion(currentVersion))}` : ""}
  npm run release-beta  ${packageJson?.version ? `# ${packageJson.version} -> ${formatVersion(nextBetaVersion(currentVersion))}` : ""}

Examples:
  npm run release
  npm run release -- v0.2.0
  npm run release-beta
  npm run release-beta -- v0.2.0
  npm run release-beta -- v0.2.0-beta.2`);
}

function explicitVersion(value, betaRelease) {
  const parsed = parseVersion(value, "release version");
  if (betaRelease && !parsed.prerelease) {
    return { ...parsed, prerelease: "beta.0", build: undefined };
  }
  return parsed;
}

function nextReleaseVersion(version) {
  if (version.prerelease) {
    return { ...version, prerelease: undefined, build: undefined };
  }
  return { major: version.major, minor: version.minor, patch: version.patch + 1 };
}

function nextBetaVersion(version) {
  if (version.prerelease) {
    const match = /^beta\.(\d+)$/.exec(version.prerelease);
    if (match) {
      return {
        major: version.major,
        minor: version.minor,
        patch: version.patch,
        prerelease: `beta.${Number(match[1]) + 1}`,
      };
    }
    return {
      major: version.major,
      minor: version.minor,
      patch: version.patch,
      prerelease: "beta.0",
    };
  }

  return {
    major: version.major,
    minor: version.minor,
    patch: version.patch + 1,
    prerelease: "beta.0",
  };
}

function syncVersionFiles(version) {
  const versionText = formatVersion(version);
  packageJson.version = versionText;
  writeJson(packageJsonPath, packageJson);

  if (existsSync(packageLockPath)) {
    const lock = readJson(packageLockPath);
    lock.version = versionText;
    if (lock.packages?.[""]) {
      lock.packages[""].version = versionText;
    }
    writeJson(packageLockPath, lock);
  }

  if (existsSync(tauriConfigPath)) {
    const tauriConfig = readJson(tauriConfigPath);
    tauriConfig.version = versionText;
    writeJson(tauriConfigPath, tauriConfig);
  }
}

function ensureCleanWorkingTree() {
  const status = gitOutput(["status", "--porcelain"]);
  if (status) {
    fail("Working tree is not clean. Commit or stash your changes before creating a release.");
  }
}

function tagExists(tag) {
  const result = spawnSync("git", ["rev-parse", "--quiet", "--verify", `refs/tags/${tag}`], {
    stdio: "ignore",
  });
  return result.status === 0;
}

function gitOutput(args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return "";
  }
  return result.stdout.trim();
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
  });
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Unable to read ${path}: ${error.message}`);
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function parseVersion(value, label) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(
    String(value),
  );
  if (!match) {
    fail(`Invalid ${label} "${value}". Use a semver version like v0.1.0.`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
    build: match[5],
  };
}

function formatVersion(version) {
  const prerelease = version.prerelease ? `-${version.prerelease}` : "";
  const build = version.build ? `+${version.build}` : "";
  return `${version.major}.${version.minor}.${version.patch}${prerelease}${build}`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
