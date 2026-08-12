import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { cfg } from '../lib/config-registry.js';

// Team/personal agent definitions → the SDK's programmatic `agents` option (no env var exists for
// this, and DB-driven beats materializing .claude/agents/*.md files into every home). A session gets
// every enabled common agent plus (for personal sessions) the owner's personal agents; a personal
// agent wins a name collision with a common one. `options.agent` (the main-thread persona) is a name
// into this map, validated both at PATCH time and at spawn time (a deleted agent degrades to default).

export const AGENT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
// Model-facing inputs written by users — cap them so a common agent can't blow up every turn's prompt.
export const MAX_DESCRIPTION = 1024;
export const MAX_PROMPT = 32 * 1024;

export interface AgentDef { description: string; prompt: string; tools?: string[]; model?: string }

type Row = typeof schema.teamAgents.$inferSelect;

const parseTools = (s: string): string[] => {
  try { const a = JSON.parse(s); return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []; }
  catch { return []; }
};

function toDef(r: Row): AgentDef {
  const tools = parseTools(r.tools);
  return {
    description: r.description,
    prompt: r.prompt,
    ...(tools.length ? { tools } : {}), // omit = inherit all tools
    ...(r.model ? { model: r.model } : {}),
  };
}

// Enabled agents for a session spawn. {} when the feature is off — buildOptions then omits `agents`.
export function resolveAgents(kind: 'user' | 'room', ownerId: string): Record<string, AgentDef> {
  if (!cfg.bool('teamAgentsEnabled')) return {};
  const out: Record<string, AgentDef> = {};
  const common = db.select().from(schema.teamAgents).where(eq(schema.teamAgents.scope, 'common')).all();
  for (const a of common) if (a.enabled) out[a.name] = toDef(a);
  if (kind === 'user') {
    const personal = db.select().from(schema.teamAgents)
      .where(and(eq(schema.teamAgents.scope, 'user'), eq(schema.teamAgents.ownerId, ownerId))).all();
    for (const a of personal) if (a.enabled) out[a.name] = toDef(a); // personal wins on collision
  }
  return out;
}

// ── CRUD (used by routes/agents.ts) ──

export type AgentScope = 'common' | 'user';

export function listAgents(userId: string): { common: Row[]; mine: Row[] } {
  return {
    common: db.select().from(schema.teamAgents).where(eq(schema.teamAgents.scope, 'common')).all(),
    mine: db.select().from(schema.teamAgents)
      .where(and(eq(schema.teamAgents.scope, 'user'), eq(schema.teamAgents.ownerId, userId))).all(),
  };
}

export function getAgent(id: string): Row | undefined {
  return db.select().from(schema.teamAgents).where(eq(schema.teamAgents.id, id)).get();
}

function validate(b: any): { name: string; description: string; prompt: string; tools: string[]; model: string | null } {
  const name = String(b?.name || '').trim();
  if (!AGENT_NAME_RE.test(name)) throw new Error('name must match ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$');
  const description = String(b?.description || '').trim();
  if (!description) throw new Error('description required');
  if (description.length > MAX_DESCRIPTION) throw new Error(`description too long (max ${MAX_DESCRIPTION})`);
  const prompt = String(b?.prompt || '').trim();
  if (!prompt) throw new Error('prompt required');
  if (prompt.length > MAX_PROMPT) throw new Error(`prompt too long (max ${MAX_PROMPT})`);
  const tools = Array.isArray(b?.tools) ? b.tools.map((t: any) => String(t).trim()).filter(Boolean) : [];
  const model = String(b?.model || '').trim() || null;
  return { name, description, prompt, tools, model };
}

export function createAgent(scope: AgentScope, ownerId: string, body: any): Row {
  const v = validate(body);
  const owner = scope === 'common' ? '' : ownerId;
  const dup = db.select().from(schema.teamAgents)
    .where(and(eq(schema.teamAgents.scope, scope), eq(schema.teamAgents.ownerId, owner), eq(schema.teamAgents.name, v.name))).get();
  if (dup) throw new Error(`an agent named '${v.name}' already exists in this scope`);
  const now = Date.now();
  const row = { id: newId(), scope, ownerId: owner, name: v.name, description: v.description, prompt: v.prompt, tools: JSON.stringify(v.tools), model: v.model, enabled: 1, createdAt: now, updatedAt: now };
  db.insert(schema.teamAgents).values(row).run();
  return row as Row;
}

export function updateAgent(id: string, body: any): Row {
  const existing = getAgent(id);
  if (!existing) throw new Error('not found');
  const v = validate({ ...existing, tools: parseTools(existing.tools), ...body });
  db.update(schema.teamAgents)
    .set({ name: v.name, description: v.description, prompt: v.prompt, tools: JSON.stringify(v.tools), model: v.model, updatedAt: Date.now() })
    .where(eq(schema.teamAgents.id, id)).run();
  return getAgent(id)!;
}

export function setAgentEnabled(id: string, enabled: boolean): void {
  db.update(schema.teamAgents).set({ enabled: enabled ? 1 : 0, updatedAt: Date.now() })
    .where(eq(schema.teamAgents.id, id)).run();
}

export function deleteAgent(id: string): void {
  db.delete(schema.teamAgents).where(eq(schema.teamAgents.id, id)).run();
}
