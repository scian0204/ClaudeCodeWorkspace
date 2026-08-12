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
      { keys: ['Alt+↑', 'Alt+↓'], label: 'sc.threadMove' },
      { keys: ['Mod+Shift+E'], label: 'sc.tasksToggle' },
      { keys: ['Mod+Shift+G'], label: 'sc.gitPanel' },
      { keys: ['Mod+Shift+F'], label: 'sc.fileExplorer' },
      { keys: ['Mod+Shift+\\'], label: 'sc.viewCycle' },
      { keys: ['Shift+Esc'], label: 'sc.focusComposer' },
      { keys: ['Esc'], label: 'sc.interruptGlobal' },
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
  // SELECT included: Alt+↑/↓ opens a native dropdown on some platforms — don't steal that
  return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable);
};

type S = ReturnType<typeof useStore.getState>;

// Flat thread list in sidebar order (project-grouped chats → rooms → DMs → wiki → reviews) for
// Alt+↑/↓. Collapsed sidebar groups are still traversed — same behavior as Slack's channel keys.
// Keep the grouping in step with Sidebar.tsx if session grouping ever changes.
function threadOrder(s: S): { key: string; open: () => void }[] {
  const rows: { key: string; open: () => void }[] = [];
  const byProject = (pid: string | null) => s.sessions.filter((x) => (x.projectId || null) === pid);
  for (const p of [...s.projects.common, ...s.projects.mine]) {
    for (const x of byProject(p.id)) rows.push({ key: 's:' + x.id, open: () => void s.openPrivate(x.id) });
  }
  for (const x of byProject(null)) rows.push({ key: 's:' + x.id, open: () => void s.openPrivate(x.id) });
  for (const r of s.rooms) rows.push({ key: 'r:' + r.id, open: () => void s.openRoom(r.id) });
  if (s.dmEnabled) for (const c of s.channels) rows.push({ key: 'c:' + c.id, open: () => void s.openChannel(c.id) });
  for (const w of s.wikiTopics) rows.push({ key: 'w:' + w.id, open: () => void s.openWiki(w.id) });
  for (const rv of s.reviewSessions) rows.push({ key: 'v:' + rv.id, open: () => void s.openReview(rv.id) });
  return rows;
}

function currentThreadKey(s: S): string | null {
  if (s.activeChannelId) return 'c:' + s.activeChannelId;
  const c = s.current;
  if (!c) return null;
  if (c.wikiTopicId) return 'w:' + c.wikiTopicId;
  if (c.kind === 'room') return 'r:' + c.roomId;
  if (c.kind === 'review') return 'v:' + c.reviewId;
  return 's:' + c.chatSessionId;
}

function moveThread(dir: 1 | -1): void {
  const s = useStore.getState();
  const rows = threadOrder(s);
  if (!rows.length) return;
  const i = rows.findIndex((r) => r.key === currentThreadKey(s));
  // nothing open: ↓ starts at the top, ↑ at the bottom; otherwise wrap around
  rows[i < 0 ? (dir === 1 ? 0 : rows.length - 1) : (i + dir + rows.length) % rows.length].open();
}

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
      // project-panel shortcuts only make sense where the header renders those pills (Chat.tsx)
      const projectPanels = !!s.current?.projectId && !s.current.wikiTopicId && s.current.kind !== 'review';
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        if (!e.shiftKey && (k === 'k' || k === '/')) {
          if (!s.searchEnabled) return;
          e.preventDefault(); s.setSearchOpen(true);
        } else if (e.shiftKey && k === 'o') { e.preventDefault(); void s.newSession(); }
        else if (!e.shiftKey && k === 'b') { e.preventDefault(); toggleSidebar(); }
        else if (e.shiftKey && k === 'h') { e.preventDefault(); s.goHome(); }
        else if (e.shiftKey && k === 'l') { e.preventDefault(); s.toggleTheme(); }
        else if (e.shiftKey && k === 'e') { if (s.taskPanelEnabled && s.current) { e.preventDefault(); s.setTasksOpen(!s.tasksOpen); } }
        else if (e.shiftKey && k === 'g') { if (projectPanels) { e.preventDefault(); s.setGitPanelOpen(!s.gitPanelOpen); } }
        else if (e.shiftKey && k === 'f') { if (projectPanels) { e.preventDefault(); s.setExplorerOpen(!s.explorerOpen); } }
        else if (e.shiftKey && k === '\\') {
          // cycle chat → split → editor, mirroring the seg buttons' gates (mobile/docker/wiki/review)
          const c = s.current;
          if (c && !c.wikiTopicId && c.kind !== 'review' && s.dockerReady && !window.matchMedia('(max-width: 767px)').matches) {
            e.preventDefault();
            const order = ['chat', 'split', 'editor'] as const;
            s.setViewMode(order[(order.indexOf(s.viewMode) + 1) % order.length]);
          }
        }
        return;
      }
      // Alt+↑/↓: previous/next thread in sidebar order (guarded — Option+arrows edits text on mac)
      if (e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !isTyping(e.target)) {
        e.preventDefault(); moveThread(e.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (e.key === 'Escape') {
        // Shift+Esc: jump to the composer from anywhere (fires even while typing elsewhere)
        if (e.shiftKey) {
          const el = document.querySelector<HTMLElement>('[data-composer]');
          if (el) { e.preventDefault(); el.focus(); }
          return;
        }
        if (isTyping(e.target)) return; // the composer's own Esc handles the in-field cases
        if (s.sidebarOpen) { e.preventDefault(); s.setSidebarOpen(false); return; } // drawer first, then the turn
        if (s.turnActive) { e.preventDefault(); s.interrupt(); }
        return;
      }
      if (e.key === '?' && !isTyping(e.target)) { e.preventDefault(); s.setShortcutsOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
