// Member request → admin approval framework. A tiny action registry: each entry declares the form
// fields a member fills in, a validator, and an execute() that runs the real (admin-only) server
// logic by importing the existing create functions (no duplication). Adding a new requestable admin
// action = add one entry to ACTIONS. The routes (routes/requests.ts) and the UI form are derived
// from this registry, so nothing else needs to change.
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getUserById, toAuthUser, type AuthUser } from '../auth/index.js';
import { newId } from '../lib/ids.js';
import { createCommonProject } from '../routes/projects.js';
import { createWikiTopic } from '../routes/wiki.js';

export interface ActionField { key: string; type: 'text' | 'textarea'; required: boolean; }
export interface AdminAction {
  label: string;                 // action key (UI resolves a friendly i18n label from it)
  fields: ActionField[];         // form fields the UI renders for the payload
  validate(payload: any, requester: AuthUser): void;                    // throw Error on bad input
  execute(payload: any, requester: AuthUser): Promise<string> | string; // returns a human-readable result
}

function reqStr(payload: any, key: string): string {
  const v = payload && typeof payload === 'object' ? payload[key] : undefined;
  return typeof v === 'string' ? v.trim() : '';
}

export const ACTIONS: Record<string, AdminAction> = {
  // create a shared common project by name
  common_project: {
    label: 'common_project',
    fields: [{ key: 'name', type: 'text', required: true }],
    validate(p) { if (!reqStr(p, 'name')) throw new Error('name required'); },
    execute(p) { const proj = createCommonProject(reqStr(p, 'name')); return `공통 프로젝트 생성됨: ${proj.name}`; },
  },
  // create an LLM Wiki topic; createdBy = the requesting member
  wiki_topic: {
    label: 'wiki_topic',
    fields: [{ key: 'name', type: 'text', required: true }, { key: 'description', type: 'textarea', required: false }],
    validate(p) { if (!reqStr(p, 'name')) throw new Error('name required'); },
    execute(p, requester) {
      const topic = createWikiTopic({ name: reqStr(p, 'name'), description: reqStr(p, 'description'), createdBy: requester.id });
      return `위키 주제 생성됨: ${topic.name}`;
    },
  },
  // promote the REQUESTER to admin. The subject is ALWAYS requester.id — payload can NOT name a
  // different target user, so this can never be used to escalate someone else's privileges.
  role_upgrade: {
    label: 'role_upgrade',
    fields: [],
    validate() { /* nothing to validate: acts only on the requester, no payload */ },
    execute(_p, requester) {
      db.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.id, requester.id)).run();
      return `${requester.username} 권한을 admin으로 승격`;
    },
  },
};

// Registry projection for GET /api/requests/actions — lets the UI render a form per action.
export function actionList() {
  return Object.entries(ACTIONS).map(([type, a]) => ({ type, label: a.label, fields: a.fields }));
}

function getRequest(id: string) {
  return db.select().from(schema.adminRequests).where(eq(schema.adminRequests.id, id)).get();
}

// Validate the type + payload and insert a pending request. Throws on unknown type / invalid payload.
export function submitRequest(requester: AuthUser, type: string, payload: any, reason: string) {
  const action = ACTIONS[type];
  if (!action) throw new Error(`unknown action type: ${type}`);
  action.validate(payload ?? {}, requester); // throws on invalid payload
  const now = Date.now();
  const row = {
    id: newId(), requesterId: requester.id, type,
    payload: JSON.stringify(payload ?? {}), reason: String(reason || ''),
    status: 'pending' as const, reviewerId: null, decidedAt: null, result: null,
    createdAt: now, updatedAt: now,
  };
  db.insert(schema.adminRequests).values(row).run();
  return row;
}

// Admin sees every request; a member sees only their own. Newest first.
export function listRequests(forUser: AuthUser) {
  if (forUser.role === 'admin') {
    return db.select().from(schema.adminRequests).orderBy(desc(schema.adminRequests.createdAt)).all();
  }
  return db.select().from(schema.adminRequests)
    .where(eq(schema.adminRequests.requesterId, forUser.id)).orderBy(desc(schema.adminRequests.createdAt)).all();
}

// Approve or reject a request. Idempotent: only a still-`pending` request can be decided, so an
// action executes AT MOST ONCE (a second decide — concurrent or repeated — throws and does nothing).
// On approve, run the action AS THE ORIGINAL REQUESTER and store the result; on reject store the note.
export async function decideRequest(reviewer: AuthUser, id: string, approve: boolean, note?: string) {
  const r = getRequest(id);
  if (!r) throw new Error('request not found');
  if (r.status !== 'pending') throw new Error('request already decided'); // fast path; the claim below is the real guard
  const now = Date.now();
  // Atomically claim the request: this UPDATE only matches while status is still 'pending'. SQLite is
  // a single writer, so of two concurrent decides exactly one gets changes===1 and runs execute().
  const claim = db.update(schema.adminRequests)
    .set({
      status: approve ? 'approved' : 'rejected', reviewerId: reviewer.id, decidedAt: now, updatedAt: now,
      result: approve ? null : (note ? String(note) : null),
    })
    .where(and(eq(schema.adminRequests.id, id), eq(schema.adminRequests.status, 'pending'))).run();
  if (claim.changes === 0) throw new Error('request already decided');
  if (!approve) return getRequest(id)!;
  // approved → execute. role_upgrade promotes the requester; wiki_topic attributes createdBy to them,
  // so we run as the ORIGINAL requester, never the reviewer. Status stays 'approved' either way, so a
  // failing action can't be retried into a double-execution — the error is surfaced via `result`.
  const requesterRow = getUserById(r.requesterId);
  let result: string;
  try {
    if (!requesterRow) throw new Error('requester no longer exists');
    result = await ACTIONS[r.type].execute(JSON.parse(r.payload || '{}'), toAuthUser(requesterRow));
  } catch (e: any) {
    result = `오류: ${String(e?.message || e)}`;
  }
  db.update(schema.adminRequests).set({ result, updatedAt: Date.now() }).where(eq(schema.adminRequests.id, id)).run();
  return getRequest(id)!;
}
