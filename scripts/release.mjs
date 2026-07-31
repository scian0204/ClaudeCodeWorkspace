#!/usr/bin/env node
// Build the app image and push it to Docker Hub with version + latest + git-sha tags.
//
//   node scripts/release.mjs            build & push the CURRENT package.json version
//   node scripts/release.mjs --dry-run  print what it would do (no build, no push)
//
// Bump the version first (creates a git tag too):
//   npm run release:patch | release:minor | release:major
//
// Requires a one-time `docker login` on this machine. Override the repo with DOCKER_REPO.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = process.env.DOCKER_REPO || 'cian0204/claudecode-workspace';
const dryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const sha = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();

// Tags: exact version (immutable), latest (moving), sha-<short> (traceable to a commit).
const tags = [`${repo}:${version}`, `${repo}:latest`, `${repo}:sha-${sha}`];

const run = (cmd) => {
  console.log(`$ ${cmd}`);
  if (!dryRun) execSync(cmd, { cwd: root, stdio: 'inherit' });
};

console.log(`Releasing ${repo}  version=${version}  sha=${sha}${dryRun ? '  (dry-run)' : ''}`);
try {
  run(`docker build ${tags.map((t) => `-t ${t}`).join(' ')} .`);
  for (const t of tags) run(`docker push ${t}`);
} catch (err) {
  console.error(`\nRelease failed: ${err.message}`);
  console.error('If it is an auth error, run `docker login` first (Docker Hub token).');
  process.exit(1);
}
console.log(`\n${dryRun ? 'Would push' : 'Pushed'}:\n  ${tags.join('\n  ')}`);
