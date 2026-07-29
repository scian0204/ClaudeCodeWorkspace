import type { UploadState } from '../lib/api';
import { useT } from '../lib/i18n';

// Two-bar upload progress: overall (by bytes, with file counter) + the current file (with its %).
// Shared by every bulk-file uploader (session import, wiki staging).
export function UploadProgress({ s }: { s: UploadState }) {
  const t = useT();
  return (
    <div className="mb-2 space-y-1">
      <div className="flex justify-between text-[11px] text-txt3">
        <span>{t('common.uploadOverall')} ({Math.min(s.index + 1, s.total)}/{s.total})</span>
        <span>{s.overall}%</span>
      </div>
      <div className="h-1.5 bg-line rounded overflow-hidden">
        <div className="h-full bg-clay transition-all" style={{ width: `${s.overall}%` }} />
      </div>
      <div className="flex justify-between text-[11px] text-txt3">
        <span className="truncate max-w-[70%]" title={s.name}>{s.name}</span>
        <span>{s.file}%</span>
      </div>
      <div className="h-1 bg-line rounded overflow-hidden">
        <div className="h-full bg-clay/60 transition-all" style={{ width: `${s.file}%` }} />
      </div>
    </div>
  );
}
