import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { t, useT, useLang, setLang, LANGS, LANG_LABELS, type Lang } from './i18n';
import { useStore } from './store';
import { withKeys } from './shortcuts';
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

// Hamburger in every top bar. <md: opens the off-canvas drawer (always visible). ≥md: shown only
// once the sidebar column is collapsed, where it brings the column back.
export function MobileMenuButton({ className }: { className?: string }) {
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const setSidebarCollapsed = useStore((s) => s.setSidebarCollapsed);
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const isMobile = useIsMobile();
  const tr = useT();
  const label = tr(isMobile ? 'nav.openMenu' : 'nav.expandSidebar');
  return (
    <button className={`toolbtn shrink-0 ${collapsed ? '' : 'md:hidden'} ${className || ''}`} aria-label={label} title={withKeys(label, 'Mod+B')}
      onClick={() => (isMobile ? setSidebarOpen(true) : setSidebarCollapsed(false))}><IconMenu /></button>
  );
}

// ── waiting on the model ────────────────────────────────────────────────────────────────────
// One signature mark for every "Claude is thinking" spot (an answer streaming in, a wiki compile,
// a chat being named), so the wait always looks like this app and not like a stock spinner. The
// motion lives in styles/index.css; reduced-motion freezes it into a static badge.

// The brand mark's three dots (favicon.svg) travelling as a wave. Sits next to text.
export function ClayDots({ size = 6, className }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[3px] shrink-0 ${className || ''}`}
      style={{ '--cdot': `${size}px` } as React.CSSProperties} aria-hidden>
      <i className="cdot" /><i className="cdot" /><i className="cdot" />
    </span>
  );
}

// For icon-button slots: the sparkle that names a chat, breathing inside a turning clay ring —
// the idle icon coming alive rather than being swapped for a foreign spinner.
export function ClaySpark({ size = 14 }: { size?: number }) {
  return (
    <span className="cspark" style={{ width: size, height: size }} aria-hidden>
      <svg className="cs-ring" viewBox="0 0 24 24" width={size} height={size} fill="none">
        <circle cx="12" cy="12" r="10.5" stroke="currentColor" strokeWidth="2.5" strokeOpacity=".18" />
        <circle cx="12" cy="12" r="10.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray="17 49" />
      </svg>
      <span className="cs-core"><IconSparkle size={Math.max(7, Math.round(size * 0.5))} /></span>
    </span>
  );
}

// A whole waiting line: the mark plus a label a clay glint travels through.
export function ClayWait({ label, size = 6, className }: { label: string; size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 min-w-0 ${className || ''}`} role="status">
      <ClayDots size={size} />
      <span className="clay-shimmer truncate">{label}</span>
    </span>
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

// Language picker — reused on the login page and in the sidebar footer. A list, not a toggle: adding
// a language means adding it to LANGS, nothing here changes.
export function LangSelect({ className }: { className?: string }) {
  const lang = useLang();
  const tr = useT();
  return (
    <select className={className || 'input !w-auto !py-1 !text-xs'} value={lang} title={tr('lang.pickTitle')}
      aria-label={tr('lang.pickTitle')} onChange={(e) => setLang(e.target.value as Lang)}>
      {LANGS.map((l) => <option key={l} value={l}>{LANG_LABELS[l]}</option>)}
    </select>
  );
}
