// Runnable check (no framework): npx tsx server/src/lib/session-export.test.ts
//
// What the project-folder download rests on:
//   1. the default-off rules — an excluded name or a `.gitignore` match (root AND nested) — decide
//      what the walk collects, and the hand-picked overrides beat them
//   2. the picker's one-level listing reports the same verdict, plus the child count the browser
//      needs to warn before opening a huge folder
//   3. the archive really contains the picked files and the transcript at
//      `.claude/projects/<slug>/<uuid>.jsonl` — put that folder in $HOME and `claude --resume` finds it
//   4. a download ticket is one-time and bound to the user who made it
// It runs the real system tar and reads the member list back, so a portability slip fails here.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// The excluded-name list normally comes from the admin settings (a DB read); both entry points take
// it as an argument so this check needs no database.
import {
  walkBundle, listExportDir, bundleStream, bundleFilename, transcriptLines, putTicket, takeTicket,
} from './session-export.js';

const EXCLUDES = new Set(['node_modules', '.cache']);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccw-bundle-test-'));

const proj = path.join(root, 'my-project');
const w = (rel: string, body: string) => {
  const full = path.join(proj, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
};
w('app.ts', 'x'.repeat(100));
w('src/deep/util.ts', 'y'.repeat(50));
w('node_modules/junk.js', 'z'.repeat(10_000));            // excluded by name (sessionBundleExcludes)
w('src/node_modules/nested-junk.js', 'z'.repeat(10_000));
w('.gitignore', 'secrets.txt\n*.log\ncoverage/\n');
w('secrets.txt', 'shhh');                                  // ignored at the root
w('debug.log', 'noise');                                   // ignored by pattern
w('coverage/report.html', 'noise');
w('web/.gitignore', 'local-only/\n');                      // a nested .gitignore applies below itself
w('web/local-only/scratch.ts', 'nope');
w('web/index.ts', 'a'.repeat(10));

const NO_SEL = { exclude: new Set<string>(), include: new Set<string>() };
const CAP = 1024 * 1024;

// ── walkBundle: defaults ──
const base = walkBundle(proj, NO_SEL, CAP, 10_000, EXCLUDES);
assert.deepEqual([...base.files].sort(), ['.gitignore', 'app.ts', 'src/deep/util.ts', 'web/.gitignore', 'web/index.ts'],
  `defaults keep the real files only — got ${base.files.join(' ')}`);
assert.equal(base.bytes, 100 + 50 + 10 + fs.statSync(path.join(proj, '.gitignore')).size + fs.statSync(path.join(proj, 'web/.gitignore')).size);
assert.equal(base.over, false);
assert.equal(base.tooMany, false);

// ── walkBundle: hand-picked overrides ──
const unchecked = walkBundle(proj, { exclude: new Set(['src']), include: new Set() }, CAP, 10_000, EXCLUDES);
assert.ok(!unchecked.files.some((f) => f.startsWith('src/')), 'unchecking a folder drops its whole subtree');
const rechecked = walkBundle(proj, { exclude: new Set(), include: new Set(['secrets.txt', 'web/local-only']) }, CAP, 10_000, EXCLUDES);
assert.ok(rechecked.files.includes('secrets.txt'), 'checking an ignored file by hand puts it back');
assert.ok(rechecked.files.includes('web/local-only/scratch.ts'), 'checking an ignored folder lifts the default for everything inside');
const deeper = walkBundle(proj, { exclude: new Set(['web/local-only/scratch.ts']), include: new Set(['web/local-only']) }, CAP, 10_000, EXCLUDES);
assert.ok(!deeper.files.includes('web/local-only/scratch.ts'), 'a deeper uncheck wins over a shallower check');

// ── walkBundle: the ceilings stop the walk ──
assert.equal(walkBundle(proj, NO_SEL, 100, 10_000, EXCLUDES).over, true, 'over the size cap');
assert.equal(walkBundle(proj, NO_SEL, CAP, 2, EXCLUDES).tooMany, true, 'over the file-count cap');

// ── listExportDir: one level, with the default-off verdict and child counts ──
const top = listExportDir(proj, '', 2000, EXCLUDES);
const byName = Object.fromEntries(top.entries.map((e) => [e.name, e]));
assert.equal(top.entries[0].dir, true, 'folders sort before files');
assert.equal(byName['node_modules'].ignored, true, 'an excluded name shows as off');
assert.equal(byName['secrets.txt'].ignored, true, 'a .gitignore match shows as off');
assert.equal(byName['app.ts'].ignored, false, 'a normal file shows as on');
assert.equal(byName['src'].count, 2, 'a folder reports its immediate child count (what the expand warning reads)');
assert.equal(byName['app.ts'].size, 100);
const webLevel = listExportDir(proj, 'web', 2000, EXCLUDES);
assert.equal(webLevel.entries.find((e) => e.name === 'local-only')!.ignored, true, 'a nested .gitignore is honoured at its own level');
assert.equal(listExportDir(proj, '', 2, EXCLUDES).truncated, true, 'a monstrous folder is cut at the limit');
assert.deepEqual(listExportDir(proj, 'nope/missing', 2000, EXCLUDES).entries, [], 'a path that is not there lists as empty');

// ── bundleStream ──
const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const { stream } = bundleStream({
  projectDir: proj,
  fileRels: base.files,
  transcript: { slug: '-C--dev-my-project', uuid, lines: ['{"type":"user"}'] },
});
const out = path.join(root, 'bundle.tgz');
const chunks: Buffer[] = [];
stream.on('data', (c: Buffer) => chunks.push(c));
await new Promise<void>((res, rej) => { stream.on('end', () => res()); stream.on('error', rej); });
fs.writeFileSync(out, Buffer.concat(chunks));
// listed with a bare name from `root`: GNU tar reads `C:\…` as a remote host spec ("Cannot connect to C")
const members = execFileSync('tar', ['-tzf', 'bundle.tgz'], { cwd: root, encoding: 'utf8' })
  .split('\n').map((l) => l.trim().replace(/\/$/, '')).filter(Boolean);
assert.ok(members.includes('my-project/app.ts'), 'picked files sit under the folder name');
assert.ok(members.includes('my-project/src/deep/util.ts'), 'nested picks kept');
assert.ok(members.includes(`.claude/projects/-C--dev-my-project/${uuid}.jsonl`), 'transcript filed where the CLI looks for it');
assert.ok(!members.some((x) => x.includes('node_modules')), `nothing unpicked slipped in — got ${members.join(' ')}`);
assert.ok(!members.some((x) => x.includes('secrets.txt')), 'ignored files stay out');

// ── bundleFilename ──
assert.equal(bundleFilename('Refactor the Auth!', new Date(2026, 7, 20, 15, 4)), 'ccw-refactor-the-auth-20260820-1504.tgz');
assert.equal(bundleFilename('한글 제목', new Date(2026, 7, 20, 15, 4)), 'ccw-20260820-1504.tgz', 'a title with no ASCII left just drops out');

// ── transcriptLines ──
const jsonlFile = path.join(root, 't.jsonl');
fs.writeFileSync(jsonlFile, `${JSON.stringify({ type: 'user', cwd: '/data/users/u1/projects/my-project', sessionId: 'u-1' })}\n`);
const lines = transcriptLines(jsonlFile, 'u-1', 'C:\\dev\\my-project', 'My chat');
assert.match(lines[0], /"custom-title"/, 'the workspace title is prepended for the resume picker');
assert.match(lines[1], /dev/, 'cwd rewritten to the local path');
assert.equal(transcriptLines(jsonlFile, 'u-1', '', null).length, 2, 'no title line, no rewrite → the file as it is');

// ── download tickets ──
const ticket = { userId: 'u1', sessionId: 's1', projectDir: proj, fileRels: ['app.ts'], transcript: null, title: 'x' };
const tok = putTicket(ticket);
assert.equal(takeTicket(tok, 'u2'), null, 'another user cannot spend it');
assert.ok(takeTicket(tok, 'u1'), 'the owner can');
assert.equal(takeTicket(tok, 'u1'), null, 'and only once');
const stale = putTicket(ticket, Date.now() - 60 * 60 * 1000);
assert.equal(takeTicket(stale, 'u1'), null, 'an old ticket is refused');

fs.rmSync(root, { recursive: true, force: true });
console.log('session-export: ok');
