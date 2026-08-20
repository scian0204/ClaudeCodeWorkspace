// The ONE plugin an LLM Wiki turn loads.
//
// A wiki thread used to inherit every plugin the workspace had enabled, and it showed: answers came
// back in another plugin's writing style, an unrelated hook demanded a preamble before each tool
// call (so every write ran twice), and a note-taking skill invented its own folder under raw/. A
// knowledge lookup has nothing to do with the team's coding plugins, so it now gets exactly one:
// the bundled llm-wiki skill next to this file. Same for the compile.
//
// Operators who would rather use their own (or a third-party wiki plugin) point `wikiPluginPath` at
// its directory. A path that does not exist resolves to no plugin at all rather than failing the
// turn — the topic's own CLAUDE.md still carries the grounding rules.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfg } from '../lib/config-registry.js';

// <server>/src/wiki/plugin.ts → <server>/plugins/llm-wiki (shipped in the image by `COPY server server`)
const BUNDLED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'llm-wiki');

function usable(dir: string): boolean {
  try { return fs.statSync(path.join(dir, '.claude-plugin', 'plugin.json')).isFile(); } catch { return false; }
}

// Pure half, so the resolution rules are checkable without a database (plugin.test.ts).
export function resolveWikiPlugin(override: string): string[] {
  const dir = override.trim() ? path.resolve(override.trim()) : BUNDLED;
  return usable(dir) ? [dir] : [];
}

// Read live (no caching): an admin can repoint wikiPluginPath without a restart, and one stat per
// turn is nothing next to starting the CLI.
export function wikiPluginPaths(): string[] {
  return resolveWikiPlugin(cfg.str('wikiPluginPath'));
}

export const bundledWikiPlugin = BUNDLED; // exported for the check in plugin.test.ts
