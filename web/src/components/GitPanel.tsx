import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { Modal } from './Modal';
import { useT } from '../lib/i18n';
import { IconGitBranch, IconChevronDown, IconChevronRight } from '../lib/icons';

interface GitFile { path: string; index: string; work: string; staged: boolean; }
interface CredMeta { scope: 'user' | 'common'; provider: string; host: string; username: string; authorEmail: string | null; }
interface CredOption extends CredMeta { id: string; }
interface Status { repo: boolean; branch: string; upstream: boolean; ahead: number; behind: number; files: GitFile[]; clean: boolean; host: string | null; hasCredential: boolean; credential: CredMeta | null; identity: { name: string; email: string }; }

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
      {st && !st.repo && <PublishForm projectId={projectId} onDone={load} setErr={setErr} setNote={setNote} />}
      {st && st.repo && (
        <>
          {/* wraps on a phone — the branch select plus ahead/behind plus host does not fit 375px */}
          <div className="flex flex-wrap items-center gap-2 text-sm mb-3">
            <span className="text-clay" title={t('git.branchLabel')}><IconGitBranch size={15} /></span>
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

          {/* Which credential this session's push/commit actually uses (resolved: yours → shared) */}
          {st.host && (
            <div className="text-xs border border-line rounded-lg px-2.5 py-2 mb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-txt3">{t('git.credUsing')}</span>
                {st.credential
                  ? (
                    <>
                      <span className="text-[10px] bg-claysoft text-clay px-1.5 py-0.5 rounded-full">
                        {st.credential.scope === 'user' ? t('git.credMine') : t('git.credCommon')}
                      </span>
                      <span className="text-[10px] bg-claysoft text-clay px-1.5 py-0.5 rounded-full">{st.credential.provider}</span>
                      <span className="font-mono text-[11px]">{st.credential.host}</span>
                      <span className="text-txt3">· {st.credential.username}</span>
                    </>
                  )
                  : <span className="text-warn">{t('git.credNone', { host: st.host })}</span>}
              </div>
              <div className="text-txt3 text-[11px] mt-1">
                {t('git.commitsAs')}: <span className="font-mono">{st.identity.name} &lt;{st.identity.email}&gt;</span>
              </div>
            </div>
          )}

          {st.repo && (
            <RemotesSection projectId={projectId} onChanged={load} setErr={setErr} setNote={setNote} />
          )}

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

// Manual remote management. Collapsed by default — most projects have one origin nobody touches,
// and it only matters when retargeting a fork, adding an upstream, or fixing a stale URL. Editing
// origin changes which credential push resolves to, so every mutation reloads the panel's status.
function RemotesSection({ projectId, onChanged, setErr, setNote }: {
  projectId: string; onChanged: () => Promise<void> | void;
  setErr: (s: string) => void; setNote: (s: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [remotes, setRemotes] = useState<{ name: string; url: string }[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [busy, setBusy] = useState('');

  const load = async () => {
    try {
      const r = await api.get(`/api/projects/${projectId}/git/remotes`);
      setRemotes(r.remotes || []); setDraft({});
    } catch (e: any) { setErr(e.message); }
  };
  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open, projectId]);

  // Every mutation returns the fresh list, so the section never needs a second round-trip.
  const mutate = async (key: string, run: () => Promise<any>, note: string) => {
    setBusy(key); setErr(''); setNote('');
    try {
      const r = await run();
      setRemotes(r.remotes || []); setDraft({}); setNote(note);
      await onChanged();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(''); }
  };

  return (
    <div className="border border-line rounded-lg mb-3">
      <button type="button" className="w-full flex items-center gap-2 px-2.5 py-2 text-xs"
        onClick={() => setOpen((o) => !o)}>
        <span className="text-txt3">{open ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}</span>
        <span>{t('git.remotes')}</span>
        {!open && remotes.length > 0 && <span className="text-txt3">{remotes.length}</span>}
      </button>

      {open && (
        <div className="px-2.5 pb-2.5">
          {remotes.length === 0 && <div className="text-[11px] text-txt3 mb-2">{t('git.remotesNone')}</div>}
          {remotes.map((r) => {
            const val = draft[r.name] ?? r.url;
            const dirty = val.trim() !== r.url;
            return (
              <div key={r.name} className="flex flex-wrap items-center gap-2 mb-2">
                <span className="font-mono text-[11px] shrink-0 min-w-[64px]">{r.name}</span>
                <input className="input w-full md:w-auto md:flex-1 min-w-0 !py-1 !text-[11px] font-mono" value={val}
                  onChange={(e) => setDraft((p) => ({ ...p, [r.name]: e.target.value }))} />
                <button className="btn-ghost !py-0.5 !px-2 !text-[11px] shrink-0" disabled={!dirty || !!busy}
                  onClick={() => mutate(`u:${r.name}`, () => api.put(`/api/projects/${projectId}/git/remotes/${encodeURIComponent(r.name)}`, { url: val.trim() }), t('git.remoteSaved', { name: r.name }))}>
                  {busy === `u:${r.name}` ? '…' : t('git.remoteSave')}
                </button>
                <button className="btn-ghost !py-0.5 !px-2 !text-[11px] shrink-0 text-danger" disabled={!!busy}
                  onClick={() => mutate(`d:${r.name}`, () => api.del(`/api/projects/${projectId}/git/remotes/${encodeURIComponent(r.name)}`), t('git.remoteRemoved', { name: r.name }))}>
                  {busy === `d:${r.name}` ? '…' : t('git.remoteRemove')}
                </button>
              </div>
            );
          })}

          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-line">
            <input className="input !py-1 !text-[11px] font-mono w-full md:w-[110px] shrink-0 mt-2" value={newName}
              placeholder={t('git.remoteNamePlaceholder')} onChange={(e) => setNewName(e.target.value)} />
            <input className="input w-full md:w-auto md:flex-1 min-w-0 !py-1 !text-[11px] font-mono mt-2" value={newUrl}
              placeholder="https://github.com/me/repo.git" onChange={(e) => setNewUrl(e.target.value)} />
            <button className="btn-ghost !py-0.5 !px-2 !text-[11px] shrink-0 md:mt-2"
              disabled={!!busy || !newName.trim() || !newUrl.trim()}
              onClick={() => mutate('add', () => api.post(`/api/projects/${projectId}/git/remotes`, { name: newName.trim(), url: newUrl.trim() }), t('git.remoteAdded', { name: newName.trim() }))
                .then(() => { setNewName(''); setNewUrl(''); })}>
              {busy === 'add' ? '…' : t('git.remoteAdd')}
            </button>
          </div>
          <div className="text-[11px] text-txt3 mt-2">{t('git.remotesHint')}</div>
        </div>
      )}
    </div>
  );
}

// An imported project lands as plain files, so its Git panel would otherwise be a dead end. Offer
// the two ways out: make it a repo and stop there, or go all the way — init, first commit, create
// the repo on the provider, push. A pasted URL skips the creation step for a repo that exists (and
// is the only route for a provider whose API we do not speak).
function PublishForm({ projectId, onDone, setErr, setNote }: {
  projectId: string; onDone: () => Promise<void> | void;
  setErr: (s: string) => void; setNote: (s: string) => void;
}) {
  const t = useT();
  const publishEnabled = useStore((s) => s.gitPublishEnabled);
  const project = useStore((s) => [...s.projects.mine, ...s.projects.common].find((p: any) => p.id === projectId));
  const [creds, setCreds] = useState<CredOption[]>([]);
  const [credentialId, setCredentialId] = useState('');
  const [name, setName] = useState('');
  const [priv, setPriv] = useState(true);
  const [manual, setManual] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [busy, setBusy] = useState<'' | 'init' | 'publish'>('');

  useEffect(() => {
    setName((n) => n || (project as any)?.name || '');
    if (!publishEnabled) return;
    api.get('/api/git-credentials')
      .then((r) => {
        const all: CredOption[] = [...(r.mine || []), ...(r.common || [])];
        setCreds(all);
        setCredentialId((c) => c || all[0]?.id || '');
      })
      .catch(() => {});
    /* eslint-disable-next-line */
  }, [projectId, publishEnabled]);

  const run = async (kind: 'init' | 'publish') => {
    setBusy(kind); setErr(''); setNote('');
    try {
      if (kind === 'init') {
        await api.post(`/api/projects/${projectId}/git/init`, {});
        setNote(t('git.initDone'));
      } else {
        const r = await api.post(`/api/projects/${projectId}/git/publish`,
          manual ? { remoteUrl: remoteUrl.trim() } : { credentialId, name: name.trim(), private: priv });
        setNote(t('git.publishDone', { url: r.url }));
      }
      await onDone();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(''); }
  };

  const canPublish = !busy && (manual ? !!remoteUrl.trim() : !!credentialId && !!name.trim());

  return (
    <div>
      <div className="text-sm text-txt2 mb-3">{t('git.noRepo')}</div>
      {!publishEnabled ? (
        <div className="flex justify-end">
          <button className="btn-primary" disabled={!!busy} onClick={() => run('init')}>{t('git.init')}</button>
        </div>
      ) : (
        <>
          <label className="flex items-center gap-2 text-xs mb-3 cursor-pointer select-none">
            <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} />
            {t('git.publishManual')}
          </label>

          {manual ? (
            <>
              <div className="text-xs text-txt2 mb-1">{t('git.publishUrl')}</div>
              <input className="input mb-1 font-mono !text-xs" value={remoteUrl} placeholder="https://github.com/me/repo.git"
                onChange={(e) => setRemoteUrl(e.target.value)} />
              <div className="text-[11px] text-txt3 mb-3">{t('git.publishUrlHint')}</div>
            </>
          ) : creds.length === 0 ? (
            <div className="text-[11px] text-warn mb-3">{t('git.publishNoCred')}</div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-1">
                <div>
                  <div className="text-xs text-txt2 mb-1">{t('git.publishAccount')}</div>
                  <select className="input !text-xs w-full" value={credentialId} onChange={(e) => setCredentialId(e.target.value)}>
                    {creds.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.host} · {c.username}{c.scope === 'common' ? ` (${t('git.publishShared')})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="text-xs text-txt2 mb-1">{t('git.publishRepoName')}</div>
                  <input className="input w-full !text-xs font-mono" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs mb-1 cursor-pointer select-none">
                <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} />
                {t('git.publishPrivate')}
              </label>
              <div className="text-[11px] text-txt3 mb-3">{t('git.publishHint')}</div>
            </>
          )}

          <div className="flex flex-col md:flex-row md:justify-end gap-2">
            <button className="btn-ghost" disabled={!!busy} onClick={() => run('init')}>
              {busy === 'init' ? '…' : t('git.init')}
            </button>
            <button className="btn-primary" disabled={!canPublish} onClick={() => run('publish')}>
              {busy === 'publish' ? '…' : t('git.publish')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
