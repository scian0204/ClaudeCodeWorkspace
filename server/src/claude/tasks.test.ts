// Runnable check: npx vitest run server/src/claude/tasks.test.ts
import { describe, it, expect, vi } from 'vitest';

// cfg reads the settings table; this unit has no DB, so serve the registry defaults directly.
vi.mock('../lib/config-registry.js', () => ({
  cfg: { bool: () => true, int: (k: string) => (k === 'taskSessionsMax' ? 200 : 80), str: () => '' },
}));

const { ingestTaskEvent, endRunningTasks, tasksFor, clearTasks } = await import('./tasks.js');

const SID = 'sess_tasks_test';
const sink = () => { const seen: any[] = []; return { emit: (_e: string, p: any) => seen.push(p), seen }; };

describe('agent task registry', () => {
  it('folds the SDK task edges into one live list', () => {
    clearTasks(SID);
    const s = sink();
    ingestTaskEvent(SID, { type: 'system', subtype: 'task_started', task_id: 't1', tool_use_id: 'tu1', description: 'review the diff', subagent_type: 'code-reviewer' }, s.emit);
    expect(tasksFor(SID)).toMatchObject([{ id: 't1', kind: 'subagent', agentType: 'code-reviewer', status: 'running' }]);

    ingestTaskEvent(SID, { type: 'system', subtype: 'task_progress', task_id: 't1', last_tool_name: 'Grep', usage: { total_tokens: 1200, tool_uses: 3, duration_ms: 900 } }, s.emit);
    expect(tasksFor(SID)[0]).toMatchObject({ lastTool: 'Grep', tokens: 1200, toolUses: 3 });

    ingestTaskEvent(SID, { type: 'system', subtype: 'task_notification', task_id: 't1', status: 'completed', summary: 'found 2 issues' }, s.emit);
    expect(tasksFor(SID)[0]).toMatchObject({ status: 'completed', summary: 'found 2 issues' });
    expect(typeof tasksFor(SID)[0].endedAt).toBe('number');
    expect(s.seen.length).toBe(3); // every change broadcasts the whole list
  });

  it('tracks backgrounded shells from the level snapshot and clears the flag when they leave it', () => {
    clearTasks(SID);
    const s = sink();
    ingestTaskEvent(SID, { type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'b1', task_type: 'shell', description: 'npm run build' }] }, s.emit);
    expect(tasksFor(SID)).toMatchObject([{ id: 'b1', kind: 'shell', label: 'npm run build', background: true, status: 'running' }]);

    ingestTaskEvent(SID, { type: 'system', subtype: 'background_tasks_changed', tasks: [] }, s.emit);
    expect(tasksFor(SID)[0]).toMatchObject({ background: false, status: 'running' }); // its own edge sets the final status
  });

  it('settles anything still running when the turn (and its CLI) ends', () => {
    clearTasks(SID);
    const s = sink();
    ingestTaskEvent(SID, { type: 'system', subtype: 'task_started', task_id: 't2', description: 'long job' }, s.emit);
    endRunningTasks(SID, s.emit);
    expect(tasksFor(SID)[0]).toMatchObject({ status: 'stopped', background: false });
    // idempotent: a second call has nothing left to settle, so it must not re-broadcast
    const before = s.seen.length;
    endRunningTasks(SID, s.emit);
    expect(s.seen.length).toBe(before);
  });

  it('ignores non-task system messages', () => {
    clearTasks(SID);
    const s = sink();
    expect(ingestTaskEvent(SID, { type: 'system', subtype: 'compact_boundary' }, s.emit)).toBe(false);
    expect(s.seen.length).toBe(0);
  });
});
