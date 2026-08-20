import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { md } from '../lib/md';
import { useT } from '../lib/i18n';
import { type UploadState } from '../lib/api';
import { collectDrop, collectPick, type Collected } from '../lib/dropfiles';
import { confirmBigFolder, expandAllLazy, fmtBytes, joinRel, type TreeEntry, type TreeLevel } from '../lib/filetree';
import { Modal } from './Modal';
import { UploadProgress } from './UploadProgress';
import { IconChevronDown, IconChevronRight, IconFolder, IconFile, IconEye, IconTerminal, IconPencil, IconCheck, IconX } from '../lib/icons';

export const isImage = (n: string) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(n);
export const isMarkdown = (n: string) => /\.(md|markdown)$/i.test(n);
// mirrors the server's isText (routes/wiki.ts) — what the editor can safely round-trip as text
export const isTextFile = (n: string) => /\.(md|markdown|txt|json|ya?ml|csv|tsv)$/i.test(n);

// Resolve a relative asset href (e.g. a markdown image) against the containing file's directory.
// The href is URL-encoded in the source; server-side path sanitizing trims stray segment spaces.
export function resolveRelAsset(baseDir: string, rawSrc: string): string {
  let rel: string;
  try { rel = decodeURIComponent(rawSrc); } catch { rel = rawSrc; }
  rel = rel.replace(/^\.\//, '');
  return baseDir ? `${baseDir}/${rel}` : rel;
}
const dirOf = (p: string) => p.split('/').slice(0, -1).join('/');
// every ancestor folder of a path, outermost first: a/b/c.md → ['a', 'a/b']
const parentsOf = (p: string) => {
  const parts = p.split('/').slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
};

export type Source = { key: string; label: string };

// Generic file-explorer modal: a tree pane + a preview pane (image / markdown / text).
// `loadDir` returns ONE folder level, so opening a repo costs one listing instead of a whole-tree
// walk, and every folder starts closed. `initialDir`/`initialPath` open straight onto one file (a
// search hit jumping to a wiki article) — the ancestors are fetched on the way down.
// Optional write mode (admin surfaces): `uploadDir`+`onUpload` add a dropzone to that source's tab,
// `editDir`+`onSave` put an inline text editor in the preview. Both refresh the tree afterwards and
// report through `onChanged` so the owner can offer a follow-up action via `notice`.
export function FileExplorer({
  title, width = 780, sources, loadDir, fileUrl, blobUrl, onClose, initialDir, initialPath,
  uploadDir, onUpload, editDir, onSave, onChanged, notice,
}: {
  title: string;
  width?: number;
  sources: Source[];
  loadDir: (source: string, rel: string) => Promise<TreeLevel>;
  fileUrl: (dir: string, path: string) => string;
  blobUrl: (dir: string, path: string) => string;
  onClose: () => void;
  initialDir?: string;
  initialPath?: string;
  uploadDir?: string;
  onUpload?: (items: Collected[], onProgress: (s: UploadState) => void) => Promise<void>;
  editDir?: string;
  onSave?: (dir: string, path: string, content: string) => Promise<void>;
  onChanged?: () => void;
  notice?: React.ReactNode;
}) {
  const t = useT();
  const [dir, setDir] = useState(initialDir && sources.some((s) => s.key === initialDir) ? initialDir : sources[0].key);
  // one entry per folder the user has actually opened, keyed `<source>:<relPath>` ('' = the root)
  const [levels, setLevels] = useState<Record<string, TreeLevel>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [expanding, setExpanding] = useState(false);
  const [partial, setPartial] = useState(false);   // expand-all left something closed
  const [sel, setSel] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [mdRaw, setMdRaw] = useState(false); // markdown: false=rendered, true=source
  const [draft, setDraft] = useState<string | null>(null); // non-null = editing the open file
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<UploadState | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);

  const key = (source: string, rel: string) => `${source}:${rel}`;

  // Fetch one level (cached unless `force`). Returns the level so a caller can walk further down.
  const fetchLevel = async (source: string, rel: string, force = false): Promise<TreeLevel | null> => {
    const k = key(source, rel);
    if (!force && levels[k]) return levels[k];
    setBusyPath(rel);
    try {
      const lv = await loadDir(source, rel);
      setLevels((m) => ({ ...m, [k]: lv }));
      return lv;
    } catch (e: any) { useStore.getState().setError(e.message); return null; }
    finally { setBusyPath(null); }
  };

  // the root of whichever source tab is showing
  useEffect(() => { void fetchLevel(dir, ''); }, [dir]);

  // A folder the user just clicked: warn before painting thousands of rows, then load it once.
  const toggleDir = async (rel: string, entry: TreeEntry) => {
    const k = key(dir, rel);
    if (open[k]) { setOpen((m) => ({ ...m, [k]: false })); return; }
    if (!levels[k] && !confirmBigFolder(entry.name, entry.count)) return;
    setOpen((m) => ({ ...m, [k]: true }));
    if (!levels[k]) await fetchLevel(dir, rel);
  };

  // Opens every folder of the current source, fetching the ones not seen yet. Folders over the
  // warning size stay closed — the walk works in plain rel space, so the keys are mapped in and out.
  const expandAll = async () => {
    setExpanding(true);
    try {
      const mine: Record<string, TreeLevel> = {};
      for (const [k, v] of Object.entries(levels)) if (k.startsWith(`${dir}:`)) mine[k.slice(dir.length + 1)] = v;
      const r = await expandAllLazy((rel) => loadDir(dir, rel).catch((e) => { useStore.getState().setError(e.message); return null; }), mine);
      setLevels((m) => ({ ...m, ...Object.fromEntries(Object.entries(r.levels).map(([rel, v]) => [key(dir, rel), v])) }));
      setOpen(Object.fromEntries(Object.entries(r.open).map(([rel, v]) => [key(dir, rel), v])));
      setPartial(r.partial);
    } finally { setExpanding(false); }
  };

  // Drop everything opened so far, so the next open re-reads from disk (after an upload or a save).
  const refreshTree = async () => {
    setLevels({});
    setOpen({});
    await fetchLevel(dir, '', true);
  };

  const openFile = async (p: string) => {
    setSel(p); setFile(null); setMdRaw(false); setDraft(null);
    if (isImage(p)) return; // rendered via <img>, no text fetch
    setLoading(true);
    try {
      const r = await fetch(fileUrl(dir, p), { credentials: 'same-origin' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || r.statusText);
      setFile(d);
    } catch (e: any) { useStore.getState().setError(e.message); }
    finally { setLoading(false); }
  };

  const canUpload = !!onUpload && dir === uploadDir;
  const canEdit = !!onSave && dir === editDir && !!sel && !isImage(sel) && isTextFile(sel) && !!file;

  const upload = async (items: Collected[]) => {
    if (!onUpload || !items.length) return;
    try {
      await onUpload(items, setProgress);
      await refreshTree();
      onChanged?.();
    } catch (e: any) { useStore.getState().setError(e.message); }
    finally { setProgress(null); if (fileRef.current) fileRef.current.value = ''; if (dirRef.current) dirRef.current.value = ''; }
  };

  const save = async () => {
    if (!onSave || !sel || draft === null) return;
    setSaving(true);
    try {
      await onSave(dir, sel, draft);
      setFile({ name: sel, content: draft });
      setDraft(null);
      await refreshTree();
      onChanged?.();
    } catch (e: any) { useStore.getState().setError(e.message); }
    finally { setSaving(false); }
  };

  // Search hit: walk down to the file's folder one listing at a time, open those folders, preview it.
  useEffect(() => {
    if (!initialPath) return;
    let live = true;
    void (async () => {
      for (const p of parentsOf(initialPath)) {
        if (!live) return;
        await fetchLevel(dir, p);
        setOpen((m) => ({ ...m, [key(dir, p)]: true }));
      }
      if (live) await openFile(initialPath);
    })();
    return () => { live = false; };
  }, [initialPath]);

  const rootLevel = levels[key(dir, '')];

  const renderLevel = (rel: string, depth: number): React.ReactNode => {
    const lv = levels[key(dir, rel)];
    if (!lv) return null;
    return (
      <>
        {lv.entries.map((e) => {
          const p = joinRel(rel, e.name);
          const k = key(dir, p);
          if (!e.dir) {
            return (
              <div key={p} className={`flex items-center gap-1 py-0.5 cursor-pointer rounded text-xs ${sel === p ? 'bg-claysoft text-clay' : 'hover:bg-line'}`}
                style={{ paddingLeft: depth * 12 + 18 }} onClick={() => void openFile(p)} title={p}>
                <IconFile size={14} className="text-txt3 shrink-0" /><span className="truncate flex-1">{e.name}</span>
                <span className="text-txt3 text-[10px]">{fmtBytes(e.size)}</span>
              </div>
            );
          }
          return (
            <div key={p}>
              <div className="flex items-center gap-1 py-0.5 cursor-pointer hover:bg-line rounded text-xs"
                style={{ paddingLeft: depth * 12 + 4 }} onClick={() => void toggleDir(p, e)}>
                <span className="text-txt3 w-3 inline-flex">{open[k] ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}</span>
                <IconFolder size={14} className="text-txt3 shrink-0" />
                <span className="truncate">{e.name}</span>
                <span className="text-txt3 text-[10px] ml-1">{busyPath === p ? '…' : e.count}</span>
              </div>
              {open[k] && renderLevel(p, depth + 1)}
            </div>
          );
        })}
        {lv.truncated && (
          <div className="text-[10px] text-warn px-2 py-0.5" style={{ paddingLeft: depth * 12 + 18 }}>{t('files.truncated')}</div>
        )}
      </>
    );
  };

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={title} width={width}>
      {sources.length > 1 && (
        <div className="flex gap-2 mb-2 text-xs">
          {sources.map((s) => (
            <button key={s.key} className={`px-2.5 py-1 rounded ${dir === s.key ? 'bg-clay text-white' : 'bg-line text-txt2'}`}
              onClick={() => { setDir(s.key); setSel(null); setFile(null); }}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      {canUpload && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={async (e) => { e.preventDefault(); setDragOver(false); await upload(await collectDrop(e.dataTransfer)); }}
          className={`border-2 border-dashed rounded-lg px-3 py-2 mb-2 flex flex-wrap items-center justify-center gap-2 text-xs transition-colors ${dragOver ? 'border-clay bg-claysoft' : 'border-line'}`}>
          <span className="text-txt2 inline-flex items-center gap-1"><IconFolder size={14} />{t('fileExplorer.dropZone')}</span>
          <button className="btn-ghost !py-0.5 !text-[11px]" disabled={progress !== null} onClick={() => fileRef.current?.click()}>{t('fileExplorer.chooseFiles')}</button>
          <button className="btn-ghost !py-0.5 !text-[11px]" disabled={progress !== null} onClick={() => dirRef.current?.click()}>{t('fileExplorer.chooseFolder')}</button>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => void upload(collectPick(e.target.files))} />
          <input ref={dirRef} type="file" multiple className="hidden"
            {...{ webkitdirectory: '', directory: '' } as any} onChange={(e) => void upload(collectPick(e.target.files))} />
        </div>
      )}
      {progress && <div className="mb-2"><UploadProgress s={progress} /></div>}
      {notice && <div className="mb-2">{notice}</div>}
      <div className="grid gap-2 h-[68vh] md:h-[60vh] grid-cols-1 grid-rows-[38%_minmax(0,1fr)] md:grid-cols-[260px_minmax(0,1fr)] md:grid-rows-1">
        <div className="border border-line rounded flex flex-col min-h-0 overflow-hidden">
          <div className="flex gap-3 px-2 py-1 border-b border-line text-[11px] shrink-0">
            <button className="text-txt3 hover:text-clay disabled:opacity-40" disabled={expanding} onClick={() => void expandAll()}>
              {expanding ? t('files.expanding') : t('common.expandAll')}
            </button>
            <button className="text-txt3 hover:text-clay" onClick={() => { setOpen({}); setPartial(false); }}>{t('common.collapseAll')}</button>
            <button className="text-txt3 hover:text-clay" onClick={() => void refreshTree()}>{t('fileExplorer.refresh')}</button>
          </div>
          <div className="overflow-auto scrolly p-1 min-h-0 flex-1">
            {!rootLevel && <div className="text-txt3 text-xs p-2">{t('fileExplorer.loading')}</div>}
            {rootLevel && !rootLevel.entries.length && <div className="text-txt3 text-xs p-2">{t('fileExplorer.noFiles')}</div>}
            {renderLevel('', 0)}
            {partial && <div className="text-[10px] text-warn px-2 py-1">{t('files.expandAllPartial')}</div>}
          </div>
        </div>
        <div className="border border-line rounded overflow-auto scrolly bg-bg min-w-0 min-h-0">
          {!sel && <div className="text-txt3 text-xs p-3">{t('fileExplorer.selectFilePrompt')}</div>}
          {sel && (
            <>
              <div className="sticky top-0 bg-card border-b border-line px-3 py-1.5 text-xs font-mono flex items-center gap-2">
                <span className="truncate flex-1">{sel}</span>
                {isMarkdown(sel) && !isImage(sel) && draft === null && (
                  <button className="shrink-0 px-1.5 py-0.5 rounded border border-line hover:text-clay inline-flex items-center gap-1" onClick={() => setMdRaw(!mdRaw)}>
                    {mdRaw ? <><IconEye size={12} />{t('fileExplorer.rendered')}</> : <><IconTerminal size={12} />{t('fileExplorer.source')}</>}
                  </button>
                )}
                {canEdit && draft === null && (
                  <button className="shrink-0 px-1.5 py-0.5 rounded border border-line hover:text-clay inline-flex items-center gap-1" onClick={() => setDraft(file!.content)}>
                    <IconPencil size={12} />{t('fileExplorer.edit')}
                  </button>
                )}
                {draft !== null && (
                  <>
                    <button className="shrink-0 px-1.5 py-0.5 rounded border border-line hover:text-clay inline-flex items-center gap-1 disabled:opacity-40" disabled={saving} onClick={save}>
                      <IconCheck size={12} />{saving ? t('fileExplorer.saving') : t('fileExplorer.save')}
                    </button>
                    <button className="shrink-0 px-1.5 py-0.5 rounded border border-line hover:text-danger inline-flex items-center gap-1 disabled:opacity-40" disabled={saving} onClick={() => setDraft(null)}>
                      <IconX size={12} />{t('common.cancel')}
                    </button>
                  </>
                )}
              </div>
              {draft !== null ? (
                <textarea className="w-full h-[calc(100%-30px)] min-h-[240px] bg-bg text-txt2 font-mono text-[11px] p-3 outline-none resize-none"
                  value={draft} spellCheck={false} autoFocus onChange={(e) => setDraft(e.target.value)} />
              ) : isImage(sel) ? (
                <div className="p-3">
                  <img src={blobUrl(dir, sel)} alt={sel} className="max-w-full h-auto rounded border border-line" />
                </div>
              ) : loading ? (
                <div className="text-txt3 text-xs p-3">{t('fileExplorer.loading')}</div>
              ) : file && isMarkdown(sel) && !mdRaw ? (
                <div className="p-3 text-sm break-words leading-relaxed" dangerouslySetInnerHTML={{ __html: md(file.content, { img: (s) => blobUrl(dir, resolveRelAsset(dirOf(sel), s)) }) }} />
              ) : file ? (
                <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-txt2 p-3">{file.content}</pre>
              ) : null}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
