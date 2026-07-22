import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';

export function AdminPanel() {
  const setPanel = useStore((s) => s.setPanel);
  const [ov, setOv] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [nu, setNu] = useState({ username: '', password: '', role: 'member', displayName: '', claudeToken: '' });
  const [commonTok, setCommonTok] = useState('');
  const t = useT();

  const load = async () => {
    const [o, u, s, us] = await Promise.all([
      api.get('/api/admin/overview'), api.get('/api/admin/usage'), api.get('/api/admin/settings'), api.get('/api/users'),
    ]);
    setOv(o); setUsage(u); setSettings(s); setUsers(us.users);
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
      <div className="flex items-center gap-3 px-5 py-3 border-b border-line sticky top-0 bg-panel z-10">
        <button className="toolbtn" onClick={() => setPanel(null)}>←</button>
        <div className="font-semibold">{t('admin.panelTitle')}</div>
      </div>
      <div className="max-w-[860px] mx-auto p-5 space-y-6">
        {ov && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label={t('admin.statUsers')} v={ov.users} /><Stat label={t('admin.statRooms')} v={ov.rooms} />
            <Stat label={t('admin.statSessions')} v={ov.sessions} /><Stat label={t('admin.statConcurrentTurns')} v={`${ov.throttle.inUse}/${ov.throttle.max}${ov.throttle.waiting ? ` (+${ov.throttle.waiting})` : ''}`} />
          </div>
        )}
        {ov?.forceMock && <div className="text-xs text-warn bg-warnsoft border border-warn rounded-lg px-3 py-2">{t('admin.mockForcedWarning')}</div>}
        {!ov?.forceMock && ov?.commonToken && !ov.commonToken.hasToken && <div className="text-xs text-warn bg-warnsoft border border-warn rounded-lg px-3 py-2">{t('admin.commonTokenUnsetWarning')}</div>}

        <Section title={t('admin.commonTokenTitle')}>
          <div className="text-sm mb-2 flex items-center gap-2">
            {ov?.commonToken?.hasToken
              ? <><span className="text-ok">●</span><span>{t('admin.registered')}{ov.commonToken.setAt ? ` · ${new Date(ov.commonToken.setAt).toLocaleDateString()}` : ' (env)'}</span>
                  <button className="ml-auto text-xs text-txt3 hover:text-danger" onClick={clearCommon}>{t('common.delete')}</button></>
              : <><span className="text-warn">●</span><span className="text-txt2">{t('admin.notSet')}</span></>}
          </div>
          <div className="flex gap-2">
            <input className="input flex-1" type="password" placeholder={t('admin.commonTokenPlaceholder')} value={commonTok}
              onChange={(e) => setCommonTok(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveCommon()} />
            <button className="btn-primary" onClick={saveCommon}>{t('admin.save')}</button>
          </div>
          <div className="text-[11px] text-txt3 mt-1.5">{t('admin.commonTokenHint', { key: 'ANTHROPIC_API_KEY' })}</div>
        </Section>

        <Section title={t('admin.usageTitle')}>
          {usage && (
            <>
              <div className="text-sm text-txt2 mb-2">{t('admin.usageTotals', { turns: usage.totals.turns, input: usage.totals.inputTokens.toLocaleString(), output: usage.totals.outputTokens.toLocaleString(), cost: usage.totals.costUsd.toFixed(4) })}</div>
              <table className="w-full text-sm">
                <thead><tr className="text-txt3 text-xs text-left"><th className="py-1">{t('admin.colUser')}</th><th>{t('admin.colTurns')}</th><th>in</th><th>out</th><th>$</th></tr></thead>
                <tbody>
                  {usage.byUser.map((r: any) => (
                    <tr key={r.userId} className="border-t border-line"><td className="py-1.5">{r.name}</td><td>{r.turns}</td><td>{r.inputTokens.toLocaleString()}</td><td>{r.outputTokens.toLocaleString()}</td><td>${r.costUsd.toFixed(4)}</td></tr>
                  ))}
                  {usage.byUser.length === 0 && <tr><td colSpan={5} className="text-txt3 py-2">{t('common.none')}</td></tr>}
                </tbody>
              </table>
            </>
          )}
        </Section>

        <Section title={t('admin.globalSettingsTitle')}>
          {settings && (
            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={settings.allowBypass} onChange={toggleBypass} />
                {t('admin.allowBypassLabel')}
              </label>
              <div className="text-txt3 text-xs">{t('admin.concurrentTurnCap', { max: settings.maxConcurrentTurns })}</div>
              <div className="text-txt3 text-xs">{t('admin.codeServerImage', { image: settings.codeServer })}</div>
            </div>
          )}
        </Section>

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
          <div className="grid grid-cols-2 gap-2">
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
      </div>
    </div>
  );
}

function Stat({ label, v }: { label: string; v: any }) {
  return <div className="bg-card border border-line rounded-lg p-3"><div className="text-2xl font-semibold">{v}</div><div className="text-xs text-txt3">{label}</div></div>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="bg-card border border-line rounded-xl p-4"><div className="font-semibold mb-3">{title}</div>{children}</div>;
}
