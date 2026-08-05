// Live registry of the *agent-side* work a turn spawns — Task-tool subagents, backgrounded shells,
// local workflows, MCP monitors. None of it shows up as a normal assistant/tool block, so without
// this the UI can't tell that anything is running besides the main thread.
//
// The SDK reports all of it as `system` messages on the same turn stream:
//   task_started / task_progress / task_updated / task_notification  — per-task edges + progress
//   background_tasks_changed                                          — level snapshot (REPLACE semantics)
// We fold those into one ordered list per chat session and broadcast the whole list on every change
// (`tasks:update`); replace-the-set is what keeps a missed edge from wedging a stale running row.
//
// In-memory only, like the live-turn snapshot: the CLI subprocess is per-turn, so a background task
// can't outlive its turn anyway, and the history here is a convenience, not a record.
import { cfg } from '../lib/config-registry.js';

type Emit = (event: string, payload: any) => void;

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'stopped' | 'killed' | 'paused';

export interface AgentTask {
  id: string;            // SDK task_id
  toolUseId?: string;    // originating tool_use block (Task / Bash), when the task came from one
  kind: string;          // 'subagent' | 'shell' | 'workflow' | 'monitor' | raw task_type
  label: string;         // description: subagent task, shell command line, workflow name…
  agentType?: string;    // subagent type name ('code-reviewer', …)
  status: TaskStatus;
  background: boolean;   // backgrounded (Ctrl+B semantics) — still running, turn moved on
  ambient?: boolean;     // housekeeping task the CLI hides from the transcript (panel-only)
  startedAt: number;
  endedAt?: number;
  lastTool?: string;
  tokens?: number;
  toolUses?: number;
  durationMs?: number;
  summary?: string;
  error?: string;
}

const ENDED: TaskStatus[] = ['completed', 'failed', 'stopped', 'killed'];
const isEnded = (t: AgentTask) => ENDED.includes(t.status);

// sessionId -> taskId -> task. Both Maps are insertion-ordered, and `touch()` re-inserts the session
// key, so the outer Map doubles as an LRU for the session cap.
const perSession = new Map<string, Map<string, AgentTask>>();

export function tasksFor(sessionId: string): AgentTask[] {
  return [...(perSession.get(sessionId)?.values() ?? [])];
}

function touch(sessionId: string): Map<string, AgentTask> {
  let m = perSession.get(sessionId);
  if (m) perSession.delete(sessionId); // re-insert → most-recently-used last
  else m = new Map();
  perSession.set(sessionId, m);
  const maxSessions = cfg.int('taskSessionsMax');
  while (perSession.size > maxSessions) {
    const oldest = perSession.keys().next().value as string | undefined;
    if (oldest === undefined || oldest === sessionId) break;
    perSession.delete(oldest);
  }
  return m;
}

// Keep the newest `taskHistoryMax` entries, evicting finished tasks before live ones so a long
// session never drops a row that is still running.
function trim(m: Map<string, AgentTask>) {
  const max = cfg.int('taskHistoryMax');
  if (m.size <= max) return;
  for (const [id, t] of m) { if (m.size <= max) return; if (isEnded(t)) m.delete(id); }
  for (const id of m.keys()) { if (m.size <= max) return; m.delete(id); }
}

function kindOf(m: any): string {
  if (m?.subagent_type) return 'subagent';
  const tt = String(m?.task_type || '');
  if (!tt) return 'task';
  return tt === 'local_workflow' ? 'workflow' : tt;
}

function upsert(m: Map<string, AgentTask>, id: string, patch: Partial<AgentTask>): AgentTask {
  const cur = m.get(id);
  // A progress/notification edge can arrive for a task whose `task_started` we never saw (joined
  // mid-turn, unknown task type) — synthesize the row instead of dropping the update.
  const next: AgentTask = cur
    ? { ...cur, ...patch }
    : { id, kind: 'task', label: '', status: 'running', background: false, startedAt: Date.now(), ...patch };
  m.set(id, next);
  return next;
}

