import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { Modal } from './Modal';
import { useT } from '../lib/i18n';
import { IconDot } from '../lib/icons';
import { api } from '../lib/api';

function fmtDate(ms?: number | null) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type LoginMeta = { loggedIn: boolean; scopes: string[]; planLimits: boolean; subscriptionType: string | null; expiresAt: number | null };

// Sign in to a Claude account through the CLI's own OAuth flow. This is the only path to a
// user:profile scope — a token pasted below (`claude setup-token`) is minted inference-only, so it
// runs turns fine but can never report the plan window. Two steps: open the link, paste the code back.
export function ClaudeLoginBlock({ boxed = true }: { boxed?: boolean }) {
  const t = useT();
  const [meta, setMeta] = useState<LoginMeta | null>(null);
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [off, setOff] = useState(false); // admin disabled the feature (404) → hide the whole block

  useEffect(() => {
    let alive = true;
    api.get('/api/auth/me/claude-login')
      .then((r) => { if (alive) { setMeta(r.login); setUrl(r.pendingUrl || ''); } })
      .catch(() => { if (alive) setOff(true); });
    return () => { alive = false; };
  }, []);

  const start = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.post('/api/auth/me/claude-login/start');
      setUrl(r.url);
      window.open(r.url, '_blank', 'noopener');
    } catch (e: any) { setErr(e.message || t('login.startFailed')); }
    finally { setBusy(false); }
  };
  const finish = async () => {
    if (!code.trim()) { setErr(t('login.enterCode')); return; }
    setBusy(true); setErr('');
    try { const r = await api.post('/api/auth/me/claude-login/code', { code: code.trim() }); setMeta(r.login); setUrl(''); setCode(''); }
    catch (e: any) { setErr(e.message || t('login.failed')); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    setUrl(''); setCode(''); setErr('');
    try { await api.del('/api/auth/me/claude-login/start'); } catch { /* already gone */ }
  };
  const signOut = async () => {
    if (!confirm(t('login.signOutConfirm'))) return;
    setBusy(true); setErr('');
    try { const r = await api.del('/api/auth/me/claude-login'); setMeta(r.login); }
    catch (e: any) { setErr(e.message || t('login.signOutFailed')); }
    finally { setBusy(false); }
  };

  if (off) return null;

  return (
    <div className={boxed ? 'border border-line rounded-lg p-3 mb-4' : 'mb-4'}>
      <div className="text-sm font-semibold mb-1">{t('login.title')}</div>
      <div className="text-[11px] text-txt3 mb-2">{t('login.why')}</div>

      {meta?.loggedIn ? (
        <div className="text-sm flex flex-wrap items-center gap-2">
          <IconDot className="text-ok" />
          <span>{t('login.connected')}{meta.subscriptionType ? ` · ${meta.subscriptionType}` : ''}</span>
          <span className={`text-[11px] ${meta.planLimits ? 'text-ok' : 'text-warn'}`}>
            {t(meta.planLimits ? 'login.planLimitsOn' : 'login.planLimitsOff')}
          </span>
          <button className="ml-auto text-xs text-txt3 hover:text-danger" disabled={busy} onClick={signOut}>{t('login.signOut')}</button>
        </div>
      ) : url ? (
        <>
          <div className="text-[11px] text-txt2 mb-1">{t('login.step1')}</div>
          <a className="text-xs text-clay underline break-all" href={url} target="_blank" rel="noopener noreferrer">{url}</a>
          <div className="text-[11px] text-txt2 mt-2 mb-1">{t('login.step2')}</div>
          <input className="input" placeholder={t('login.codePlaceholder')} value={code} autoFocus
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && finish()} />
          <div className="flex justify-end gap-2 mt-2">
            <button className="btn-ghost" onClick={cancel} disabled={busy}>{t('common.cancel')}</button>
            <button className="btn-primary" onClick={finish} disabled={busy}>{busy ? '…' : t('login.connect')}</button>
          </div>
        </>
      ) : (
        <button className="btn-primary w-full md:w-auto" onClick={start} disabled={busy}>
          {busy ? '…' : t('login.signIn')}
        </button>
      )}
      {err && <div className="text-xs text-danger mt-2">{err}</div>}
    </div>
  );
}

// Register / update / clear the current user's own Claude token.
// `nag` variant is the post-login reminder shown to users who haven't registered one yet.
export function MyTokenModal({ open, onClose, nag }: { open: boolean; onClose: () => void; nag?: boolean }) {
  const user = useStore((s) => s.user);
  const saveClaudeToken = useStore((s) => s.saveClaudeToken);
  const clearClaudeToken = useStore((s) => s.clearClaudeToken);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const has = !!user?.hasClaudeToken;
  const t = useT();

  const save = async () => {
    if (!token.trim()) { setErr(t('token.enterToken')); return; }
    setBusy(true); setErr('');
    try { await saveClaudeToken(token.trim()); setToken(''); onClose(); }
    catch (e: any) { setErr(e.message || t('token.saveFailed')); }
    finally { setBusy(false); }
  };
  const clear = async () => {
    if (!confirm(t('token.clearConfirm'))) return;
    setBusy(true); setErr('');
    try { await clearClaudeToken(); }
    catch (e: any) { setErr(e.message || t('token.deleteFailed')); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) onClose(); }} title={nag ? t('token.registerTitle') : t('token.myTokenTitle')} width={460}>
      {nag && (
        <div className="text-xs text-txt2 bg-claysoft border border-line rounded-lg px-3 py-2 mb-3">
          {t('token.nagNotice')}
        </div>
      )}

      {/* mounted only while open so a closed modal never holds an in-flight sign-in */}
      {open && <ClaudeLoginBlock />}

      <div className="text-sm font-semibold mb-1">{t('token.pasteTitle')}</div>
      {has ? (
        <div className="text-sm mb-3 flex items-center gap-2">
          <IconDot className="text-ok" />
          <span>{t('token.registered')}{user?.claudeTokenSetAt ? ` · ${fmtDate(user.claudeTokenSetAt)}` : ''}</span>
          <button className="ml-auto text-xs text-txt3 hover:text-danger" disabled={busy} onClick={clear}>{t('common.delete')}</button>
        </div>
      ) : (
        <div className="text-xs text-txt3 mb-2">{t('token.notRegistered')}</div>
      )}

      <label className="text-xs text-txt2">{has ? t('token.replaceToken') : t('token.token')} {t('token.tokenPrefixHint')}</label>
      <input className="input mt-1 mb-2" type="password" placeholder="sk-ant-oat-…" value={token}
        onChange={(e) => setToken(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && save()} />
      <div className="text-[11px] text-txt3 mb-3">
        {t('token.setupHint', { code: 'claude setup-token' })}
      </div>
      {err && <div className="text-xs text-danger mb-2">{err}</div>}

      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose} disabled={busy}>{nag ? t('token.later') : t('token.close')}</button>
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? '…' : t('token.save')}</button>
      </div>
    </Modal>
  );
}
