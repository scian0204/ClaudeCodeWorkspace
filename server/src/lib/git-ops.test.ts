// Runnable check (no framework): npx tsx server/src/lib/git-ops.test.ts
// Covers the remote name/URL validators only — they are what stands between a request body and
// `git remote add`, which has no `--` separator, so a leading '-' would become a flag.
import assert from 'node:assert';
import { validRemoteName, validRemoteUrl } from './git-ops.js';

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

console.log('git-ops: all checks passed');
