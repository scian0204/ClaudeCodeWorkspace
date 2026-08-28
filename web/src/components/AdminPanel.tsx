import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, BRAND_NAME, brandLogoUrl } from '../lib/store';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { MobileMenuButton, timeAgo } from '../lib/ui';
import { GitCredList } from './GitCredentials';
import { LlmProviderForm } from './LlmProvider';
import { LdapForm, OidcForm } from './SsoSettings';
import { RequestInfo } from './MyPage';
import { ClaudeLoginBlock } from './TokenSettings';
import {
  IconArrowLeft, IconDot, IconDotOutline, IconRefresh, IconChevronRight, IconChevronDown,
  IconRotateCcw, IconX, IconPlus, IconSliders, IconDownload,
} from '../lib/icons';

// Tab bar model — append here to add a tab (e.g. resource cleanup, approvals, processes, LLM providers).
// `label` is an i18n key resolved at render.
const TABS = [
  { key: 'overview', label: 'admin.tab.overview' },
  { key: 'requests', label: 'admin.tab.requests' },
  { key: 'users', label: 'admin.tab.users' },
  { key: 'signin', label: 'admin.tab.signin' },
  { key: 'providers', label: 'admin.tab.providers' },
  { key: 'processes', label: 'admin.tab.processes' },
  { key: 'config', label: 'admin.tab.config' },
  { key: 'update', label: 'admin.tab.update' },
  { key: 'backup', label: 'admin.tab.backup' },
  { key: 'resources', label: 'admin.tab.resources' },
] as const;
type AdminTab = (typeof TABS)[number]['key'];

