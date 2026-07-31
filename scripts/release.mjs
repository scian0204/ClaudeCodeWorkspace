#!/usr/bin/env node
// Build the app image (multi-arch) and push it to Docker Hub with version + latest + git-sha tags.
//
//   node scripts/release.mjs            build & push the CURRENT package.json version
//   node scripts/release.mjs --dry-run  print what it would do (no build, no push)
//
// Bump the version first (creates a git tag too):
//   npm run release:patch | release:minor | release:major
//
// Multi-arch (linux/amd64,linux/arm64) via buildx — needs a one-time `docker login`.
// Override: DOCKER_REPO=you/app · PLATFORMS=linux/amd64 · BUILDX_BUILDER=name
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = process.env.DOCKER_REPO || 'cian0204/claudecode-workspace';
const platforms = process.env.PLATFORMS || 'linux/amd64,linux/arm64';
const builder = process.env.BUILDX_BUILDER || 'ccw-multi';
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
console.log(`\n${dryRun ? 'Would push' : 'Pushed'} (${platforms}):\n  ${tags.join('\n  ')}`);
