import { useStore } from './store';
import { t } from './i18n';

// Shared bits of the lazy file trees (project/plugin/wiki explorer, the import picker, the session
// download picker). All of them load ONE folder at a time and start fully collapsed: a repo with
// tens of thousands of files must cost nothing until someone actually opens a folder.

export type TreeEntry = {
  name: string;
  dir: boolean;
  size: number;
  count: number;      // a folder's immediate child count — what the open-it warning reads
  ignored?: boolean;  // download picker: off by default (an excluded name or a .gitignore match)
};
export type TreeLevel = { entries: TreeEntry[]; truncated: boolean };

export const joinRel = (base: string, name: string) => (base ? `${base}/${name}` : name);

export function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

// Opening a folder with thousands of entries paints thousands of rows, which is what actually
// freezes the tab — so ask first. The threshold is an admin setting (fileTreeWarnCount, off at 0)
// and rides along on /api/config. Returns false when the user backs out.
export function confirmBigFolder(name: string, count: number): boolean {
  const limit = useStore.getState().fileTreeWarnCount;
  if (!limit || count <= limit) return true;
  return window.confirm(t('files.manyWarn', { name, n: String(count) }));
}

const EXPAND_ALL_MAX_DIRS = 300; // ponytail: one flat ceiling on the fan-out; per-depth budgets if it ever matters

// Expand-all over a lazily loaded tree: walk down from the root, fetching each folder once. The two
// things that made "expand all" dangerous are handled rather than forbidden — a folder past the
// warning threshold is left closed (open that one by hand) and the walk stops after
// EXPAND_ALL_MAX_DIRS folders. `partial` is true when either happened, so the caller can say so.
// Works in plain relative-path space and returns everything at once, so the caller renders one frame.
export async function expandAllLazy(
  load: (rel: string) => Promise<TreeLevel | null>,
  known: Record<string, TreeLevel>,
): Promise<{ levels: Record<string, TreeLevel>; open: Record<string, boolean>; partial: boolean }> {
  const limit = useStore.getState().fileTreeWarnCount;
  const levels: Record<string, TreeLevel> = { ...known };
  const open: Record<string, boolean> = {};
  let partial = false;
  let fetched = 0;
  const queue: string[] = [''];
  while (queue.length) {
    const rel = queue.shift() as string;
    let lv = levels[rel];
    if (!lv) {
      if (fetched >= EXPAND_ALL_MAX_DIRS) { partial = true; break; }
      fetched++;
      const got = await load(rel);
      if (!got) continue;
      levels[rel] = got;
      lv = got;
    }
    if (rel) open[rel] = true;
    for (const e of lv.entries) {
      if (!e.dir) continue;
      if (limit && e.count > limit) { partial = true; continue; }   // too big to paint unasked
      queue.push(joinRel(rel, e.name));
    }
  }
  return { levels, open, partial };
}
