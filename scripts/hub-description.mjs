#!/usr/bin/env node
// Push the Docker Hub repo Overview (full_description) + short description from DOCKERHUB.md.
// Docker Hub does NOT pull this from git — it must be set via its API.
//
// Auth with a Docker Hub Personal Access Token you supply (never hard-code it):
//   DOCKERHUB_USER=cian0204 DOCKERHUB_TOKEN=<PAT> npm run hub:desc
// Preview without auth/writes:
//   node scripts/hub-description.mjs --dry-run
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = process.env.DOCKER_REPO || 'cian0204/claudecode-workspace';
const shortDesc =
  'Claude Code team workspace — per-session isolation, shared rooms, in-browser VS Code.'; // Hub cap: 100 chars
const full = readFileSync(join(root, 'DOCKERHUB.md'), 'utf8');

if (process.argv.includes('--dry-run')) {
  console.log(`repo=${repo}\nshort (${shortDesc.length}/100): ${shortDesc}\nfull_description: ${full.length} chars`);
  process.exit(0);
}

const user = process.env.DOCKERHUB_USER;
const token = process.env.DOCKERHUB_TOKEN;
if (!user || !token) {
  console.error('Set DOCKERHUB_USER and DOCKERHUB_TOKEN (a Docker Hub Personal Access Token) first.');
  process.exit(1);
}

const login = await fetch('https://hub.docker.com/v2/users/login/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: user, password: token }),
});
if (!login.ok) {
  console.error(`Login failed: ${login.status} ${await login.text()}`);
  process.exit(1);
}
const { token: jwt } = await login.json();

const res = await fetch(`https://hub.docker.com/v2/repositories/${repo}/`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Authorization: `JWT ${jwt}` },
  body: JSON.stringify({ description: shortDesc, full_description: full }),
});
if (!res.ok) {
  console.error(`Update failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log(`Updated Docker Hub overview for ${repo} (${full.length} chars).`);
