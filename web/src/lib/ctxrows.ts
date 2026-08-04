// Row algebra for the right-click menu. No React/DOM runtime imports, so it stays a plain unit that
// `npx tsx web/src/lib/ctxrows.test.ts` can run. The menu is assembled from independent groups (a
// surface's own rows, rows mirrored off the clicked element's buttons, clipboard rows, app-wide rows)
// and this is where the groups merge.

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

// Merge groups into one menu: falsy entries dropped, duplicate labels dropped (the earlier group
// wins — a surface's hand-written "Delete" beats the same button mirrored off the DOM), separators
// collapsed so a group that came back empty never leaves a double rule behind.
export function composeRows(...groups: CtxRows[]): CtxRow[] {
  const out: CtxRow[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    const kept: CtxRow[] = [];
    for (const r of group) {
      if (!r) continue;
      if (r === '-') {
        if (kept.length && kept[kept.length - 1] !== '-') kept.push(r);
        continue;
      }
      if (seen.has(r.label)) continue;
      seen.add(r.label);
      kept.push(r);
    }
    while (kept.length && kept[kept.length - 1] === '-') kept.pop();
    if (!kept.length) continue;
    if (out.length) out.push('-');
    out.push(...kept);
  }
  return out;
}

// What to call a control we mirrored out of the DOM. Icon-only buttons in this app always carry an
// aria-label or title; text buttons carry their own label.
export function actionLabel(el: Pick<Element, 'getAttribute' | 'textContent'>): string {
  const raw = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, 60);
}
