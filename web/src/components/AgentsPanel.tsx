import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { MobileMenuButton } from '../lib/ui';
import { useT } from '../lib/i18n';
import { IconArrowLeft, IconUsers, IconCheck, IconPencil } from '../lib/icons';

interface AgentRow {
  id: string; scope: 'common' | 'user' | 'project'; ownerId: string; projectId: string; name: string;
  description: string; prompt: string; tools: string; model: string | null; enabled: number;
}
type FsAgentRow = { name: string; description: string; model?: string; tools?: string; source: 'home' | 'project'; projectId?: string; file: string };
type FormState = { id: string | null; name: string; description: string; prompt: string; tools: string; model: string; projectId: string };
const emptyForm = (): FormState => ({ id: null, name: '', description: '', prompt: '', tools: '', model: '', projectId: '' });
const toForm = (a: AgentRow): FormState => ({
  id: a.id, name: a.name, description: a.description, prompt: a.prompt,
  tools: (() => { try { return (JSON.parse(a.tools) as string[]).join(', '); } catch { return ''; } })(),
  model: a.model || '', projectId: a.projectId || '',
});

// Team-agent management: admin-managed common agents (usable by everyone, invoked via the Task tool
// or as a session's main-thread persona) + per-user personal agents + per-project agents that apply
// to every session of the project. Mirrors PluginsPanel's layout.
export function AgentsPanel() {
  const setPanel = useStore((s) => s.setPanel);
  const user = useStore((s) => s.user)!;
  const projects = useStore((s) => s.projects);
  const isAdmin = user.role === 'admin';
  const [data, setData] = useState<{ common: AgentRow[]; mine: AgentRow[]; projects: AgentRow[]; files: FsAgentRow[] }>({ common: [], mine: [], projects: [], files: [] });
  const [models, setModels] = useState<Record<string, string>>({});
  const t = useT();

  const load = async () => setData({ projects: [], files: [], ...(await api.get('/api/agents')) });
  const listsVersion = useStore((s) => s.listsVersion); // someone changed an agent in another tab
  useEffect(() => {
    load().catch((e) => useStore.getState().setError(e.message));
    api.get('/api/config').then((cf) => { if (cf?.models) setModels(cf.models); }).catch(() => {});
  }, [listsVersion]);
  const err = (e: any) => useStore.getState().setError(e.message || String(e));

  // where the caller may create/edit project agents: admins anywhere, members on their own projects
  const manageable = isAdmin ? [...projects.common, ...projects.mine] : projects.mine;
  const manageableIds = new Set(manageable.map((p) => p.id));
  const projName = Object.fromEntries([...projects.common, ...projects.mine].map((p) => [p.id, p.name]));

  return (
    <div className="h-full overflow-y-auto scrolly">
      <div className="flex items-center gap-3 px-4 md:px-5 py-3 border-b border-line sticky top-0 bg-panel z-10">
        <MobileMenuButton />
        <button className="toolbtn" aria-label={t('common.back')} onClick={() => setPanel(null)}><IconArrowLeft /></button>
        <div className="font-semibold inline-flex items-center gap-1.5"><IconUsers size={16} />{t('agents.title')}</div>
      </div>
      <div className="max-w-[860px] mx-auto p-4 md:p-5 space-y-6">
        <ScopeCard
          title={t('agents.common')} desc={isAdmin ? t('agents.commonAdminDesc') : t('agents.commonUserDesc')}
          rows={data.common} canEdit={isAdmin} models={models} scope="common" onChange={load} onErr={err} />
        <ScopeCard
          title={t('agents.project')} desc={t('agents.projectDesc')}
          rows={data.projects} canEdit={manageable.length > 0} models={models} scope="project" onChange={load} onErr={err}
          projects={manageable} projName={projName} rowEditable={(a) => isAdmin || manageableIds.has(a.projectId)} />
        <ScopeCard
          title={t('agents.personal')} desc={t('agents.personalDesc')}
          rows={data.mine} canEdit models={models} scope="user" onChange={load} onErr={err} />
        {data.files.length > 0 && (
          <div className="bg-card border border-line rounded-xl p-4">
            <div className="font-semibold mb-1">{t('agents.files')}</div>
            <div className="text-xs text-txt3 mb-3">{t('agents.filesDesc')}</div>
            <div className="space-y-1.5">
              {data.files.map((a, i) => (
                <div key={`${a.source}:${a.projectId || ''}:${a.file}:${i}`} className="flex items-center gap-2 border border-line rounded-lg px-3 py-2 flex-wrap">
                  <code className="font-mono text-xs font-semibold shrink-0">{a.name}</code>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 bg-line text-txt2">
                    {a.source === 'home' ? t('agents.sourceHome') : (projName[a.projectId || ''] || a.projectId)}</span>
                  {a.model && <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: 'var(--claysoft)', color: 'var(--clay)' }}>{models[a.model] || a.model}</span>}
                  <span className="text-xs text-txt2 truncate flex-1 min-w-[120px]" title={a.file}>{a.description || a.file}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScopeCard({ title, desc, rows, canEdit, models, scope, onChange, onErr, projects, projName, rowEditable }: {
  title: string; desc: string; rows: AgentRow[]; canEdit: boolean;
  models: Record<string, string>; scope: 'common' | 'user' | 'project'; onChange: () => void; onErr: (e: any) => void;
  projects?: { id: string; name: string }[]; projName?: Record<string, string>; rowEditable?: (a: AgentRow) => boolean;
}) {
  const t = useT();
  const [form, setForm] = useState<FormState | null>(null);

  const save = async () => {
    if (!form) return;
    if (scope === 'project' && !form.id && !form.projectId) { onErr(new Error(t('agents.selectProject'))); return; }
    const body = {
      name: form.name.trim(), description: form.description.trim(), prompt: form.prompt.trim(),
      tools: form.tools.split(',').map((s) => s.trim()).filter(Boolean), model: form.model || null,
    };
    try {
      if (form.id) await api.patch(`/api/agents/${form.id}`, body);
      else await api.post('/api/agents', { scope, projectId: form.projectId || undefined, ...body });
      setForm(null); onChange();
    } catch (e) { onErr(e); }
  };

  return (
    <div className="bg-card border border-line rounded-xl p-4">
      <div className="font-semibold mb-1">{title}</div>
      <div className="text-xs text-txt3 mb-3">{desc}</div>
      {canEdit && !form && (
        <button className="btn-ghost !py-1.5 !text-xs" onClick={() => setForm(emptyForm())}>{t('agents.new')}</button>
      )}
      {canEdit && form && (
        <div className="space-y-1.5 border-t border-line pt-3">
          {scope === 'project' && !form.id && (
            <select className="input !py-1.5 !text-xs" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
              <option value="">{t('agents.selectProject')}</option>
              {(projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
            <input className="input !py-1.5 !text-xs font-mono" placeholder={t('agents.namePlaceholder')} value={form.name}
              disabled={!!form.id} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <select className="input !py-1.5 !text-xs" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}>
              <option value="">{t('agents.modelInherit')}</option>
              {/* An agent pinned to an id the current registry no longer names still has to show it —
                  otherwise the select renders blank and saving would silently reset it to inherit. */}
              {form.model && !models[form.model] && <option value={form.model}>{form.model}</option>}
              {Object.entries(models).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </div>
          <input className="input !py-1.5 !text-xs" placeholder={t('agents.descPlaceholder')} value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <textarea className="input !py-1.5 !text-xs font-mono min-h-[96px]" placeholder={t('agents.promptPlaceholder')} value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
          <input className="input !py-1.5 !text-xs font-mono" placeholder={t('agents.toolsPlaceholder')} value={form.tools}
            onChange={(e) => setForm({ ...form, tools: e.target.value })} />
          <div className="flex gap-2">
            <button className="btn-primary !py-1.5 !text-xs" onClick={() => void save()}>{form.id ? t('common.save') : t('agents.create')}</button>
            <button className="btn-ghost !py-1.5 !text-xs" onClick={() => setForm(null)}>{t('common.cancel')}</button>
          </div>
        </div>
      )}
      <div className="mt-3 space-y-1.5">
        {rows.length === 0 && <div className="text-xs text-txt3">{t('common.none')}</div>}
        {rows.map((a) => (
          <div key={a.id} className="flex items-center gap-2 border border-line rounded-lg px-3 py-2 flex-wrap">
            <code className="font-mono text-xs font-semibold shrink-0">{a.name}</code>
            {a.scope === 'project' && <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 bg-line text-txt2">{projName?.[a.projectId] || a.projectId}</span>}
            {a.model && <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: 'var(--claysoft)', color: 'var(--clay)' }}>{models[a.model] || a.model}</span>}
            <span className="text-xs text-txt2 truncate flex-1 min-w-[120px]">{a.description}</span>
            {(rowEditable ? rowEditable(a) : canEdit) ? (
              <span className="flex items-center gap-2 shrink-0">
                <button className={`text-[11px] inline-flex items-center gap-1 ${a.enabled ? 'text-ok' : 'text-txt3'}`}
                  onClick={async () => { try { await api.post(`/api/agents/${a.id}/enabled`, { enabled: !a.enabled }); onChange(); } catch (e) { onErr(e); } }}>
                  <IconCheck size={11} />{a.enabled ? t('agents.enabled') : t('agents.disabled')}
                </button>
                <button className="text-[11px] text-txt3 hover:text-clay inline-flex items-center gap-1" onClick={() => setForm(toForm(a))}><IconPencil size={11} />{t('common.edit')}</button>
                <button className="text-xs text-txt3 hover:text-danger"
                  onClick={async () => { if (!confirm(t('agents.deleteConfirm', { name: a.name }))) return; try { await api.del(`/api/agents/${a.id}`); onChange(); } catch (e) { onErr(e); } }}>{t('common.delete')}</button>
              </span>
            ) : (
              !a.enabled && <span className="text-[11px] text-txt3 shrink-0">{t('agents.disabled')}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
