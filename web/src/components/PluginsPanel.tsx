import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { PluginDetail } from './PluginDetail';
import { MobileMenuButton } from '../lib/ui';
import { useT } from '../lib/i18n';
import { IconArrowLeft, IconPuzzle, IconCheck, IconLock, IconGlobe, IconRefresh, IconChevronRight } from '../lib/icons';

type Scope = 'common' | 'user' | 'project';
type ProjectRef = { id: string; name: string };

export function PluginsPanel() {
  const setPanel = useStore((s) => s.setPanel);
  const user = useStore((s) => s.user)!;
  const projects = useStore((s) => s.projects);
  const isAdmin = user.role === 'admin';
  const [data, setData] = useState<any>({ common: [], mine: [], projects: [], prefs: [] });
  const [mkt, setMkt] = useState<any>({ common: [], mine: [] });
  const [detail, setDetail] = useState<{ id: string; canUpdate: boolean } | null>(null);
  const t = useT();

  const load = async () => {
    const [p, m] = await Promise.all([api.get('/api/plugins'), api.get('/api/marketplaces')]);
    setData({ projects: [], ...p }); setMkt(m);
  };
  useEffect(() => { load().catch((e) => useStore.getState().setError(e.message)); }, []);
  const err = (e: any) => useStore.getState().setError(e.message || String(e));

  const prefMap = new Map<string, number>(data.prefs.map((p: any) => [p.pluginId, p.enabled]));
  // where the caller may install/remove project plugins: admins anywhere, members on their own projects
  const manageable: ProjectRef[] = isAdmin ? [...projects.common, ...projects.mine] : projects.mine;
  const manageableIds = new Set(manageable.map((p) => p.id));
  const projName = Object.fromEntries([...projects.common, ...projects.mine].map((p) => [p.id, p.name]));

  return (
    <div className="h-full overflow-y-auto scrolly">
      <div className="flex items-center gap-3 px-4 md:px-5 py-3 border-b border-line sticky top-0 bg-panel z-10">
        <MobileMenuButton />
        <button className="toolbtn" aria-label={t('common.back')} onClick={() => setPanel(null)}><IconArrowLeft /></button>
        <div className="font-semibold inline-flex items-center gap-1.5"><IconPuzzle size={16} />{t('plugins.title')}</div>
      </div>
      <div className="max-w-[860px] mx-auto p-4 md:p-5 space-y-6">
        {/* COMMON */}
        <div className="bg-card border border-line rounded-xl p-4">
          <div className="font-semibold mb-1">{t('plugins.commonPlugins')} {isAdmin ? '' : t('plugins.commonPluginsUserNote')}</div>
          <div className="text-xs text-txt3 mb-3">{isAdmin ? t('plugins.commonAdminDesc') : t('plugins.commonUserDesc')}</div>
          {isAdmin && <InstallForms scope="common" mkt={mkt.common} onChange={load} onErr={err} />}
          <div className="mt-3 space-y-1.5">
            {data.common.length === 0 && <Empty />}
            {data.common.map((p: any) => {
              const pref = prefMap.has(p.id) ? prefMap.get(p.id) === 1 : true;
              return (
                <Row key={p.id} p={p}>
                  <button className="text-[11px] text-txt3 hover:text-clay" onClick={() => setDetail({ id: p.id, canUpdate: isAdmin })}>{t('plugins.detail')}</button>
                  {isAdmin ? (
                    <>
                      <Toggle on={!!p.enabled} label={t('plugins.enabledLabel')} onClick={async () => { await api.post(`/api/plugins/${p.id}/enabled`, { enabled: !p.enabled }); load(); }} />
                      <Toggle on={!!p.forced} label={t('plugins.required')} onClick={async () => { await api.post(`/api/plugins/${p.id}/forced`, { forced: !p.forced }); load(); }} />
                      <button className="text-xs text-txt3 hover:text-danger" onClick={async () => { await api.del(`/api/plugins/${p.id}`); load(); }}>{t('common.delete')}</button>
                    </>
                  ) : (
                    p.forced ? <span className="text-[11px] text-clay inline-flex items-center gap-1"><IconLock size={11} />{t('plugins.required')}</span>
                      : <Toggle on={pref} label={t('plugins.usePref')} onClick={async () => { await api.post(`/api/plugins/${p.id}/pref`, { enabled: !pref }).catch(err); load(); }} />
                  )}
                </Row>
              );
            })}
          </div>
        </div>

        {/* PROJECT — applies to every chat pointed at that project, whoever owns it */}
        <div className="bg-card border border-line rounded-xl p-4">
          <div className="font-semibold mb-1">{t('plugins.projectPlugins')}</div>
          <div className="text-xs text-txt3 mb-3">{t('plugins.projectDesc')}</div>
          {manageable.length > 0 && <InstallForms scope="project" mkt={mkt.mine} projects={manageable} onChange={load} onErr={err} />}
          <div className="mt-3 space-y-1.5">
            {data.projects.length === 0 && <Empty />}
            {data.projects.map((p: any) => {
              const editable = isAdmin || manageableIds.has(p.projectId);
              return (
                <Row key={p.id} p={p} tag={projName[p.projectId] || p.projectId}>
                  <button className="text-[11px] text-txt3 hover:text-clay" onClick={() => setDetail({ id: p.id, canUpdate: editable })}>{t('plugins.detail')}</button>
                  {editable ? (
                    <>
                      <Toggle on={!!p.enabled} label={t('plugins.enabledLabel')} onClick={async () => { await api.post(`/api/plugins/${p.id}/enabled`, { enabled: !p.enabled }).catch(err); load(); }} />
                      <button className="text-xs text-txt3 hover:text-danger" onClick={async () => { await api.del(`/api/plugins/${p.id}`).catch(err); load(); }}>{t('common.delete')}</button>
                    </>
                  ) : (
                    !p.enabled && <span className="text-[11px] text-txt3">{t('plugins.disabledLabel')}</span>
                  )}
                </Row>
              );
            })}
          </div>
        </div>

        {/* PERSONAL */}
        <div className="bg-card border border-line rounded-xl p-4">
          <div className="font-semibold mb-1">{t('plugins.personalPlugins')}</div>
          <div className="text-xs text-txt3 mb-3">{t('plugins.personalDesc')}</div>
          <InstallForms scope="user" mkt={mkt.mine} onChange={load} onErr={err} />
          <div className="mt-3 space-y-1.5">
            {data.mine.length === 0 && <Empty />}
            {data.mine.map((p: any) => (
              <Row key={p.id} p={p}>
                <button className="text-[11px] text-txt3 hover:text-clay" onClick={() => setDetail({ id: p.id, canUpdate: true })}>{t('plugins.detail')}</button>
                <Toggle on={!!p.enabled} label={t('plugins.enabledLabel')} onClick={async () => { await api.post(`/api/plugins/${p.id}/enabled`, { enabled: !p.enabled }); load(); }} />
                <button className="text-xs text-txt3 hover:text-danger" onClick={async () => { await api.del(`/api/plugins/${p.id}`); load(); }}>{t('common.delete')}</button>
              </Row>
            ))}
          </div>
        </div>
      </div>
      {detail && (
        <PluginDetail
          pluginId={detail.id}
          canUpdate={detail.canUpdate}
          onClose={() => setDetail(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function InstallForms({ scope, mkt, projects, onChange, onErr }: {
  scope: Scope; mkt: any[]; projects?: ProjectRef[]; onChange: () => void; onErr: (e: any) => void;
}) {
  const [git, setGit] = useState({ name: '', repo: '' });
  const [mk, setMk] = useState('');
  const [adding, setAdding] = useState(false);
  const [upName, setUpName] = useState('');
  const [projectId, setProjectId] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const t = useT();

  // every install in this form goes to the same target — scope, plus the project it belongs to
  const target = scope === 'project' ? { scope, projectId } : { scope };
  const needProject = scope === 'project' && !projectId;
  const guard = () => { if (needProject) { onErr(new Error(t('plugins.selectProject'))); return true; } return false; };

  // The name field carries a plugin name or "<plugin>@<marketplace>"; the git field is only needed to
  // install straight from a repo. Either one alone is enough — the server resolves the rest.
  const installGit = async () => {
    if (!git.name && !git.repo) return;
    if (guard()) return;
    try { await api.post('/api/plugins/install', { ...target, ...git }); setGit({ name: '', repo: '' }); onChange(); } catch (e) { onErr(e); }
  };
  // registering clones the marketplace repo, so this one waits on the network
  const addMk = async () => {
    if (!mk.trim() || adding) return;
    setAdding(true);
    // a marketplace is registered for a person or for everyone; there is no project-scoped market,
    // so a project form registers it personally and installs from it
    try { await api.post('/api/marketplaces', { scope: scope === 'common' ? 'common' : 'user', ref: mk.trim() }); setMk(''); onChange(); }
    catch (e) { onErr(e); } finally { setAdding(false); }
  };
  const upload = async () => {
    const f = fileRef.current?.files?.[0]; if (!f || !upName) return;
    if (guard()) return;
    const form = new FormData(); form.append('scope', scope); form.append('name', upName); form.append('file', f);
    if (scope === 'project') form.append('projectId', projectId);
    try { await api.upload('/api/plugins/upload', form); setUpName(''); if (fileRef.current) fileRef.current.value = ''; onChange(); } catch (e) { onErr(e); }
  };

  return (
    <div className="space-y-2 border-t border-line pt-3">
      {scope === 'project' && (
        <select className="input !py-1.5 !text-xs" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">{t('plugins.selectProject')}</option>
          {(projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
      {mkt.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] text-txt3">{t('plugins.marketsLabel')}</div>
          {mkt.map((m) => <MarketRow key={m.id} m={m} target={target} disabled={needProject} onChange={onChange} onErr={onErr} />)}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-1.5">
        <input className="input !py-1.5 !text-xs" placeholder={t('plugins.marketRefPlaceholder')} value={mk} onChange={(e) => setMk(e.target.value)} />
        <button className="btn-ghost !py-1.5 !text-xs" disabled={adding} onClick={addMk}>{adding ? t('plugins.marketSyncing') : t('plugins.addMarket')}</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-1.5">
        <input className="input !py-1.5 !text-xs" placeholder={t('plugins.pluginNamePlaceholder')} value={git.name} onChange={(e) => setGit({ ...git, name: e.target.value })} />
        <input className="input !py-1.5 !text-xs" placeholder={t('plugins.repoPlaceholder')} value={git.repo} onChange={(e) => setGit({ ...git, repo: e.target.value })} />
        <button className="btn-primary !py-1.5 !text-xs" onClick={installGit}>{t('plugins.install')}</button>
      </div>
      <div className="text-[11px] text-txt3 leading-relaxed">{t('plugins.refHint')}</div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-1.5">
        <input className="input !py-1.5 !text-xs" placeholder={t('plugins.uploadNamePlaceholder')} value={upName} onChange={(e) => setUpName(e.target.value)} />
        <input ref={fileRef} type="file" accept=".tar.gz,.tgz" className="text-xs text-txt2" />
        <button className="btn-ghost !py-1.5 !text-xs" onClick={upload}>{t('plugins.uploadTarGz')}</button>
      </div>
    </div>
  );
}

// One registered marketplace: pull its repo's latest (new plugins pushed there appear after that),
// browse what it offers, install one by a button, or drop the registration.
function MarketRow({ m, target, disabled, onChange, onErr }: {
  m: any; target: { scope: Scope; projectId?: string }; disabled?: boolean; onChange: () => void; onErr: (e: any) => void;
}) {
  const [cat, setCat] = useState<{ plugins: any[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = useT();

  // ?refresh=1 pulls the repo first; without it the cached clone answers (and is cloned if missing)
  const load = async (refresh: boolean) => {
    setBusy(true);
    try { setCat(await api.get(`/api/marketplaces/${m.id}/plugins${refresh ? '?refresh=1' : ''}`)); setOpen(true); }
    catch (e) { onErr(e); } finally { setBusy(false); }
  };
  const install = async (name: string) => {
    setBusy(true);
    try { await api.post('/api/plugins/install', { ...target, marketplaceId: m.id, plugin: name }); onChange(); }
    catch (e) { onErr(e); } finally { setBusy(false); }
  };

  return (
    <div className="border-b border-line last:border-0 pb-1">
      <div className="flex items-center gap-2 text-xs">
        <button className="text-txt3 shrink-0 inline-flex" aria-label={t('plugins.marketBrowse')} disabled={busy}
          onClick={() => (open ? setOpen(false) : (cat ? setOpen(true) : load(false)))}>
          <span className={`inline-flex transition-transform ${open ? 'rotate-90' : ''}`}><IconChevronRight size={13} /></span>
        </button>
        <IconGlobe size={12} className="text-txt3 shrink-0" />
        <span className="text-txt2 shrink-0">{m.name}</span>
        {m.url && <span className="text-txt3 truncate" title={m.url}>{m.url}</span>}
        <div className="ml-auto flex items-center gap-3 shrink-0">
          <button className="text-[11px] text-txt3 hover:text-clay inline-flex items-center gap-1" disabled={busy} onClick={() => load(true)}>
            <IconRefresh size={11} />{busy ? t('plugins.marketSyncing') : t('plugins.marketUpdate')}
          </button>
          <button className="text-[11px] text-txt3 hover:text-danger" disabled={busy}
            onClick={async () => { try { await api.del(`/api/marketplaces/${m.id}`); onChange(); } catch (e) { onErr(e); } }}>{t('common.delete')}</button>
        </div>
      </div>
      {open && cat && (
        <div className="mt-1 ml-6 space-y-1">
          {cat.plugins.length === 0 && <div className="text-[11px] text-txt3">{t('plugins.marketNoPlugins')}</div>}
          {cat.plugins.map((p: any) => (
            <div key={p.name} className="flex items-start gap-2 text-[11px]">
              <IconPuzzle size={11} className="text-txt3 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-txt2">{p.name}</div>
                {p.description && <div className="text-txt3 line-clamp-2">{p.description}</div>}
              </div>
              <button className="ml-auto shrink-0 text-[11px] text-clay hover:underline disabled:opacity-40" disabled={busy || disabled}
                title={disabled ? t('plugins.selectProject') : undefined} onClick={() => install(p.name)}>{t('plugins.install')}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ p, tag, children }: { p: any; tag?: string; children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2 text-sm border-b border-line py-1.5 flex-wrap">
      <IconPuzzle size={15} className="text-txt2 shrink-0" /><span className="font-medium">{p.name}</span>
      {tag && <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 bg-line text-txt2">{tag}</span>}
      <span className="text-[10px] text-txt3">{p.source === 'local' ? t('plugins.sourceUpload') : 'git'}</span>
      <div className="ml-auto flex items-center gap-3">{children}</div>
    </div>
  );
}
function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`text-[11px] px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${on ? 'bg-oksoft border-ok text-ok' : 'border-line text-txt3'}`}>
      {on && <IconCheck size={12} />}{label}
    </button>
  );
}
function Empty() { const t = useT(); return <div className="text-xs text-txt3">{t('common.none')}</div>; }
