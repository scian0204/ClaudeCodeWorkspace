import { useState } from 'react';
import { useStore } from '../lib/store';
import { useT } from '../lib/i18n';
import { LangToggle } from '../lib/ui';

export function Login() {
  const login = useStore((s) => s.login);
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const t = useT();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await login(u, p); } catch (e: any) { setErr(e.message || t('login.loginFailed')); } finally { setBusy(false); }
  };

  return (
    <div className="h-full grid place-items-center bg-bg">
      <form onSubmit={submit} className="w-[340px] bg-panel border border-line rounded-xl p-7 shadow-sm">
        <div className="flex items-center gap-2.5 mb-5">
          <img src="/favicon.svg" alt="" className="w-8 h-8 rounded-lg" />
          <div>
            <div className="font-semibold">ClaudeCode Workspace</div>
            <div className="text-xs text-txt3">{t('login.subtitle')}</div>
          </div>
          <LangToggle className="ml-auto text-xs text-txt3 hover:text-txt border border-line rounded px-2 py-1" />
        </div>
        <label className="text-xs text-txt2">{t('login.username')}</label>
        <input className="input mt-1 mb-3" value={u} onChange={(e) => setU(e.target.value)} autoFocus />
        <label className="text-xs text-txt2">{t('login.password')}</label>
        <input className="input mt-1 mb-4" type="password" value={p} onChange={(e) => setP(e.target.value)} />
        {err && <div className="text-xs text-danger mb-3">{err}</div>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? '…' : t('login.logIn')}</button>
        <div className="text-[11px] text-txt3 mt-3 text-center">{t('login.initialAdmin')}</div>
      </form>
    </div>
  );
}
