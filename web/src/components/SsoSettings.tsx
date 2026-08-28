import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { IconDot, IconDotOutline } from '../lib/icons';

// AD/LDAP + OIDC single sign-on settings (admin panel › 인증).
//
// Same shape as LlmProviderForm: self-contained, talks to the API directly, and secrets live in
// local state only — the GET never returns the bind password or the client secret, so an empty box
// means "keep what is stored" rather than "clear it".
//
// The on/off switch for each directory is a config-registry key (ldapEnabled / oidcEnabled), edited
// here through the ordinary /api/admin/config route so there is still exactly one source of truth.

function Toggle({ on, onChange, label, busy }: { on: boolean; onChange: (v: boolean) => void; label: string; busy?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
      <input type="checkbox" checked={on} disabled={busy} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-txt2">
      {label}{hint ? <span className="text-txt3"> {hint}</span> : null}
      {children}
    </label>
  );
}

const setFlag = (key: string, value: boolean) => api.put('/api/admin/config', { key, value: value ? '1' : '0' });

// ── LDAP / Active Directory ──

type LdapState = {
  url: string; bindDn: string; bindPassword: string; baseDn: string;
  userFilter: string; importFilter: string; attrUsername: string; attrDisplayName: string;
  attrEmail: string; attrMemberOf: string; adminGroup: string;
  startTls: boolean; tlsRejectUnauthorized: boolean;
};
const emptyLdap: LdapState = {
  url: '', bindDn: '', bindPassword: '', baseDn: '',
  userFilter: '(&(objectClass=user)(sAMAccountName={username}))',
  importFilter: '(&(objectClass=user)(objectCategory=person))',
  attrUsername: 'sAMAccountName', attrDisplayName: 'displayName', attrEmail: 'mail',
  attrMemberOf: 'memberOf', adminGroup: '', startTls: false, tlsRejectUnauthorized: true,
};

