import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { Modal } from './Modal';
import { FileExplorer } from './FileExplorer';
import { useT } from '../lib/i18n';
import { IconPuzzle, IconFolder, IconDownload, IconLink, IconChevronRight } from '../lib/icons';

// total/mine/byUser ride along only while skill-usage counting is on (admin feature flag);
// byUser is admin-only — it is other members' activity.
type Skill = {
  dir: string; name: string; description: string;
  total?: number; mine?: number; byUser?: { userId: string; name: string; count: number }[];
};
type Detail = {
  plugin: { id: string; name: string; scope: string; source: string; repo: string | null };
  manifest: { name?: string; description?: string; version?: string; homepage?: string } | null;
  skills: Skill[];
};

// Plugin detail modal: manifest + exposed skills, with a file-tree view (reuses FileExplorer)
// and an in-place update button for git-installed plugins.
export function PluginDetail({ pluginId, canUpdate, onClose, onChanged }: {
  pluginId: string; canUpdate: boolean; onClose: () => void; onChanged: () => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  const [updating, setUpdating] = useState(false);
  const t = useT();
  const err = (e: any) => useStore.getState().setError(e.message || String(e));

  const reload = () => api.get(`/api/plugins/${pluginId}/detail`).then(setD).catch(err);
  useEffect(() => { reload(); }, [pluginId]);

  const update = async () => {
    setUpdating(true);
    try { await api.post(`/api/plugins/${pluginId}/update`); await reload(); onChanged(); }
    catch (e) { err(e); } finally { setUpdating(false); }
  };

  // file-tree view swaps in the shared explorer modal; closing it returns to detail
  if (showFiles) {
    return (
      <FileExplorer
        title={t('pluginDetail.filesTitle', { name: d?.plugin.name || t('pluginDetail.fallbackPlugin') })}
        sources={[{ key: 'files', label: t('pluginDetail.files') }]}
        loadDir={(_src, rel) => api.get(`/api/plugins/${pluginId}/tree?path=${encodeURIComponent(rel)}`)}
        fileUrl={(_dir, p) => `/api/plugins/${pluginId}/file?path=${encodeURIComponent(p)}`}
        blobUrl={(_dir, p) => `/api/plugins/${pluginId}/blob?path=${encodeURIComponent(p)}`}
        onClose={() => setShowFiles(false)}
      />
    );
  }

  const git = d?.plugin.source === 'marketplace';
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={<span className="inline-flex items-center gap-1.5"><IconPuzzle size={16} />{t('pluginDetail.title', { name: d?.plugin.name || t('pluginDetail.fallbackPlugin') })}</span>} width={640}>
      {!d ? <div className="text-txt3 text-sm p-4">{t('pluginDetail.loading')}</div> : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap text-xs text-txt3">
            <span className="px-2 py-0.5 rounded-full bg-line">{d.plugin.scope === 'common' ? t('pluginDetail.scopeCommon') : t('pluginDetail.scopePersonal')}</span>
            <span className="px-2 py-0.5 rounded-full bg-line">{git ? 'git' : t('pluginDetail.sourceUpload')}</span>
            {d.manifest?.version && <span>v{d.manifest.version}</span>}
            {d.manifest?.homepage && <a className="text-clay hover:underline inline-flex items-center gap-1" href={d.manifest.homepage} target="_blank" rel="noreferrer"><IconLink size={12} />{t('pluginDetail.homepage')}</a>}
          </div>
          {d.manifest?.description && <div className="text-sm text-txt2">{d.manifest.description}</div>}
          {d.plugin.repo && <div className="text-[11px] font-mono text-txt3 break-all">{d.plugin.repo}</div>}

          <div className="flex gap-2">
            <button className="btn-ghost !py-1.5 !text-xs inline-flex items-center gap-1" onClick={() => setShowFiles(true)}><IconFolder size={13} />{t('pluginDetail.viewFileTree')}</button>
            {git && canUpdate && (
              <button className="btn-primary !py-1.5 !text-xs inline-flex items-center gap-1" disabled={updating} onClick={update}>
                <IconDownload size={13} />{updating ? t('pluginDetail.updating') : t('pluginDetail.update')}
              </button>
            )}
          </div>

          <div>
            <div className="font-semibold text-sm mb-1">
              {t('pluginDetail.skills')} {d.skills.length > 0 && <span className="text-txt3 font-normal">({d.skills.length})</span>}
            </div>
            {d.skills.length === 0 ? (
              <div className="text-xs text-txt3">{t('pluginDetail.noSkills')}</div>
            ) : (
              <div className="space-y-1.5 max-h-[40vh] overflow-y-auto scrolly">
                {d.skills.map((s) => <SkillRow key={s.dir} s={s} />)}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

// One skill in the list. With usage counting on it expands into that skill's detail: the workspace
// total sits in the row, the viewer's own count and (admins only) the per-user breakdown inside.
// Counting off → the server sends no counters, so the row stays a plain, non-expandable card.
function SkillRow({ s }: { s: Skill }) {
  const t = useT();
  if (s.total == null) {
    return (
      <div className="border border-line rounded-lg px-3 py-2">
        <div className="text-sm font-medium">{s.name}</div>
        {s.description && <div className="text-xs text-txt3 mt-0.5">{s.description}</div>}
      </div>
    );
  }
  return (
    <details className="group border border-line rounded-lg px-3 py-2">
      <summary className="flex items-start gap-2 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
        <span className="text-txt3 mt-0.5 shrink-0 transition-transform group-open:rotate-90 inline-flex"><IconChevronRight size={13} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{s.name}</span>
          {s.description && <span className="block text-xs text-txt3 mt-0.5">{s.description}</span>}
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap shrink-0 ${s.total > 0 ? 'bg-claysoft text-clay' : 'bg-line text-txt3'}`}>
          {t('pluginDetail.usesTotal', { n: s.total })}
        </span>
      </summary>
      <div className="mt-2 pl-5 space-y-1.5 text-xs">
        <div className="text-txt2">{t('pluginDetail.usesMine', { n: s.mine ?? 0 })}</div>
        {s.byUser && (
          s.byUser.length === 0 ? <div className="text-txt3">{t('pluginDetail.usesNone')}</div> : (
            <div>
              <div className="text-txt3 mb-0.5">{t('pluginDetail.usesByUser')}</div>
              <div className="overflow-x-auto scrolly">
                <table className="w-full min-w-[200px]">
                  <tbody>
                    {s.byUser.map((r) => (
                      <tr key={r.userId} className="border-t border-line">
                        <td className="py-1 pr-2 break-all">{r.name}</td>
                        <td className="py-1 text-right tabular-nums whitespace-nowrap">{t('pluginDetail.usesCount', { n: r.count })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        )}
      </div>
    </details>
  );
}
