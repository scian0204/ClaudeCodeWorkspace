// Runnable check (no framework): npx tsx server/src/plugins/manager.test.ts
// Covers the DB-free half of plugin install: how a repo reference typed into the UI is read.
import assert from 'node:assert';
import { isRepoRef, normalizeRepo, repoName } from './manager.js';

// GitHub shorthand — the whole point: "foo/bar" needs no full URL
assert.equal(normalizeRepo('foo/bar'), 'https://github.com/foo/bar');
assert.equal(normalizeRepo('  anthropics/claude-code  '), 'https://github.com/anthropics/claude-code');
// full refs pass through untouched
for (const u of ['https://github.com/foo/bar', 'http://host/x.git', 'ssh://git@host/foo/bar', 'git://host/x', 'git@github.com:foo/bar.git']) {
  assert.equal(normalizeRepo(u), u);
}
// rejected: nothing git can clone over the network, an option git would eat, or a path escape
for (const bad of ['', '   ', 'plain-name', 'ext::sh -c "id"', '--upload-pack=evil', '-x', '../etc/passwd', 'foo/bar extra']) {
  assert.equal(isRepoRef(bad), false, `should reject: ${bad}`);
  assert.throws(() => normalizeRepo(bad), /지원하지 않는 저장소 주소/, `should throw: ${bad}`);
}
// default name = last segment, .git stripped (both URL shapes)
assert.equal(repoName('foo/bar'), 'bar');
assert.equal(repoName('https://github.com/foo/bar.git'), 'bar');
assert.equal(repoName('https://github.com/foo/bar/'), 'bar');
assert.equal(repoName('git@github.com:foo/bar.git'), 'bar');
assert.equal(repoName(''), '');

console.log('ok: plugin repo refs');
