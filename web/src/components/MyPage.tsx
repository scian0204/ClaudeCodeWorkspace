import { useEffect, useRef, useState } from 'react';
import { useStore, type AdminRequest, type RequestAction } from '../lib/store';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { MobileMenuButton, Avatar, avatarUrl } from '../lib/ui';
import { GitCredList } from './GitCredentials';
import { LlmProviderForm } from './LlmProvider';
import { ProjectCreateForm } from './ProjectCreateForm';
import { ClaudeLoginBlock } from './TokenSettings';
import { GitPanel } from './GitPanel';
import { IconArrowLeft, IconDot, IconFolder, IconGitBranch, IconUser, IconUsers, IconTrash, IconCheck, IconWarning } from '../lib/icons';

function fmtDate(ms?: number | null) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="bg-card border border-line rounded-xl p-4"><div className="font-semibold mb-3">{title}</div>{children}</div>;
}

// Tab bar model — same shape as AdminPanel's TABS. `label` is an i18n key resolved at render.
const TABS = [
  { key: 'profile', label: 'mypage.tab.profile' },
  { key: 'session', label: 'mypage.tab.session' },
  { key: 'requests', label: 'mypage.tab.requests' },
  { key: 'creds', label: 'mypage.tab.creds' },
  { key: 'projects', label: 'mypage.tab.projects' },
] as const;
type MyTab = (typeof TABS)[number]['key'];

// Per-user settings page: profile image, Claude token, git credentials, personal projects.
// Structure mirrors AdminPanel (sticky header + tab bar + max-w content + Section cards).
export function MyPage() {
  const setPanel = useStore((s) => s.setPanel);
  const llmProvidersEnabled = useStore((s) => s.llmProvidersEnabled);
  const approvalsEnabled = useStore((s) => s.approvalsEnabled);
  const autoTitleEnabled = useStore((s) => s.autoTitleEnabled);
  const autoResumeEnabled = useStore((s) => s.autoResumeEnabled);
  const windowPrimerEnabled = useStore((s) => s.windowPrimerEnabled);
  const tokenPoolEnabled = useStore((s) => s.tokenPoolEnabled);
  const t = useT();
  const [tab, setTab] = useState<MyTab>('profile');
  // Session tab holds the three per-user automation toggles — hidden when the admin disabled all three.
  const sessionTab = autoTitleEnabled || autoResumeEnabled || windowPrimerEnabled;
  const tabs = TABS.filter((tb) =>
    (tb.key !== 'requests' || approvalsEnabled) && (tb.key !== 'session' || sessionTab));
  return (
    <div className="h-full overflow-y-auto scrolly">
      <div className="flex items-center gap-3 px-4 md:px-5 py-3 border-b border-line sticky top-0 bg-panel z-10">
        <MobileMenuButton />
        <button className="toolbtn" aria-label={t('common.back')} onClick={() => setPanel(null)}><IconArrowLeft /></button>
        <div className="font-semibold inline-flex items-center gap-1.5"><IconUser size={16} />{t('mypage.title')}</div>
      </div>
      {/* Tab bar — scrolls horizontally inside its own container so it never widens the page on mobile. */}
      <div className="border-b border-line overflow-x-auto scrolly">
        <div className="flex gap-1 px-4 md:px-5">
          {tabs.map((tb) => (
            <button key={tb.key} onClick={() => setTab(tb.key)}
              className={`shrink-0 px-3 py-2.5 text-sm whitespace-nowrap border-b-2 ${tab === tb.key ? 'border-clay text-clay' : 'border-transparent text-txt3 hover:text-txt'}`}>
              {t(tb.label)}
            </button>
          ))}
        </div>
      </div>
      <div className="max-w-[860px] mx-auto p-4 md:p-5 space-y-6">
        {tab === 'profile' && <Section title={t('mypage.profile')}><ProfileSection /></Section>}
        {tab === 'session' && (
          <>
            {autoTitleEnabled && <Section title={t('mypage.autoTitle')}><AutoTitleSection /></Section>}
            {autoResumeEnabled && <Section title={t('mypage.autoResume')}><AutoResumeSection /></Section>}
            {windowPrimerEnabled && <Section title={t('mypage.primeWindow')}><PrimeWindowSection /></Section>}
          </>
        )}
        {tab === 'requests' && approvalsEnabled && (
          <Section title={t('mypage.requests')}>
            <div className="text-xs text-txt2 bg-claysoft border border-line rounded-lg px-3 py-2 mb-3">{t('requests.intro')}</div>
            <RequestsSection />
          </Section>
        )}
        {tab === 'creds' && (
          <>
            <Section title={t('mypage.claudeToken')}><TokenSection /></Section>
            {llmProvidersEnabled && (
              <Section title={t('mypage.llmProvider')}>
                <div className="text-xs text-txt2 bg-claysoft border border-line rounded-lg px-3 py-2 mb-3">{t('provider.intro')}</div>
                <LlmProviderForm scope="user" />
              </Section>
            )}
            <Section title={t('mypage.gitCreds')}>
              <div className="text-xs text-txt2 bg-claysoft border border-line rounded-lg px-3 py-2 mb-3">{t('gitcred.notice')}</div>
              <GitCredList scope="user" />
            </Section>
            {tokenPoolEnabled && (
              <Section title={t('mypage.pools')}>
                <div className="text-xs text-txt2 bg-claysoft border border-line rounded-lg px-3 py-2 mb-3">{t('pool.intro')}</div>
                <PoolSection />
              </Section>
            )}
          </>
        )}
        {tab === 'projects' && <Section title={t('mypage.projects')}><ProjectsSection /></Section>}
      </div>
    </div>
  );
}

