import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { confirmBigFolder, fmtBytes, joinRel, type TreeEntry, type TreeLevel } from '../lib/filetree';
import { Modal } from './Modal';
import { IconDownload, IconWarning, IconFolder, IconArchive, IconFile, IconChevronRight, IconChevronDown } from '../lib/icons';

// mirrors the server's encodeSlug (lib/session-import.ts) so the shown target dir matches the one
// the CLI will actually look in
const slugOf = (p: string) => p.replace(/[^a-zA-Z0-9]/g, '-');

type Prep = {
  bytes: number; files: number; over: boolean; tooMany: boolean; capMB: number; capFiles: number;
  folder: string; hasTranscript: boolean; uuid: string | null; slug: string; wholeProjectsDir: boolean;
  token: string | null;
};

// Download a workspace session for local `claude --resume`, in one of two shapes:
//   transcript — just the CLI's .jsonl
//   bundle     — a .tgz with the picked files from the session's project folder plus that transcript,
//                already filed under .claude/projects/<slug>/
// The bundle's file tree loads one folder at a time and starts closed, and anything a `.gitignore`
// (or the admin exclude list) covers starts unticked — the server decides that, and the browser only
// sends back what the user changed. The size on screen is recomputed from the real selection.
// The local project path matters for both shapes: the CLI matches transcripts against the runtime
// cwd, so the server rewrites each line's `cwd` to it. Leaving it empty keeps the container path and
// resume likely won't list the session.
export function ExportSessionModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const setError = useStore((s) => s.setError);
  const bundleEnabled = useStore((s) => s.sessionBundleEnabled);
  const t = useT();
  const [mode, setMode] = useState<'transcript' | 'bundle'>('transcript');
  const [cwd, setCwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ kind: 'transcript'; uuid: string; slug: string; lineCount: number }
    | { kind: 'bundle'; uuid: string | null; slug: string; folder: string } | null>(null);

  // ── the picker ──
  const [levels, setLevels] = useState<Record<string, TreeLevel>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});           // starts empty: all closed
  const [overrides, setOverrides] = useState<Record<string, boolean>>({}); // what the user changed by hand
  const [prep, setPrep] = useState<Prep | null>(null);
  const [preparing, setPreparing] = useState(false);
  const timer = useRef<number | null>(null);

  const slug = slugOf(cwd.trim());

  const loadLevel = async (rel: string) => {
    if (levels[rel]) return;
    try {
      const lv: TreeLevel = await api.get(`/api/sessions/${sessionId}/export/tree?path=${encodeURIComponent(rel)}`);
      setLevels((m) => ({ ...m, [rel]: lv }));
    } catch (e: any) { setError(e.message); }
  };

  // Ask the server what the current selection weighs, and take the download token with it. Debounced:
  // every run is a real walk over the project folder.
  useEffect(() => {
    if (mode !== 'bundle') return;
    if (timer.current) window.clearTimeout(timer.current);
    setPreparing(true);
    timer.current = window.setTimeout(() => {
      const exclude = Object.entries(overrides).filter(([, v]) => !v).map(([k]) => k);
      const include = Object.entries(overrides).filter(([, v]) => v).map(([k]) => k);
      api.post(`/api/sessions/${sessionId}/export/bundle/prepare`, { cwd: cwd.trim(), exclude, include })
        .then((r) => setPrep(r))
        .catch((e) => setError(e.message))
        .finally(() => setPreparing(false));
    }, 350);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [mode, sessionId, overrides, cwd]);

  useEffect(() => { if (mode === 'bundle') void loadLevel(''); }, [mode]);

  // Is this path in the archive? The nearest hand-made decision at or above it wins; with none, the
  // server's default-off verdict for the row decides.
  const isOn = (rel: string, ignored: boolean): boolean => {
    const parts = rel.split('/');
    for (let i = parts.length; i > 0; i--) {
      const p = parts.slice(0, i).join('/');
      if (p in overrides) return overrides[p];
    }
    return !ignored;
  };

  // Ticking a folder settles everything inside it, so its descendants' own overrides are dropped.
  const toggle = (rel: string, value: boolean) => {
    setOverrides((prev) => {
      const next: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(prev)) if (k !== rel && !k.startsWith(`${rel}/`)) next[k] = v;
      next[rel] = value;
      return next;
    });
  };

  const toggleOpen = async (rel: string, e: TreeEntry) => {
    if (open[rel]) { setOpen((m) => ({ ...m, [rel]: false })); return; }
    if (!levels[rel] && !confirmBigFolder(e.name, e.count)) return;
    setOpen((m) => ({ ...m, [rel]: true }));
    await loadLevel(rel);
  };

  const runTranscript = async () => {
    setBusy(true);
    try {
      const q = cwd.trim() ? `?cwd=${encodeURIComponent(cwd.trim())}` : '';
      const r = await api.get(`/api/sessions/${sessionId}/export${q}`);
      const url = URL.createObjectURL(new Blob([r.jsonl], { type: 'application/jsonl' }));
      const a = document.createElement('a');
      a.href = url; a.download = `${r.uuid}.jsonl`; a.click();
      URL.revokeObjectURL(url);
      setDone({ kind: 'transcript', uuid: r.uuid, slug: r.slug, lineCount: r.lineCount });
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const runBundle = async () => {
    if (!prep?.token) return;
    const url = `/api/sessions/${sessionId}/export/bundle?token=${encodeURIComponent(prep.token)}`;
    setBusy(true);
    try {
      if (import.meta.env.VITE_DEMO) {
        // the static demo answers /api/* from a mock, which only sees fetch/XHR — not a navigation
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error || `HTTP ${res.status}`);
        const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'ccw-bundle.tgz';
        const href = URL.createObjectURL(await res.blob());
        const a = document.createElement('a'); a.href = href; a.download = name; a.click();
        URL.revokeObjectURL(href);
      } else {
        // a plain navigation, not fetch: the archive streams straight to disk instead of piling up
        // in browser memory (a project folder can be hundreds of MB)
        const a = document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noreferrer'; a.click();
      }
      setDone({ kind: 'bundle', uuid: prep.uuid, slug: cwd.trim() ? slug : prep.slug, folder: prep.folder });
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const Option = ({ id, icon, label, hint }: { id: 'transcript' | 'bundle'; icon: React.ReactNode; label: string; hint: string }) => (
    <button type="button" onClick={() => setMode(id)}
      className={`flex-1 text-left rounded-lg border px-3 py-2.5 transition-colors ${mode === id ? 'border-clay bg-claysoft' : 'border-line bg-card hover:border-txt3'}`}>
      <div className="flex items-center gap-1.5 text-xs font-semibold">{icon}{label}</div>
      <div className="text-[11px] text-txt3 mt-1 leading-snug">{hint}</div>
    </button>
  );

  const renderLevel = (rel: string, depth: number): React.ReactNode => {
    const lv = levels[rel];
    if (!lv) return null;
    return (
      <>
        {lv.entries.map((e) => {
          const p = joinRel(rel, e.name);
          const on = isOn(p, !!e.ignored);
          const pad = { paddingLeft: depth * 14 + 4 };
          if (!e.dir) {
            return (
              <label key={p} style={pad} className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-line/50 cursor-pointer">
                <span className="w-3 shrink-0" />
                <input type="checkbox" checked={on} onChange={(ev) => toggle(p, ev.target.checked)} />
                <span className="opacity-70"><IconFile size={14} /></span>
                <span className={`flex-1 truncate ${on ? '' : 'text-txt3'}`} title={p}>{e.name}</span>
                <span className="text-txt3 text-[10px] shrink-0">{fmtBytes(e.size)}</span>
              </label>
            );
          }
          return (
            <div key={p}>
              <div style={pad} className="flex items-center gap-2 px-2 py-1 text-xs font-medium hover:bg-line/50">
                <button type="button" className="shrink-0 w-3 text-txt3 leading-none inline-flex" onClick={() => void toggleOpen(p, e)}
                  aria-label={open[p] ? t('common.collapse') : t('common.expand')}>
                  {open[p] ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
                </button>
                <input type="checkbox" checked={on} onChange={(ev) => toggle(p, ev.target.checked)} />
                <span className="flex-1 flex items-center gap-2 min-w-0 cursor-pointer" onClick={() => void toggleOpen(p, e)}>
                  <span className="opacity-70"><IconFolder size={14} /></span>
                  <span className={`flex-1 truncate ${on ? '' : 'text-txt3'}`} title={p}>{e.name}</span>
                  <span className="text-txt3 text-[10px] shrink-0">{e.count}</span>
                </span>
              </div>
              {open[p] && renderLevel(p, depth + 1)}
            </div>
          );
        })}
        {lv.truncated && <div style={{ paddingLeft: depth * 14 + 18 }} className="text-[10px] text-warn px-2 py-0.5">{t('files.truncated')}</div>}
      </>
    );
  };

  const blocked = mode === 'bundle' && (preparing || !prep?.token);

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={t('export.title')} width={mode === 'bundle' && !done ? 620 : 520}>
      {!done ? (
        <div className="flex flex-col gap-3">
          <div className="text-xs text-txt2">{t('export.intro')}</div>
          {bundleEnabled && (
            <div className="flex flex-col md:flex-row gap-2">
              <Option id="transcript" icon={<IconArchive size={13} />} label={t('export.modeTranscript')} hint={t('export.modeTranscriptHint')} />
              <Option id="bundle" icon={<IconFolder size={13} />} label={t('export.modeBundle')} hint={t('export.modeBundleHint')} />
            </div>
          )}
          {mode === 'bundle' && (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] text-txt3 min-w-0 flex-1">{t('export.pickHint')}</div>
                <button className="text-[11px] text-txt3 hover:text-clay shrink-0" onClick={() => setOpen({})}>{t('common.collapseAll')}</button>
              </div>
              <div className="max-h-[38vh] overflow-auto scrolly border border-line rounded">
                {!levels[''] ? <div className="text-xs text-txt3 px-2 py-1.5">{t('fileExplorer.loading')}</div> : renderLevel('', 0)}
              </div>
              <div className="text-[11px] flex flex-col gap-1">
                {preparing && <span className="text-txt3">{t('export.bundleMeasuring')}</span>}
                {!preparing && prep && !prep.over && !prep.tooMany && !!prep.files && (
                  <span className="text-txt2 font-mono break-all">
                    {prep.folder}/ — {t('export.bundleSize', { size: fmtBytes(prep.bytes), n: String(prep.files) })}
                  </span>
                )}
                {!preparing && prep?.over && (
                  <span className="flex items-start gap-1.5" style={{ color: 'var(--danger)' }}>
                    <IconWarning size={13} className="shrink-0 mt-0.5" />{t('export.bundleOver', { cap: String(prep.capMB) })}
                  </span>
                )}
                {!preparing && prep?.tooMany && (
                  <span className="flex items-start gap-1.5" style={{ color: 'var(--danger)' }}>
                    <IconWarning size={13} className="shrink-0 mt-0.5" />{t('export.bundleTooMany', { n: String(prep.capFiles) })}
                  </span>
                )}
                {!preparing && prep && !prep.files && <span style={{ color: 'var(--warn)' }}>{t('export.bundleEmpty')}</span>}
                {prep?.wholeProjectsDir && (
                  <span className="flex items-start gap-1.5" style={{ color: 'var(--warn)' }}>
                    <IconWarning size={13} className="shrink-0 mt-0.5" />{t('export.bundleWholeProjects')}
                  </span>
                )}
                {prep && !prep.hasTranscript && <span className="text-txt3">{t('export.bundleNoTranscript')}</span>}
              </div>
            </>
          )}
          <label className="text-xs font-semibold">{t('export.pathLabel')}</label>
          <input className="input w-full font-mono text-xs" value={cwd} placeholder={t('export.pathPlaceholder')}
            onChange={(e) => setCwd(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void (mode === 'bundle' ? runBundle() : runTranscript()); } }} />
          {cwd.trim()
            ? <div className="text-[11px] text-txt3 font-mono break-all">~/.claude/projects/{slug}/</div>
            : (
              <div className="text-[11px] flex items-start gap-1.5" style={{ color: 'var(--warn)' }}>
                <IconWarning size={13} className="shrink-0 mt-0.5" />{t('export.emptyPathWarn')}
              </div>
            )}
          <div className="text-[11px] text-txt3">{t('export.fidelityHint')}</div>
          <div className="flex gap-2 justify-end mt-1">
            <button className="btn-ghost !text-xs" onClick={onClose}>{t('common.cancel')}</button>
            <button className="rounded-md px-3.5 py-1.5 text-xs font-semibold text-white inline-flex items-center gap-1.5 disabled:opacity-50"
              style={{ background: 'var(--clay)' }}
              disabled={busy || blocked}
              onClick={() => void (mode === 'bundle' ? runBundle() : runTranscript())}>
              <IconDownload size={13} />{busy ? t('export.downloading') : t('export.download')}
            </button>
          </div>
        </div>
      ) : done.kind === 'transcript' ? (
        <div className="flex flex-col gap-3">
          <div className="text-xs text-txt2">{t('export.doneIntro', { n: String(done.lineCount) })}</div>
          <ol className="text-xs text-txt2 list-decimal pl-4 flex flex-col gap-2">
            <li>
              {t('export.step1')}
              <code className="block font-mono text-[11px] bg-card border border-line rounded px-2 py-1 mt-1 break-all select-all">~/.claude/projects/{done.slug}/{done.uuid}.jsonl</code>
            </li>
            <li>
              {t('export.step2')}
              <code className="block font-mono text-[11px] bg-card border border-line rounded px-2 py-1 mt-1 break-all select-all">claude --resume {done.uuid}</code>
            </li>
          </ol>
          <div className="flex justify-end">
            <button className="btn-ghost !text-xs" onClick={onClose}>{t('common.close')}</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="text-xs text-txt2">{t('export.bundleDoneIntro')}</div>
          <ol className="text-xs text-txt2 list-decimal pl-4 flex flex-col gap-2">
            <li>
              {t('export.bundleStep1')}
              <code className="block font-mono text-[11px] bg-card border border-line rounded px-2 py-1 mt-1 break-all select-all">tar -xzf ccw-*.tgz</code>
            </li>
            <li>{t('export.bundleStep2', { folder: `${done.folder}/`, path: cwd.trim() || t('export.bundleAnywhere') })}</li>
            {done.uuid && (
              <li>
                {t('export.bundleStep3')}
                <code className="block font-mono text-[11px] bg-card border border-line rounded px-2 py-1 mt-1 break-all select-all">.claude/projects/{done.slug}/ → ~/.claude/projects/{done.slug}/</code>
              </li>
            )}
            {done.uuid && (
              <li>
                {t('export.step2')}
                <code className="block font-mono text-[11px] bg-card border border-line rounded px-2 py-1 mt-1 break-all select-all">claude --resume {done.uuid}</code>
              </li>
            )}
          </ol>
          <div className="flex justify-end">
            <button className="btn-ghost !text-xs" onClick={onClose}>{t('common.close')}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
