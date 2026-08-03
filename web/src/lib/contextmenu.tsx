// The workspace's own right-click menu. ONE window listener claims `contextmenu` app-wide, so a
// right-click anywhere lands on workspace actions instead of the browser's page menu; a surface that
// wants its own items (a sidebar row, a chat message) calls openContextMenu() from onContextMenu and
// the global handler stands down (it skips anything already default-prevented).
//
// Escape hatch: hold Shift while right-clicking. We never preventDefault then, so the browser's own
// menu comes through untouched — same convention Firefox and VS Code use.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useStore } from './store';
import { t } from './i18n';
import { fmtKeys, toggleSidebar } from './shortcuts';
import { IconCopy, IconPlus, IconSearch, IconPanelLeft, IconTheme, IconKeyboard, IconRefresh, IconLink } from './icons';

export interface CtxItem {
  label: string;
  onSelect: () => void;
  icon?: React.ReactNode;
  keys?: string;   // shortcut spec ('Mod+C'), rendered per platform on the right
  danger?: boolean;
}
export type CtxRow = CtxItem | '-'; // '-' = separator
// Falsy entries are dropped, so callers can inline conditions: [canEdit && { ... }]
export type CtxRows = (CtxRow | '' | false | null | undefined)[];

interface MenuState {
  at: { x: number; y: number } | null;
  rows: CtxRow[];
  open: (x: number, y: number, rows: CtxRow[]) => void;
  close: () => void;
}
const useMenu = create<MenuState>((set) => ({
  at: null, rows: [],
  open: (x, y, rows) => set({ at: { x, y }, rows }),
  close: () => set({ at: null, rows: [] }),
}));

export function openContextMenu(e: React.MouseEvent | MouseEvent, rows: CtxRows): void {
  if (e.shiftKey) return;                                     // escape hatch → browser's own menu
  if (!useStore.getState().customContextMenuEnabled) return;  // admin turned the feature off
  const list = rows.filter(Boolean) as CtxRow[];
  if (!list.length) return;
  e.preventDefault();
  useMenu.getState().open(e.clientX, e.clientY, list);
}

// App-wide default menu, plus clipboard rows when the click landed on text / a field / a link.
// Blocking the native menu means we owe the user those clipboard actions.
function defaultRows(e: MouseEvent): CtxRows {
  const s = useStore.getState();
  const el = e.target as HTMLElement | null;
  const field = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? (el as HTMLInputElement | HTMLTextAreaElement) : null;
  const link = el?.closest?.('a[href]') as HTMLAnchorElement | null;
  // Selection is captured NOW: clicking a menu item moves focus and can collapse it.
  const range = field ? { start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0 } : null;
  const copyText = (range && range.end > range.start ? field!.value.slice(range.start, range.end) : window.getSelection()?.toString() || '').trim();
  // Put the caret/selection back before an execCommand edit (it keeps the field's undo stack, and
  // fires `input` so React's controlled value follows along).
  const restore = () => { if (field && range) { field.focus(); field.setSelectionRange(range.start, range.end); } };
  const canPaste = !!navigator.clipboard?.readText;

  return [
    copyText && { label: t('ctx.copy'), icon: <IconCopy size={14} />, keys: 'Mod+C', onSelect: () => void navigator.clipboard?.writeText(copyText) },
    field && copyText && {
      label: t('ctx.cut'), keys: 'Mod+X',
      onSelect: async () => { await navigator.clipboard?.writeText(copyText).catch(() => {}); restore(); document.execCommand('insertText', false, ''); },
    },
    field && canPaste && {
      label: t('ctx.paste'), keys: 'Mod+V',
      onSelect: async () => {
        try {
          const txt = await navigator.clipboard.readText();
          restore();
          if (txt) document.execCommand('insertText', false, txt);
        } catch { s.setError(t('ctx.pasteBlocked', { keys: fmtKeys('Mod+V') })); } // no clipboard-read permission
      },
    },
    field && { label: t('ctx.selectAll'), keys: 'Mod+A', onSelect: () => { field.focus(); field.select(); } },
    link && { label: t('ctx.copyLink'), icon: <IconLink size={14} />, onSelect: () => void navigator.clipboard?.writeText(link.href) },
    (copyText || field || link) && '-',
    { label: t('ctx.newChat'), icon: <IconPlus size={14} />, keys: 'Mod+Shift+O', onSelect: () => void s.newSession() },
    s.searchEnabled && { label: t('ctx.search'), icon: <IconSearch size={14} />, keys: 'Mod+K', onSelect: () => s.setSearchOpen(true) },
    { label: t('ctx.sidebar'), icon: <IconPanelLeft size={14} />, keys: 'Mod+B', onSelect: toggleSidebar },
    { label: t('ctx.theme'), icon: <IconTheme size={14} />, keys: 'Mod+Shift+L', onSelect: () => s.toggleTheme() },
    { label: t('ctx.shortcuts'), icon: <IconKeyboard size={14} />, keys: '?', onSelect: () => s.setShortcutsOpen(true) },
    '-',
    { label: t('ctx.reload'), icon: <IconRefresh size={14} />, onSelect: () => window.location.reload() },
  ];
}

