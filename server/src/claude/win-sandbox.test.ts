// npx tsx server/src/claude/win-sandbox.test.ts
// Pure parts of the Windows build container: the daemon address parser, the copy filter, the tree
// scan (size cap + change detection) and the shell wrapping. No Docker, no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDockerHost } from '../lib/docker-hosts.js';
import { parseExcludes, makeSkip, scanTree, shellArgv } from './win-sandbox.js';

let failed = 0;
function it(name: string, fn: () => void) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e: any) { failed++; console.error(`  FAIL ${name}\n       ${e?.message || e}`); }
}

console.log('parseDockerHost');
it('tcp:// with an explicit port', () => {
  assert.deepEqual(parseDockerHost('tcp://win-build:2376', true), { host: 'win-build', port: 2376, protocol: 'https' });
});
it('a cert dir turns a bare tcp:// address into TLS on 2376', () => {
  assert.deepEqual(parseDockerHost('tcp://win-build', true), { host: 'win-build', port: 2376, protocol: 'https' });
});
it('without certs the default port is the plain one', () => {
  assert.deepEqual(parseDockerHost('win-build', false), { host: 'win-build', port: 2375, protocol: 'http' });
});
it('an explicit scheme wins over the cert dir', () => {
  assert.equal(parseDockerHost('http://win-build:2375', true)?.protocol, 'http');
  assert.equal(parseDockerHost('https://win-build', false)?.protocol, 'https');
});
it('IPv6 keeps its address and port apart', () => {
  assert.deepEqual(parseDockerHost('tcp://[fe80::1]:2376', false), { host: 'fe80::1', port: 2376, protocol: 'http' });
  assert.deepEqual(parseDockerHost('[fe80::1]', true), { host: 'fe80::1', port: 2376, protocol: 'https' });
});
it('rejects what cannot be a second host', () => {
  for (const bad of ['', '   ', 'unix:///var/run/docker.sock', 'npipe:////./pipe/docker_engine', 'ssh://user@host', 'tcp://host/path', 'tcp://:2376', 'tcp://host:70000']) {
    assert.equal(parseDockerHost(bad, true), null, bad || '(empty)');
  }
});

console.log('parseExcludes / makeSkip');
const noLink = () => ({ isSymbolicLink: () => false });
it('splits on commas and drops blanks', () => {
  assert.deepEqual(parseExcludes(' .git, node_modules ,,bin '), ['.git', 'node_modules', 'bin']);
});
it('matches a name at any depth, not a path prefix', () => {
  const skip = makeSkip(['bin', 'obj'], noLink);
  assert.equal(skip('/data/p/src/Foo/bin'), true);
  assert.equal(skip('/data/p/obj'), true);
  assert.equal(skip('/data/p/src/binding.gwn'), false, 'a longer name is not the pattern');
  assert.equal(skip('/data/p/bin/x/Program.cs'), false, 'the dir was already skipped; the file itself is not a match');
});
it('is case-insensitive (the destination is Windows)', () => {
  assert.equal(makeSkip(['bin'], noLink)('/data/p/BIN'), true);
  assert.equal(makeSkip(['BIN'], noLink)('/data/p/bin'), true);
});
it('honours *.suffix and prefix* patterns', () => {
  const skip = makeSkip(['*.log', 'tmp*'], noLink);
  assert.equal(skip('/data/p/build.log'), true);
  assert.equal(skip('/data/p/tmpcache'), true);
  assert.equal(skip('/data/p/logger.cs'), false);
});
it('always skips symlinks, and anything that vanished mid-walk', () => {
  const skip = makeSkip([], () => ({ isSymbolicLink: () => true }));
  assert.equal(skip('/data/p/link'), true);
  const gone = makeSkip([], () => { throw new Error('ENOENT'); });
  assert.equal(gone('/data/p/gone'), true);
});

console.log('scanTree');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccw-win-'));
fs.mkdirSync(path.join(tmp, 'src'));
fs.mkdirSync(path.join(tmp, 'bin'));
fs.writeFileSync(path.join(tmp, 'src', 'a.cs'), 'x'.repeat(1000));
fs.writeFileSync(path.join(tmp, 'src', 'b.cs'), 'y'.repeat(500));
fs.writeFileSync(path.join(tmp, 'bin', 'big.dll'), 'z'.repeat(100000));

it('counts only what the filter keeps', () => {
  const r = scanTree(tmp, makeSkip(['bin'], noLink), 10 * 1024 * 1024);
  assert.equal(r.files, 2);
  assert.equal(r.bytes, 1500);
  assert.equal(r.over, false);
});
it('stops as soon as the cap is passed instead of walking a huge tree', () => {
  const r = scanTree(tmp, makeSkip([], noLink), 1200);
  assert.equal(r.over, true);
  assert.ok(r.bytes > 1200);
});
it('reports the newest mtime, which is what makes a re-copy skippable', () => {
  const before = scanTree(tmp, makeSkip(['bin'], noLink), 1e9);
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(path.join(tmp, 'src', 'b.cs'), future, future);
  const after = scanTree(tmp, makeSkip(['bin'], noLink), 1e9);
  assert.ok(after.newestMtime > before.newestMtime, 'a touched file moves the watermark');
});
it('an empty tree is not mistaken for "changed"', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ccw-win-empty-'));
  const r = scanTree(empty, makeSkip([], noLink), 1e9);
  assert.deepEqual([r.files, r.bytes, r.newestMtime, r.over], [0, 0, 0, false]);
  fs.rmSync(empty, { recursive: true, force: true });
});
fs.rmSync(tmp, { recursive: true, force: true });

console.log('shellArgv');
it('cmd is the default wrapping', () => {
  assert.deepEqual(shellArgv('cmd', 'msbuild Foo.sln'), ['cmd', '/S', '/C', 'msbuild Foo.sln']);
  assert.deepEqual(shellArgv('', 'dir'), ['cmd', '/S', '/C', 'dir']);
});
it('powershell runs without a profile so a host config cannot change a build', () => {
  assert.deepEqual(shellArgv('powershell', 'Get-Item .'), ['powershell', '-NoProfile', '-NonInteractive', '-Command', 'Get-Item .']);
});

if (failed) { console.error(`\n${failed} failing`); process.exit(1); }
console.log('\nall passing');
