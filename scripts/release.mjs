#!/usr/bin/env node
// Build the app image (multi-arch) and push it to Docker Hub with version + latest + git-sha tags.
//
//   node scripts/release.mjs            build & push (amd64 only — fast)
//   node scripts/release.mjs --arm      also build linux/arm64 (slow: emulated, occasional use)
//   node scripts/release.mjs --dry-run  print what it would do (no build, no push)
//
// Bump the version first (creates a git tag too):
//   npm run release:patch | release:minor | release:major        (amd64)
//   npm run release:patch -- --arm                                (+ arm64)
//
// buildx build+push — needs a one-time `docker login`.
// Override: DOCKER_REPO=you/app · PLATFORMS=linux/amd64,linux/arm64 · BUILDX_BUILDER=name
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = process.env.DOCKER_REPO || 'cian0204/claudecode-workspace';
const multiarch = process.argv.includes('--arm') || process.argv.includes('--multiarch');
const platforms = process.env.PLATFORMS || (multiarch ? 'linux/amd64,linux/arm64' : 'linux/amd64');
const builder = process.env.BUILDX_BUILDER || 'ccw-multi';
const keepStorage = process.env.BUILDX_KEEP_STORAGE || '10GB';
const dryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const sha = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();

// Tags: exact version (immutable), latest (moving), sha-<short> (traceable to a commit).
const tags = [`${repo}:${version}`, `${repo}:latest`, `${repo}:sha-${sha}`];

const run = (cmd, opts = {}) => {
  console.log(`$ ${cmd}`);
  if (!dryRun) execSync(cmd, { cwd: root, stdio: 'inherit', ...opts });
};

// A multi-platform build needs the docker-container driver; the default `docker` driver can't do it.
function ensureBuilder() {
  try { execSync(`docker buildx inspect ${builder}`, { stdio: 'ignore' }); }
  catch { run(`docker buildx create --name ${builder} --driver docker-container --bootstrap`); }
}

// Cap this builder's cache after a push.
//
// A docker-container builder keeps its cache in its OWN docker volume
// (buildx_buildkit_<builder>0_state), and NEITHER `docker builder prune` nor `docker image prune`
// touches it — so the cleanup step in CLAUDE.md rule 3 never saw it. Left alone it grew to 92GB
// across releases, filled the host disk, and took the Docker engine down with it (the workspace with
// it). Trimming to a ceiling rather than wiping keeps the next release's layer reuse.
//
// Best-effort by design: the image is already pushed by the time this runs, so a prune that fails
// must not turn a successful release into a failed one. `--keep-storage` is the older flag name and
// newer buildkit calls it `--max-used-space`; try both before giving up.
function capBuilderCache() {
  const attempts = [
    `docker buildx prune --builder ${builder} --keep-storage ${keepStorage} -f`,
    `docker buildx prune --builder ${builder} --max-used-space ${keepStorage} -f`,
  ];
  for (const cmd of attempts) {
    try { run(cmd); return; } catch { /* try the next flag spelling */ }
  }
  console.warn(`(could not cap ${builder} cache — run \`docker buildx prune --builder ${builder} -a -f\` if the disk fills)`);
}

console.log(`Releasing ${repo}  version=${version}  sha=${sha}  platforms=${platforms}${dryRun ? '  (dry-run)' : ''}`);
try {
  if (!dryRun) ensureBuilder();
  const tagFlags = tags.map((t) => `-t ${t}`).join(' ');
  // buildx builds every platform and pushes the multi-arch manifest in one shot (no local --load).
  run(`docker buildx build --builder ${builder} --platform ${platforms} ${tagFlags} --push .`);
} catch (err) {
  console.error(`\nRelease failed: ${err.message}`);
  console.error('Auth error? run `docker login`. Builder missing? `docker buildx create --name ccw-multi --driver docker-container --bootstrap`.');
  process.exit(1);
}
if (!dryRun) capBuilderCache();
console.log(`\n${dryRun ? 'Would push' : 'Pushed'} (${platforms}):\n  ${tags.join('\n  ')}`);
