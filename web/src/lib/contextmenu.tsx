// The workspace's own right-click menu. ONE window listener claims `contextmenu` app-wide, so a
// right-click anywhere lands on workspace actions instead of the browser's page menu.
//
// The menu builds itself from whatever was clicked — nothing is wired per surface. Every row and card
// in this app already ships its actions as <button title|aria-label> and its data as text/href/src,
// so mirrorRows() reads them back off the DOM and turns them into menu items. A panel written next
// month gets a working right-click menu the day it ships, with no edit here. A surface only calls
// openContextMenu() when it wants an item that has no button behind it (e.g. "Open"), and those rows
// are merged in front of the automatic ones.
//
// Escape hatch: hold Shift while right-clicking. We never preventDefault then, so the browser's own
// menu comes through untouched — same convention Firefox and VS Code use.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { copyToClipboard } from './clipboard';
import { useStore } from './store';
import { t } from './i18n';
import { fmtKeys, toggleSidebar } from './shortcuts';
import { composeRows, actionLabel, type CtxRow, type CtxRows } from './ctxrows';
import { IconCopy, IconPlus, IconSearch, IconPanelLeft, IconTheme, IconKeyboard, IconRefresh, IconLink, IconGlobe, IconImage, IconTerminal } from './icons';

export type { CtxItem, CtxRow, CtxRows } from './ctxrows';

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

// Rows a surface asked for, then the three automatic groups. Every entry point goes through here, so
// a hand-written menu also gets the mirrored buttons, the clipboard rows and the app-wide rows.
export function openContextMenu(e: React.MouseEvent | MouseEvent, rows: CtxRows): void {
  if (e.shiftKey) return;                                     // escape hatch → browser's own menu
  if (!useStore.getState().customContextMenuEnabled) return;  // admin turned the feature off
  const el = e.target instanceof Element ? e.target : null;
  const list = composeRows(rows, el ? mirrorRows(el) : [], dataRows(el), appRows());
  if (!list.length) return;
  e.preventDefault();
  useMenu.getState().open(e.clientX, e.clientY, list);
}

const ACTION_SEL = 'button, a[href], summary, [role="button"], [role="menuitem"]';
// Climb past this many controls and we've left "the thing you clicked" for a whole panel or the page
// chrome — mirroring those would be noise, so we stop instead.
// ponytail: a plain count; if a surface ever needs a different boundary, mark it with a data attr.
const MAX_MIRRORED = 12; // a row has 2-4, a toolbar up to ~10; a list of rows blows past this

// The automatic layer: turn the nearest owning row's own controls into menu items. Clicking a menu
// item clicks the real button, so the surface's handler (and confirm dialogs, busy state, i18n label)
// stays the single source of truth — hidden hover-only buttons click fine.
function mirrorRows(from: Element): CtxRows {
  for (let n: Element | null = from; n && n !== document.body; n = n.parentElement) {
    const acts = Array.from(n.querySelectorAll<HTMLElement>(ACTION_SEL)).filter(
      (b) => !(b as HTMLButtonElement).disabled && b.getAttribute('aria-hidden') !== 'true' && !!actionLabel(b)
        && inClickedBranch(n!, from, b),
    );
    if (!acts.length) continue;
    if (acts.length > MAX_MIRRORED) return [];
    return acts.map((b) => ({
      label: actionLabel(b),
      icon: mirrorIcon(b),
      danger: (b.getAttribute('class') || '').includes('danger'),
      onSelect: () => b.click(),
    }));
  }
  return [];
}

// An action nested in a branch of `n` the click never entered belongs to a sibling row, not this one —
// without this, right-clicking a project header would offer to delete every chat under it. Actions
// that are direct children of `n` (a toolbar's own buttons) always count.
function inClickedBranch(n: Element, from: Element, b: Element): boolean {
  let c = b;
  while (c.parentElement && c.parentElement !== n) c = c.parentElement;
  return c === b || c.contains(from);
}

