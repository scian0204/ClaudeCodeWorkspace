import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Modal } from './Modal';
import { useT } from '../lib/i18n';

export interface GitCredMeta {
  id: string; scope: 'user' | 'common'; provider: string; host: string;
  username: string; authorEmail: string | null; setAt: number;
}

const PROVIDERS = ['github', 'gitlab', 'bitbucket', 'other'] as const;
const DEFAULT_HOST: Record<string, string> = { github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org', other: '' };
const DEFAULT_USER: Record<string, string> = { github: 'x-access-token', gitlab: 'oauth2', bitbucket: 'x-token-auth', other: '' };

function fmtDate(ms?: number | null) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// List + add + delete git credentials for one scope. Reused in the user modal and the admin panel.
export function GitCredList({ scope }: { scope: 'user' | 'common' }) {
  const t = useT();
  const [list, setList] = useState<GitCredMeta[]>([]);
  const [provider, setProvider] = useState<string>('github');
  const [host, setHost] = useState('github.com');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [authorEmail, setAuthorEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    const r = await api.get('/api/git-credentials');
    setList(scope === 'common' ? r.common : r.mine);
  };
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [scope]);

  const pickProvider = (p: string) => {
    setProvider(p);
    if (!host || Object.values(DEFAULT_HOST).includes(host)) setHost(DEFAULT_HOST[p] || '');
  };

  const add = async () => {
    if (!host.trim() || !username.trim() || !token.trim()) { setErr(t('gitcred.fillRequired')); return; }
    setBusy(true); setErr('');
    try {
      await api.post('/api/git-credentials', {
        scope, provider, host: host.trim(), username: username.trim(), token: token.trim(),
        authorName: authorName.trim() || undefined, authorEmail: authorEmail.trim() || undefined,
      });
      setToken(''); setUsername(DEFAULT_USER[provider] || ''); setAuthorName(''); setAuthorEmail('');
      await load();
    } catch (e: any) { setErr(e.message || t('gitcred.saveFailed')); }
    finally { setBusy(false); }
  };
  const del = async (id: string) => {
    if (!confirm(t('gitcred.deleteConfirm'))) return;
    try { await api.del(`/api/git-credentials/${id}`); await load(); }
    catch (e: any) { setErr(e.message); }
  };

  return (
    <div>
      <div className="space-y-1.5 mb-3">
        {list.length === 0 && <div className="text-xs text-txt3">{t('gitcred.none')}</div>}
        {list.map((c) => (
          <div key={c.id} className="flex items-center gap-2 text-sm border-b border-line py-1.5">
            <span className="text-[10px] bg-claysoft text-clay px-1.5 py-0.5 rounded-full">{c.provider}</span>
            <span className="font-mono text-xs">{c.host}</span>
            <span className="text-txt3 text-xs">· {c.username}</span>
            {c.authorEmail && <span className="text-txt3 text-[11px] truncate">✎ {c.authorEmail}</span>}
            <span className="text-txt3 text-[10px] ml-auto">{fmtDate(c.setAt)}</span>
            <button className="text-xs text-txt3 hover:text-danger" onClick={() => del(c.id)}>{t('common.delete')}</button>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select className="input" value={provider} onChange={(e) => pickProvider(e.target.value)}>
          {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input className="input" placeholder={t('gitcred.hostPlaceholder')} value={host} onChange={(e) => setHost(e.target.value)} />
        <input className="input" placeholder={t('gitcred.usernamePlaceholder')} value={username} onChange={(e) => setUsername(e.target.value)} />
        <input className="input" type="password" placeholder={t('gitcred.tokenPlaceholder')} value={token} onChange={(e) => setToken(e.target.value)} />
        <input className="input" placeholder={t('gitcred.authorNamePlaceholder')} value={authorName} onChange={(e) => setAuthorName(e.target.value)} />
        <input className="input" placeholder={t('gitcred.authorEmailPlaceholder')} value={authorEmail} onChange={(e) => setAuthorEmail(e.target.value)} />
      </div>
      <div className="text-[11px] text-txt3 mt-1.5">{t('gitcred.hint')}</div>
      {err && <div className="text-xs text-danger mt-1">{err}</div>}
      <button className="btn-primary mt-2" disabled={busy} onClick={add}>{busy ? '…' : t('gitcred.add')}</button>
    </div>
  );
}

export function GitCredentialsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) onClose(); }} title={t('gitcred.title')} width={520}>
      <div className="text-xs text-txt2 bg-claysoft border border-line rounded-lg px-3 py-2 mb-3">{t('gitcred.notice')}</div>
      <GitCredList scope="user" />
      <div className="flex justify-end mt-3">
        <button className="btn-ghost" onClick={onClose}>{t('token.close')}</button>
      </div>
    </Modal>
  );
}
