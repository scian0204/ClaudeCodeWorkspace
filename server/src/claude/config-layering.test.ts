// Runnable check: npx vitest run server/src/claude/config-layering.test.ts
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { sdkMode } from './config-layering.js';
import { makeCanUseTool } from './permissions.js';

// rootsFor() hands the fence already-resolved absolute roots; resolve here too so the paths below
// carry a drive letter on Windows and the fence compares like for like.
const ROOT = path.resolve('/w');
const inRoot = path.join(ROOT, 'a.ts');
const outside = path.resolve('/elsewhere/passwd');

// The two halves of one fix: root can't get --dangerously-skip-permissions (the CLI exits 1), so the
// SDK sees acceptEdits — and canUseTool must then allow everything or bypass silently starts prompting.
describe('bypassPermissions under root', () => {
  it('hands the SDK acceptEdits as root, and the real mode otherwise', () => {
    expect(sdkMode('bypassPermissions', true)).toBe('acceptEdits');
    expect(sdkMode('bypassPermissions', false)).toBe('bypassPermissions');
    for (const m of ['default', 'acceptEdits', 'plan'] as const) {
      expect(sdkMode(m, true)).toBe(m);
      expect(sdkMode(m, false)).toBe(m);
    }
  });

  it('auto-allows every tool in bypass mode without emitting a permission request', async () => {
    const events: string[] = [];
    const canUseTool = makeCanUseTool({
      sessionId: 's1', roots: [ROOT], mode: 'bypassPermissions',
      emit: (e) => events.push(e), signal: new AbortController().signal,
    });
    expect(await canUseTool('Bash', { command: 'ls' }, {})).toMatchObject({ behavior: 'allow' });
    expect(await canUseTool('Write', { file_path: inRoot }, {})).toMatchObject({ behavior: 'allow' });
    expect(events).toEqual([]);
  });

  it('still enforces the class-1 path fence in bypass mode', async () => {
    const canUseTool = makeCanUseTool({
      sessionId: 's2', roots: [ROOT], mode: 'bypassPermissions',
      emit: () => {}, signal: new AbortController().signal,
    });
    expect(await canUseTool('Write', { file_path: outside }, {})).toMatchObject({ behavior: 'deny' });
  });
});
