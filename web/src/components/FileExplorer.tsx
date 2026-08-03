import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { md } from '../lib/md';
import { useT } from '../lib/i18n';
import { Modal } from './Modal';
import { IconChevronDown, IconChevronRight, IconFolder, IconFile, IconEye, IconTerminal } from '../lib/icons';

export const isImage = (n: string) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(n);
export const isMarkdown = (n: string) => /\.(md|markdown)$/i.test(n);

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
export function FileExplorer({
  title, width = 780, sources, loadTree, fileUrl, blobUrl, onClose, initialDir, initialPath,
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
}) {
  const t = useT();
  const [dir, setDir] = useState(initialDir && sources.some((s) => s.key === initialDir) ? initialDir : sources[0].key);
  const [tree, setTree] = useState<Record<string, FileItem[]> | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [mdRaw, setMdRaw] = useState(false); // markdown: false=rendered, true=source
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({}); // dir path -> open (expand/collapse-all)

  useEffect(() => {
    loadTree().then(setTree).catch((e) => useStore.getState().setError(e.message));
  }, []);

  const openFile = async (p: string) => {
    setSel(p); setFile(null); setMdRaw(false);
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
                {isMarkdown(sel) && !isImage(sel) && (
                  <button className="shrink-0 px-1.5 py-0.5 rounded border border-line hover:text-clay inline-flex items-center gap-1" onClick={() => setMdRaw(!mdRaw)}>
                    {mdRaw ? <><IconEye size={12} />{t('fileExplorer.rendered')}</> : <><IconTerminal size={12} />{t('fileExplorer.source')}</>}
                  </button>
                )}
              </div>
              {isImage(sel) ? (
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
