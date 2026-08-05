// Runnable check (no framework): npx tsx server/src/lib/git-ops.test.ts
// Covers the remote name/URL validators (they are what stands between a request body and
// `git remote add`, which has no `--` separator, so a leading '-' would become a flag) plus the
// pull argv builder (ff-only vs rebase, and the explicit refspec when no upstream is configured).
import assert from 'node:assert';
import { validRemoteName, validRemoteUrl, pullArgs } from './git-ops.js';

// --- names ---
for (const ok of ['origin', 'upstream', 'my-fork', 'a.b', 'team/fork', 'x_1']) {
  assert.equal(validRemoteName(ok), true, `expected valid: ${ok}`);
}
for (const bad of [
  '', ' ', '-u', '--upload-pack=sh', '.hidden', '/abs', 'a..b', 'has space', 'quote"',
  'semi;rm', 'a'.repeat(101),
]) {
  assert.equal(validRemoteName(bad), false, `expected invalid: ${JSON.stringify(bad)}`);
}

// --- urls ---
for (const ok of [
  'https://github.com/me/repo.git',
  'http://gitlab.internal:8080/g/p.git',
  'ssh://git@github.com:22/me/repo.git',
  'git://example.com/repo.git',
  'git@github.com:me/repo.git',
  'user@host.example:path/to/repo',
]) {
  assert.equal(validRemoteUrl(ok), true, `expected valid: ${ok}`);
}
for (const bad of [
  '', '   ',
  '--upload-pack=/bin/sh',                 // would be read as a flag
  'https://host/a b',                      // whitespace splits the argument
  'file:///data/users/other/projects/x',   // local paths: would read another user's project dir
  '/data/users/other/projects/x',
  'C:\\dev\\other',
  '../../etc',
  'ext::sh -c cat',                        // git's ext:: transport executes a command
  'https://',                              // no host
  `https://host/${'a'.repeat(2000)}`,      // over the length cap
]) {
  assert.equal(validRemoteUrl(bad), false, `expected invalid: ${JSON.stringify(bad)}`);
}

// --- pull argv ---
// Default must stay --ff-only (never a surprise merge commit) and carry --all so branches created
// upstream come along. A refspec (no upstream configured) is the one case that cannot say --all:
// git rejects the pair with "fetch --all does not make sense with refspecs".
assert.deepEqual(pullArgs({ branch: 'main', upstream: true }), ['pull', '--all', '--ff-only']);
assert.deepEqual(pullArgs({ branch: 'main' }), ['pull', '--ff-only', 'origin', 'main']);
assert.deepEqual(pullArgs({ branch: 'feat/x', upstream: true, rebase: true }), ['pull', '--all', '--rebase', '--autostash']);
assert.deepEqual(pullArgs({ branch: 'feat/x', rebase: true }), ['pull', '--rebase', '--autostash', 'origin', 'feat/x']);
for (const a of [pullArgs({ branch: 'main' }), pullArgs({ branch: 'main', rebase: true })]) {
  assert.equal(a.includes('--all'), false, 'a refspec pull must not pass --all');
}
assert.throws(() => pullArgs({ branch: 'HEAD', upstream: true }), /detached HEAD/);
assert.throws(() => pullArgs({ branch: '' }), /detached HEAD/);

console.log('git-ops: all checks passed');
