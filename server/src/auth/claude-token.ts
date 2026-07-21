import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import { getSetting, setSetting } from '../lib/settings.js';
import { encrypt, decrypt, validTokenFormat } from '../lib/secret-box.js';

export type TokenSource = 'user' | 'shared' | 'none';
export interface TokenMeta { hasToken: boolean; setAt: number | null }

const COMMON_ENC = 'claude_common_token_enc';
const COMMON_AT = 'claude_common_token_set_at';

// ── per-user token ──
export function setUserToken(userId: string, token: string): void {
  const t = token.trim();
  if (!validTokenFormat(t)) throw new Error('invalid token format (expect sk-ant-oat… or sk-ant-api…)');
  db.update(schema.users)
    .set({ claudeTokenEnc: encrypt(t), claudeTokenSetAt: Date.now() })
    .where(eq(schema.users.id, userId)).run();
}
export function clearUserToken(userId: string): void {
  db.update(schema.users)
    .set({ claudeTokenEnc: null, claudeTokenSetAt: null })
    .where(eq(schema.users.id, userId)).run();
}
export function userTokenMeta(userId: string): TokenMeta {
  const u = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  return { hasToken: !!u?.claudeTokenEnc, setAt: u?.claudeTokenSetAt ?? null };
}

// ── admin-managed common token (shared fallback) ──
export function setCommonToken(token: string): void {
  const t = token.trim();
  if (!validTokenFormat(t)) throw new Error('invalid token format (expect sk-ant-oat… or sk-ant-api…)');
  setSetting(COMMON_ENC, encrypt(t));
  setSetting(COMMON_AT, String(Date.now()));
}
export function clearCommonToken(): void {
  setSetting(COMMON_ENC, '');
  setSetting(COMMON_AT, '');
}
export function commonTokenMeta(): TokenMeta {
  const enc = getSetting(COMMON_ENC, '');
  const at = Number(getSetting(COMMON_AT, '') || 0);
  // env fallback counts as "configured" but has no set-at timestamp
  const has = !!enc || !!config.anthropicApiKey;
  return { hasToken: has, setAt: enc && at ? at : null };
}

// Decrypted shared token: admin-set (DB) first, else legacy env. '' if neither.
export function getCommonToken(): string {
  const enc = getSetting(COMMON_ENC, '');
  if (enc) { try { return decrypt(enc); } catch { /* corrupt/rekeyed → fall through */ } }
  return config.anthropicApiKey;
}

// ── resolution: whose token runs this turn ──
// Precedence: user's own token → admin common token (DB) → env → none(mock).
// MOCK_CLAUDE=1 forces mock regardless.
export function resolveClaudeAuth(userId: string | null): { token: string; source: TokenSource } {
  if (config.forceMock) return { token: '', source: 'none' };
  if (userId) {
    const u = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    if (u?.claudeTokenEnc) {
      try { return { token: decrypt(u.claudeTokenEnc), source: 'user' }; }
      catch { /* corrupt/rekeyed → fall back to shared */ }
    }
  }
  const shared = getCommonToken();
  if (shared) return { token: shared, source: 'shared' };
  return { token: '', source: 'none' };
}
