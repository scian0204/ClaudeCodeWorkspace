// How much padding a bottom-anchored composer row needs so its buttons stay clear of the guide
// launcher — the circle fixed over the viewport's bottom-right corner. Kept out of the hook
// (ui.tsx useGuideInset) so it is testable with plain `npx tsx` (see guideinset.test.ts), because
// this is where it used to run away: the row is measured on every commit and the answer becomes
// padding on that row, so a value that can grow with its own effect never settles.

// The launcher's square plus breathing room: right-3 + w-12 (<md), right-5 + w-14 (>=md).
export function launcherBox(vw: number): number { return (vw < 768 ? 12 + 48 : 20 + 56) + 8; }

// `rect` is the row's container (never the padded row itself — see the hook). Returns 0 whenever
// the row already ends left of, or sits above, the launcher.
export function guideInsetPx(rect: { right: number; bottom: number }, vw: number, vh: number): number {
  if (!vw || !vh) return 0;   // nothing laid out yet (hidden pane, zero-size window) — nothing to clear
  const box = launcherBox(vw);
  if (rect.bottom < vh - box || vw - rect.right >= box) return 0;
  // Never more than the launcher itself takes. Without the ceiling, a row reported wider than the
  // window (which our own padding can cause) asks for padding as wide as the overflow, which makes
  // the row wider still — the loop that took the whole page down.
  return Math.min(box, Math.max(0, Math.ceil(box - (vw - rect.right))));
}
