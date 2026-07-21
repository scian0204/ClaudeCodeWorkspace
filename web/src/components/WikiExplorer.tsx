import { api } from '../lib/api';
import { FileExplorer } from './FileExplorer';

export function WikiExplorer({ topicId, onClose }: { topicId: string; onClose: () => void }) {
  return (
    <FileExplorer
      title="LLM Wiki 파일 탐색기"
      sources={[{ key: 'raw', label: '원본 raw' }, { key: 'wiki', label: '컴파일 wiki' }]}
      loadTree={() => api.get(`/api/wiki/topics/${topicId}/tree`)}
      fileUrl={(dir, p) => `/api/wiki/topics/${topicId}/file?dir=${dir}&path=${encodeURIComponent(p)}`}
      blobUrl={(dir, p) => `/api/wiki/topics/${topicId}/blob?dir=${dir}&path=${encodeURIComponent(p)}`}
      onClose={onClose}
    />
  );
}
