// Runnable check: npx vitest run server/src/claude/config-layering.test.ts
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { sdkMode } from './config-layering.js';
import { makeCanUseTool, respondPermission, getAlwaysAllowed } from './permissions.js';

// rootsFor() hands the fence already-resolved absolute roots; resolve here too so the paths below
// carry a drive letter on Windows and the fence compares like for like.
const ROOT = path.resolve('/w');
const inRoot = path.join(ROOT, 'a.ts');
const outside = path.resolve('/elsewhere/passwd');

// The two halves of one fix: the CLI refuses --dangerously-skip-permissions as root (it exits 1) and
// stops calling canUseTool when it accepts it, so bypass always runs as SDK acceptEdits — and
// canUseTool must then allow everything or bypass silently starts prompting.
describe('bypassPermissions', () => {
  it('always hands the SDK acceptEdits, and leaves every other mode alone', () => {
    expect(sdkMode('bypassPermissions')).toBe('acceptEdits');
    for (const m of ['default', 'acceptEdits', 'plan'] as const) expect(sdkMode(m)).toBe(m);
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

  // The bug this guards: bypass auto-allowed AskUserQuestion too, so the CLI ran the ask with no
  // human attached, answered itself, and the turn walked past the choice.
  it('still prompts for AskUserQuestion in bypass mode, and feeds the pick back', async () => {
    const events: any[] = [];
    const canUseTool = makeCanUseTool({
      sessionId: 's3', roots: [ROOT], mode: 'bypassPermissions',
      emit: (e, p) => { events.push([e, p]); if (e === 'permission:request') respondPermission(p.requestId, 'allow', 'picked: B'); },
      signal: new AbortController().signal,
    });
    const r = await canUseTool('AskUserQuestion', { questions: [{ question: 'A or B?' }] }, {});
    expect(events.map(([e]) => e)).toEqual(['permission:request', 'permission:resolved']);
    expect(r).toMatchObject({ behavior: 'deny', message: 'picked: B' });
  });

  it('never auto-allows AskUserQuestion from the "always allow" memory either', async () => {
    getAlwaysAllowed('s4').add('AskUserQuestion');
    const events: string[] = [];
    const canUseTool = makeCanUseTool({
      sessionId: 's4', roots: [ROOT], mode: 'default',
      emit: (e, p) => { events.push(e); if (e === 'permission:request') respondPermission(p.requestId, 'deny'); },
      signal: new AbortController().signal,
    });
    await canUseTool('AskUserQuestion', { questions: [] }, {});
    expect(events).toContain('permission:request');
  });

  it('still enforces the class-1 path fence in bypass mode', async () => {
    const canUseTool = makeCanUseTool({
      sessionId: 's2', roots: [ROOT], mode: 'bypassPermissions',
      emit: () => {}, signal: new AbortController().signal,
    });
    expect(await canUseTool('Write', { file_path: outside }, {})).toMatchObject({ behavior: 'deny' });
  });
});
