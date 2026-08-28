import { useEffect, useState } from 'react';
import { useStore, useBrand } from '../lib/store';
import { useT } from '../lib/i18n';
import { LangSelect } from '../lib/ui';

// What sign-in methods the server offers. Fetched unauthenticated (/api/auth/methods) because the
// card has to decide whether to draw the SSO button before anyone is signed in.
interface Methods { localRestricted: boolean; ldap: boolean; oidc: boolean; oidcLabel: string }

export function Login() {
  const login = useStore((s) => s.login);
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [methods, setMethods] = useState<Methods | null>(null);
  const brand = useBrand();
  const t = useT();

  useEffect(() => {
    // A failed SSO round trip comes back as ?ssoError=… — show it, then drop it from the URL so a
    // reload does not resurrect a stale message.
    const q = new URLSearchParams(window.location.search);
    const sso = q.get('ssoError');
    if (sso) {
      setErr(sso);
      q.delete('ssoError');
      const rest = q.toString();
      window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
    }
    fetch('/api/auth/methods', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => m && setMethods(m))
      .catch(() => { /* the local form still works */ });
  }, []);

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

        {methods?.oidc && (
          <>
            <a href="/api/auth/oidc/start" className="btn-primary w-full !no-underline text-center block mb-3">
              {t('login.ssoWith', { name: methods.oidcLabel || 'SSO' })}
            </a>
            <div className="flex items-center gap-2 mb-3 text-[11px] text-txt3">
              <span className="h-px bg-line flex-1" />{t('login.or')}<span className="h-px bg-line flex-1" />
            </div>
          </>
        )}

        <label className="text-xs text-txt2">{t('login.username')}</label>
        <input className="input mt-1 mb-3" value={u} onChange={(e) => setU(e.target.value)} autoFocus />
        <label className="text-xs text-txt2">{t('login.password')}</label>
        <input className="input mt-1 mb-4" type="password" value={p} onChange={(e) => setP(e.target.value)} />
        {err && <div className="text-xs text-danger mb-3 break-words">{err}</div>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? '…' : t('login.logIn')}</button>
        {methods?.ldap && <div className="text-[11px] text-txt3 mt-3 text-center">{t('login.ldapHint')}</div>}
        {methods?.localRestricted && <div className="text-[11px] text-txt3 mt-2 text-center">{t('login.localRestricted')}</div>}
        <div className="text-[11px] text-txt3 mt-3 text-center">{t('login.initialAdmin')}</div>
      </form>
    </div>
  );
}
