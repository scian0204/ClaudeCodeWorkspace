// Runnable check (no framework): npx tsx server/src/wiki/plugin.test.ts
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveWikiPlugin, bundledWikiPlugin } from './plugin.js';

// ── the bundled plugin has to actually be there, or a wiki turn silently loses its rules ──
const manifest = path.join(bundledWikiPlugin, '.claude-plugin', 'plugin.json');
const skill = path.join(bundledWikiPlugin, 'skills', 'llm-wiki', 'SKILL.md');
assert.ok(fs.existsSync(manifest), `missing ${manifest}`);
assert.ok(fs.existsSync(skill), `missing ${skill}`);
assert.equal(JSON.parse(fs.readFileSync(manifest, 'utf8')).name, 'llm-wiki');
// the skill's frontmatter name must match its directory, else the CLI never registers it
assert.match(fs.readFileSync(skill, 'utf8').split('---')[1] || '', /\nname:\s*llm-wiki\s*\n/);

// ── resolution ──
assert.deepEqual(resolveWikiPlugin(''), [path.resolve(bundledWikiPlugin)]);   // default = bundled
assert.deepEqual(resolveWikiPlugin('   '), [path.resolve(bundledWikiPlugin)]); // blank counts as unset
assert.equal(resolveWikiPlugin('').length, 1, 'a wiki turn loads exactly ONE plugin');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wikiplugin-'));
try {
  // an operator can point it at their own directory instead
  const own = path.join(tmp, 'my-wiki-plugin');
  fs.mkdirSync(path.join(own, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(own, '.claude-plugin', 'plugin.json'), '{"name":"mine"}');
  assert.deepEqual(resolveWikiPlugin(own), [path.resolve(own)]);

  // a path that is not a plugin degrades to no plugin at all rather than failing the turn —
  // the topic's own CLAUDE.md still carries the grounding rules
  assert.deepEqual(resolveWikiPlugin(path.join(tmp, 'nope')), []);
  assert.deepEqual(resolveWikiPlugin(tmp), []); // a real dir without a manifest is not a plugin
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('wiki/plugin: ok');
