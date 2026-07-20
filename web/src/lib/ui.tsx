import React from 'react';

export function initials(name?: string): string {
  const t = (name || '').trim();
  if (!t) return '?';
  const parts = t.split(/\s+/);
  if (parts.length === 1) return t.slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function Avatar({ name, color, size = 28, claude = false }: { name?: string; color?: string; size?: number; claude?: boolean }) {
  const style: React.CSSProperties = { width: size, height: size, fontSize: size * 0.4, background: claude ? 'var(--clay)' : color || '#5b6b8c' };
  return <div className="avatar" style={style}>{claude ? '✳' : initials(name)}</div>;
}

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간`;
  return `${Math.floor(s / 86400)}일`;
}
