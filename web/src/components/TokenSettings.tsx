import { useState } from 'react';
import { useStore } from '../lib/store';
import { Modal } from './Modal';
import { useT } from '../lib/i18n';

function fmtDate(ms?: number | null) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

      {has ? (
        <div className="text-sm mb-3 flex items-center gap-2">
          <span className="text-ok">●</span>
          <span>{t('token.registered')}{user?.claudeTokenSetAt ? ` · ${fmtDate(user.claudeTokenSetAt)}` : ''}</span>
          <button className="ml-auto text-xs text-txt3 hover:text-danger" disabled={busy} onClick={clear}>{t('common.delete')}</button>
        </div>
      ) : (
        <div className="text-xs text-txt3 mb-2">{t('token.notRegistered')}</div>
      )}

      <label className="text-xs text-txt2">{has ? t('token.replaceToken') : t('token.token')} {t('token.tokenPrefixHint')}</label>
      <input className="input mt-1 mb-2" type="password" placeholder="sk-ant-oat-…" value={token} autoFocus
        onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
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
