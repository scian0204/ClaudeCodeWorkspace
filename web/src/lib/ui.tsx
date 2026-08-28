import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { t, useT, useLang, setLang, LANGS, LANG_LABELS, type Lang } from './i18n';
import { useStore } from './store';
import { withKeys } from './shortcuts';
import { IconMenu, IconSparkle } from './icons';
import { mdHighlight } from './md';
import { guideInsetPx } from './guideinset';

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

// The guide launcher is a fixed circle over the viewport's bottom-right corner, so a composer row
// anchored down there must keep its buttons out from under it. How much room that takes depends on
// where the row actually ends — a centred 760px card on a wide screen already clears the launcher,
// a full-width one on a phone does not — so measure it instead of reserving a blanket 56px, which
// left the Send button visibly floating off the card's right edge. Returns [ref, paddingRight].
export function useGuideInset(enabled: boolean) {
  const [el, setEl] = useState<HTMLDivElement | null>(null); // callback ref: measure once mounted
  const [pad, setPad] = useState(0);
  const measure = React.useCallback(() => {
    if (!enabled || !el) { setPad(0); return; }
    // Measure the row's CONTAINER, never the row itself: the padding this hook sets can push the
    // row's own right edge outward, and that edge is the next measurement's input — the row then
    // asks for more padding, gets wider, asks again, and React tears the page down at 50 rounds.
    // The parent's box is the row's natural width and our padding cannot move it.
    const host = el.parentElement ?? el;
    setPad(guideInsetPx(host.getBoundingClientRect(), window.innerWidth, window.innerHeight));
  }, [enabled, el]);
  // Every commit, because the row can *move* without resizing (drawer slide, pane swap) and a
  // ResizeObserver only sees size. One getBoundingClientRect; setPad no-ops when nothing changed.
  React.useLayoutEffect(measure);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(measure); // pane resize (sidebar, split drag) with no re-render
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [el, measure]);
  return [setEl, pad] as const;
}

// ── stick-to-bottom scrollers ───────────────────────────────────────────────────────────────
// A streaming pane follows new output only while the reader is sitting at the bottom. Scrolling up
// mid-answer parks the view where they left it; coming back down resumes the follow. Growing
// content fires no scroll event, so the flag only ever flips on a real user scroll.
const STICK_SLACK_PX = 48; // "close enough to the bottom" — sub-pixel rounding must still count
export function useStickToBottom<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const stick = React.useRef(true);
  const onScroll = React.useCallback(() => {
    const el = ref.current; if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_SLACK_PX;
  }, []);
  const follow = React.useCallback(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, []);
  return { ref, onScroll, follow, stick };
}

// ── growing textareas + live markdown ───────────────────────────────────────────────────────
// A prompt box should follow its content instead of sitting at a fixed `rows`, up to a ceiling —
// past that it scrolls, so a pasted wall of text can never push the conversation off screen.
// (CSS `field-sizing: content` would do this without JS, but it is still missing in Firefox.)
const GROW_MAX_PX = 220;
export function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  React.useLayoutEffect(() => {
    const ta = ref.current; if (!ta) return;
    // keep the ceiling under half the viewport so the box stays usable on a phone in landscape
    const max = Math.min(GROW_MAX_PX, Math.max(96, Math.round(window.innerHeight * 0.4)));
    ta.style.height = 'auto';
    const need = ta.scrollHeight;
    ta.style.height = Math.min(need, max) + 'px';
    ta.style.overflowY = need > max ? 'auto' : 'hidden';
  }, [ref, value]);
}

// ↑/↓ in a composer walk your own past messages, the way a shell walks its command history. The
// list is derived from the thread the caller already renders (oldest → newest), so nothing extra is
// stored or persisted. Returns a keydown handler that reports whether it took the key.
// setText's second argument says whether the value is a recalled message (false = the draft coming
// back), so a caller whose menus open on typing can keep them shut while the box is being walked.
const HISTORY_MAX = 200;
export function useInputHistory(history: string[], text: string, setText: (v: string, recalled: boolean) => void) {
  const idx = React.useRef<number | null>(null); // 0 = newest entry, null = the live draft
  const draft = React.useRef('');                // what was in the box before we started walking
  const filled = React.useRef<string | null>(null); // last value we wrote — anything else means the user typed

  return (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
    if (e.nativeEvent.isComposing || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return false;
    const ta = e.currentTarget;
    const start = ta.selectionStart ?? 0, end = ta.selectionEnd ?? 0;
    if (start !== end) return false; // a selection is being extended — leave the arrows alone
    const up = e.key === 'ArrowUp';
    // only from the edge line: inside a multi-line draft the arrows still move the caret
    if (up ? text.slice(0, start).includes('\n') : text.slice(end).includes('\n')) return false;
    if (text !== filled.current) idx.current = null; // edited since we filled it in → a fresh draft again
    // newest last, consecutive repeats collapsed, capped so a long thread can't be walked forever
    const h = history.filter((v, i, a) => v && v !== a[i - 1]).slice(-HISTORY_MAX);
    if (!h.length) return false;

    let next: number | null;
    if (up) {
      next = idx.current === null ? 0 : idx.current + 1;
      if (next >= h.length) { e.preventDefault(); return true; } // oldest entry — stay on it
      if (idx.current === null) draft.current = text;
    } else {
      if (idx.current === null) return false; // not walking history → ↓ is just a caret key
      next = idx.current === 0 ? null : idx.current - 1;
    }
    e.preventDefault();
    idx.current = next;
    const v = next === null ? draft.current : h[h.length - 1 - next];
    filled.current = v;
    setText(v, next !== null);
    // after React has painted the recalled text, park the caret at its end
    requestAnimationFrame(() => { ta.setSelectionRange(v.length, v.length); });
    return true;
  };
}

// Live-markdown mirror for a textarea: same box, same metrics, painted behind transparent text so
// the textarea keeps the caret, the selection, IME composition and every menu wired to it. Styling
// is width-preserving by construction (see mdHighlight / the .mdh-* rules).
export function MdMirror({ text, taRef, className = '' }: {
  text: string; taRef: React.RefObject<HTMLTextAreaElement | null>; className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  // follow the textarea once it hits its ceiling and starts scrolling
  React.useLayoutEffect(() => {
    const ta = taRef.current, el = ref.current; if (!ta || !el) return;
    el.scrollTop = ta.scrollTop;
  }, [text, taRef]);
  useEffect(() => {
    const ta = taRef.current, el = ref.current; if (!ta || !el) return;
    const sync = () => { el.scrollTop = ta.scrollTop; };
    ta.addEventListener('scroll', sync);
    return () => ta.removeEventListener('scroll', sync);
  }, [taRef]);
  return (
    <div ref={ref} aria-hidden
      className={`absolute inset-0 overflow-hidden whitespace-pre-wrap break-words pointer-events-none select-none ${className}`}
      dangerouslySetInnerHTML={{ __html: mdHighlight(text) }} />
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
