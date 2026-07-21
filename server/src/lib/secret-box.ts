import crypto from 'node:crypto';
import { config } from '../config.js';

// AES-256-GCM at-rest encryption for stored secrets (Claude tokens). Lightweight posture
// per DESIGN.md — one server-held key, no per-record key rotation. Key is derived from
// TOKEN_ENC_SECRET (or SESSION_SECRET fallback); changing either invalidates stored tokens
// (decrypt throws → callers treat as "no token" and users re-register).
const KEY = crypto.scryptSync(config.tokenEncSecret || config.sessionSecret, 'ccw-token-box-v1', 32);

// Format: ivHex:tagHex:cipherHex
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decrypt(blob: string): string {
  const [ivH, tagH, dataH] = blob.split(':');
  if (!ivH || !tagH || !dataH) throw new Error('bad blob');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivH, 'hex'));
  d.setAuthTag(Buffer.from(tagH, 'hex'));
  return Buffer.concat([d.update(Buffer.from(dataH, 'hex')), d.final()]).toString('utf8');
}

// Claude Code tokens: OAuth token (sk-ant-oat*, `claude setup-token`) or plain API key (sk-ant-api*).
export function validTokenFormat(t: string): boolean {
  const s = (t || '').trim();
  return /^sk-ant-(oat|api)/.test(s) && s.length >= 20;
}
