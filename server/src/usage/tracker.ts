import { sql } from 'drizzle-orm';
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