// Reuse the button's own glyph so the row reads like the control it mirrors. Cloning our own node —
// no HTML parsing, nothing untrusted.
function mirrorIcon(b: Element): React.ReactNode {
  const svg = b.querySelector('svg');
  if (!svg) return undefined;
  return <span className="inline-flex" ref={(n) => { if (n && !n.firstChild) n.appendChild(svg.cloneNode(true)); }} />;
}

// Clipboard rows for whatever the click landed on: a selection, a field, a link, an image, a code
// block, or plain text. Blocking the native menu means we owe the user these.
function dataRows(el: Element | null): CtxRows {
  const s = useStore.getState();
  const field = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? (el as HTMLInputElement | HTMLTextAreaElement) : null;
  const link = el?.closest?.('a[href]') as HTMLAnchorElement | null;
  const img = el?.closest?.('img[src]') as HTMLImageElement | null;
  const pre = el?.closest?.('pre') as HTMLElement | null;
  // Nothing selected and no field: fall back to what the clicked node itself says — the full path in
  // a tree row's title, the label of the span under the cursor. Controls are excluded: a button's own
  // label is already its mirrored row, so copying it is noise.
  const own = (el && !el.closest(ACTION_SEL)
    ? el.closest('[title]')?.getAttribute('title') || (el.children.length ? '' : el.textContent) || ''
    : '').trim();
  // Selection is captured NOW: clicking a menu item moves focus and can collapse it.
  const range = field ? { start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0 } : null;
  const copyText = (range && range.end > range.start ? field!.value.slice(range.start, range.end) : window.getSelection()?.toString() || '').trim();
  // Put the caret/selection back before an execCommand edit (it keeps the field's undo stack, and
  // fires `input` so React's controlled value follows along).
  const restore = () => { if (field && range) { field.focus(); field.setSelectionRange(range.start, range.end); } };
  const canPaste = !!navigator.clipboard?.readText;

  return [
    copyText && { label: t('ctx.copy'), icon: <IconCopy size={14} />, keys: 'Mod+C', onSelect: () => void copyToClipboard(copyText) },
    field && copyText && {
      label: t('ctx.cut'), keys: 'Mod+X',
      onSelect: async () => { await copyToClipboard(copyText); restore(); document.execCommand('insertText', false, ''); },
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
    !copyText && !field && own && { label: t('ctx.copyText'), icon: <IconCopy size={14} />, onSelect: () => void copyToClipboard(own) },
    pre && { label: t('ctx.copyCode'), icon: <IconTerminal size={14} />, onSelect: () => void copyToClipboard(pre.textContent || '') },
    link && { label: t('ctx.copyLink'), icon: <IconLink size={14} />, onSelect: () => void copyToClipboard(link.href) },
    link && { label: t('ctx.openNewTab'), icon: <IconGlobe size={14} />, onSelect: () => void window.open(link.href, '_blank', 'noopener,noreferrer') },
    img && { label: t('ctx.copyImage'), icon: <IconImage size={14} />, onSelect: () => void copyToClipboard(img.src) },
    img && { label: t('ctx.openImage'), icon: <IconGlobe size={14} />, onSelect: () => void window.open(img.src, '_blank', 'noopener,noreferrer') },
  ];
}

// Always-there rows: they are the reason we take the native menu over in the first place.
function appRows(): CtxRows {
  const s = useStore.getState();
  return [
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
      openContextMenu(e, []);                       // rows come from the click itself
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
    // a menu anchored to a scrolled-away row is a lie — but scrolling a long menu must not close it
    const onScroll = (e: Event) => { if (!ref.current?.contains(e.target as Node)) close(); };
    document.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      document.removeEventListener('scroll', onScroll, true);
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
      className="fixed z-[70] min-w-[210px] max-w-[min(280px,92vw)] max-h-[min(80vh,520px)] overflow-y-auto scrolly bg-panel border border-line rounded-lg p-1 shadow-2xl text-txt"
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
      <div className="sticky bottom-0 mt-1 border-t border-line bg-panel px-2 pt-1.5 pb-1 text-[10px] text-txt3">{t('ctx.nativeHint', { keys: fmtKeys('Shift+RClick') })}</div>
    </div>
  );
}
