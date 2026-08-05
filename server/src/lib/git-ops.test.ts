// Runnable check (no framework): npx tsx server/src/lib/git-ops.test.ts
// Covers the remote name/URL validators (they are what stands between a request body and
// `git remote add`, which has no `--` separator, so a leading '-' would become a flag) plus the
// pull argv builder (ff-only vs rebase, and the explicit refspec when no upstream is configured).
import assert from 'node:assert';
import { validRemoteName, validRemoteUrl, pullArgs, validSha, safeRepoPath } from './git-ops.js';

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

// --- diff targets ---
// A sha reaches `git show` as a bare argument and a path reaches the untracked reader as a real
// filesystem path, so both are validated: anything flag-like, ref-like or escaping the repo is out.
for (const ok of ['a1b2', 'DEADBEEF', 'e4f5a6b', 'a'.repeat(40)]) {
  assert.equal(validSha(ok), true, `expected valid sha: ${ok}`);
}
for (const bad of ['', 'abc', 'HEAD', 'main', '--output=/tmp/x', 'a1b2..c3d4', 'a1b2 c3d4', 'z1b2', 'a'.repeat(41)]) {
  assert.equal(validSha(bad), false, `expected invalid sha: ${JSON.stringify(bad)}`);
}
assert.equal(safeRepoPath('src/auth/token.ts'), 'src/auth/token.ts');
assert.equal(safeRepoPath('src\\auth\\token.ts'), 'src/auth/token.ts'); // a Windows client still means one path
assert.equal(safeRepoPath('a..b/x.ts'), 'a..b/x.ts');                   // '..' inside a name is not traversal
for (const bad of ['', '   ', '/etc/passwd', 'C:/Windows/x', '../secrets', 'a/../../b', '-o', 'x\0y']) {
  assert.equal(safeRepoPath(bad), null, `expected rejected path: ${JSON.stringify(bad)}`);
}

console.log('git-ops: all checks passed');
