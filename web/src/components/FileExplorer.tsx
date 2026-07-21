import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { md } from '../lib/md';
import { Modal } from './Modal';

export const isImage = (n: string) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(n);
export const isMarkdown = (n: string) => /\.(md|markdown)$/i.test(n);

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

function TreeNode({ node, depth, onOpen, selected }: { node: Node; depth: number; onOpen: (p: string) => void; selected: string | null }) {
  const [open, setOpen] = useState(depth < 1); // top level expanded by default
  if (node.dir) {
    return (
      <div>
        <div className="flex items-center gap-1 py-0.5 cursor-pointer hover:bg-line rounded text-xs"
          style={{ paddingLeft: depth * 12 + 4 }} onClick={() => setOpen(!open)}>
          <span className="text-txt3 w-3">{open ? '▾' : '▸'}</span><span>📁</span>
          <span className="truncate">{node.name}</span>
          <span className="text-txt3 text-[10px] ml-1">{node.children.length}</span>
        </div>
        {open && node.children.map((c) => <TreeNode key={c.path} node={c} depth={depth + 1} onOpen={onOpen} selected={selected} />)}
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-1 py-0.5 cursor-pointer rounded text-xs ${selected === node.path ? 'bg-claysoft text-clay' : 'hover:bg-line'}`}
      style={{ paddingLeft: depth * 12 + 18 }} onClick={() => onOpen(node.path)} title={node.path}>
      <span>📄</span><span className="truncate flex-1">{node.name}</span>
      <span className="text-txt3 text-[10px]">{fmtSize(node.size)}</span>
    </div>
  );
}

export type Source = { key: string; label: string };

// Generic file-explorer modal: a tree pane + a preview pane (image / markdown / text).
// `loadTree` returns a map keyed by each source.key; single source hides the tab bar.
export function FileExplorer({
  title, width = 780, sources, loadTree, fileUrl, blobUrl, onClose,
}: {
  title: string;
  width?: number;
  sources: Source[];
  loadTree: () => Promise<Record<string, FileItem[]>>;
  fileUrl: (dir: string, path: string) => string;
  blobUrl: (dir: string, path: string) => string;
  onClose: () => void;
}) {
  const [dir, setDir] = useState(sources[0].key);
  const [tree, setTree] = useState<Record<string, FileItem[]> | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [mdRaw, setMdRaw] = useState(false); // markdown: false=rendered, true=source

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
      <div className="grid gap-2" style={{ gridTemplateColumns: '260px 1fr', height: '60vh' }}>
        <div className="border border-line rounded overflow-auto scrolly p-1">
          {!tree && <div className="text-txt3 text-xs p-2">불러오는 중…</div>}
          {tree && list.length === 0 && <div className="text-txt3 text-xs p-2">파일 없음</div>}
          {nodes.map((n) => <TreeNode key={n.path} node={n} depth={0} onOpen={openFile} selected={sel} />)}
        </div>
        <div className="border border-line rounded overflow-auto scrolly bg-bg min-w-0">
          {!sel && <div className="text-txt3 text-xs p-3">왼쪽에서 파일을 선택하세요.</div>}
          {sel && (
            <>
              <div className="sticky top-0 bg-card border-b border-line px-3 py-1.5 text-xs font-mono flex items-center gap-2">
                <span className="truncate flex-1">{sel}</span>
                {isMarkdown(sel) && !isImage(sel) && (
                  <button className="shrink-0 px-1.5 py-0.5 rounded border border-line hover:text-clay" onClick={() => setMdRaw(!mdRaw)}>
                    {mdRaw ? '📖 렌더' : '</> 원문'}
                  </button>
                )}
              </div>
              {isImage(sel) ? (
                <div className="p-3">
                  <img src={blobUrl(dir, sel)} alt={sel} className="max-w-full h-auto rounded border border-line" />
                </div>
              ) : loading ? (
                <div className="text-txt3 text-xs p-3">불러오는 중…</div>
              ) : file && isMarkdown(sel) && !mdRaw ? (
                <div className="p-3 text-sm break-words leading-relaxed" dangerouslySetInnerHTML={{ __html: md(file.content) }} />
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
