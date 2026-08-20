import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { Modal } from './Modal';
import { IconDownload, IconWarning, IconFolder, IconArchive } from '../lib/icons';

// mirrors the server's encodeSlug (lib/session-import.ts) so the shown target dir matches the one
// the CLI will actually look in
const slugOf = (p: string) => p.replace(/[^a-zA-Z0-9]/g, '-');

const fmtBytes = (b: number) =>
  b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b >= 1024 ** 2 ? `${Math.round(b / 1024 ** 2)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

type Probe = {
  bytes: number; files: number; over: boolean; capMB: number; excludes: string[];
  folder: string; hasTranscript: boolean; uuid: string | null; slug: string; wholeProjectsDir: boolean;
};

// Download a workspace session for local `claude --resume`, in one of two shapes:
//   transcript — just the CLI's .jsonl
//   bundle     — a .tgz with the session's whole project folder plus that transcript, already filed
//                under .claude/projects/<slug>/
// The local project path matters for both: the CLI matches transcripts against the runtime cwd, so
// the server rewrites each line's `cwd` to it. Leaving it empty keeps the container path and resume
// likely won't list the session.
export function ExportSessionModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const setError = useStore((s) => s.setError);
  const bundleEnabled = useStore((s) => s.sessionBundleEnabled);
  const t = useT();
  const [mode, setMode] = useState<'transcript' | 'bundle'>('transcript');
  const [cwd, setCwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [probing, setProbing] = useState(false);
  const [done, setDone] = useState<{ kind: 'transcript'; uuid: string; slug: string; lineCount: number }
    | { kind: 'bundle'; uuid: string | null; slug: string; folder: string } | null>(null);
  const slug = slugOf(cwd.trim());

  // measure the project folder once the bundle option is picked — the size is what tells the user
  // whether this is a 3MB or a 900MB download, and the server refuses the same `over` verdict
  useEffect(() => {
    if (mode !== 'bundle' || probe || probing) return;
    setProbing(true);
    api.get(`/api/sessions/${sessionId}/export/bundle/size`)
      .then((r) => setProbe(r))
      .catch((e) => setError(e.message))
      .finally(() => setProbing(false));
  }, [mode, sessionId, probe, probing, setError]);

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
    if (!probe || probe.over) return;
    const url = `/api/sessions/${sessionId}/export/bundle${cwd.trim() ? `?cwd=${encodeURIComponent(cwd.trim())}` : ''}`;
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
      setDone({ kind: 'bundle', uuid: probe.uuid, slug: cwd.trim() ? slug : probe.slug, folder: probe.folder });
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

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={t('export.title')} width={520}>
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
            <div className="text-[11px] flex flex-col gap-1">
              {probing && <span className="text-txt3">{t('export.bundleMeasuring')}</span>}
              {probe && !probe.over && (
                <span className="text-txt2 font-mono break-all">
                  {probe.folder}/ — {t('export.bundleSize', { size: fmtBytes(probe.bytes), n: String(probe.files) })}
                </span>
              )}
              {probe?.over && (
                <span className="flex items-start gap-1.5" style={{ color: 'var(--danger)' }}>
                  <IconWarning size={13} className="shrink-0 mt-0.5" />{t('export.bundleOver', { cap: String(probe.capMB) })}
                </span>
              )}
              {probe && !!probe.excludes.length && <span className="text-txt3 break-all">{t('export.bundleExcluded', { list: probe.excludes.join(', ') })}</span>}
              {probe?.wholeProjectsDir && (
                <span className="flex items-start gap-1.5" style={{ color: 'var(--warn)' }}>
                  <IconWarning size={13} className="shrink-0 mt-0.5" />{t('export.bundleWholeProjects')}
                </span>
              )}
              {probe && !probe.hasTranscript && <span className="text-txt3">{t('export.bundleNoTranscript')}</span>}
            </div>
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
              disabled={busy || (mode === 'bundle' && (probing || !probe || probe.over))}
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
