import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { md } from '../lib/md';
import { useT } from '../lib/i18n';
import { type UploadState } from '../lib/api';
import { collectDrop, collectPick, type Collected } from '../lib/dropfiles';
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

export type FileItem = { name: string; size: number };
type Node = { name: string; path: string; dir: boolean; size: number; children: Node[] };

// build a nested tree from flat relative paths (docs/api/x.md -> docs > api > x.md)
export function buildTree(files: FileItem[]): Node[] {
  const root: Node = { name: '', path: '', dir: true, size: 0, children: [] };
  for (const f of files) {
    const parts = f.name.split('/');
    let cur = root;
    parts.forEach((part, i) => {
      const isLeaf = i === parts.length - 1;
      const p = parts.slice(0, i + 1).join('/');
      let child = cur.children.find((c) => c.name === part && c.dir === !isLeaf);
      if (!child) { child = { name: part, path: p, dir: !isLeaf, size: isLeaf ? f.size : 0, children: [] }; cur.children.push(child); }
      cur = child;
    });
  }
  const sort = (n: Node) => {
    n.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

function fmtSize(n: number) { return n >= 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}B`; }

// Collect every directory path in the tree (for expand-all / collapse-all).
export function allDirPaths(nodes: Node[]): string[] {
  const out: string[] = [];
  const walk = (n: Node) => { if (n.dir) { out.push(n.path); n.children.forEach(walk); } };
  nodes.forEach(walk);
  return out;
}

// Open state is controlled by the parent (a path->bool map) so expand-all/collapse-all can drive
// every node at once; an unset path falls back to the default (top level open, deeper closed).
function TreeNode({ node, depth, onOpen, selected, openMap, setOpenMap }: {
  node: Node; depth: number; onOpen: (p: string) => void; selected: string | null;
  openMap: Record<string, boolean>; setOpenMap: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  if (node.dir) {
    const open = openMap[node.path] ?? (depth < 1); // top level expanded by default
    return (
      <div>
        <div className="flex items-center gap-1 py-0.5 cursor-pointer hover:bg-line rounded text-xs"
          style={{ paddingLeft: depth * 12 + 4 }} onClick={() => setOpenMap((m) => ({ ...m, [node.path]: !(m[node.path] ?? (depth < 1)) }))}>
          <span className="text-txt3 w-3 inline-flex">{open ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}</span><IconFolder size={14} className="text-txt3 shrink-0" />
          <span className="truncate">{node.name}</span>
          <span className="text-txt3 text-[10px] ml-1">{node.children.length}</span>
        </div>
        {open && node.children.map((c) => <TreeNode key={c.path} node={c} depth={depth + 1} onOpen={onOpen} selected={selected} openMap={openMap} setOpenMap={setOpenMap} />)}
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-1 py-0.5 cursor-pointer rounded text-xs ${selected === node.path ? 'bg-claysoft text-clay' : 'hover:bg-line'}`}
      style={{ paddingLeft: depth * 12 + 18 }} onClick={() => onOpen(node.path)} title={node.path}>
      <IconFile size={14} className="text-txt3 shrink-0" /><span className="truncate flex-1">{node.name}</span>
      <span className="text-txt3 text-[10px]">{fmtSize(node.size)}</span>
    </div>
  );
}

export type Source = { key: string; label: string };

// Generic file-explorer modal: a tree pane + a preview pane (image / markdown / text).
// `loadTree` returns a map keyed by each source.key; single source hides the tab bar.
// `initialDir`/`initialPath` open straight onto one file (a search hit jumping to a wiki article).
// Optional write mode (admin surfaces): `uploadDir`+`onUpload` add a dropzone to that source's tab,
// `editDir`+`onSave` put an inline text editor in the preview. Both refresh the tree afterwards and
// report through `onChanged` so the owner can offer a follow-up action via `notice`.
export function FileExplorer({
  title, width = 780, sources, loadTree, fileUrl, blobUrl, onClose, initialDir, initialPath,
  uploadDir, onUpload, editDir, onSave, onChanged, notice,
}: {
  title: string;
  width?: number;
  sources: Source[];
  loadTree: () => Promise<Record<string, FileItem[]>>;
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
  const [tree, setTree] = useState<Record<string, FileItem[]> | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [mdRaw, setMdRaw] = useState(false); // markdown: false=rendered, true=source
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({}); // dir path -> open (expand/collapse-all)
  const [draft, setDraft] = useState<string | null>(null); // non-null = editing the open file
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<UploadState | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);

  const refreshTree = () => loadTree().then(setTree).catch((e) => useStore.getState().setError(e.message));
  useEffect(() => { void refreshTree(); }, []);

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

  // Search hit: once the tree lands, expand the file's folders and preview it right away.
  useEffect(() => {
    if (!initialPath || !tree) return;
    const parts = initialPath.split('/').slice(0, -1);
    setOpenMap((m) => ({ ...m, ...Object.fromEntries(parts.map((_, i) => [parts.slice(0, i + 1).join('/'), true])) }));
    void openFile(initialPath);
  }, [tree, initialPath]);

  const list = tree ? tree[dir] || [] : [];
  const nodes = buildTree(list);

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={title} width={width}>
      {sources.length > 1 && (
        <div className="flex gap-2 mb-2 text-xs">
          {sources.map((s) => (
            <button key={s.key} className={`px-2.5 py-1 rounded ${dir === s.key ? 'bg-clay text-white' : 'bg-line text-txt2'}`}
              onClick={() => { setDir(s.key); setSel(null); setFile(null); }}>
              {s.label} ({tree ? (tree[s.key]?.length ?? 0) : '…'})
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
          {nodes.length > 0 && (
            <div className="flex gap-3 px-2 py-1 border-b border-line text-[11px] shrink-0">
              <button className="text-txt3 hover:text-clay" onClick={() => setOpenMap(Object.fromEntries(allDirPaths(nodes).map((p) => [p, true])))}>{t('common.expandAll')}</button>
              <button className="text-txt3 hover:text-clay" onClick={() => setOpenMap(Object.fromEntries(allDirPaths(nodes).map((p) => [p, false])))}>{t('common.collapseAll')}</button>
            </div>
          )}
          <div className="overflow-auto scrolly p-1 min-h-0 flex-1">
            {!tree && <div className="text-txt3 text-xs p-2">{t('fileExplorer.loading')}</div>}
            {tree && list.length === 0 && <div className="text-txt3 text-xs p-2">{t('fileExplorer.noFiles')}</div>}
            {nodes.map((n) => <TreeNode key={n.path} node={n} depth={0} onOpen={openFile} selected={sel} openMap={openMap} setOpenMap={setOpenMap} />)}
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
