import { and, eq, gte, sql, type SQL } from 'drizzle-orm';
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

export function usageTotals() {
  const r = db.select({
    inputTokens: sql<number>`coalesce(sum(${schema.usage.inputTokens}),0)`,
    outputTokens: sql<number>`coalesce(sum(${schema.usage.outputTokens}),0)`,
    costUsd: sql<number>`coalesce(sum(${schema.usage.costUsd}),0)`,
    turns: sql<number>`count(*)`,
  }).from(schema.usage).get();
  return r;
}

export function usageByUser() {
  return db.select({
    userId: schema.usage.userId,
    inputTokens: sql<number>`coalesce(sum(${schema.usage.inputTokens}),0)`,
    outputTokens: sql<number>`coalesce(sum(${schema.usage.outputTokens}),0)`,
    costUsd: sql<number>`coalesce(sum(${schema.usage.costUsd}),0)`,
    turns: sql<number>`count(*)`,
  }).from(schema.usage).groupBy(schema.usage.userId).all();
}

// ── local spend ledger ──
// What an API-key (or bedrock/vertex/custom) session has INSTEAD of claude.ai plan limits: those
// accounts have no plan window at all, so the CLI reports rate_limits_available=false and the usage
// popover had nothing to show. These are our own recorded turns, not an Anthropic figure.
// Session total is author-agnostic (a room's turns come from several members); the rolling 5h/7d
// windows are per-user, mirroring the plan windows they stand in for.
export interface Spend { inputTokens: number; outputTokens: number; costUsd: number; turns: number }
export function spendSummary(userId: string, sessionId: string): { session: Spend; fiveHour: Spend; sevenDay: Spend } {
  const sum = (where: SQL | undefined): Spend => db.select({
    inputTokens: sql<number>`coalesce(sum(${schema.usage.inputTokens}),0)`,
    outputTokens: sql<number>`coalesce(sum(${schema.usage.outputTokens}),0)`,
    costUsd: sql<number>`coalesce(sum(${schema.usage.costUsd}),0)`,
    turns: sql<number>`count(*)`,
  }).from(schema.usage).where(where).get()!;
  const mine = (windowMs: number) =>
    and(eq(schema.usage.userId, userId), gte(schema.usage.createdAt, Date.now() - windowMs));
  return {
    session: sum(eq(schema.usage.sessionId, sessionId)),
    fiveHour: sum(mine(5 * 60 * 60 * 1000)),
    sevenDay: sum(mine(7 * 24 * 60 * 60 * 1000)),
  };
}

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