function ProfileSection() {
  const user = useStore((s) => s.user);
  const uploadAvatar = useStore((s) => s.uploadAvatar);
  const clearAvatar = useStore((s) => s.clearAvatar);
  const setError = useStore((s) => s.setError);
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const src = avatarUrl(user);

  const pick = async (f?: File | null) => {
    if (!f) return;
    setBusy(true);
    try { await uploadAvatar(f); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const remove = async () => {
    setBusy(true);
    try { await clearAvatar(); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex items-center gap-4">
      <Avatar name={user?.displayName} color={user?.avatarColor} src={src} size={72} />
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-lg truncate">{user?.displayName}</div>
        <div className="text-sm text-txt3 truncate">@{user?.username} · {user?.role}</div>
        <div className="flex gap-2 mt-2">
          <button className="btn-ghost !py-1 !text-xs" disabled={busy} onClick={() => fileRef.current?.click()}>{t('mypage.uploadAvatar')}</button>
          {src && <button className="btn-ghost !py-1 !text-xs" disabled={busy} onClick={remove}>{t('mypage.removeAvatar')}</button>}
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      </div>
    </div>
  );
}

// Auto session titling: on, the server renames a still-unnamed private chat after its topic
// once the first turn finishes. Optimistic — the checkbox flips back if the PATCH fails.
function AutoTitleSection() {
  const user = useStore((s) => s.user);
  const setAutoTitle = useStore((s) => s.setAutoTitle);
  const setError = useStore((s) => s.setError);
  const t = useT();
  const [busy, setBusy] = useState(false);
  const on = user?.autoTitle !== false;

  const toggle = async (next: boolean) => {
    setBusy(true);
    try { await setAutoTitle(next); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={on} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
        <span>{t('mypage.autoTitleLabel')}</span>
      </label>
      <div className="text-xs text-txt3 mt-2">{t('mypage.autoTitleHint')}</div>
    </>
  );
}

// Auto-resume when the claude.ai plan window resets: on, a turn that died because the 5h (or weekly)
// window was exhausted is re-sent by the server once it reopens. Off by default — it runs unattended.
// Claude-subscription auth only; an API key or a bedrock/vertex/custom provider has no such window.
function AutoResumeSection() {
  const user = useStore((s) => s.user);
  const setAutoResume = useStore((s) => s.setAutoResume);
  const setError = useStore((s) => s.setError);
  const t = useT();
  const [busy, setBusy] = useState(false);
  const on = user?.autoResume === true;

  const toggle = async (next: boolean) => {
    setBusy(true);
    try { await setAutoResume(next); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={on} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
        <span>{t('mypage.autoResumeLabel')}</span>
      </label>
      <div className="text-xs text-txt3 mt-2">{t('mypage.autoResumeHint')}</div>
      <div className="text-xs text-txt3 mt-1">{t('mypage.autoResumeClaudeOnly')}</div>
    </>
  );
}

// Keep the claude.ai 5-hour window open. The window starts on your first billed message, not on a
// wall clock, so idle time after a reset is lost. On, the server sends one tiny throwaway query as
// soon as no window is running, and the full 5 hours are there when you actually sit down.
function PrimeWindowSection() {
  const user = useStore((s) => s.user);
  const setPrimeWindow = useStore((s) => s.setPrimeWindow);
  const setError = useStore((s) => s.setError);
  const t = useT();
  const [busy, setBusy] = useState(false);
  const on = user?.primeWindow === true;

  const toggle = async (next: boolean) => {
    setBusy(true);
    try { await setPrimeWindow(next); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={on} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
        <span>{t('mypage.primeWindowLabel')}</span>
      </label>
      <div className="text-xs text-txt3 mt-2">{t('mypage.primeWindowHint')}</div>
      <div className="text-xs text-txt3 mt-1">{t('mypage.primeWindowCost')}</div>
      {on && (
        <div className="text-xs text-txt3 mt-2">
          {user?.primedAt
            ? t('mypage.primeWindowLast', { at: new Date(user.primedAt).toLocaleString() })
            : t('mypage.primeWindowNever')}
        </div>
      )}
    </>
  );
}

// Register / replace / clear the current user's Claude token — reuses the store methods
// (same logic as MyTokenModal, rendered inline as a Section instead of a modal).
function TokenSection() {
  const user = useStore((s) => s.user);
  const saveClaudeToken = useStore((s) => s.saveClaudeToken);
  const clearClaudeToken = useStore((s) => s.clearClaudeToken);
  const t = useT();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const has = !!user?.hasClaudeToken;

  const save = async () => {
    if (!token.trim()) { setErr(t('token.enterToken')); return; }
    setBusy(true); setErr('');
    try { await saveClaudeToken(token.trim()); setToken(''); }
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
    <>
      <ClaudeLoginBlock />
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
      <div className="text-[11px] text-txt3 mb-3">{t('token.setupHint', { code: 'claude setup-token' })}</div>
      {err && <div className="text-xs text-danger mb-2">{err}</div>}
      <div className="flex justify-end">
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? '…' : t('token.save')}</button>
      </div>
    </>
  );
}

// The user's personal projects: create (name), delete (with the shared confirm), open one in a
// fresh private chat (new session → attach the project → leave My Page to the chat), or manage its
// git state right here — the same panel the chat header opens (pull / commit / push / branches /
// remotes / publish), so a project never has to be attached to a session just to be pulled.
// Shared-plan pools. Joining is the member's own act and nothing else here can enrol someone —
// leaving/removing only ever spends LESS of a plan, so the creator and admins may do that too.
function PoolSection() {
  const t = useT();
  const { pools, globalPoolId, poolCanCreate, poolHasCredential, user, refreshPools } = useStore();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const isAdmin = user?.role === 'admin';

  const call = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); await refreshPools(); }
    catch (e: any) { useStore.getState().setError(String(e?.message || e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      {!poolHasCredential && (
        <div className="text-xs inline-flex items-start gap-1.5 rounded-lg px-3 py-2 border" style={{ borderColor: 'var(--warn)', background: 'var(--warn-soft)' }}>
          <IconWarning size={13} className="shrink-0 mt-0.5" />{t('pool.noCredential')}
        </div>
      )}
      {pools.map((p) => {
        const mine = p.members.some((m) => m.userId === user?.id);
        const canManage = isAdmin || p.ownerId === user?.id;
        return (
          <div key={p.id} className="border border-line rounded-lg p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <IconUsers size={14} className="text-clay shrink-0" />
              <span className="font-semibold text-sm">{p.name}</span>
              {p.id === globalPoolId && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--claysoft)', color: 'var(--clay)' }}>{t('pool.globalBadge')}</span>}
              {/* order is a per-pool override of the admin default; only the creator/admins may set it */}
              {canManage ? (
                <select className="input !py-0.5 !text-[11px] !w-auto" value={p.strategy} disabled={busy}
                  title={t('pool.strategyTip')}
                  onChange={(e) => void call(() => api.put(`/api/pools/${p.id}/strategy`, { strategy: e.target.value }))}>
                  <option value="rotate">{t('pool.strategy.rotate')}</option>
                  <option value="sequential">{t('pool.strategy.sequential')}</option>
                </select>
              ) : (
                <span className="text-[11px] text-txt3">{t('pool.strategy.' + p.strategy)}</span>
              )}
              <span className="text-[11px] text-txt3">{t('pool.owner', { name: p.ownerName })}</span>
              <span className="ml-auto flex items-center gap-1.5">
                <button className={`btn-ghost !py-1 !text-xs ${mine ? '' : 'text-clay'}`} disabled={busy}
                  onClick={() => void call(() => api.post(`/api/pools/${p.id}/${mine ? 'leave' : 'join'}`, {}))}>
                  {mine ? t('pool.leave') : t('pool.join')}
                </button>
                {isAdmin && (
                  <button className="btn-ghost !py-1 !text-xs" disabled={busy}
                    onClick={() => void call(() => api.put('/api/pools/global', { poolId: p.id === globalPoolId ? '' : p.id }))}>
                    {p.id === globalPoolId ? t('pool.unsetGlobal') : t('pool.setGlobal')}
                  </button>
                )}
                {canManage && (
                  <button className="btn-ghost !py-1 !text-xs hover:text-danger" title={t('common.delete')} disabled={busy}
                    onClick={() => { if (confirm(t('pool.deleteConfirm', { name: p.name }))) void call(() => api.del(`/api/pools/${p.id}`)); }}>
                    <IconTrash size={13} />
                  </button>
                )}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {p.members.length === 0 && <span className="text-[11px] text-txt3">{t('pool.noMembers')}</span>}
              {p.members.map((m) => (
                <span key={m.userId} className="text-[11px] px-2 py-0.5 rounded-full border border-line inline-flex items-center gap-1"
                  title={m.cooldownUntil ? t('pool.cooldownTip', { at: fmtDate(m.cooldownUntil) }) : m.hasCredential ? '' : t('pool.memberNoCredential')}>
                  {m.hasCredential ? <IconCheck size={11} className="text-ok" /> : <IconWarning size={11} className="text-warn" />}
                  <span className={m.cooldownUntil ? 'line-through text-txt3' : ''}>{m.name}</span>
                </span>
              ))}
            </div>
          </div>
        );
      })}
      {pools.length === 0 && <div className="text-xs text-txt3">{t('pool.none')}</div>}
      {poolCanCreate && (
        <div className="flex items-center gap-2">
          <input className="input flex-1 min-w-0" placeholder={t('pool.newPlaceholder')} value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && name.trim()) { e.preventDefault(); void call(async () => { await api.post('/api/pools', { name }); setName(''); }); } }} />
          <button className="btn-ghost !text-xs shrink-0" disabled={busy || !name.trim()}
            onClick={() => void call(async () => { await api.post('/api/pools', { name }); setName(''); })}>{t('pool.create')}</button>
        </div>
      )}
    </div>
  );
}

function ProjectsSection() {
  const projects = useStore((s) => s.projects);
  const createProject = useStore((s) => s.createProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const newSession = useStore((s) => s.newSession);
  const setProject = useStore((s) => s.setProject);
  const setPanel = useStore((s) => s.setPanel);
  const setError = useStore((s) => s.setError);
  const t = useT();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [gitFor, setGitFor] = useState<string | null>(null); // project whose Git panel is open

  const create = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    try { await createProject(name.trim()); setName(''); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const openInChat = async (id: string) => {
    try { await newSession(); await setProject(id); setPanel(null); }
    catch (e: any) { setError(e.message); }
  };
  const del = async (id: string, nm: string) => {
    if (!confirm(t('chat.deleteProjectConfirm', { name: nm }))) return;
    try { await deleteProject(id); }
    catch (e: any) { setError(e.message); }
  };

  return (
    <>
      <div className="space-y-1.5 mb-3">
        {projects.mine.length === 0 && <div className="text-xs text-txt3">{t('mypage.noProjects')}</div>}
        {projects.mine.map((p) => (
          <div key={p.id} className="flex items-center gap-2 text-sm border-b border-line py-1.5">
            <span className="opacity-70"><IconFolder size={15} /></span>
            <span className="flex-1 truncate" title={p.path}>{p.name}</span>
            <button className="text-xs text-txt3 hover:text-clay inline-flex items-center gap-1 shrink-0"
              title={t('git.title')} onClick={() => setGitFor(p.id)}>
              <IconGitBranch size={13} />{t('git.pill')}
            </button>
            <button className="text-xs text-txt3 hover:text-clay shrink-0" onClick={() => openInChat(p.id)}>{t('mypage.openInChat')}</button>
            <button className="text-xs text-txt3 hover:text-danger shrink-0" onClick={() => del(p.id, p.name)}>{t('common.delete')}</button>
          </div>
        ))}
      </div>
      {gitFor && <GitPanel projectId={gitFor} open onClose={() => setGitFor(null)} />}
      <div className="flex gap-2">
        <input className="input flex-1" placeholder={t('mypage.projectNamePlaceholder')} value={name} disabled={busy}
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        <button className="btn-primary" disabled={busy} onClick={create}>{t('common.create')}</button>
      </div>
    </>
  );
}

// ── shared request presentation (reused by the admin › requests tab) ──
// Friendly labels fall back to the raw registry key so a new action shows up even before i18n lands.
export function reqTypeLabel(t: (k: string) => string, type: string) { const s = t(`requests.action.${type}`); return s === `requests.action.${type}` ? type : s; }
export function reqFieldLabel(t: (k: string) => string, key: string) { const s = t(`requests.field.${key}`); return s === `requests.field.${key}` ? key : s; }
export function reqStatusMeta(t: (k: string) => string, status: string) {
  if (status === 'approved') return { label: t('requests.status.approved'), cls: 'bg-oksoft text-ok' };
  if (status === 'rejected') return { label: t('requests.status.rejected'), cls: 'bg-dangersoft text-danger' };
  return { label: t('requests.status.pending'), cls: 'bg-warnsoft text-warn' };
}
export function RequestStatusBadge({ status }: { status: string }) {
  const t = useT();
  const m = reqStatusMeta(t, status);
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${m.cls}`}>{m.label}</span>;
}
// Read-only summary of a request (type + status + payload + reason + result). Shared by both panels.
export function RequestInfo({ r, requesterName }: { r: AdminRequest; requesterName?: string }) {
  const t = useT();
  let payload: Record<string, string> = {};
  try { payload = JSON.parse(r.payload || '{}'); } catch { /* keep empty */ }
  const entries = Object.entries(payload).filter(([, v]) => typeof v === 'string' && v);
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="font-medium text-[13px]">{reqTypeLabel(t, r.type)}</span>
        <RequestStatusBadge status={r.status} />
        {requesterName && <span className="text-[11px] text-txt3">· {requesterName}</span>}
        <span className="ml-auto text-[10px] text-txt3">{fmtDate(r.createdAt)}</span>
      </div>
      {entries.length > 0 && (
        <div className="text-[11px] text-txt3 mt-0.5 break-words">
          {entries.map(([k, v]) => `${reqFieldLabel(t, k)}: ${v}`).join(' · ')}
        </div>
      )}
      {r.reason && <div className="text-[11px] text-txt2 mt-0.5 break-words">{t('requests.reasonLabel')}: {r.reason}</div>}
      {r.result && <div className="text-[11px] mt-0.5 break-words text-txt2">{t('requests.resultLabel')}: {r.result}</div>}
    </div>
  );
}

// "My Requests" — submit a request for an admin-only action (form driven by /api/requests/actions),
// then track your own submissions with live status badges + the execution result.
function RequestsSection() {
  const user = useStore((s) => s.user);
  const requests = useStore((s) => s.requests);
  const submitRequest = useStore((s) => s.submitRequest);
  const setError = useStore((s) => s.setError);
  const t = useT();
  const [actions, setActions] = useState<RequestAction[]>([]);
  const [type, setType] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/requests/actions')
      .then((r) => { setActions(r.actions || []); if (r.actions?.[0]) setType(r.actions[0].type); })
      .catch(() => {});
  }, []);
  useEffect(() => { setFields({}); }, [type]); // reset payload when the chosen action changes

  const action = actions.find((a) => a.type === type);
  const mine = requests.filter((r) => r.requesterId === user?.id); // own only (admins see all in the store)

  const submit = async () => {
    if (!action) return;
    for (const f of action.fields) if (f.required && !(fields[f.key] || '').trim()) { setError(t('requests.fillRequired')); return; }
    setBusy(true);
    try { await submitRequest(type, fields, reason.trim()); setFields({}); setReason(''); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="space-y-2 mb-4">
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          {actions.length === 0 && <option value="">{t('requests.noActions')}</option>}
          {actions.map((a) => <option key={a.type} value={a.type}>{reqTypeLabel(t, a.type)}</option>)}
        </select>
        {/* common_project reuses the real create form (name + git clone URL + branch + credential picker),
            in request mode for members; other actions keep the generic field-driven form. */}
        {type === 'common_project' ? (
          <ProjectCreateForm scope="common" />
        ) : (
          <>
            {action?.fields.map((f) => (
              f.type === 'textarea'
                ? <textarea key={f.key} className="input resize-none" rows={2}
                    placeholder={reqFieldLabel(t, f.key) + (f.required ? ' *' : '')} value={fields[f.key] || ''}
                    onChange={(e) => setFields((s) => ({ ...s, [f.key]: e.target.value }))} />
                : <input key={f.key} className="input"
                    placeholder={reqFieldLabel(t, f.key) + (f.required ? ' *' : '')} value={fields[f.key] || ''}
                    onChange={(e) => setFields((s) => ({ ...s, [f.key]: e.target.value }))} />
            ))}
            <textarea className="input resize-none" rows={2} placeholder={t('requests.reasonPlaceholder')}
              value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex justify-end">
              <button className="btn-primary" disabled={busy || !type} onClick={submit}>{busy ? '…' : t('requests.submit')}</button>
            </div>
          </>
        )}
      </div>
      <div className="space-y-1.5">
        {mine.length === 0 && <div className="text-xs text-txt3">{t('requests.none')}</div>}
        {mine.map((r) => (
          <div key={r.id} className="flex items-start gap-2 border-b border-line py-1.5">
            <RequestInfo r={r} />
          </div>
        ))}
      </div>
    </>
  );
}
