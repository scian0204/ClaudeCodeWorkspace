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
