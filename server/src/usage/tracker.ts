import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';

export function recordUsage(o: {
  userId: string; sessionId?: string | null; roomId?: string | null;
  inputTokens: number; outputTokens: number; costUsd: number;
}) {
  db.insert(schema.usage).values({
    id: newId(), userId: o.userId, sessionId: o.sessionId ?? null, roomId: o.roomId ?? null,
    inputTokens: o.inputTokens || 0, outputTokens: o.outputTokens || 0, costUsd: o.costUsd || 0,
    createdAt: Date.now(),
  }).run();
}

// The workspace-aggregate displays are gone (admin usage tab, then the popover's spend ledger —
// subscription turns report no billing cost, so the homegrown figures read as broken next to real
// plan windows). recordUsage keeps writing: the rows cost nothing, the admin resource cleanup
// manages them, and a future ops view can read them without a migration.

// ── skill usage ──
// Bump one (user, skill) counter. The key is stored raw; matching to a plugin's skills happens at
// read time (plugins/manager.skillKey), so nothing here breaks when a plugin is renamed.
export function recordSkillUse(userId: string, skill: string) {
  const now = Date.now();
  db.insert(schema.skillUsage).values({ userId, skill, count: 1, lastAt: now })
    .onConflictDoUpdate({
      target: [schema.skillUsage.userId, schema.skillUsage.skill],
      set: { count: sql`${schema.skillUsage.count} + 1`, lastAt: now },
    }).run();
}

// Which skills did a turn invoke? Two paths reach the CLI:
//  1. the prompt itself is a slash command — the composer's palette fills "/name …" as the prompt,
//     and a skill's slash command is expanded by the CLI (no tool call to observe);
//  2. the model calls the Skill (or SlashCommand) tool mid-turn.
// Non-skill commands (/model, /compact …) are counted too but filtered out at read time, where the
// installed skill list is known — that keeps write-time free of an fs scan per turn.
export function turnSkillKeys(
  promptText: string,
  blocks: { type: string; name?: string; input?: any; [k: string]: unknown }[], // SDK blocks carry more per type (text, thinking, …)
): string[] {
  const out: string[] = [];
  const push = (raw: unknown) => {
    const m = String(raw ?? '').trim().match(/^\/?([A-Za-z0-9][\w.:-]*)/);
    if (m) out.push(m[1]);
  };
  if (promptText.trimStart().startsWith('/')) push(promptText.trimStart());
  for (const b of blocks) {
    if (b.type !== 'tool_use') continue;
    if (b.name === 'Skill') push(b.input?.skill);
    else if (b.name === 'SlashCommand') push(b.input?.command);
  }
  return out;
}

// Every skill counter with its owner's display name. Inner join: a deleted user's leftover rows
// drop out of all reporting (the admin resource cleanup sweeps them for real).
export function skillUsageRows() {
  return db.select({
    userId: schema.skillUsage.userId,
    name: schema.users.displayName,
    skill: schema.skillUsage.skill,
    count: schema.skillUsage.count,
    lastAt: schema.skillUsage.lastAt,
  }).from(schema.skillUsage)
    .innerJoin(schema.users, eq(schema.users.id, schema.skillUsage.userId)).all();
}
