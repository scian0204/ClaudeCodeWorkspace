import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { listCcwContainers } from '../lib/docker-images.js';
import { listActiveTurns, interruptTurn } from '../claude/session-manager.js';
import { allQueueStates, cancelQueued } from '../rooms/queue.js';
import { killEditor } from '../codeserver/manager.js';
import { killSessionSandbox } from '../claude/session-sandbox.js';
import { killSandbox } from '../review/sandbox.js';

// Admin "activity / processes" — a live task-manager view over the runtime activity the server
// already manages (running/queued Claude turns, code-server editor containers, review sandbox
// containers, running review pipelines) plus per-item controls. NOT an agent-orchestration
// framework — it's a read/kill window over existing in-memory / docker / DB state.

export interface ProcTurn { sessionId: string; title: string; kind: string; author: { id: string; name: string }; startedAt: number; elapsedMs: number }
export interface ProcQueued { sessionId: string; itemId: string; author: { id: string; name: string } }
export interface ProcEditor { id: string; name: string; owner: string; project: string; state: string; createdAt: number }
export interface ProcSandbox { id: string; name: string; state: string; createdAt: number }
export interface ProcPipeline { reviewId: string; prNumber: number; prTitle: string; repoName: string; chatSessionId: string }
export interface ProcessList {
  turns: ProcTurn[]; queued: ProcQueued[]; editors: ProcEditor[]; sandboxes: ProcSandbox[];
  reviewPipelines: ProcPipeline[]; dockerUnavailable: boolean;
}

export async function listProcesses(): Promise<ProcessList> {
  const now = Date.now();

  // ── turns (in-memory) — resolve title/kind from the chat_sessions row ──
  const active = listActiveTurns();
  const sessMap = new Map(db.select().from(schema.chatSessions).all().map((s) => [s.id, s]));
  const turns: ProcTurn[] = active.map((t) => {
    const s = sessMap.get(t.sessionId);
    return { sessionId: t.sessionId, title: s?.title || t.sessionId, kind: s?.kind || 'private', author: t.author, startedAt: t.startedAt, elapsedMs: now - t.startedAt };
  });

  // ── queued (in-memory) — waiting items only (the running one is a turn above) ──
  const queued: ProcQueued[] = allQueueStates().flatMap((q) =>
    q.waiting.map((w) => ({ sessionId: q.sessionId, itemId: w.id, author: w.author })));

  // ── containers (docker) — degrade to empty + flag if the socket is missing/down ──
  let editors: ProcEditor[] = [];
  let sandboxes: ProcSandbox[] = [];
  let dockerUnavailable = false;
  try {
    const users = new Map(db.select().from(schema.users).all().map((u) => [u.id, u.displayName]));
    const rooms = new Map(db.select().from(schema.rooms).all().map((r) => [r.id, r.name]));
    const projects = new Map(db.select().from(schema.projects).all().map((p) => [p.id, p.name]));
    const eds = await listCcwContainers('ccw.codeserver=1');
    // both build-container kinds render the same row: per-PR review sandboxes and per-session ones
    const sbx = [...await listCcwContainers('ccw.reviewsandbox=1'), ...await listCcwContainers('ccw.sessionsandbox=1')];
    editors = eds.map((c): ProcEditor => {
      const oid = c.labels['ccw.owner']; const pid = c.labels['ccw.project'];
      return { id: c.id, name: c.name, owner: users.get(oid) || rooms.get(oid) || oid || '', project: projects.get(pid) || pid || '', state: c.state, createdAt: c.createdAt };
    });
    sandboxes = sbx.map((c): ProcSandbox => ({ id: c.id, name: c.name, state: c.state, createdAt: c.createdAt }));
  } catch { dockerUnavailable = true; }

  // ── review pipelines (DB) — review_sessions mid-run (verdict='running') ──
  const repoNames = new Map(db.select().from(schema.reviewRepos).all().map((r) => [r.id, r.name]));
  const reviewPipelines: ProcPipeline[] = db.select().from(schema.reviewSessions)
    .where(eq(schema.reviewSessions.verdict, 'running')).all()
    .map((rv): ProcPipeline => ({ reviewId: rv.id, prNumber: rv.prNumber, prTitle: rv.prTitle, repoName: repoNames.get(rv.repoId) || rv.repoId, chatSessionId: rv.chatSessionId }));

  return { turns, queued, editors, sandboxes, reviewPipelines, dockerUnavailable };
}

// Run one control action. Validates kind + required ids; returns a small result. The route re-runs
// listProcesses() afterwards so the client sees the fresh state.
export async function controlProcess(kind: string, action: string, ids: { sessionId?: string; itemId?: string; id?: string; chatSessionId?: string }): Promise<{ ok: boolean }> {
  switch (kind) {
    case 'turn':
      if (action !== 'stop' || !ids.sessionId) throw new Error('turn: stop + sessionId required');
      return { ok: interruptTurn(ids.sessionId) };
    case 'queued':
      if (action !== 'cancel' || !ids.sessionId || !ids.itemId) throw new Error('queued: cancel + sessionId + itemId required');
      return { ok: cancelQueued(ids.sessionId, ids.itemId) };
    case 'editor':
      if (action !== 'stop' || !ids.id) throw new Error('editor: stop + id required');
      return { ok: await killEditor(ids.id) };
    case 'sandbox':
      if (action !== 'stop' || !ids.id) throw new Error('sandbox: stop + id required');
      // one id, two kinds: the session killer force-removes by id either way and also drops the
      // in-memory entry when it is a session container
      return { ok: (await killSessionSandbox(ids.id)) || (await killSandbox(ids.id)) };
    case 'pipeline':
      // "stop" a running review pipeline = interrupt the Claude turn driving its chat session.
      if (action !== 'stop' || !ids.chatSessionId) throw new Error('pipeline: stop + chatSessionId required');
      return { ok: interruptTurn(ids.chatSessionId) };
    default:
      throw new Error(`unknown process kind: ${kind}`);
  }
}
