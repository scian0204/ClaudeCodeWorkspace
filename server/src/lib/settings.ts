import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export function getSetting(key: string, def: string): string {
  const r = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  return r ? r.value : def;
}
export function setSetting(key: string, value: string) {
  const r = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  if (r) db.update(schema.settings).set({ value }).where(eq(schema.settings.key, key)).run();
  else db.insert(schema.settings).values({ key, value }).run();
}
export function allowBypass(): boolean {
  return getSetting('allow_bypass', '1') === '1';
}
