import { useT } from '../lib/i18n';

// One replaced span of a file edit. Edit gives old→new directly; Write is all-new (old '').
export interface Hunk { old: string; new: string }

// Which tool calls are file edits a diff can visualize? Input comes straight off the wire (`any`),
// so every field is null-guarded — old mock transcripts or foreign agents may lack them.
export function fileEditOf(name: string, input: any): Hunk[] | null {
  if (!input || typeof input !== 'object') return null;
  if (name === 'Edit' && typeof input.old_string === 'string' && typeof input.new_string === 'string') {
    return [{ old: input.old_string, new: input.new_string }];
  }
  if (name === 'Write' && typeof input.content === 'string') {
    return [{ old: '', new: input.content }];
  }
  if (name === 'MultiEdit' && Array.isArray(input.edits)) {
    const hunks = input.edits
      .filter((e: any) => e && typeof e.old_string === 'string' && typeof e.new_string === 'string')
      .map((e: any) => ({ old: e.old_string, new: e.new_string }));
    return hunks.length ? hunks : null;
  }
  return null;
}

type Row = { k: 'ctx' | 'del' | 'add'; text: string };

// Line diff without a dependency: trim the lines both sides share at the start/end (Edit inputs
// carry context lines for uniqueness), keep up to 2 of them visible as context, and show the
// differing middles as del-then-add. For a wholesale old→new replacement this IS the unified diff.
function diffOf(oldStr: string, newStr: string): { rows: Row[]; add: number; del: number } {
  const a = oldStr ? oldStr.split('\n') : [];
  const b = newStr ? newStr.split('\n') : [];
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const rows: Row[] = [];
  for (let i = Math.max(0, pre - 2); i < pre; i++) rows.push({ k: 'ctx', text: a[i] });
  const del = a.slice(pre, a.length - suf);
  const add = b.slice(pre, b.length - suf);
  del.forEach((text) => rows.push({ k: 'del', text }));
  add.forEach((text) => rows.push({ k: 'add', text }));
  for (let i = 0; i < Math.min(2, suf); i++) rows.push({ k: 'ctx', text: a[a.length - suf + i] });
  return { rows, add: add.length, del: del.length };
}

export function diffCounts(hunks: Hunk[]): { add: number; del: number } {
  return hunks.reduce((acc, h) => {
    const d = diffOf(h.old, h.new);
    return { add: acc.add + d.add, del: acc.del + d.del };
  }, { add: 0, del: 0 });
}

const MAX_ROWS = 500; // a Write can be thousands of lines — cap what we render
const rowClass: Record<Row['k'], string> = { add: 'text-ok', del: 'text-danger', ctx: 'text-txt3' };
const rowSign: Record<Row['k'], string> = { add: '+', del: '-', ctx: ' ' };

// GitDiff-style rendering: rows are plain JSX text nodes (never md()/innerHTML — this is model/file
// text), and the pre scrolls inside its own container so the page body never scrolls sideways.
export function ToolDiff({ hunks }: { hunks: Hunk[] }) {
  const t = useT();
  let budget = MAX_ROWS;
  let truncated = false;
  const parts = hunks.map((h) => {
    const d = diffOf(h.old, h.new);
    if (d.rows.length > budget) { truncated = true; d.rows = d.rows.slice(0, Math.max(0, budget)); }
    budget -= d.rows.length;
    return d.rows;
  });
  return (
    <div className="overflow-x-auto scrolly max-h-64 overflow-y-auto bg-bg">
      <pre className="text-[11px] leading-[1.5] font-mono px-2.5 py-1.5 w-max min-w-full">
        {parts.map((rows, hi) => (
          <div key={hi} className={hi > 0 ? 'border-t border-line mt-1 pt-1' : undefined}>
            {rows.map((r, i) => (
              <div key={i} className={rowClass[r.k]}>{rowSign[r.k]} {r.text}</div>
            ))}
          </div>
        ))}
        {truncated && <div className="text-txt3 mt-1">{t('git.diffTruncated')}</div>}
      </pre>
    </div>
  );
}
