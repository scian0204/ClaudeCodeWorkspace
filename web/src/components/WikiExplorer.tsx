import { useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { useT } from '../lib/i18n';
import { IconLink, IconRefresh, IconWarning } from '../lib/icons';
import { FileExplorer } from './FileExplorer';
import { WikiGraph } from './WikiGraph';

// Wiki topic file explorer. Two views of the same topic: the file tree, and the link graph of the
// compiled articles (WikiGraph) — clicking a dot there comes back here with that article open.
// Admins additionally get source management on raw/: drop in new files and edit existing text
// sources in place. Neither recompiles on its own (the compile is a Claude run), so a change raises
// a "recompile needed" bar with the button right there.
export function WikiExplorer({ topicId, onClose }: { topicId: string; onClose: () => void }) {
  const t = useT();
  const isAdmin = useStore((s) => s.user?.role === 'admin');
  const editEnabled = useStore((s) => s.wikiSourceEditEnabled);
  const compiling = useStore((s) => s.wikiTopics.find((x) => x.id === topicId)?.compileStatus) === 'compiling';
  const [dirty, setDirty] = useState(false);
  const [graph, setGraph] = useState(false);
  const [jump, setJump] = useState<string | null>(null); // article picked in the graph, opened here
  const canWrite = isAdmin && editEnabled;

  const recompile = async () => {
    try { await api.post(`/api/wiki/topics/${topicId}/recompile`); setDirty(false); }
    catch (e: any) { useStore.getState().setError(e.message); }
  };

  if (graph) {
    return (
      <WikiGraph
        topicId={topicId} onClose={onClose} onFiles={() => setGraph(false)}
        onOpenFile={(p) => { setJump(p); setGraph(false); }}
      />
    );
  }

  return (
    <FileExplorer
      title={t('wikiExplorer.title')}
      initialDir={jump ? 'wiki' : undefined}
      initialPath={jump || undefined}
      titleExtra={
        <button className="pill inline-flex items-center gap-1" onClick={() => setGraph(true)}>
          <IconLink size={13} />{t('wikiExplorer.graphTab')}
        </button>
      }
      sources={[{ key: 'raw', label: t('wikiExplorer.sourceRaw') }, { key: 'wiki', label: t('wikiExplorer.sourceWiki') }]}
      loadDir={(src, rel) => api.get(`/api/wiki/topics/${topicId}/tree?dir=${src}&path=${encodeURIComponent(rel)}`)}
      fileUrl={(dir, p) => `/api/wiki/topics/${topicId}/file?dir=${dir}&path=${encodeURIComponent(p)}`}
      blobUrl={(dir, p) => `/api/wiki/topics/${topicId}/blob?dir=${dir}&path=${encodeURIComponent(p)}`}
      onClose={onClose}
      uploadDir={canWrite ? 'raw' : undefined}
      editDir={canWrite ? 'raw' : undefined}
      onUpload={canWrite ? (items, onProgress) => api.uploadFiles(`/api/wiki/topics/${topicId}/files`, items, onProgress) : undefined}
      onSave={canWrite ? (_dir, p, content) => api.put(`/api/wiki/topics/${topicId}/file`, { path: p, content }) : undefined}
      onChanged={canWrite ? () => setDirty(true) : undefined}
      notice={canWrite && dirty ? (
        <div className="flex items-center gap-2 text-[11px] text-txt2 bg-claysoft border border-line rounded px-2 py-1.5">
          <IconWarning size={13} className="text-clay shrink-0" />
          <span className="flex-1">{t('wikiExplorer.recompileNeeded')}</span>
          <button className="pill inline-flex items-center gap-1 disabled:opacity-40" disabled={compiling} onClick={recompile}>
            <IconRefresh size={12} />{compiling ? t('chat.compiling') : t('chat.recompile')}
          </button>
        </div>
      ) : undefined}
    />
  );
}
