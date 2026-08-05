import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { timeAgo } from '../lib/ui';
import { IconChevronDown, IconChevronRight } from '../lib/icons';
import { layout, laneCount, type Commit, type GraphRow } from '../lib/gitgraph';

export type { Commit };

// What the diff box is currently showing: an uncommitted file, or a whole commit.
export type DiffTarget =
  | { kind: 'file'; path: string; untracked?: boolean }
  | { kind: 'commit'; hash: string; short: string; subject: string };

// Rendered lines are capped separately from the server's byte cap: a 512KB patch is fine to fetch
// but 20k rows is not, and nobody reads past the first screens anyway.
const MAX_LINES = 1500;

function lineClass(l: string): string {
  if (l.startsWith('+++') || l.startsWith('---')) return 'text-txt3';
  if (l.startsWith('+')) return 'text-ok';
  if (l.startsWith('-')) return 'text-danger';
  if (l.startsWith('@@')) return 'text-clay';
  if (/^(diff --git|index |new file|deleted file|similarity index|rename |Binary )/.test(l)) return 'text-txt3';
  return '';
}

// Unified patch viewer. Its own horizontal scroller — a patch has long lines and the page body must
// never scroll sideways on a phone.
// `tall` = the dialog went fullscreen, so the patch may use the height instead of a fixed 18rem box.
export function DiffView({ projectId, target, tall, onClose }: {
  projectId: string; target: DiffTarget; tall?: boolean; onClose: () => void;
}) {
  const t = useT();
  const [diff, setDiff] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(true);

  const qs = target.kind === 'commit'
    ? `commit=${encodeURIComponent(target.hash)}`
    : `path=${encodeURIComponent(target.path)}${target.untracked ? '&untracked=1' : ''}`;

  useEffect(() => {
    let live = true;
    setBusy(true); setErr(''); setDiff('');
    api.get(`/api/projects/${projectId}/git/diff?${qs}`)
      .then((r) => { if (live) { setDiff(String(r.diff || '')); setTruncated(!!r.truncated); } })
      .catch((e: any) => { if (live) setErr(e.message); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
    /* eslint-disable-next-line */
  }, [projectId, qs]);

  const lines = useMemo(() => diff.split('\n'), [diff]);
  const shown = lines.slice(0, MAX_LINES);

  return (
    <div className="border border-line rounded-lg mb-3">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-line">
        <span className="font-mono text-[11px] truncate min-w-0 flex-1">
          {target.kind === 'commit' ? `${target.short} ${target.subject}` : target.path}
        </span>
        <button className="btn-ghost !py-0 !px-1.5 !text-[11px] shrink-0" onClick={onClose}>✕</button>
      </div>
      {busy && <div className="px-2.5 py-2 text-xs text-txt3">…</div>}
      {err && <div className="px-2.5 py-2 text-xs text-danger whitespace-pre-wrap break-words">{err}</div>}
      {!busy && !err && !diff.trim() && <div className="px-2.5 py-2 text-xs text-txt3">{t('git.diffEmpty')}</div>}
      {!busy && !err && !!diff.trim() && (
        <div className={`overflow-auto scrolly ${tall ? 'max-h-[58vh]' : 'max-h-72'}`}>
          <pre className="text-[11px] leading-[1.5] font-mono px-2.5 py-1.5 w-max min-w-full">
            {shown.map((l, i) => <div key={i} className={lineClass(l)}>{l || ' '}</div>)}
          </pre>
        </div>
      )}
      {(truncated || lines.length > MAX_LINES) && (
        <div className="px-2.5 py-1 text-[11px] text-warn border-t border-line">{t('git.diffTruncated')}</div>
      )}
    </div>
  );
}

// ── history graph ──

const LANE_COLORS = ['#c96442', '#5b8def', '#3aa675', '#c9a227', '#a05fd3', '#d1568f', '#2fa3a3'];
const LANE_W = 11;   // px between lanes
const ROW_H = 24;    // must match the row's rendered height or the vertical lines break

const laneX = (i: number) => 6 + i * LANE_W;
const laneColor = (i: number) => LANE_COLORS[i % LANE_COLORS.length];

function RowGraph({ row, width }: { row: GraphRow; width: number }) {
  const mid = ROW_H / 2;
  return (
    <svg width={width} height={ROW_H} className="shrink-0 block" aria-hidden>
      {row.up.map((i) => <line key={`u${i}`} x1={laneX(i)} y1={0} x2={laneX(i)} y2={mid} stroke={laneColor(i)} strokeWidth="1.5" />)}
      {row.down.map((i) => <line key={`d${i}`} x1={laneX(i)} y1={mid} x2={laneX(i)} y2={ROW_H} stroke={laneColor(i)} strokeWidth="1.5" />)}
      {row.merges.map((i) => (
        <line key={`m${i}`} x1={laneX(row.lane)} y1={mid} x2={laneX(i)} y2={ROW_H} stroke={laneColor(i)} strokeWidth="1.5" />
      ))}
      {row.joins.map((i) => (
        <line key={`j${i}`} x1={laneX(i)} y1={0} x2={laneX(row.lane)} y2={mid} stroke={laneColor(i)} strokeWidth="1.5" />
      ))}
      <circle cx={laneX(row.lane)} cy={mid} r="3.5" fill={laneColor(row.lane)} />
    </svg>
  );
}

// Collapsed by default like the remotes section: history is a look-at-it-when-you-need-it view, and
// it costs a `git log` per open. Clicking a commit hands it up so the panel shows its patch.
export function GitHistory({ projectId, selected, tall, onPick }: {
  projectId: string; selected?: string; tall?: boolean; onPick: (c: Commit) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [limit, setLimit] = useState(40);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setBusy(true); setErr('');
    api.get(`/api/projects/${projectId}/git/log?limit=${limit}${all ? '&all=1' : ''}`)
      .then((r) => { if (live) setCommits(r.commits || []); })
      .catch((e: any) => { if (live) setErr(e.message); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [open, projectId, limit, all]);

  const rows = useMemo(() => layout(commits), [commits]);
  const width = useMemo(() => laneX(laneCount(rows) - 1) + 8, [rows]);

  return (
    <div className="border border-line rounded-lg mb-3">
      <button type="button" className="w-full flex items-center gap-2 px-2.5 py-2 text-xs" onClick={() => setOpen((o) => !o)}>
        <span className="text-txt3">{open ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}</span>
        <span>{t('git.history')}</span>
        {!open && <span className="text-txt3 text-[11px]">{t('git.historyHint')}</span>}
      </button>

      {open && (
        <div className="px-2.5 pb-2.5">
          <div className="flex items-center gap-2 mb-1.5">
            <label className="flex items-center gap-1.5 text-[11px] text-txt3 cursor-pointer select-none">
              <input type="checkbox" checked={all} onChange={(e) => { setAll(e.target.checked); setCommits([]); }} />
              {t('git.historyAll')}
            </label>
            {busy && <span className="text-txt3 text-[11px]">…</span>}
          </div>
          {err && <div className="text-xs text-danger mb-2 whitespace-pre-wrap break-words">{err}</div>}
          {!err && !busy && rows.length === 0 && <div className="text-[11px] text-txt3">{t('git.historyNone')}</div>}
          {rows.length > 0 && (
            <div className={`border border-line rounded-lg overflow-auto scrolly ${tall ? 'max-h-[40vh]' : 'max-h-64'}`}>
              {rows.map((r) => (
                <button key={r.c.hash} type="button" title={`${r.c.short} · ${r.c.author} · ${r.c.date}`}
                  className={`w-full flex items-center gap-2 pr-2 text-left hover:bg-line ${selected === r.c.hash ? 'bg-line' : ''}`}
                  style={{ height: ROW_H }} onClick={() => onPick(r.c)}>
                  <RowGraph row={r} width={width} />
                  <span className="font-mono text-[10px] text-txt3 shrink-0">{r.c.short}</span>
                  {r.c.refs.slice(0, 2).map((ref) => (
                    <span key={ref} className="text-[9px] bg-claysoft text-clay px-1 py-px rounded-full shrink-0 max-w-[110px] truncate">
                      {ref.replace('HEAD -> ', '')}
                    </span>
                  ))}
                  <span className="text-[11px] truncate flex-1 min-w-0">{r.c.subject}</span>
                  <span className="text-[10px] text-txt3 shrink-0 hidden md:inline">{r.c.author}</span>
                  <span className="text-[10px] text-txt3 shrink-0">{timeAgo(new Date(r.c.date).getTime())}</span>
                </button>
              ))}
            </div>
          )}
          {commits.length >= limit && (
            <button className="btn-ghost !py-0.5 !px-2 !text-[11px] mt-1.5" disabled={busy}
              onClick={() => setLimit((n) => n + 40)}>{t('git.historyMore')}</button>
          )}
        </div>
      )}
    </div>
  );
}