// Fold one `system` SDK message into the session's task list. Returns true when it was a task event
// (so the caller knows the message is accounted for); emits the whole list on any change.
export function ingestTaskEvent(sessionId: string, msg: any, emit: Emit): boolean {
  const sub = msg?.subtype;
  if (sub !== 'task_started' && sub !== 'task_progress' && sub !== 'task_updated'
    && sub !== 'task_notification' && sub !== 'background_tasks_changed') return false;
  if (!cfg.bool('taskPanelEnabled')) return true; // recognised, but tracking is off

  const m = touch(sessionId);
  switch (sub) {
    case 'task_started':
      upsert(m, String(msg.task_id), {
        toolUseId: msg.tool_use_id || undefined,
        kind: kindOf(msg),
        label: String(msg.description || msg.workflow_name || msg.prompt || '').slice(0, 400),
        agentType: msg.subagent_type || undefined,
        status: 'running',
        ambient: msg.skip_transcript ? true : undefined,
        startedAt: Date.now(),
      });
      trim(m);
      break;
    case 'task_progress':
      upsert(m, String(msg.task_id), {
        ...(msg.description ? { label: String(msg.description).slice(0, 400) } : {}),
        ...(msg.subagent_type ? { kind: 'subagent', agentType: msg.subagent_type } : {}),
        lastTool: msg.last_tool_name || undefined,
        tokens: msg.usage?.total_tokens,
        toolUses: msg.usage?.tool_uses,
        durationMs: msg.usage?.duration_ms,
        ...(msg.summary ? { summary: String(msg.summary).slice(0, 2000) } : {}),
      });
      break;
    case 'task_updated': {
      const p = msg.patch || {};
      const ended = p.status && ENDED.includes(p.status);
      upsert(m, String(msg.task_id), {
        ...(p.status ? { status: p.status } : {}),
        ...(p.description ? { label: String(p.description).slice(0, 400) } : {}),
        ...(p.error ? { error: String(p.error).slice(0, 2000) } : {}),
        ...(typeof p.is_backgrounded === 'boolean' ? { background: p.is_backgrounded } : {}),
        ...(ended ? { endedAt: p.end_time || Date.now(), background: false } : {}),
      });
      break;
    }
    case 'task_notification':
      upsert(m, String(msg.task_id), {
        toolUseId: msg.tool_use_id || undefined,
        status: msg.status as TaskStatus,
        endedAt: Date.now(),
        background: false,
        ...(msg.summary ? { summary: String(msg.summary).slice(0, 2000) } : {}),
        tokens: msg.usage?.total_tokens,
        toolUses: msg.usage?.tool_uses,
        durationMs: msg.usage?.duration_ms,
      });
      break;
    case 'background_tasks_changed': {
      // Level signal: exactly these ids are backgrounded right now. Anything we had flagged that is
      // no longer listed has settled (or was killed) — its own edge sets the final status.
      const live = new Set<string>();
      for (const t of msg.tasks || []) {
        const id = String(t?.task_id || '');
        if (!id) continue;
        live.add(id);
        const known = m.get(id);
        upsert(m, id, {
          kind: t.task_type || kindOf(t),
          ...(t.description ? { label: String(t.description).slice(0, 400) } : {}),
          background: true,
          ...(known ? {} : { status: 'running' as TaskStatus }),
        });
      }
      for (const [id, t] of m) if (t.background && !live.has(id)) m.set(id, { ...t, background: false });
      trim(m);
      break;
    }
  }
  emit('tasks:update', { sessionId, tasks: tasksFor(sessionId) });
  return true;
}

// The turn (and with it the CLI subprocess) is over, so nothing it spawned can still be alive —
// anything we never saw settle is dead. Called from runTurn's finally so an interrupt/crash can't
// leave a row spinning forever.
export function endRunningTasks(sessionId: string, emit: Emit) {
  const m = perSession.get(sessionId);
  if (!m) return;
  let changed = false;
  for (const [id, t] of m) {
    if (isEnded(t)) continue;
    m.set(id, { ...t, status: 'stopped', background: false, endedAt: Date.now() });
    changed = true;
  }
  if (changed) emit('tasks:update', { sessionId, tasks: tasksFor(sessionId) });
}

export function clearTasks(sessionId: string) { perSession.delete(sessionId); }
