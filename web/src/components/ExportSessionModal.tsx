import { useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { Modal } from './Modal';
import { IconDownload, IconWarning } from '../lib/icons';

// mirrors the server's encodeSlug (lib/session-import.ts) so the shown target dir matches the one
// the CLI will actually look in
const slugOf = (p: string) => p.replace(/[^a-zA-Z0-9]/g, '-');

// Download a workspace session's CLI transcript for local `claude --resume`. The local project path
// matters: the CLI matches transcripts against the runtime cwd, so the server rewrites each line's
// `cwd` to it. Leaving it empty keeps the container path and resume likely won't list the session.
export function ExportSessionModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const setError = useStore((s) => s.setError);
  const t = useT();
  const [cwd, setCwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ uuid: string; slug: string; lineCount: number } | null>(null);
  const slug = slugOf(cwd.trim());

  const run = async () => {
    setBusy(true);
    try {
      const q = cwd.trim() ? `?cwd=${encodeURIComponent(cwd.trim())}` : '';
      const r = await api.get(`/api/sessions/${sessionId}/export${q}`);
      const url = URL.createObjectURL(new Blob([r.jsonl], { type: 'application/jsonl' }));
      const a = document.createElement('a');
      a.href = url; a.download = `${r.uuid}.jsonl`; a.click();
      URL.revokeObjectURL(url);
      setDone({ uuid: r.uuid, slug: r.slug, lineCount: r.lineCount });
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={t('export.title')} width={520}>
      {!done ? (
        <div className="flex flex-col gap-3">
          <div className="text-xs text-txt2">{t('export.intro')}</div>
          <label className="text-xs font-semibold">{t('export.pathLabel')}</label>
          <input className="input w-full font-mono text-xs" value={cwd} placeholder={t('export.pathPlaceholder')}
            onChange={(e) => setCwd(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void run(); } }} />
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
              style={{ background: 'var(--clay)' }} disabled={busy} onClick={() => void run()}>
              <IconDownload size={13} />{busy ? t('export.downloading') : t('export.download')}
            </button>
          </div>
        </div>
      ) : (
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
      )}
    </Modal>
  );
}
