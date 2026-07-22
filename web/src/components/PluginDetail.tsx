import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { Modal } from './Modal';
import { FileExplorer } from './FileExplorer';

type Skill = { dir: string; name: string; description: string };
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
        title={`${d?.plugin.name || '플러그인'} · 파일`}
        sources={[{ key: 'files', label: '파일' }]}
        loadTree={() => api.get(`/api/plugins/${pluginId}/tree`).then((r) => ({ files: r.files }))}
        fileUrl={(_dir, p) => `/api/plugins/${pluginId}/file?path=${encodeURIComponent(p)}`}
        blobUrl={(_dir, p) => `/api/plugins/${pluginId}/blob?path=${encodeURIComponent(p)}`}
        onClose={() => setShowFiles(false)}
      />
    );
  }

  const git = d?.plugin.source === 'marketplace';
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={`🧩 ${d?.plugin.name || '플러그인'}`} width={640}>
      {!d ? <div className="text-txt3 text-sm p-4">불러오는 중…</div> : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap text-xs text-txt3">
            <span className="px-2 py-0.5 rounded-full bg-line">{d.plugin.scope === 'common' ? '공통' : '개인'}</span>
            <span className="px-2 py-0.5 rounded-full bg-line">{git ? 'git' : '업로드'}</span>
            {d.manifest?.version && <span>v{d.manifest.version}</span>}
            {d.manifest?.homepage && <a className="text-clay hover:underline" href={d.manifest.homepage} target="_blank" rel="noreferrer">홈페이지 ↗</a>}
          </div>
          {d.manifest?.description && <div className="text-sm text-txt2">{d.manifest.description}</div>}
          {d.plugin.repo && <div className="text-[11px] font-mono text-txt3 break-all">{d.plugin.repo}</div>}

          <div className="flex gap-2">
            <button className="btn-ghost !py-1.5 !text-xs" onClick={() => setShowFiles(true)}>📁 파일 트리 보기</button>
            {git && canUpdate && (
              <button className="btn-primary !py-1.5 !text-xs" disabled={updating} onClick={update}>
                {updating ? '업데이트 중…' : '⬇ 업데이트'}
              </button>
            )}
          </div>

          <div>
            <div className="font-semibold text-sm mb-1">
              스킬 {d.skills.length > 0 && <span className="text-txt3 font-normal">({d.skills.length})</span>}
            </div>
            {d.skills.length === 0 ? (
              <div className="text-xs text-txt3">노출된 스킬 없음 (commands/agents만 있을 수 있음).</div>
            ) : (
              <div className="space-y-1.5 max-h-[40vh] overflow-y-auto scrolly">
                {d.skills.map((s) => (
                  <div key={s.dir} className="border border-line rounded-lg px-3 py-2">
                    <div className="text-sm font-medium">{s.name}</div>
                    {s.description && <div className="text-xs text-txt3 mt-0.5">{s.description}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
