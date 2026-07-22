import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { FileExplorer } from './FileExplorer';

export function WikiExplorer({ topicId, onClose }: { topicId: string; onClose: () => void }) {
  const t = useT();
  return (
    <FileExplorer
      title={t('wikiExplorer.title')}
      sources={[{ key: 'raw', label: t('wikiExplorer.sourceRaw') }, { key: 'wiki', label: t('wikiExplorer.sourceWiki') }]}
      loadTree={() => api.get(`/api/wiki/topics/${topicId}/tree`)}
      fileUrl={(dir, p) => `/api/wiki/topics/${topicId}/file?dir=${dir}&path=${encodeURIComponent(p)}`}
      blobUrl={(dir, p) => `/api/wiki/topics/${topicId}/blob?dir=${dir}&path=${encodeURIComponent(p)}`}
      onClose={onClose}
    />
  );
}
