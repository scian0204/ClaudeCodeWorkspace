import { customAlphabet } from 'nanoid';

const alpha = '0123456789abcdefghijklmnopqrstuvwxyz';
export const newId = customAlphabet(alpha, 16);
export const newToken = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 32);

const COLORS = ['#5b6b8c', '#8c5b6b', '#5b8c6b', '#6b5b8c', '#8c7a5b', '#5b8c8a', '#8c5b8a', '#7a8c5b'];
export function colorFor(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}
export function initials(name: string): string {
  const t = name.trim();
  if (!t) return '?';
  const parts = t.split(/\s+/);
  if (parts.length === 1) return t.slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
