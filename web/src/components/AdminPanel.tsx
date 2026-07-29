import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { MobileMenuButton } from '../lib/ui';
import { GitCredList } from './GitCredentials';
import { LlmProviderForm } from './LlmProvider';

// Tab bar model — append here to add a tab (e.g. resource cleanup, approvals, processes, LLM providers).
// `label` is an i18n key resolved at render.
const TABS = [
  { key: 'overview', label: 'admin.tab.overview' },
  { key: 'users', label: 'admin.tab.users' },
  { key: 'providers', label: 'admin.tab.providers' },
  { key: 'usage', label: 'admin.tab.usage' },
  { key: 'config', label: 'admin.tab.config' },
  { key: 'resources', label: 'admin.tab.resources' },
] as const;
type AdminTab = (typeof TABS)[number]['key'];

export function AdminPanel() {
  const setPanel = useStore((s) => s.setPanel);
  const [ov, setOv] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [nu, setNu] = useState({ username: '', password: '', role: 'member', displayName: '', claudeToken: '' });
  const [commonTok, setCommonTok] = useState('');
  const [tab, setTab] = useState<AdminTab>('overview');
  const llmProvidersEnabled = useStore((s) => s.llmProvidersEnabled);
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
      <div className="flex items-center gap-3 px-4 md:px-5 py-3 border-b border-line sticky top-0 bg-panel z-10">
        <MobileMenuButton />
        <button className="toolbtn" onClick={() => setPanel(null)}>←</button>
        <div className="font-semibold">{t('admin.panelTitle')}</div>
      </div>
      {/* Tab bar — scrolls horizontally inside its own container so it never widens the page on mobile. */}
      <div className="border-b border-line overflow-x-auto scrolly">
        <div className="flex gap-1 px-4 md:px-5">
          {TABS.map((tb) => (
            <button key={tb.key} onClick={() => setTab(tb.key)}
              className={`shrink-0 px-3 py-2.5 text-sm whitespace-nowrap border-b-2 ${tab === tb.key ? 'border-clay text-clay' : 'border-transparent text-txt3 hover:text-txt'}`}>
              {t(tb.label)}
            </button>
          ))}
        </div>
      </div>
      <div className="max-w-[860px] mx-auto p-4 md:p-5 space-y-6">
        {tab === 'overview' && (
          <>
            {ov && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label={t('admin.statUsers')} v={ov.users} /><Stat label={t('admin.statRooms')} v={ov.rooms} />
                <Stat label={t('admin.statSessions')} v={ov.sessions} /><Stat label={t('admin.statConcurrentTurns')} v={`${ov.throttle.inUse}/${ov.throttle.max}${ov.throttle.waiting ? ` (+${ov.throttle.waiting})` : ''}`} />
              </div>
            )}
            {ov?.forceMock && <div className="text-xs text-warn bg-warnsoft border border-warn rounded-lg px-3 py-2">{t('admin.mockForcedWarning')}</div>}
            {!ov?.forceMock && ov?.commonToken && !ov.commonToken.hasToken && <div className="text-xs text-warn bg-warnsoft border border-warn rounded-lg px-3 py-2">{t('admin.commonTokenUnsetWarning')}</div>}
          </>
        )}

        {tab === 'providers' && (
          <>
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

        {tab === 'usage' && (
          <Section title={t('admin.usageTitle')}>
            {usage && (
              <>
                <div className="text-sm text-txt2 mb-2">{t('admin.usageTotals', { turns: usage.totals.turns, input: usage.totals.inputTokens.toLocaleString(), output: usage.totals.outputTokens.toLocaleString(), cost: usage.totals.costUsd.toFixed(4) })}</div>
                <div className="overflow-x-auto scrolly">
                <table className="w-full text-sm min-w-[420px]">
                  <thead><tr className="text-txt3 text-xs text-left"><th className="py-1">{t('admin.colUser')}</th><th>{t('admin.colTurns')}</th><th>in</th><th>out</th><th>$</th></tr></thead>
                  <tbody>
                    {usage.byUser.map((r: any) => (
                      <tr key={r.userId} className="border-t border-line"><td className="py-1.5">{r.name}</td><td>{r.turns}</td><td>{r.inputTokens.toLocaleString()}</td><td>{r.outputTokens.toLocaleString()}</td><td>${r.costUsd.toFixed(4)}</td></tr>
                    ))}
                    {usage.byUser.length === 0 && <tr><td colSpan={5} className="text-txt3 py-2">{t('common.none')}</td></tr>}
                  </tbody>
                </table>
                </div>
              </>
            )}
          </Section>
        )}

        {tab === 'config' && (
          <>
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
        <button className="ml-auto text-xs border border-line rounded-lg px-2.5 py-1 hover:border-clay" onClick={restart}>⟳ {t('admin.cfgRestartBtn')}</button>
      </div>
      {restartNeeded && (
        <div className="text-xs text-warn bg-warnsoft border border-warn rounded-lg px-3 py-2">{t('admin.cfgRestartNeeded')}</div>
      )}
      {groups.map((g) => {
        const rows = items.filter((i) => i.group === g);
        return (
          <details key={g} className="group bg-card border border-line rounded-xl overflow-hidden">
            <summary className="font-semibold px-4 py-3 cursor-pointer select-none list-none flex items-center gap-2 [&::-webkit-details-marker]:hidden">
              <span className="text-txt3 text-xs transition-transform group-open:rotate-90">▶</span>
              <span>{t(`admin.cfgGroup.${g}`)}</span>
              <span className="ml-auto text-[11px] text-txt3 font-normal">{rows.length}</span>
            </summary>
            <div className="px-4 pb-4">
              {(g === 'infra' || g === 'secret') && (
                <div className="text-[11px] text-txt3 mb-2">{t(g === 'secret' ? 'admin.cfgSecretHint' : 'admin.cfgReadonlyHint')}</div>
              )}
              <div className="divide-y divide-line">
                {rows.map((it) => (
                  <ConfigRow key={it.key} it={it} edit={edits[it.key]}
                    onEdit={(v) => setEdits((e) => ({ ...e, [it.key]: v }))} onSave={save} onReset={reset} />
                ))}
              </div>
            </div>
          </details>
        );
      })}
    </>
  );
}

function ConfigRow({ it, edit, onEdit, onSave, onReset }: {
  it: any; edit: string | undefined; onEdit: (v: string) => void;
  onSave: (k: string, v: any) => void; onReset: (k: string) => void;
}) {
  const t = useT();
  const name = cfgLabel(t, it.key);
  const desc = cfgDesc(t, it.key);
  const cur = it.value ?? '';
  const dirty = edit !== undefined && edit !== String(cur);
  const editable = !it.readonly && !it.secret;
  return (
    <div className="py-2.5">
      <div className="flex items-start gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium text-[13px]">{name}</span>
            <span className="font-mono text-[10px] text-txt3">{it.key}</span>
            {it.restart && <span className="text-[9px] uppercase bg-warnsoft text-warn px-1.5 py-0.5 rounded-full whitespace-nowrap">{t('admin.cfgRestart')}</span>}
            {it.overridden && <button className="text-xs text-txt3 hover:text-clay" title={t('admin.cfgReset')} onClick={() => onReset(it.key)}>↺</button>}
          </div>
          {desc && <p className="text-[11px] text-txt3 mt-0.5 leading-snug">{desc}</p>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {it.secret ? (
            <span className={`text-xs ${it.set ? 'text-ok' : 'text-txt3'}`}>{it.set ? t('admin.cfgSet') : t('admin.cfgDefault')}</span>
          ) : it.readonly ? (
            <span className="font-mono text-[11px] text-txt3 break-all text-right max-w-[240px]">{String(it.value) || '—'}</span>
          ) : it.image ? (
            <ImageControl it={it} edit={edit} onEdit={onEdit} onSave={onSave} />
          ) : it.type === 'json' ? (
            <span className="text-[11px] text-txt3">{t('admin.cfgJsonBelow')} ↓</span>
          ) : it.type === 'bool' ? (
            <input type="checkbox" checked={it.value === '1'} onChange={(e) => onSave(it.key, e.target.checked)} />
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
          <button className="text-txt3 hover:text-danger px-1" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <button className="text-xs text-clay hover:underline" onClick={() => setRows([...rows, ['', '']])}>+ {t('admin.cfgAddRow')}</button>
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
          : status?.present ? <span className="text-ok">● {t('admin.cfgImagePresent')}{status.size ? ` · ${Math.round(status.size / 1e6)}MB` : ''}</span>
          : <span className="text-warn">○ {t('admin.cfgImageAbsent')}</span>}
        <button className="text-clay hover:underline disabled:opacity-40" disabled={busy !== null || dirty}
          onClick={pull}>{busy === 'pull' ? t('admin.cfgImagePulling') : t('admin.cfgImagePull')}</button>
      </div>
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
    ['admin.cleanup.rowPluginPrefs', rows.pluginPrefs],
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-semibold">{t('admin.cleanup.title')}</div>
        <button className="ml-auto text-xs border border-line rounded-lg px-2.5 py-1 hover:border-clay disabled:opacity-40"
          disabled={disabled} onClick={() => load()}>⟳ {t('admin.cleanup.rescan')}</button>
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
                  <td className="pr-2">{im.present ? <span className="text-ok">● {t('admin.cleanup.present')}</span> : <span className="text-txt3">○ {t('admin.cleanup.absent')}</span>}</td>
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