export function LdapForm() {
  const t = useT();
  const [status, setStatus] = useState<any>(null);
  const [enabled, setEnabled] = useState(false);
  const [f, setF] = useState<LdapState>(emptyLdap);
  const [advanced, setAdvanced] = useState(false);
  const [testUser, setTestUser] = useState('');
  const [result, setResult] = useState<string[] | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof LdapState, v: any) => setF((p) => ({ ...p, [k]: v }));

  const load = async () => {
    const r = await api.get('/api/admin/ldap');
    setStatus(r.ldap || null);
    setEnabled(!!r.enabled);
    if (r.ldap) setF({ ...emptyLdap, ...r.ldap, bindPassword: '' });
  };
  useEffect(() => { load().catch((e) => setErr(e.message)); }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('');
    try { await fn(); } catch (e: any) { setErr(e.message || String(e)); } finally { setBusy(false); }
  };
  const save = () => run(async () => {
    const r = await api.put('/api/admin/ldap', f);
    setStatus(r.ldap); setF((p) => ({ ...p, bindPassword: '' })); setResult(null);
  });
  const remove = () => run(async () => {
    if (!confirm(t('sso.ldapClearConfirm'))) return;
    await api.del('/api/admin/ldap'); setStatus(null); setF(emptyLdap); setResult(null); setSummary(null);
  });
  const test = () => run(async () => {
    setSummary(null);
    const r = await api.post('/api/admin/ldap/test', { username: testUser.trim() });
    setResult(r.sample?.length ? r.sample : [t('sso.testNoEntries')]);
  });
  const doImport = () => run(async () => {
    setResult(null);
    const r = await api.post('/api/admin/ldap/import');
    setSummary(r.summary);
  });
  const toggle = (v: boolean) => run(async () => { await setFlag('ldapEnabled', v); setEnabled(v); });

  return (
    <div className="space-y-3">
      <div className="text-sm flex items-center gap-2 flex-wrap">
        {status
          ? <><IconDot className="text-ok" /><span className="min-w-0 truncate">{status.url} · {status.baseDn}</span>
              <button className="ml-auto text-xs text-txt3 hover:text-danger shrink-0" disabled={busy} onClick={remove}>{t('common.delete')}</button></>
          : <><IconDotOutline className="text-txt3" /><span className="text-txt3">{t('sso.notConfigured')}</span></>}
      </div>
      <Toggle on={enabled} busy={busy} onChange={toggle} label={t('sso.ldapEnable')} />
      <div className="text-[11px] text-txt3">{t('sso.ldapNote')}</div>

      <Field label={t('sso.serverUrl')}>
        <input className="input mt-1" placeholder="ldaps://dc.corp.local:636" value={f.url} onChange={(e) => set('url', e.target.value)} />
      </Field>
      <Field label={t('sso.baseDn')}>
        <input className="input mt-1" placeholder="DC=corp,DC=local" value={f.baseDn} onChange={(e) => set('baseDn', e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Field label={t('sso.bindDn')}>
          <input className="input mt-1" placeholder="CN=svc,OU=Service,DC=corp,DC=local" value={f.bindDn} onChange={(e) => set('bindDn', e.target.value)} />
        </Field>
        <Field label={t('sso.bindPassword')} hint={status?.hasBindPassword ? `(${t('provider.alreadySet')})` : ''}>
          <input className="input mt-1" type="password" placeholder={status?.hasBindPassword ? t('sso.keepStored') : ''} value={f.bindPassword} onChange={(e) => set('bindPassword', e.target.value)} />
        </Field>
      </div>
      <Field label={t('sso.userFilter')}>
        <input className="input mt-1 font-mono text-xs" value={f.userFilter} onChange={(e) => set('userFilter', e.target.value)} />
      </Field>
      <Field label={t('sso.adminGroup')} hint={`(${t('sso.optional')})`}>
        <input className="input mt-1" placeholder="CN=CCW-Admins,OU=Groups,DC=corp,DC=local" value={f.adminGroup} onChange={(e) => set('adminGroup', e.target.value)} />
      </Field>

      <button className="text-xs text-txt3 hover:text-txt" onClick={() => setAdvanced((v) => !v)}>
        {advanced ? '−' : '+'} {t('sso.advanced')}
      </button>
      {advanced && (
        <div className="space-y-3 border-l-2 border-line pl-3">
          <Field label={t('sso.importFilter')}>
            <input className="input mt-1 font-mono text-xs" value={f.importFilter} onChange={(e) => set('importFilter', e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Field label={t('sso.attrUsername')}>
              <input className="input mt-1" value={f.attrUsername} onChange={(e) => set('attrUsername', e.target.value)} />
            </Field>
            <Field label={t('sso.attrDisplayName')}>
              <input className="input mt-1" value={f.attrDisplayName} onChange={(e) => set('attrDisplayName', e.target.value)} />
            </Field>
            <Field label={t('sso.attrEmail')}>
              <input className="input mt-1" value={f.attrEmail} onChange={(e) => set('attrEmail', e.target.value)} />
            </Field>
            <Field label={t('sso.attrMemberOf')}>
              <input className="input mt-1" value={f.attrMemberOf} onChange={(e) => set('attrMemberOf', e.target.value)} />
            </Field>
          </div>
          <Toggle on={f.startTls} onChange={(v) => set('startTls', v)} label={t('sso.startTls')} />
          <Toggle on={f.tlsRejectUnauthorized} onChange={(v) => set('tlsRejectUnauthorized', v)} label={t('sso.verifyCert')} />
        </div>
      )}

      {err && <div className="text-xs text-danger break-words">{err}</div>}
      {result && (
        <div className="text-xs bg-card border border-line rounded p-2 space-y-1">
          {result.map((line, i) => <div key={i} className="font-mono break-all">{line}</div>)}
        </div>
      )}
      {summary && (
        <div className="text-xs bg-card border border-line rounded p-2 space-y-1">
          <div>{t('sso.importResult', { found: summary.found, created: summary.created, updated: summary.updated, skipped: summary.skipped })}</div>
          {summary.errors?.map((line: string, i: number) => <div key={i} className="text-danger break-all">{line}</div>)}
        </div>
      )}

      <div className="flex flex-wrap gap-2 justify-end">
        <input className="input flex-1 min-w-[140px]" placeholder={t('sso.testUserPlaceholder')} value={testUser} onChange={(e) => setTestUser(e.target.value)} />
        <button className="btn-ghost" disabled={busy || !status} onClick={test}>{t('sso.test')}</button>
        <button className="btn-ghost" disabled={busy || !status} onClick={doImport}>{t('sso.import')}</button>
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? '…' : t('provider.save')}</button>
      </div>
    </div>
  );
}

// ── OIDC single sign-on ──

type OidcState = {
  issuer: string; clientId: string; clientSecret: string; scopes: string; redirectUri: string;
  usernameClaim: string; displayNameClaim: string; emailClaim: string; groupsClaim: string;
  adminGroup: string; allowedDomains: string; buttonLabel: string;
};
const emptyOidc: OidcState = {
  issuer: '', clientId: '', clientSecret: '', scopes: 'openid profile email', redirectUri: '',
  usernameClaim: 'preferred_username', displayNameClaim: 'name', emailClaim: 'email',
  groupsClaim: 'groups', adminGroup: '', allowedDomains: '', buttonLabel: 'SSO',
};

export function OidcForm() {
  const t = useT();
  const [status, setStatus] = useState<any>(null);
  const [enabled, setEnabled] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState('');
  const [f, setF] = useState<OidcState>(emptyOidc);
  const [advanced, setAdvanced] = useState(false);
  const [result, setResult] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof OidcState, v: string) => setF((p) => ({ ...p, [k]: v }));

  const load = async () => {
    const r = await api.get('/api/admin/oidc');
    setStatus(r.oidc || null);
    setEnabled(!!r.enabled);
    setCallbackUrl(r.callbackUrl || '');
    if (r.oidc) setF({ ...emptyOidc, ...r.oidc, clientSecret: '' });
  };
  useEffect(() => { load().catch((e) => setErr(e.message)); }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('');
    try { await fn(); } catch (e: any) { setErr(e.message || String(e)); } finally { setBusy(false); }
  };
  const save = () => run(async () => {
    const r = await api.put('/api/admin/oidc', f);
    setStatus(r.oidc); setF((p) => ({ ...p, clientSecret: '' })); setResult(null);
  });
  const remove = () => run(async () => {
    if (!confirm(t('sso.oidcClearConfirm'))) return;
    await api.del('/api/admin/oidc'); setStatus(null); setF(emptyOidc); setResult(null);
  });
  const test = () => run(async () => {
    const r = await api.post('/api/admin/oidc/test');
    setResult([
      `issuer: ${r.issuer}`, `authorize: ${r.authorize}`, `token: ${r.token}`,
      `jwks: ${r.jwks ? 'ok' : '—'} · userinfo: ${r.userinfo ? 'ok' : '—'}`,
    ]);
  });
  const toggle = (v: boolean) => run(async () => { await setFlag('oidcEnabled', v); setEnabled(v); });

  return (
    <div className="space-y-3">
      <div className="text-sm flex items-center gap-2 flex-wrap">
        {status
          ? <><IconDot className="text-ok" /><span className="min-w-0 truncate">{status.issuer}</span>
              <button className="ml-auto text-xs text-txt3 hover:text-danger shrink-0" disabled={busy} onClick={remove}>{t('common.delete')}</button></>
          : <><IconDotOutline className="text-txt3" /><span className="text-txt3">{t('sso.notConfigured')}</span></>}
      </div>
      <Toggle on={enabled} busy={busy} onChange={toggle} label={t('sso.oidcEnable')} />
      <div className="text-[11px] text-txt3">{t('sso.oidcNote')}</div>
      {callbackUrl && (
        <div className="text-[11px] text-txt3">
          {t('sso.callbackUrl')}: <code className="font-mono break-all">{status?.redirectUri || callbackUrl}</code>
        </div>
      )}

      <Field label={t('sso.issuer')}>
        <input className="input mt-1" placeholder="https://login.microsoftonline.com/<tenant>/v2.0" value={f.issuer} onChange={(e) => set('issuer', e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Field label={t('sso.clientId')}>
          <input className="input mt-1" value={f.clientId} onChange={(e) => set('clientId', e.target.value)} />
        </Field>
        <Field label={t('sso.clientSecret')} hint={status?.hasClientSecret ? `(${t('provider.alreadySet')})` : `(${t('sso.optional')})`}>
          <input className="input mt-1" type="password" placeholder={status?.hasClientSecret ? t('sso.keepStored') : t('sso.publicClient')} value={f.clientSecret} onChange={(e) => set('clientSecret', e.target.value)} />
        </Field>
      </div>
      <Field label={t('sso.buttonLabel')}>
        <input className="input mt-1" placeholder="SSO" value={f.buttonLabel} onChange={(e) => set('buttonLabel', e.target.value)} />
      </Field>
      <Field label={t('sso.allowedDomains')} hint={`(${t('sso.optional')})`}>
        <input className="input mt-1" placeholder="corp.com, sub.corp.com" value={f.allowedDomains} onChange={(e) => set('allowedDomains', e.target.value)} />
      </Field>

      <button className="text-xs text-txt3 hover:text-txt" onClick={() => setAdvanced((v) => !v)}>
        {advanced ? '−' : '+'} {t('sso.advanced')}
      </button>
      {advanced && (
        <div className="space-y-3 border-l-2 border-line pl-3">
          <Field label={t('sso.scopes')}>
            <input className="input mt-1" value={f.scopes} onChange={(e) => set('scopes', e.target.value)} />
          </Field>
          <Field label={t('sso.redirectUri')} hint={`(${t('sso.optional')})`}>
            <input className="input mt-1" placeholder={callbackUrl} value={f.redirectUri} onChange={(e) => set('redirectUri', e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Field label={t('sso.usernameClaim')}>
              <input className="input mt-1" value={f.usernameClaim} onChange={(e) => set('usernameClaim', e.target.value)} />
            </Field>
            <Field label={t('sso.displayNameClaim')}>
              <input className="input mt-1" value={f.displayNameClaim} onChange={(e) => set('displayNameClaim', e.target.value)} />
            </Field>
            <Field label={t('sso.emailClaim')}>
              <input className="input mt-1" value={f.emailClaim} onChange={(e) => set('emailClaim', e.target.value)} />
            </Field>
            <Field label={t('sso.groupsClaim')}>
              <input className="input mt-1" value={f.groupsClaim} onChange={(e) => set('groupsClaim', e.target.value)} />
            </Field>
          </div>
          <Field label={t('sso.oidcAdminGroup')} hint={`(${t('sso.optional')})`}>
            <input className="input mt-1" placeholder="ccw-admins" value={f.adminGroup} onChange={(e) => set('adminGroup', e.target.value)} />
          </Field>
        </div>
      )}

      {err && <div className="text-xs text-danger break-words">{err}</div>}
      {result && (
        <div className="text-xs bg-card border border-line rounded p-2 space-y-1">
          {result.map((line, i) => <div key={i} className="font-mono break-all">{line}</div>)}
        </div>
      )}

      <div className="flex flex-wrap gap-2 justify-end">
        <button className="btn-ghost" disabled={busy || !status} onClick={test}>{t('sso.test')}</button>
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? '…' : t('provider.save')}</button>
      </div>
    </div>
  );
}