export function AdminPanel() {
  const setPanel = useStore((s) => s.setPanel);
  const [ov, setOv] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [nu, setNu] = useState({ username: '', password: '', role: 'member', displayName: '', claudeToken: '' });
  const [commonTok, setCommonTok] = useState('');
  const [tab, setTab] = useState<AdminTab>('overview');
  const llmProvidersEnabled = useStore((s) => s.llmProvidersEnabled);
  const approvalsEnabled = useStore((s) => s.approvalsEnabled);
  const pendingRequestCount = useStore((s) => s.pendingRequestCount);
  const t = useT();
  const tabs = TABS.filter((tb) => tb.key !== 'requests' || approvalsEnabled);

  const load = async () => {
    const [o, s, us] = await Promise.all([
      api.get('/api/admin/overview'), api.get('/api/admin/settings'), api.get('/api/users'),
    ]);
    setOv(o); setSettings(s); setUsers(us.users);
    void useStore.getState().refreshRequests(); // keep the requests tab + badge fresh on open
  };
  useEffect(() => { load().catch((e) => useStore.getState().setError(e.message)); }, []);

  const createUser = async () => {
    if (!nu.username || !nu.password) return;
    try { await api.post('/api/users', nu); setNu({ username: '', password: '', role: 'member', displayName: '', claudeToken: '' }); await load(); }
    catch (e: any) { useStore.getState().setError(e.message); }
  };
  const delUser = async (id: string) => { if (!confirm(t('admin.deleteUserConfirm'))) return; await api.del(`/api/users/${id}`); await load(); };
  const resetPw = async (id: string) => { const p = prompt(t('admin.newPasswordPrompt')); if (!p) return; await api.post(`/api/users/${id}/password`, { password: p }); alert(t('admin.changed')); };
  const toggleBypass = async () => { await api.post('/api/admin/settings', { allowBypass: !settings.allowBypass }); await load(); };
  const saveCommon = async () => {
    if (!commonTok.trim()) return;
    try { await api.put('/api/admin/claude-token', { token: commonTok.trim() }); setCommonTok(''); await load(); }
    catch (e: any) { useStore.getState().setError(e.message); }
  };
  const clearCommon = async () => {
    if (!confirm(t('admin.clearCommonTokenConfirm'))) return;
    try { await api.del('/api/admin/claude-token'); await load(); }
    catch (e: any) { useStore.getState().setError(e.message); }
  };

  return (
    <div className="h-full overflow-y-auto scrolly">
      <div className="flex items-center gap-3 px-4 md:px-5 py-3 border-b border-line sticky top-0 bg-panel z-10">
        <MobileMenuButton />
        <button className="toolbtn" aria-label={t('common.back')} onClick={() => setPanel(null)}><IconArrowLeft /></button>
        <div className="font-semibold inline-flex items-center gap-1.5"><IconSliders size={16} />{t('admin.panelTitle')}</div>
      </div>
      {/* Tab bar — scrolls horizontally inside its own container so it never widens the page on mobile. */}
      <div className="border-b border-line overflow-x-auto scrolly">
        <div className="flex gap-1 px-4 md:px-5">
          {tabs.map((tb) => (
            <button key={tb.key} onClick={() => setTab(tb.key)}
              className={`shrink-0 px-3 py-2.5 text-sm whitespace-nowrap border-b-2 flex items-center gap-1.5 ${tab === tb.key ? 'border-clay text-clay' : 'border-transparent text-txt3 hover:text-txt'}`}>
              {t(tb.label)}
              {tb.key === 'requests' && pendingRequestCount > 0 && (
                <span className="text-[10px] bg-warnsoft text-warn px-1.5 py-0.5 rounded-full">{pendingRequestCount}</span>
              )}
              {tb.key === 'update' && ov?.updateAvailable && (
                <span className="w-1.5 h-1.5 rounded-full bg-clay" aria-label={t('admin.upd.available')} />
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="max-w-[860px] mx-auto p-4 md:p-5 space-y-6">
        {/* A published update is easy to miss as a dot on one tab, so say it once, loudly, on every
            tab but the one that already spells it out. */}
        {ov?.updateAvailable && tab !== 'update' && (
          <button onClick={() => setTab('update')}
            className="w-full text-left border border-clay bg-claysoft rounded-lg px-3 py-2.5 flex items-center gap-2 flex-wrap transition hover:border-txt2">
            <span className="text-clay shrink-0"><IconDownload size={16} /></span>
            <span className="text-sm font-semibold text-clay">
              {ov.updateNewerVersion && ov.updateLatest
                ? t('admin.upd.bannerNew', { v: `v${ov.updateLatest}` })
                : t('admin.upd.bannerImage')}
            </span>
            <span className="text-xs text-txt2">{t('admin.upd.bannerFrom', { v: `v${ov.version}` })}</span>
            <span className="ml-auto text-xs text-clay underline shrink-0">{t('admin.upd.bannerCta')}</span>
          </button>
        )}
        {tab === 'overview' && (
          <>
            {ov && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label={t('admin.statUsers')} v={ov.users} /><Stat label={t('admin.statRooms')} v={ov.rooms} />
                <Stat label={t('admin.statSessions')} v={ov.sessions} /><Stat label={t('admin.statConcurrentTurns')} v={`${ov.throttle.inUse}/${ov.throttle.max}${ov.throttle.waiting ? ` (+${ov.throttle.waiting})` : ''}`} />
              </div>
            )}
            {ov?.version && (
              <div className="text-xs text-txt3 flex items-center gap-2 flex-wrap">
                <span>{t('admin.upd.current')}: <span className="font-mono text-txt2">v{ov.version}</span></span>
                {ov.updateAvailable && (
                  <button className="text-clay hover:underline" onClick={() => setTab('update')}>{t('admin.upd.available')}</button>
                )}
              </div>
            )}
            {ov?.docker && !(ov.docker.ok && ov.docker.configured) && (
              <DockerWarning docker={ov.docker} onProbed={(d: any) => setOv({ ...ov, docker: d })} />
            )}
            {ov?.forceMock && <div className="text-xs text-warn bg-warnsoft border border-warn rounded-lg px-3 py-2">{t('admin.mockForcedWarning')}</div>}
            {/* a shared sign-in is a shared fallback too — only warn when there is neither */}
            {!ov?.forceMock && ov?.commonToken && !ov.commonToken.hasToken && !ov?.commonLogin?.loggedIn && <div className="text-xs text-warn bg-warnsoft border border-warn rounded-lg px-3 py-2">{t('admin.commonTokenUnsetWarning')}</div>}
          </>
        )}

        {tab === 'requests' && <RequestsTab users={users} />}

        {/* External sign-in: AD/LDAP and OIDC SSO. Kept apart from the 자격증명 tab on purpose —
            that one is about which Claude account a turn runs on, this one about who may log in. */}
        {tab === 'signin' && (
          <>
            <Section title={t('sso.ldapTitle')}>
              <LdapForm />
            </Section>
            <Section title={t('sso.oidcTitle')}>
              <OidcForm />
            </Section>
          </>
        )}

        {tab === 'providers' && (
          <>
            <Section title={t('admin.commonTokenTitle')}>
              {/* sign-in first: it is the only shared credential that can report plan limits */}
              <ClaudeLoginBlock scope="common" />
              <div className="text-sm font-semibold mb-1">{t('token.pasteTitle')}</div>
              <div className="text-sm mb-2 flex items-center gap-2">
                {/* an env-provided key is not ours to delete — show why instead of a dead button */}
                {ov?.commonToken?.hasToken
                  ? <><IconDot className="text-ok" /><span>{t('admin.registered')}{ov.commonToken.setAt ? ` · ${new Date(ov.commonToken.setAt).toLocaleDateString()}` : ''}</span>
                      {ov.commonToken.fromEnv
                        ? <span className="text-[11px] text-txt3">{t('admin.commonTokenFromEnv', { key: 'ANTHROPIC_API_KEY' })}</span>
                        : <button className="ml-auto text-xs text-txt3 hover:text-danger" onClick={clearCommon}>{t('common.delete')}</button>}</>
                  : <><IconDot className="text-warn" /><span className="text-txt2">{t('admin.notSet')}</span></>}
              </div>
              <div className="flex gap-2">
                <input className="input flex-1" type="password" placeholder={t('admin.commonTokenPlaceholder')} value={commonTok}
                  onChange={(e) => setCommonTok(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveCommon()} />
                <button className="btn-primary" onClick={saveCommon}>{t('admin.save')}</button>
              </div>
              <div className="text-[11px] text-txt3 mt-1.5">{t('admin.commonTokenHint', { key: 'ANTHROPIC_API_KEY' })}</div>
            </Section>

            {llmProvidersEnabled && (
              <Section title={t('admin.commonProviderTitle')}>
                <div className="text-[11px] text-txt3 mb-2">{t('admin.commonProviderHint')}</div>
                <LlmProviderForm scope="common" />
              </Section>
            )}

            <Section title={t('admin.gitCredsTitle')}>
              <div className="text-[11px] text-txt3 mb-2">{t('admin.gitCredsHint')}</div>
              <GitCredList scope="common" />
            </Section>
          </>
        )}

        {tab === 'config' && (
          <>
            <BrandManager />

            <Section title={t('admin.globalSettingsTitle')}>
              {settings && (
                <div className="space-y-2 text-sm">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={settings.allowBypass} onChange={toggleBypass} />
                    {t('admin.allowBypassLabel')}
                  </label>
                </div>
              )}
            </Section>

            <ConfigManager />
          </>
        )}

        {tab === 'update' && <UpdateManager />}

        {tab === 'backup' && <BackupManager />}

        {tab === 'processes' && <ProcessesManager />}

        {tab === 'resources' && <CleanupManager />}

        {tab === 'users' && (
          <Section title={t('admin.userManagementTitle')}>
            <div className="space-y-1.5 mb-3">
              {users.map((u) => (
                <div key={u.id} className="flex items-center gap-2 text-sm border-b border-line py-1.5">
                  <span className="w-6 h-6 rounded-full grid place-items-center text-[10px] text-white font-semibold" style={{ background: u.avatarColor }}>{u.displayName.slice(0, 2).toUpperCase()}</span>
                  <span className="font-medium">{u.displayName}</span><span className="text-txt3 text-xs">@{u.username}</span>
                  <span className="text-[10px] bg-claysoft text-clay px-1.5 py-0.5 rounded-full">{u.role}</span>
                  <div className="ml-auto flex gap-2">
                    <button className="text-xs text-txt3 hover:text-clay" onClick={() => resetPw(u.id)}>{t('admin.resetPassword')}</button>
                    <button className="text-xs text-txt3 hover:text-danger" onClick={() => delUser(u.id)}>{t('common.delete')}</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input className="input" placeholder={t('admin.usernamePlaceholder')} value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} />
              <input className="input" placeholder={t('admin.displayNamePlaceholder')} value={nu.displayName} onChange={(e) => setNu({ ...nu, displayName: e.target.value })} />
              <input className="input" type="password" placeholder={t('admin.passwordPlaceholder')} value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} />
              <select className="input" value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}>
                <option value="member">member</option><option value="admin">admin</option>
              </select>
              <input className="input col-span-2" type="password" placeholder={t('admin.claudeTokenPlaceholder')}
                value={nu.claudeToken} onChange={(e) => setNu({ ...nu, claudeToken: e.target.value })} />
            </div>
            <button className="btn-primary mt-2" onClick={createUser}>{t('admin.createUser')}</button>
          </Section>
        )}
      </div>
    </div>
  );
}

// Member request approvals: pending requests (approve/reject) + decided history. Approving runs the
// action server-side and surfaces its result; rejecting asks for a note. Refreshes live via the
// requests:changed socket event.
function RequestsTab({ users }: { users: any[] }) {
  const requests = useStore((s) => s.requests);
  const decideRequest = useStore((s) => s.decideRequest);
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const nameFor = (id: string) => users.find((u) => u.id === id)?.displayName || id;
  const pending = requests.filter((r) => r.status === 'pending');
  const decided = requests.filter((r) => r.status !== 'pending');

  const decide = async (id: string, approve: boolean, note?: string) => {
    setBusy(id);
    try { await decideRequest(id, approve, note); }
    catch (e: any) { useStore.getState().setError(e.message); }
    finally { setBusy(null); }
  };
  const reject = (id: string) => { const note = prompt(t('requests.rejectPrompt')); if (note === null) return; void decide(id, false, note || undefined); };

  return (
    <>
      <Section title={t('requests.pendingTitle')}>
        {pending.length === 0 && <div className="text-xs text-txt3">{t('requests.noPending')}</div>}
        <div className="space-y-2">
          {pending.map((r) => (
            <div key={r.id} className="flex items-start gap-2 border-b border-line pb-2 last:border-0 flex-wrap">
              <RequestInfo r={r} requesterName={nameFor(r.requesterId)} />
              <div className="flex gap-2 shrink-0">
                <button className="btn-primary text-xs px-2 py-1" disabled={busy === r.id} onClick={() => decide(r.id, true)}>{t('requests.approve')}</button>
                <button className="btn-ghost text-xs px-2 py-1" disabled={busy === r.id} onClick={() => reject(r.id)}>{t('requests.reject')}</button>
              </div>
            </div>
          ))}
        </div>
      </Section>
      <Section title={t('requests.historyTitle')}>
        {decided.length === 0 && <div className="text-xs text-txt3">{t('common.none')}</div>}
        <div className="space-y-1.5">
          {decided.map((r) => (
            <div key={r.id} className="flex items-start gap-2 border-b border-line py-1.5 last:border-0">
              <RequestInfo r={r} requesterName={nameFor(r.requesterId)} />
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

// Branding: the title + logo every screen wears (sidebar, login card, landing screen, browser tab).
// An empty title falls back to the product's own name; no logo falls back to the bundled mark. Both
// apply live for everyone — the title is the brandTitle config key, the logo an uploaded file.
function BrandManager() {
  const t = useT();
  const brand = useStore((s) => s.brand);
  const saveBrandTitle = useStore((s) => s.saveBrandTitle);
  const uploadBrandLogo = useStore((s) => s.uploadBrandLogo);
  const clearBrandLogo = useStore((s) => s.clearBrandLogo);
  const [title, setTitle] = useState(brand.title);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setTitle(brand.title); }, [brand.title]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); }
    catch (e: any) { useStore.getState().setError(e.message); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const dirty = title.trim() !== brand.title;
  const saveTitle = () => run(() => saveBrandTitle(title.trim()));

  return (
    <Section title={t('admin.brand.title')}>
      <p className="text-[11px] text-txt3 mb-3 leading-snug">{t('admin.brand.hint')}</p>
      <div className="flex items-center gap-4 flex-wrap">
        <img src={brandLogoUrl(brand)} alt="" className="w-14 h-14 rounded-lg object-contain bg-panel border border-line p-1 shrink-0" />
        <div className="flex gap-2 flex-wrap">
          <button className="btn-ghost !py-1 !text-xs" disabled={busy} onClick={() => fileRef.current?.click()}>{t('admin.brand.uploadLogo')}</button>
          {brand.logo && <button className="btn-ghost !py-1 !text-xs" disabled={busy} onClick={() => run(clearBrandLogo)}>{t('admin.brand.removeLogo')}</button>}
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void run(() => uploadBrandLogo(f)); }} />
      </div>
      <label className="text-xs text-txt2 block mt-4">{t('admin.brand.titleLabel')}</label>
      <div className="flex gap-2 mt-1">
        <input className="input flex-1 min-w-0" value={title} placeholder={BRAND_NAME} disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && dirty) void saveTitle(); }} />
        <button className="btn-primary shrink-0" disabled={busy || !dirty} onClick={() => void saveTitle()}>{t('admin.save')}</button>
      </div>
      <div className="text-[11px] text-txt3 mt-1.5">{t('admin.brand.titleHint', { name: BRAND_NAME })}</div>
    </Section>
  );
}

// Full config registry: every admin-manageable setting (env + hardcoded constants), grouped.
// Driven entirely by the /api/admin/config metadata so new registry entries appear here for free.
// Human names + descriptions come from i18n (cfg.<key> / cfgDesc.<key>) with graceful fallback.
function cfgLabel(t: (k: string) => string, key: string) { const s = t(`cfg.${key}`); return s === `cfg.${key}` ? key : s; }
function cfgDesc(t: (k: string) => string, key: string) { const s = t(`cfgDesc.${key}`); return s === `cfgDesc.${key}` ? '' : s; }

function ConfigManager() {
  const t = useT();
  const [items, setItems] = useState<any[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const load = async () => { const r = await api.get('/api/admin/config'); setItems(r.items); setEdits({}); };
  useEffect(() => { load().catch((e) => useStore.getState().setError(e.message)); }, []);
  const apply = async (fn: () => Promise<any>) => {
    try { const r = await fn(); if (r?.items) setItems(r.items); }
    catch (e: any) { useStore.getState().setError(e.message); }
  };
  const save = (key: string, value: any) => apply(async () => {
    const r = await api.put('/api/admin/config', { key, value });
    setEdits((e) => { const n = { ...e }; delete n[key]; return n; });
    return r;
  });
  const reset = (key: string) => apply(() => api.del(`/api/admin/config/${encodeURIComponent(key)}`));
  // manual "fetch now" for the model list; the response carries the whole registry, so the row re-renders
  const fetchModels = () => apply(() => api.post('/api/admin/models/refresh', {}));
  const restart = async () => {
    if (!confirm(t('admin.cfgRestartConfirm'))) return;
    try { await api.post('/api/admin/restart', {}); } catch { /* the process exits mid-request */ }
    useStore.getState().setError(t('admin.cfgRestarting'));
    setTimeout(() => location.reload(), 4000);
  };
  const groups: string[] = [...new Set(items.map((i) => i.group))];
  const restartNeeded = items.some((i) => i.restart && i.overridden);
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-semibold">{t('admin.cfgTitle')}</div>
        <button className="ml-auto text-xs border border-line rounded-lg px-2.5 py-1 hover:border-clay inline-flex items-center gap-1.5" onClick={restart}><IconRefresh size={13} />{t('admin.cfgRestartBtn')}</button>
      </div>
      {restartNeeded && (
        <div className="text-xs text-warn bg-warnsoft border border-warn rounded-lg px-3 py-2">{t('admin.cfgRestartNeeded')}</div>
      )}
      {groups.map((g) => {
        const rows = items.filter((i) => i.group === g);
        return (
          <details key={g} className="group bg-card border border-line rounded-xl overflow-hidden">
            <summary className="font-semibold px-4 py-3 cursor-pointer select-none list-none flex items-center gap-2 [&::-webkit-details-marker]:hidden">
              <span className="text-txt3 transition-transform group-open:rotate-90 inline-flex"><IconChevronRight size={14} /></span>
              <span>{t(`admin.cfgGroup.${g}`)}</span>
              <span className="ml-auto text-[11px] text-txt3 font-normal">{rows.length}</span>
            </summary>
            <div className="px-4 pb-4">
              {(g === 'infra' || g === 'secret') && (
                <div className="text-[11px] text-txt3 mb-2">{t(g === 'secret' ? 'admin.cfgSecretHint' : 'admin.cfgReadonlyHint')}</div>
              )}
              {g === 'privacy' && <div className="text-[11px] text-txt3 mb-2">{t('admin.cfgPrivacyHint')}</div>}
              <div className="divide-y divide-line">
                {rows.map((it) => (
                  <ConfigRow key={it.key} it={it} edit={edits[it.key]}
                    locked={!!it.disabledWhen && items.find((m) => m.key === it.disabledWhen)?.value === '1'}
                    lockedBy={it.disabledWhen}
                    onEdit={(v) => setEdits((e) => ({ ...e, [it.key]: v }))} onSave={save} onReset={reset}
                    onFetchModels={fetchModels} />
                ))}
              </div>
            </div>
          </details>
        );
      })}
    </>
  );
}

function ConfigRow({ it, edit, locked, lockedBy, onEdit, onSave, onReset, onFetchModels }: {
  it: any; edit: string | undefined; locked?: boolean; lockedBy?: string; onEdit: (v: string) => void;
  onSave: (k: string, v: any) => void; onReset: (k: string) => void; onFetchModels?: () => Promise<void>;
}) {
  const t = useT();
  const name = cfgLabel(t, it.key);
  const desc = cfgDesc(t, it.key);
  const cur = it.value ?? '';
  const dirty = edit !== undefined && edit !== String(cur);
  const editable = !it.readonly && !it.secret;
  return (
    <div className={`py-2.5${locked ? ' opacity-50' : ''}`}>
      <div className="flex items-start gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium text-[13px]">{name}</span>
            <span className="font-mono text-[10px] text-txt3">{it.key}</span>
            {it.restart && <span className="text-[9px] uppercase bg-warnsoft text-warn px-1.5 py-0.5 rounded-full whitespace-nowrap">{t('admin.cfgRestart')}</span>}
            {it.overridden && <button className="text-txt3 hover:text-clay" title={t('admin.cfgReset')} aria-label={t('admin.cfgReset')} onClick={() => onReset(it.key)}><IconRotateCcw size={14} /></button>}
          </div>
          {desc && <p className="text-[11px] text-txt3 mt-0.5 leading-snug">{desc}</p>}
          {locked && <p className="text-[11px] text-txt3 mt-0.5 leading-snug italic">{t('admin.cfgLockedBy', { name: cfgLabel(t, lockedBy || '') })}</p>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {it.secret ? (
            <span className={`text-xs ${it.set ? 'text-ok' : 'text-txt3'}`}>{it.set ? t('admin.cfgSet') : t('admin.cfgDefault')}</span>
          ) : it.readonly ? (
            <span className="font-mono text-[11px] text-txt3 break-all text-right max-w-[240px]">{String(it.value) || '—'}</span>
          ) : it.image ? (
            <ImageControl it={it} edit={edit} onEdit={onEdit} onSave={onSave} />
          ) : it.type === 'json' ? (
            <>
              {it.key === 'models' && onFetchModels && <ModelFetchButton onFetch={onFetchModels} />}
              <span className="text-[11px] text-txt3 inline-flex items-center gap-1">{t('admin.cfgJsonBelow')}<IconChevronDown size={12} /></span>
            </>
          ) : it.type === 'bool' ? (
            // while locked, show the effective state (the overriding key forces it on), not the stored one
            <input type="checkbox" checked={locked || it.value === '1'} disabled={locked}
              onChange={(e) => onSave(it.key, e.target.checked)} />
          ) : it.type === 'select' ? (
            <select className="input" value={cur} onChange={(e) => onSave(it.key, e.target.value)}>
              {(it.options || []).map((o: string) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <>
              <input className="input w-40" type={it.type === 'int' ? 'number' : 'text'}
                value={edit ?? String(cur)} min={it.min} max={it.max}
                onChange={(e) => onEdit(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && dirty) onSave(it.key, edit); }} />
              {it.unit && <span className="text-[11px] text-txt3">{it.unit}</span>}
              {dirty && <button className="btn-primary text-xs px-2 py-1" onClick={() => onSave(it.key, edit)}>{t('admin.save')}</button>}
            </>
          )}
        </div>
      </div>
      {editable && it.type === 'json' && <JsonEditor it={it} onSave={onSave} />}
    </div>
  );
}

// "Fetch now" for the model list: the server pulls /v1/models from the configured provider and
// overwrites the map, so the JSON editor below re-renders with the fresh ids.
function ModelFetchButton({ onFetch }: { onFetch: () => Promise<void> }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { await onFetch(); } finally { setBusy(false); } };
  return (
    <button className="text-xs border border-line rounded-lg px-2 py-1 hover:border-clay inline-flex items-center gap-1 disabled:opacity-50"
      disabled={busy} onClick={run}><IconRefresh size={12} />{busy ? '…' : t('admin.cfgModelsFetch')}</button>
  );
}

// Structured editor for object/array JSON settings (e.g. the model map). Object → key/value rows;
// array → value rows; anything else → raw textarea. Local edits commit on Save.
function JsonEditor({ it, onSave }: { it: any; onSave: (k: string, v: any) => void }) {
  const t = useT();
  const parsed = useMemo(() => { try { return JSON.parse(it.value ?? it.default); } catch { return null; } }, [it.value, it.default]);
  const isArray = Array.isArray(parsed);
  const isObj = !!parsed && !isArray && typeof parsed === 'object';
  const [rows, setRows] = useState<Array<[string, string]>>([]);
  const [raw, setRaw] = useState('');
  useEffect(() => {
    if (isArray) setRows((parsed as any[]).map((v) => ['', String(v)]));
    else if (isObj) setRows(Object.entries(parsed as any).map(([k, v]) => [k, String(v)] as [string, string]));
    else setRaw(it.value ?? it.default ?? '');
  }, [it.value, it.default]);
  if (!isArray && !isObj) {
    return (
      <div className="mt-2 flex flex-col gap-1.5">
        <textarea className="input font-mono text-xs h-24" value={raw} onChange={(e) => setRaw(e.target.value)} />
        <button className="btn-primary text-xs px-2 py-1 self-end" onClick={() => onSave(it.key, raw)}>{t('admin.save')}</button>
      </div>
    );
  }
  const commit = () => {
    const value = isArray
      ? rows.map(([, v]) => v).filter((x) => x !== '')
      : Object.fromEntries(rows.filter(([k]) => k !== '').map(([k, v]) => [k, v]));
    onSave(it.key, JSON.stringify(value));
  };
  return (
    <div className="mt-2 rounded-lg border border-line bg-card p-2 space-y-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          {isObj && <input className="input w-40" placeholder={t('admin.cfgKey')} value={r[0]}
            onChange={(e) => { const n = rows.slice(); n[i] = [e.target.value, r[1]]; setRows(n); }} />}
          <input className="input flex-1" placeholder={t('admin.cfgValue')} value={r[1]}
            onChange={(e) => { const n = rows.slice(); n[i] = [r[0], e.target.value]; setRows(n); }} />
          <button className="text-txt3 hover:text-danger px-1" aria-label={t('common.delete')} onClick={() => setRows(rows.filter((_, j) => j !== i))}><IconX size={14} /></button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <button className="text-xs text-clay hover:underline inline-flex items-center gap-1" onClick={() => setRows([...rows, ['', '']])}><IconPlus size={13} />{t('admin.cfgAddRow')}</button>
        <button className="btn-primary text-xs px-2 py-1 ml-auto" onClick={commit}>{t('admin.save')}</button>
      </div>
    </div>
  );
}

// Docker image row: editable image ref + presence check + pull/update. Pull acts on the SAVED value
// (the server allowlists it), so it's disabled while there's an unsaved edit.
function ImageControl({ it, edit, onEdit, onSave }: {
  it: any; edit: string | undefined; onEdit: (v: string) => void; onSave: (k: string, v: any) => void;
}) {
  const t = useT();
  const cur = it.value ?? '';
  const dirty = edit !== undefined && edit !== String(cur);
  const [status, setStatus] = useState<any>(null);
  const [busy, setBusy] = useState<'check' | 'pull' | null>(null);
  useEffect(() => {
    let live = true;
    setBusy('check');
    api.post('/api/admin/image/inspect', { image: cur })
      .then((s) => { if (live) setStatus(s); })
      .catch(() => { if (live) setStatus({ dockerUnavailable: true }); })
      .finally(() => { if (live) setBusy(null); });
    return () => { live = false; };
  }, [cur]);
  const pull = async () => {
    setBusy('pull');
    try { setStatus(await api.post('/api/admin/image/pull', { image: cur })); }
    catch (e: any) { useStore.getState().setError(e.message); }
    finally { setBusy(null); }
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <input className="input w-44 md:w-48" value={edit ?? String(cur)}
          onChange={(e) => onEdit(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && dirty) onSave(it.key, edit); }} />
        {dirty && <button className="btn-primary text-xs px-2 py-1" onClick={() => onSave(it.key, edit)}>{t('admin.save')}</button>}
      </div>
      <div className="flex items-center gap-2 text-[11px]">
        {busy === 'check' ? <span className="text-txt3">{t('admin.cfgImageChecking')}</span>
          : status?.dockerUnavailable ? <span className="text-txt3">docker N/A</span>
          : status?.present ? <span className="text-ok inline-flex items-center gap-1"><IconDot size={10} />{t('admin.cfgImagePresent')}{status.size ? ` · ${Math.round(status.size / 1e6)}MB` : ''}</span>
          : <span className="text-warn inline-flex items-center gap-1"><IconDotOutline size={10} />{t('admin.cfgImageAbsent')}</span>}
        <button className="text-clay hover:underline disabled:opacity-40" disabled={busy !== null || dirty}
          onClick={pull}>{busy === 'pull' ? t('admin.cfgImagePulling') : t('admin.cfgImagePull')}</button>
      </div>
    </div>
  );
}

// Docker is down or unwired: name the three features that stop working, the actual reason, and the
// fix — then let the admin re-probe without waiting for the interval or restarting.
function DockerWarning({ docker, onProbed }: { docker: any; onProbed: (d: any) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  // the server already resolved precedence: a ping failure beats "env unset" (compose fixes both, but
  // a missing socket is the deeper problem, so it must be the one named)
  const reason: string = docker.reason;
  const probe = async () => {
    setBusy(true);
    try { const r = await api.post('/api/admin/docker/probe', {}); onProbed(r.docker); }
    catch (e: any) { useStore.getState().setError(e.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="text-xs text-warn bg-warnsoft border border-warn rounded-lg px-3 py-2 space-y-1.5">
      <div className="font-semibold">{t('admin.docker.title', { reason: t(`docker.reason.${reason}`) })}</div>
      <div className="leading-snug">{t('admin.docker.affected')}</div>
      <div className="leading-snug text-txt2">{t(`admin.docker.fix.${reason}`)}</div>
      {docker.error && <div className="font-mono text-[10px] text-txt3 break-all">{docker.error}</div>}
      <button className="text-xs border border-warn rounded-lg px-2 py-0.5 hover:opacity-80 disabled:opacity-40 inline-flex items-center gap-1.5"
        disabled={busy} onClick={probe}><IconRefresh size={12} />{busy ? t('admin.upd.checking') : t('admin.docker.recheck')}</button>
    </div>
  );
}

// Self-update: version check against the published image + the container swap. Applying kills this
// very server, so the button hands off to a poll loop that waits for the NEW version to answer (or
// for the automatic rollback to land) instead of assuming success.
// Whole-workspace backup (download tgz) & restore (upload → staged summary → typed-keyword apply).
// The apply kills the server on purpose; we poll /api/health until it answers again, then reload —
// the same server-dies-mid-request pattern UpdateManager uses.
function BackupManager() {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const err = (e: any) => useStore.getState().setError(e.message || String(e));

  useEffect(() => { api.get('/api/admin/restore').then((r) => setSummary(r.summary)).catch(() => {}); }, []);

  const download = async () => {
    setDownloading(true);
    try {
      // ponytail: the whole archive buffers in browser RAM; switch to a plain <a href> download if
      // workspaces outgrow that (streams to disk, but bypasses the demo mock)
      const res = await fetch('/api/admin/backup', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error || `HTTP ${res.status}`);
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'ccw-backup.tgz';
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { err(e); } finally { setDownloading(false); }
  };

  const upload = async () => {
    const f = fileRef.current?.files?.[0]; if (!f) return;
    setUploading(true);
    try {
      const form = new FormData(); form.append('file', f, f.name);
      const r = await api.upload('/api/admin/restore/upload', form);
      setSummary(r.summary);
    } catch (e) { err(e); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const discard = async () => { try { await api.del('/api/admin/restore'); } catch (e) { err(e); } setSummary(null); };

  const apply = async () => {
    if (!confirm(t('admin.backup.applyConfirm'))) return;
    if (prompt(t('admin.backup.applyKeyword')) !== 'RESTORE') return;
    setApplying(true);
    try {
      await api.post('/api/admin/restore/apply', {});
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2500));
        try { const h = await fetch('/api/health', { credentials: 'same-origin' }); if (h.ok) { location.reload(); return; } }
        catch { /* server still restarting */ }
      }
      setApplying(false);
    } catch (e) { err(e); setApplying(false); }
  };

  const fmtSize = (b: number) => (b > 1024 * 1024 * 1024 ? `${(b / 1024 / 1024 / 1024).toFixed(2)} GB` : `${Math.max(1, Math.round(b / 1024 / 1024))} MB`);

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-txt3 leading-snug">{t('admin.backup.intro')}</p>
      <Section title={t('admin.backup.downloadTitle')}>
        <div className="text-xs text-warn bg-warnsoft border border-warn rounded-lg px-3 py-2 mb-3">{t('admin.backup.secretsWarning')}</div>
        <button className="btn-primary !text-xs inline-flex items-center gap-1.5" disabled={downloading} onClick={() => void download()}>
          <IconDownload size={13} />{downloading ? t('admin.backup.downloading') : t('admin.backup.download')}
        </button>
      </Section>
      <Section title={t('admin.backup.restoreTitle')}>
        {applying ? (
          <div className="text-xs bg-claysoft text-clay border border-clay rounded-lg px-3 py-2">
            <div className="font-semibold">{t('admin.backup.applying')}</div>
            <div className="mt-0.5 leading-snug">{t('admin.backup.applyingNote')}</div>
          </div>
        ) : summary ? (
          <div className="space-y-2 text-sm">
            <div className="text-xs text-txt2">
              {t('admin.backup.summaryLine', {
                version: summary.version || '?',
                date: summary.createdAt ? new Date(summary.createdAt).toLocaleString() : '?',
                users: String(summary.users), size: fmtSize(summary.sizeBytes || 0),
              })}
            </div>
            {summary.keyMatch === false && <div className="text-xs text-danger bg-card border border-danger rounded-lg px-3 py-2">{t('admin.backup.keyMismatch')}</div>}
            {summary.dataDirMatch === false && <div className="text-xs text-warn bg-warnsoft border border-warn rounded-lg px-3 py-2">{t('admin.backup.dataDirMismatch')}</div>}
            <div className="flex gap-2 flex-wrap">
              <button className="rounded-md px-3.5 py-1.5 text-xs font-semibold text-white" style={{ background: 'var(--danger)' }} onClick={() => void apply()}>{t('admin.backup.apply')}</button>
              <button className="btn-ghost !py-1.5 !text-xs" onClick={() => void discard()}>{t('admin.backup.discard')}</button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-txt3">{t('admin.backup.restoreHint')}</div>
            <div className="flex items-center gap-2 flex-wrap">
              <input ref={fileRef} type="file" accept=".tgz,.tar.gz,application/gzip" className="text-xs" />
              <button className="btn-ghost !py-1.5 !text-xs" disabled={uploading} onClick={() => void upload()}>
                {uploading ? t('admin.backup.uploading') : t('admin.backup.upload')}
              </button>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

function UpdateManager() {
  const t = useT();
  const [st, setSt] = useState<any>(null);
  const [busy, setBusy] = useState<'check' | 'apply' | null>(null);
  const [swap, setSwap] = useState<{ from: string; timedOut?: boolean } | null>(null);

  const load = async (force?: boolean) => {
    setBusy('check');
    try { setSt(force ? await api.post('/api/admin/update/check', {}) : await api.get('/api/admin/update')); }
    catch (e: any) { useStore.getState().setError(e.message); }
    finally { setBusy(null); }
  };
  useEffect(() => { void load(); }, []);

  // The endpoint simply fails while the container is being swapped — that's expected, keep waiting.
  // Done = a different version answers, OR this attempt's own record reached 'done' (an image rebuild
  // of the SAME version is a real update too, and then the version never changes).
  const watchSwap = async (from: string, beforeAttempt: number | undefined) => {
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const s = await api.get('/api/admin/update');
        if (s.current && s.current !== from) { location.reload(); return; }
        if (s.last?.phase === 'done' && s.last.startedAt !== beforeAttempt) { location.reload(); return; }
        const ph = s.last?.phase;
        if (ph === 'rolled-back' || ph === 'failed' || ph === 'unknown') {
          setSwap(null); setBusy(null); setSt(s);
          useStore.getState().setError(t(ph === 'rolled-back' ? 'admin.upd.rolledBack' : 'admin.upd.failed'));
          return;
        }
      } catch { /* server down mid-swap */ }
    }
    setSwap((s) => (s ? { ...s, timedOut: true } : s));
  };

  const apply = async () => {
    if (!confirm(t('admin.upd.applyConfirm', { target: st.latest ? `v${st.latest}` : st.tag }))) return;
    setBusy('apply');
    try {
      const r = await api.post('/api/admin/update/apply', {});
      if (!r.changed) { setBusy(null); alert(r.note ? `${t('admin.upd.noChange')}\n${r.note}` : t('admin.upd.noChange')); await load(); return; }
      setSwap({ from: st.current });
      void watchSwap(st.current, st.last?.startedAt);
    } catch (e: any) { setBusy(null); useStore.getState().setError(e.message); }
  };

  if (!st) return <div className="text-sm text-txt3">{t('admin.cleanup.rescanning')}</div>;
  const last = st.last;
  const phaseLabel: Record<string, string> = {
    done: t('admin.upd.done'), 'rolled-back': t('admin.upd.rolledBack'),
    failed: t('admin.upd.failed'), applying: t('admin.upd.applying'), unknown: t('admin.upd.unknown'),
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-semibold">{t('admin.upd.title')}</div>
        <button className="ml-auto text-xs border border-line rounded-lg px-2.5 py-1 hover:border-clay disabled:opacity-40 inline-flex items-center gap-1.5"
          disabled={busy !== null || !!swap || !st.enabled} onClick={() => void load(true)}>
          <IconRefresh size={13} />{busy === 'check' ? t('admin.upd.checking') : t('admin.upd.check')}
        </button>
      </div>
      <p className="text-[11px] text-txt3 leading-snug">{t('admin.upd.intro')}</p>

      {!st.enabled && <div className="text-xs text-warn bg-warnsoft border border-warn rounded-lg px-3 py-2">{t('admin.upd.disabledNote')}</div>}

      {swap && (
        <div className="text-xs bg-claysoft text-clay border border-clay rounded-lg px-3 py-2">
          <div className="font-semibold">{swap.timedOut ? t('admin.upd.timeout') : t('admin.upd.applying')}</div>
          <div className="mt-0.5 leading-snug">{swap.timedOut ? t('admin.upd.timeoutNote') : t('admin.upd.applyingNote')}</div>
        </div>
      )}

      <Section title={t('admin.upd.versionTitle')}>
        <div className="space-y-1.5 text-sm">
          <KV k={t('admin.upd.current')} v={`v${st.current}`} />
          <KV k={t('admin.upd.latest')} v={st.latest ? `v${st.latest}` : '—'} />
          <KV k={t('admin.upd.image')} v={st.image || '—'} mono />
          <KV k={t('admin.upd.container')} v={st.container ? `${st.container.name} · ${st.container.id}` : '—'} mono />
          <KV k={t('admin.upd.checkedAt')} v={st.checkedAt ? timeAgo(st.checkedAt) : '—'} />
        </div>
        <div className="mt-3 text-xs">
          {st.updateAvailable
            ? <span className="text-clay inline-flex items-center gap-1"><IconDot size={10} />{st.newerVersion ? t('admin.upd.available') : t('admin.upd.imageChanged')}</span>
            : <span className="text-ok inline-flex items-center gap-1"><IconDot size={10} />{t('admin.upd.upToDate')}</span>}
        </div>
        {!st.registrySupported && <div className="mt-1.5 text-[11px] text-txt3">{t('admin.upd.registryNa')}</div>}
        {st.checkError && <div className="mt-1.5 text-[11px] text-warn">{t('admin.upd.checkError', { err: st.checkError })}</div>}
        {st.dockerUnavailable && <div className="mt-1.5 text-[11px] text-txt3">{t('admin.upd.dockerNa')}</div>}
        <button className="btn-primary mt-3 disabled:opacity-40" disabled={busy !== null || !!swap || !st.enabled || st.dockerUnavailable}
          onClick={apply}>{busy === 'apply' ? t('admin.upd.pulling') : t('admin.upd.apply')}</button>
      </Section>

      {last && (
        <Section title={t('admin.upd.lastResult')}>
          <div className="space-y-1.5 text-sm">
            <KV k={t('admin.upd.phase')} v={phaseLabel[last.phase] || last.phase} />
            <KV k={t('admin.upd.target')} v={last.toImage || '—'} mono />
            <KV k={t('admin.upd.startedAt')} v={timeAgo(last.startedAt)} />
            {last.version && <KV k={t('admin.upd.resultVersion')} v={`v${last.fromVersion} → v${last.version}`} />}
          </div>
          {last.log && (
            <div className="mt-2">
              <div className="text-[11px] text-txt3 mb-1">{t('admin.upd.log')}</div>
              <pre className="text-[11px] font-mono bg-card border border-line rounded-lg p-2 overflow-x-auto scrolly whitespace-pre-wrap break-all">{last.log}</pre>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-txt2 shrink-0">{k}</span>
      <span className={`ml-auto text-right break-all${mono ? ' font-mono text-[11px] text-txt3' : ''}`}>{v}</span>
    </div>
  );
}

// Activity / processes: a live task-manager over running/queued turns, editor + sandbox containers,
// and running review pipelines, with a control per row. Auto-polls every processPollMs WHILE this tab
// is mounted — the tab is conditionally rendered, so a tab-switch unmounts this and clears the interval.
function ProcessesManager() {
  const t = useT();
  const pollMs = useStore((s) => s.processPollMs);
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = async () => { try { setData(await api.get('/api/admin/processes')); } catch (e: any) { useStore.getState().setError(e.message); } };
  useEffect(() => {
    load();
    const id = setInterval(load, Math.max(1000, pollMs));
    return () => clearInterval(id);
  }, [pollMs]);

  const act = async (key: string, confirmKey: string, body: any) => {
    if (!confirm(t(confirmKey))) return;
    setBusy(key);
    try { setData(await api.post('/api/admin/processes', body)); }
    catch (e: any) { useStore.getState().setError(e.message); }
    finally { setBusy(null); }
  };

  if (!data) return <div className="text-sm text-txt3">{t('admin.cleanup.rescanning')}</div>;
  const na = data.dockerUnavailable;
  const disabled = busy !== null;
  const turns = data.turns || [], queued = data.queued || [], editors = data.editors || [], sandboxes = data.sandboxes || [], pipelines = data.reviewPipelines || [];
  const short = (s: string) => (s || '').slice(0, 8);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-semibold">{t('admin.proc.title')}</div>
        <button className="ml-auto text-xs border border-line rounded-lg px-2.5 py-1 hover:border-clay disabled:opacity-40 inline-flex items-center gap-1.5"
          disabled={disabled} onClick={() => load()}><IconRefresh size={13} />{t('admin.proc.refresh')}</button>
      </div>
      <p className="text-[11px] text-txt3 leading-snug">{t('admin.proc.intro')}</p>

      {/* active turns */}
      <Section title={`${t('admin.proc.turns')} · ${turns.length}`}>
        <div className="overflow-x-auto scrolly">
          <table className="w-full text-sm min-w-[420px]">
            <tbody>
              {turns.map((r: any) => (
                <tr key={r.sessionId} className="border-t border-line first:border-0">
                  <td className="py-1.5 pr-2 break-all">{r.title}</td>
                  <td className="pr-2 text-txt3 whitespace-nowrap">{r.author?.name}</td>
                  <td className="pr-2 text-txt3 whitespace-nowrap">{timeAgo(r.startedAt)}</td>
                  <td className="text-right"><button className="btn-danger text-xs" disabled={disabled}
                    onClick={() => act(`turn:${r.sessionId}`, 'admin.proc.confirmStopTurn', { kind: 'turn', action: 'stop', sessionId: r.sessionId })}>{t('admin.proc.stop')}</button></td>
                </tr>
              ))}
              {turns.length === 0 && <tr><td className="py-1.5 text-txt3">{t('common.none')}</td></tr>}
            </tbody>
          </table>
        </div>
      </Section>

      {/* queue (waiting items) */}
      <Section title={`${t('admin.proc.queue')} · ${queued.length}`}>
        <div className="overflow-x-auto scrolly">
          <table className="w-full text-sm min-w-[420px]">
            <tbody>
              {queued.map((r: any) => (
                <tr key={r.itemId} className="border-t border-line first:border-0">
                  <td className="py-1.5 pr-2 font-mono text-[11px] break-all">{short(r.sessionId)}</td>
                  <td className="pr-2 text-txt3 whitespace-nowrap">{r.author?.name}</td>
                  <td className="text-right"><button className="btn-danger text-xs" disabled={disabled}
                    onClick={() => act(`q:${r.itemId}`, 'admin.proc.confirmCancel', { kind: 'queued', action: 'cancel', sessionId: r.sessionId, itemId: r.itemId })}>{t('admin.proc.cancel')}</button></td>
                </tr>
              ))}
              {queued.length === 0 && <tr><td className="py-1.5 text-txt3">{t('common.none')}</td></tr>}
            </tbody>
          </table>
        </div>
      </Section>

      {/* editor containers */}
      <Section title={`${t('admin.proc.editors')}${na ? ` · ${t('admin.cleanup.dockerNa')}` : ` · ${editors.length}`}`}>
        <div className="overflow-x-auto scrolly">
          <table className="w-full text-sm min-w-[420px]">
            <tbody>
              {editors.map((c: any) => (
                <tr key={c.id} className="border-t border-line first:border-0">
                  <td className="py-1.5 pr-2 font-mono text-[11px] break-all">{c.name || c.id}</td>
                  <td className="pr-2 text-txt3 whitespace-nowrap">{c.owner}{c.project ? ` · ${c.project}` : ''}</td>
                  <td className="pr-2 text-txt3">{c.state}</td>
                  <td className="text-right"><button className="btn-danger text-xs" disabled={disabled}
                    onClick={() => act(`ed:${c.id}`, 'admin.proc.confirmKillEditor', { kind: 'editor', action: 'stop', id: c.id })}>{t('admin.proc.kill')}</button></td>
                </tr>
              ))}
              {editors.length === 0 && <tr><td className="py-1.5 text-txt3">{na ? t('admin.cleanup.dockerNa') : t('common.none')}</td></tr>}
            </tbody>
          </table>
        </div>
      </Section>

      {/* review sandbox containers */}
      <Section title={`${t('admin.proc.sandboxes')}${na ? ` · ${t('admin.cleanup.dockerNa')}` : ` · ${sandboxes.length}`}`}>
        <div className="overflow-x-auto scrolly">
          <table className="w-full text-sm min-w-[420px]">
            <tbody>
              {sandboxes.map((c: any) => (
                <tr key={c.id} className="border-t border-line first:border-0">
                  <td className="py-1.5 pr-2 font-mono text-[11px] break-all">{c.name || c.id}</td>
                  <td className="pr-2 text-txt3">{c.state}</td>
                  <td className="text-right"><button className="btn-danger text-xs" disabled={disabled}
                    onClick={() => act(`sb:${c.id}`, 'admin.proc.confirmKillSandbox', { kind: 'sandbox', action: 'stop', id: c.id })}>{t('admin.proc.kill')}</button></td>
                </tr>
              ))}
              {sandboxes.length === 0 && <tr><td className="py-1.5 text-txt3">{na ? t('admin.cleanup.dockerNa') : t('common.none')}</td></tr>}
            </tbody>
          </table>
        </div>
      </Section>

      {/* running review pipelines */}
      <Section title={`${t('admin.proc.pipelines')} · ${pipelines.length}`}>
        <div className="overflow-x-auto scrolly">
          <table className="w-full text-sm min-w-[420px]">
            <tbody>
              {pipelines.map((r: any) => (
                <tr key={r.reviewId} className="border-t border-line first:border-0">
                  <td className="py-1.5 pr-2 break-all">#{r.prNumber} {r.prTitle}</td>
                  <td className="pr-2 text-txt3 whitespace-nowrap">{r.repoName}</td>
                  <td className="text-right"><button className="btn-danger text-xs" disabled={disabled}
                    onClick={() => act(`pl:${r.reviewId}`, 'admin.proc.confirmStopPipeline', { kind: 'pipeline', action: 'stop', chatSessionId: r.chatSessionId })}>{t('admin.proc.stop')}</button></td>
                </tr>
              ))}
              {pipelines.length === 0 && <tr><td className="py-1.5 text-txt3">{t('common.none')}</td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

// Resource cleanup: read-only inventory + per-resource clean actions + a double-confirmed full reset.
// Every list/table scrolls inside its own overflow-x-auto container so mobile never gets a body scroll.
function fmtBytes(n: number): string {
  if (!n) return '0';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i > 0 && v < 10 ? 1 : 0)}${u[i]}`;
}

function CleanupManager() {
  const t = useT();
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = async () => { try { setData(await api.get('/api/admin/cleanup')); } catch (e: any) { useStore.getState().setError(e.message); } };
  useEffect(() => { load(); }, []);

  const run = async (action: string) => {
    setBusy(action);
    try {
      const r = await api.post('/api/admin/cleanup', { action });
      setData(r);
      const s = r.summary || {};
      if (action === 'full-reset') {
        alert(t('admin.cleanup.fullResetDone', {
          editors: s.editors?.removed ?? 0, sandboxes: s.sandboxes?.removed ?? 0,
          images: s.danglingImages?.removed ?? 0, dirs: s.orphanDirs?.removed ?? 0, rows: s.orphanRows?.removed ?? 0,
        }));
      } else {
        alert(t('admin.cleanup.removed', { n: s.removed ?? 0 }));
      }
    } catch (e: any) { useStore.getState().setError(e.message); }
    finally { setBusy(null); }
  };
  const act = (action: string, confirmKey: string) => { if (confirm(t(confirmKey))) void run(action); };
  const fullReset = () => {
    if (!confirm(t('admin.cleanup.fullResetConfirm1'))) return;
    const typed = prompt(t('admin.cleanup.fullResetConfirm2'));
    if (typed !== t('admin.cleanup.fullResetKeyword')) return;
    void run('full-reset');
  };

  if (!data) return <div className="text-sm text-txt3">{t('admin.cleanup.rescanning')}</div>;
  if (data.enabled === false) {
    return <div className="text-xs text-warn bg-warnsoft border border-warn rounded-lg px-3 py-2">{t('admin.cleanup.disabledNote')}</div>;
  }
  const disabled = busy !== null;
  const na = data.dockerUnavailable;
  const rows = data.orphanRows || {};
  const dirs = data.orphanDirs || {};
  const rowDefs: [string, number][] = [
    ['admin.cleanup.rowMessages', rows.messages], ['admin.cleanup.rowReviewSessions', rows.reviewSessions],
    ['admin.cleanup.rowRoomMembers', rows.roomMembers], ['admin.cleanup.rowUsage', rows.usage],
    ['admin.cleanup.rowPluginPrefs', rows.pluginPrefs], ['admin.cleanup.rowSkillUsage', rows.skillUsage],
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-semibold">{t('admin.cleanup.title')}</div>
        <button className="ml-auto text-xs border border-line rounded-lg px-2.5 py-1 hover:border-clay disabled:opacity-40 inline-flex items-center gap-1.5"
          disabled={disabled} onClick={() => load()}><IconRefresh size={13} />{t('admin.cleanup.rescan')}</button>
      </div>
      <p className="text-[11px] text-txt3 leading-snug">{t('admin.cleanup.intro')}</p>

      {/* containers */}
      <Section title={`${t('admin.cleanup.containers')}${na ? ` · ${t('admin.cleanup.dockerNa')}` : ''}`}>
        <div className="overflow-x-auto scrolly">
          <table className="w-full text-sm min-w-[420px]">
            <tbody>
              {(data.containers || []).map((c: any) => (
                <tr key={c.id} className="border-t border-line first:border-0">
                  <td className="py-1.5 pr-2">{c.kind === 'editor' ? t('admin.cleanup.kindEditor') : t('admin.cleanup.kindSandbox')}</td>
                  <td className="pr-2 font-mono text-[11px] break-all">{c.name || c.id}</td>
                  <td className="pr-2 text-txt3">{c.state}</td>
                  <td>{c.orphan && <span className="text-[10px] bg-warnsoft text-warn px-1.5 py-0.5 rounded-full">{t('admin.cleanup.orphanBadge')}</span>}</td>
                </tr>
              ))}
              {(data.containers || []).length === 0 && <tr><td className="py-1.5 text-txt3">{na ? t('admin.cleanup.dockerNa') : t('admin.cleanup.none')}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2 flex-wrap mt-3">
          <button className="btn-danger text-xs" disabled={disabled} onClick={() => act('editors', 'admin.cleanup.confirmEditors')}>{t('admin.cleanup.cleanEditors')}</button>
          <button className="btn-danger text-xs" disabled={disabled} onClick={() => act('sandboxes', 'admin.cleanup.confirmSandboxes')}>{t('admin.cleanup.cleanSandboxes')}</button>
        </div>
      </Section>

      {/* images */}
      <Section title={t('admin.cleanup.images')}>
        <div className="overflow-x-auto scrolly">
          <table className="w-full text-sm min-w-[420px]">
            <tbody>
              {(data.images || []).map((im: any) => (
                <tr key={im.ref} className="border-t border-line first:border-0">
                  <td className="py-1.5 pr-2 font-mono text-[11px] break-all">{im.ref}</td>
                  <td className="pr-2">{im.present ? <span className="text-ok inline-flex items-center gap-1"><IconDot size={10} />{t('admin.cleanup.present')}</span> : <span className="text-txt3 inline-flex items-center gap-1"><IconDotOutline size={10} />{t('admin.cleanup.absent')}</span>}</td>
                  <td className="text-txt3">{im.size ? fmtBytes(im.size) : ''}</td>
                </tr>
              ))}
              {(data.images || []).length === 0 && <tr><td className="py-1.5 text-txt3">{t('admin.cleanup.none')}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-3">
          <span className="text-sm">{t('admin.cleanup.dangling')}:</span>
          <span className="text-sm text-txt2">{na ? t('admin.cleanup.dockerNa') : t('admin.cleanup.danglingCount', { count: data.danglingImages?.count ?? 0, size: fmtBytes(data.danglingImages?.size ?? 0) })}</span>
          <button className="btn-danger text-xs ml-auto" disabled={disabled || na} onClick={() => act('dangling-images', 'admin.cleanup.confirmDangling')}>{t('admin.cleanup.cleanDangling')}</button>
        </div>
      </Section>

      {/* orphan dirs */}
      <Section title={t('admin.cleanup.orphanDirs')}>
        <div className="space-y-1.5 text-sm">
          <DirRow label={t('admin.cleanup.reviewDirs')} g={dirs.reviewDirs} />
          <DirRow label={t('admin.cleanup.attachmentDirs')} g={dirs.attachmentDirs} />
          <DirRow label={t('admin.cleanup.homeDirs')} g={dirs.homeDirs} />
        </div>
        <button className="btn-danger text-xs mt-3" disabled={disabled} onClick={() => act('orphan-dirs', 'admin.cleanup.confirmOrphanDirs')}>{t('admin.cleanup.cleanOrphanDirs')}</button>
      </Section>

      {/* orphan DB rows */}
      <Section title={t('admin.cleanup.orphanRows')}>
        <div className="space-y-1.5 text-sm">
          {rowDefs.map(([k, v]) => (
            <div key={k} className="flex items-center gap-2"><span className="text-txt2">{t(k)}</span><span className="ml-auto tabular-nums">{v ?? 0}</span></div>
          ))}
        </div>
        <button className="btn-danger text-xs mt-3" disabled={disabled} onClick={() => act('orphan-rows', 'admin.cleanup.confirmOrphanRows')}>{t('admin.cleanup.cleanOrphanRows')}</button>
      </Section>

      {/* full reset */}
      <div className="bg-card border border-danger rounded-xl p-4">
        <div className="font-semibold text-danger mb-1">{t('admin.cleanup.fullReset')}</div>
        <p className="text-[11px] text-txt3 leading-snug mb-3">{t('admin.cleanup.fullResetNote')}</p>
        <button className="btn-danger" disabled={disabled} onClick={fullReset}>{t('admin.cleanup.fullReset')}</button>
      </div>
    </div>
  );
}
function DirRow({ label, g }: { label: string; g?: { count: number; size: number } }) {
  return <div className="flex items-center gap-2"><span className="text-txt2">{label}</span><span className="ml-auto tabular-nums">{g?.count ?? 0}{g?.size ? ` · ${fmtBytes(g.size)}` : ''}</span></div>;
}

function Stat({ label, v }: { label: string; v: any }) {
  return <div className="bg-card border border-line rounded-lg p-3"><div className="text-2xl font-semibold">{v}</div><div className="text-xs text-txt3">{label}</div></div>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="bg-card border border-line rounded-xl p-4"><div className="font-semibold mb-3">{title}</div>{children}</div>;
}
