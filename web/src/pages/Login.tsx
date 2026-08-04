import { useState } from 'react';
import { useStore, useBrand } from '../lib/store';
import { useT } from '../lib/i18n';
import { LangSelect } from '../lib/ui';

export function Login() {
  const login = useStore((s) => s.login);
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const brand = useBrand();
  const t = useT();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await login(u, p); } catch (e: any) { setErr(e.message || t('login.loginFailed')); } finally { setBusy(false); }
  };

  return (
    <div className="h-full grid place-items-center bg-bg p-4">
      <form onSubmit={submit} className="w-full max-w-[340px] bg-panel border border-line rounded-xl p-6 md:p-7 shadow-sm">
        <div className="flex items-center gap-2.5 mb-5">
          <img src={brand.logo} alt="" className="w-8 h-8 rounded-lg object-contain" />
          <div className="min-w-0">
            <div className="font-semibold truncate">{brand.title}</div>
            <div className="text-xs text-txt3">{t('login.subtitle')}</div>
          </div>
          <LangSelect className="ml-auto shrink-0 max-w-[92px] text-xs text-txt2 bg-card border border-line rounded px-1.5 py-1 outline-none cursor-pointer" />
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