// Mounted once by Shell: installs the global handler and renders whatever menu is open.
export function AppContextMenu() {
  const at = useMenu((m) => m.at);
  const rows = useMenu((m) => m.rows);
  const close = useMenu((m) => m.close);
  const enabled = useStore((s) => s.customContextMenuEnabled);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const onCtx = (e: MouseEvent) => {
      if (e.shiftKey || e.defaultPrevented) return; // Shift → browser menu; prevented → a surface already claimed it
      openContextMenu(e, defaultRows(e));
    };
    window.addEventListener('contextmenu', onCtx);
    return () => window.removeEventListener('contextmenu', onCtx);
  }, [enabled]);

  // Clamp into the viewport once measured, then take focus so the keyboard can drive the menu.
  useLayoutEffect(() => {
    if (!at) { setPos(null); return; }
    const r = ref.current?.getBoundingClientRect();
    const w = r?.width ?? 210;
    const h = r?.height ?? 260;
    setPos({ x: Math.max(4, Math.min(at.x, window.innerWidth - w - 4)), y: Math.max(4, Math.min(at.y, window.innerHeight - h - 4)) });
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [at]);

  useEffect(() => {
    if (!at) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    document.addEventListener('scroll', close, true); // a menu anchored to a scrolled-away row is a lie
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [at, close]);

  if (!at) return null;

  const move = (dir: number) => {
    const btns = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button') || []);
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    btns[(i + dir + btns.length) % btns.length]?.focus();
  };

  return (
    <div ref={ref} role="menu" aria-label={t('ctx.menuLabel')}
      className="fixed z-[70] min-w-[210px] max-w-[min(280px,92vw)] bg-panel border border-line rounded-lg p-1 shadow-2xl text-txt"
      style={{ left: pos?.x ?? at.x, top: pos?.y ?? at.y, visibility: pos ? 'visible' : 'hidden' }}
      onContextMenu={(e) => e.preventDefault()} // right-clicking the menu itself keeps it put
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      }}>
      {rows.map((r, i) => (r === '-' ? <div key={i} className="my-1 h-px bg-line" /> : (
        <button key={i} role="menuitem" onClick={() => { close(); r.onSelect(); }}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm outline-none hover:bg-line focus:bg-line ${r.danger ? 'text-danger' : ''}`}>
          {r.icon ? <span className="w-4 shrink-0 text-txt3">{r.icon}</span> : <span className="w-4 shrink-0" />}
          <span className="flex-1 truncate">{r.label}</span>
          {r.keys && <span className="text-[10px] font-mono text-txt3 shrink-0">{fmtKeys(r.keys)}</span>}
        </button>
      )))}
      <div className="mt-1 border-t border-line px-2 pt-1.5 pb-1 text-[10px] text-txt3">{t('ctx.nativeHint', { keys: fmtKeys('Shift+RClick') })}</div>
    </div>
  );
}
