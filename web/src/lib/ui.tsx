import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { t, useT, useLang, toggleLang } from './i18n';
import { useStore } from './store';
import { IconMenu, IconSparkle } from './icons';

// Tailwind `md` breakpoint (768px). React needs JS to branch on viewport (e.g. force chat-only
// layout, skip the code-server iframe) since those decisions can't be pure CSS show/hide.
const MOBILE_MQ = '(max-width: 767px)';
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(MOBILE_MQ); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); },
    () => window.matchMedia(MOBILE_MQ).matches,
    () => false, // SSR/first paint: assume desktop
  );
}

// Hamburger that opens the off-canvas sidebar drawer. Hidden ≥md (sidebar is a static column there).
// Dropped into every top bar so the drawer is reachable from any view.
export function MobileMenuButton({ className }: { className?: string }) {
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const tr = useT();
  return (
    <button className={`toolbtn md:hidden shrink-0 ${className || ''}`} aria-label={tr('nav.openMenu')} title={tr('nav.openMenu')}
      onClick={() => setSidebarOpen(true)}><IconMenu /></button>
  );
}

export function initials(name?: string): string {
  const t = (name || '').trim();
  if (!t) return '?';
  const parts = t.split(/\s+/);
  if (parts.length === 1) return t.slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function Avatar({ name, color, size = 28, claude = false, src }: { name?: string; color?: string; size?: number; claude?: boolean; src?: string }) {
  const [imgErr, setImgErr] = useState(false);
  useEffect(() => setImgErr(false), [src]); // a new src gets a fresh chance to load
  const style: React.CSSProperties = { width: size, height: size, fontSize: size * 0.4, background: claude ? 'var(--clay)' : color || '#5b6b8c' };
  // On load failure, fall through to the initials badge instead of a broken-image icon.
  if (src && !claude && !imgErr) return <img src={src} alt={name || ''} onError={() => setImgErr(true)} className="avatar object-cover shrink-0" style={{ width: size, height: size }} />;
  return <div className="avatar" style={style}>{claude ? <IconSparkle size={size * 0.5} /> : initials(name)}</div>;
}

// Build the <img> src for a user's avatar: the API stream (cache-busted by the version token),
// or a data: URL passed straight through (the static demo stashes the picked image inline).
export function avatarUrl(u?: { id: string; avatar?: string | null } | null): string | undefined {
  if (!u?.avatar) return undefined;
  return u.avatar.startsWith('data:') ? u.avatar : `/api/users/${u.id}/avatar?v=${encodeURIComponent(u.avatar)}`;
}

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return t('time.justNow');
  if (s < 3600) return t('time.minutes', { n: Math.floor(s / 60) });
  if (s < 86400) return t('time.hours', { n: Math.floor(s / 3600) });
  return t('time.days', { n: Math.floor(s / 86400) });
}

// Language switcher — reused in the chat header and the login page.
export function LangToggle({ className }: { className?: string }) {
  const lang = useLang();
  const tr = useT();
  return (
    <button type="button" className={className || 'toolbtn'} title={tr('lang.toggleTitle')} onClick={toggleLang}>
      {lang === 'ko' ? '한' : 'EN'}
    </button>
  );
}
