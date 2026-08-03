// Keyboard shortcuts. ONE table (SHORTCUT_GROUPS) drives both the global key handler and the help
// dialog, so a binding can never be listed without working (or work without being listed).
//
// Specs are written platform-neutral with 'Mod' = ⌘ on macOS / Ctrl elsewhere; fmtKeys() renders them
// the way each platform writes them (⇧⌘O vs Ctrl+Shift+O).
import { useEffect } from 'react';
import { useStore } from './store';

const ua = typeof navigator !== 'undefined' ? `${(navigator as any).platform || ''} ${navigator.userAgent || ''}` : '';
export const isMac = /mac|iphone|ipad|ipod/i.test(ua);

const MODS = ['Ctrl', 'Alt', 'Shift', 'Mod'] as const; // mac renders modifiers in this order: ⌃⌥⇧⌘
const MAC_SYM: Record<string, string> = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃', Enter: '↩', Esc: 'esc', RClick: 'right-click' };
const PC_SYM: Record<string, string> = { Mod: 'Ctrl', RClick: 'right-click' };

// 'Mod+Shift+O' → mac '⇧⌘O' (symbols, no separator) · win/linux 'Ctrl+Shift+O'
// (mac is a parameter, not just the module flag, so the other platform's rendering is checkable)
export function fmtKeys(spec: string, mac = isMac): string {
  const parts = spec.split('+');
  if (!mac) return parts.map((p) => PC_SYM[p] || p).join('+');
  const mods = MODS.filter((m) => parts.includes(m)).map((m) => MAC_SYM[m]);
  const keys = parts.filter((p) => !(MODS as readonly string[]).includes(p)).map((p) => MAC_SYM[p] || p);
  return mods.join('') + keys.join('');
}

// Label a button with its shortcut: "New chat (⇧⌘O)".
export function withKeys(label: string, spec: string): string {
  return `${label} (${fmtKeys(spec)})`;
}

export interface ShortcutRow { keys: string[]; label: string } // label = i18n key
export const SHORTCUT_GROUPS: { label: string; rows: ShortcutRow[] }[] = [
  {
    label: 'sc.group.global',
    rows: [
      { keys: ['Mod+K', 'Mod+/'], label: 'sc.search' },
      { keys: ['Mod+Shift+O'], label: 'sc.newChat' },
      { keys: ['Mod+B'], label: 'sc.sidebar' },
      { keys: ['Mod+Shift+H'], label: 'sc.home' },
      { keys: ['Mod+Shift+L'], label: 'sc.theme' },
      { keys: ['?'], label: 'sc.help' },
      { keys: ['Shift+RClick'], label: 'sc.nativeMenu' },
    ],
  },
  {
    label: 'sc.group.chat',
    rows: [
      { keys: ['Enter'], label: 'sc.send' },
      { keys: ['Shift+Enter'], label: 'sc.newline' },
      { keys: ['Esc'], label: 'sc.interrupt' },
      { keys: ['/'], label: 'sc.slash' },
      { keys: ['@'], label: 'sc.at' },
    ],
  },
  {
    label: 'sc.group.search',
    rows: [
      { keys: ['↑', '↓'], label: 'sc.resultMove' },
      { keys: ['Enter'], label: 'sc.resultOpen' },
      { keys: ['Esc'], label: 'sc.resultClose' },
    ],
  },
];

// Mod+B semantics, shared with the context menu: <md the sidebar is an off-canvas drawer, ≥md it's
// a collapsible column (same key, both).
export function toggleSidebar(): void {
  const s = useStore.getState();
  if (window.matchMedia('(max-width: 767px)').matches) s.setSidebarOpen(!s.sidebarOpen);
  else s.setSidebarCollapsed(!s.sidebarCollapsed);
}

const isTyping = (el: EventTarget | null): boolean => {
  const n = el as HTMLElement | null;
  return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.isContentEditable);
};

// Mounted once by Shell. Mod-combos fire even while typing (they can't be confused with text);
// bare '?' only outside a text field.
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // an open dialog (search palette, any modal) owns the keyboard — Radix handles Esc/Tab there
      if (document.querySelector('[role="dialog"]')) return;
      const s = useStore.getState();
      if (!s.user) return; // login screen has nothing to drive
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        if (!e.shiftKey && (k === 'k' || k === '/')) {
          if (!s.searchEnabled) return;
          e.preventDefault(); s.setSearchOpen(true);
        } else if (e.shiftKey && k === 'o') { e.preventDefault(); void s.newSession(); }
        else if (!e.shiftKey && k === 'b') { e.preventDefault(); toggleSidebar(); }
        else if (e.shiftKey && k === 'h') { e.preventDefault(); s.goHome(); }
        else if (e.shiftKey && k === 'l') { e.preventDefault(); s.toggleTheme(); }
        return;
      }
      if (e.key === '?' && !isTyping(e.target)) { e.preventDefault(); s.setShortcutsOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
