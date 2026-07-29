import { useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { useT } from '../lib/i18n';
import { MobileMenuButton, Avatar, avatarUrl } from '../lib/ui';
import { GitCredList } from './GitCredentials';
import { LlmProviderForm } from './LlmProvider';

function fmtDate(ms?: number | null) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="bg-card border border-line rounded-xl p-4"><div className="font-semibold mb-3">{title}</div>{children}</div>;
}

// Per-user settings page: profile image, Claude token, git credentials, personal projects.
// Structure mirrors AdminPanel (sticky header + max-w content + Section cards).
export function MyPage() {
  const setPanel = useStore((s) => s.setPanel);
  const llmProvidersEnabled = useStore((s) => s.llmProvidersEnabled);
  const t = useT();
  return (
    <div className="h-full overflow-y-auto scrolly">
      <div className="flex items-center gap-3 px-4 md:px-5 py-3 border-b border-line sticky top-0 bg-panel z-10">
        <MobileMenuButton />
        <button className="toolbtn" onClick={() => setPanel(null)}>←</button>
        <div className="font-semibold">{t('mypage.title')}</div>
      </div>
      <div className="max-w-[860px] mx-auto p-4 md:p-5 space-y-6">
        <Section title={t('mypage.profile')}><ProfileSection /></Section>
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
        <Section title={t('mypage.projects')}><ProjectsSection /></Section>
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
      <input className="input mt-1 mb-2" type="password" placeholder="sk-ant-oat-…" value={token}
        onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      <div className="text-[11px] text-txt3 mb-3">{t('token.setupHint', { code: 'claude setup-token' })}</div>
      {err && <div className="text-xs text-danger mb-2">{err}</div>}
      <div className="flex justify-end">
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? '…' : t('token.save')}</button>
      </div>
    </>
  );
}

// The user's personal projects: create (name), delete (with the shared confirm), or open one in a
// fresh private chat (new session → attach the project → leave My Page to the chat).
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
            <span className="opacity-70">📁</span>
            <span className="flex-1 truncate" title={p.path}>{p.name}</span>
            <button className="text-xs text-txt3 hover:text-clay" onClick={() => openInChat(p.id)}>{t('mypage.openInChat')}</button>
            <button className="text-xs text-txt3 hover:text-danger" onClick={() => del(p.id, p.name)}>{t('common.delete')}</button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input className="input flex-1" placeholder={t('mypage.projectNamePlaceholder')} value={name} disabled={busy}
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        <button className="btn-primary" disabled={busy} onClick={create}>{t('common.create')}</button>
      </div>
    </>
  );
}
