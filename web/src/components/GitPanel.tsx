import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Modal } from './Modal';
import { useT } from '../lib/i18n';

interface GitFile { path: string; index: string; work: string; staged: boolean; }
interface Status { repo: boolean; branch: string; upstream: boolean; ahead: number; behind: number; files: GitFile[]; clean: boolean; host: string | null; hasCredential: boolean; }

// Commit (with file-level staging) + push for a project's workspace. Opened from the chat header.
export function GitPanel({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }) {
  const t = useT();
  const [st, setSt] = useState<Status | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'' | 'load' | 'commit' | 'push'>('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [branches, setBranches] = useState<{ current: string; local: string[]; remote: string[] } | null>(null);
  const [switching, setSwitching] = useState(false);

  const load = async () => {
    setBusy('load'); setErr('');
    try {
      const s: Status = await api.get(`/api/projects/${projectId}/git/status`);
      setSt(s);
      setSel(new Set(s.files.map((f) => f.path))); // default: all changes selected
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(''); }
    // branches require a remote fetch (slower) — load without blocking the status view
    api.get(`/api/projects/${projectId}/git/branches`)
      .then((br) => setBranches(br && br.repo ? { current: br.current, local: br.local, remote: br.remote } : null))
      .catch(() => {});
  };

  const checkout = async (name: string) => {
    if (!name || name === branches?.current) return;
    setSwitching(true); setErr(''); setNote('');
    try {
      await api.post(`/api/projects/${projectId}/git/checkout`, { branch: name });
      setNote(t('git.switched', { branch: name }));
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setSwitching(false); }
  };
  useEffect(() => { if (open) { setNote(''); load(); } /* eslint-disable-next-line */ }, [open, projectId]);

  const toggle = (p: string) => { const n = new Set(sel); n.has(p) ? n.delete(p) : n.add(p); setSel(n); };
  const allSelected = !!st && st.files.length > 0 && sel.size === st.files.length;
  const toggleAll = () => { if (!st) return; setSel(allSelected ? new Set() : new Set(st.files.map((f) => f.path))); };

  const commit = async () => {
    if (!message.trim()) { setErr(t('git.needMessage')); return; }
    setBusy('commit'); setErr(''); setNote('');
    try {
      const r = await api.post(`/api/projects/${projectId}/git/commit`, { message: message.trim(), files: [...sel] });
      setMessage(''); setNote(t('git.commitDone', { commit: r.commit }));
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(''); }
  };
  const push = async () => {
    setBusy('push'); setErr(''); setNote('');
    try {
      await api.post(`/api/projects/${projectId}/git/push`, {});
      setNote(t('git.pushDone'));
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(''); }
  };

  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) onClose(); }} title={t('git.title')} width={560}>
      {busy === 'load' && !st && <div className="text-sm text-txt3">…</div>}
      {st && !st.repo && <div className="text-sm text-txt2">{t('git.noRepo')}</div>}
      {st && st.repo && (
        <>
          <div className="flex items-center gap-2 text-sm mb-3">
            <span className="text-clay" title={t('git.branchLabel')}>⑂</span>
            {branches
              ? (
                <select className="input !py-0.5 !text-xs !w-auto max-w-[220px] font-mono" value={branches.current}
                  disabled={switching} onChange={(e) => checkout(e.target.value)}>
                  {!branches.local.includes(branches.current) && <option value={branches.current}>{branches.current}</option>}
                  <optgroup label={t('git.localBranches')}>
                    {branches.local.map((b) => <option key={`l:${b}`} value={b}>{b}</option>)}
                  </optgroup>
                  {branches.remote.length > 0 && (
                    <optgroup label={t('git.remoteBranches')}>
                      {branches.remote.map((b) => <option key={`r:${b}`} value={b.split('/').slice(1).join('/')}>{b}</option>)}
                    </optgroup>
                  )}
                </select>
              )
              : <span className="text-[10px] bg-claysoft text-clay px-1.5 py-0.5 rounded-full font-mono">{st.branch}</span>}
            {switching && <span className="text-txt3 text-xs">…</span>}
            {st.upstream
              ? <span className="text-txt3 text-xs">{t('git.aheadBehind', { ahead: st.ahead, behind: st.behind })}</span>
              : <span className="text-warn text-xs">{t('git.noUpstream')}</span>}
            {st.host && <span className="text-txt3 text-[11px] ml-auto font-mono">{st.host}{st.hasCredential ? ' ✓' : ' ⚠'}</span>}
          </div>

          {st.files.length === 0
            ? <div className="text-sm text-txt3 mb-3">{t('git.clean')}</div>
            : (
              <div className="border border-line rounded-lg mb-2 max-h-52 overflow-auto scrolly">
                <label className="flex items-center gap-2 px-2.5 py-1.5 border-b border-line text-xs text-txt2 cursor-pointer sticky top-0 bg-panel">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                  {t('git.changes', { n: st.files.length })}
                </label>
                {st.files.map((f) => (
                  <label key={f.path} className="flex items-center gap-2 px-2.5 py-1 text-sm cursor-pointer hover:bg-line">
                    <input type="checkbox" checked={sel.has(f.path)} onChange={() => toggle(f.path)} />
                    <span className={`font-mono text-[10px] w-5 text-center rounded ${f.index === '?' ? 'text-warn' : f.staged ? 'text-ok' : 'text-txt3'}`}>{(f.index + f.work).trim() || '·'}</span>
                    <span className="font-mono text-xs truncate">{f.path}</span>
                  </label>
                ))}
              </div>
            )}

          <textarea className="input w-full mb-2" rows={2} placeholder={t('git.messagePlaceholder')}
            value={message} onChange={(e) => setMessage(e.target.value)} />
          {err && <div className="text-xs text-danger mb-2 whitespace-pre-wrap break-words">{err}</div>}
          {note && <div className="text-xs text-ok mb-2 whitespace-pre-wrap break-words">{note}</div>}
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={onClose}>{t('token.close')}</button>
            <button className="btn-ghost" disabled={!!busy || st.clean || sel.size === 0} onClick={commit}>
              {busy === 'commit' ? '…' : t('git.commit', { n: sel.size })}
            </button>
            <button className="btn-primary" disabled={!!busy} onClick={push}>
              {busy === 'push' ? '…' : t('git.push')}
            </button>
          </div>
        </>
      )}
      {err && !st && <div className="text-xs text-danger mt-2">{err}</div>}
    </Modal>
  );
}
