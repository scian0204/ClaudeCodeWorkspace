import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { Modal } from './Modal';

type FileItem = { name: string; size: number };
type Node = { name: string; path: string; dir: boolean; size: number; children: Node[] };

// build a nested tree from flat relative paths (docs/api/x.md -> docs > api > x.md)
function buildTree(files: FileItem[]): Node[] {
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

export function WikiExplorer({ topicId, onClose }: { topicId: string; onClose: () => void }) {
  const [dir, setDir] = useState<'raw' | 'wiki'>('raw');
  const [tree, setTree] = useState<{ raw: FileItem[]; wiki: FileItem[] } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get(`/api/wiki/topics/${topicId}/tree`).then(setTree).catch((e) => useStore.getState().setError(e.message));
  }, [topicId]);

  const openFile = async (p: string) => {
    setSel(p); setLoading(true); setFile(null);
    try { setFile(await api.get(`/api/wiki/topics/${topicId}/file?dir=${dir}&path=${encodeURIComponent(p)}`)); }
    catch (e: any) { useStore.getState().setError(e.message); }
    finally { setLoading(false); }
  };

  const list = tree ? tree[dir] : [];
  const nodes = buildTree(list);

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title="LLM Wiki 파일 탐색기" width={780}>
      <div className="flex gap-2 mb-2 text-xs">
        <button className={`px-2.5 py-1 rounded ${dir === 'raw' ? 'bg-clay text-white' : 'bg-line text-txt2'}`}
          onClick={() => { setDir('raw'); setSel(null); setFile(null); }}>원본 raw ({tree?.raw.length ?? '…'})</button>
        <button className={`px-2.5 py-1 rounded ${dir === 'wiki' ? 'bg-clay text-white' : 'bg-line text-txt2'}`}
          onClick={() => { setDir('wiki'); setSel(null); setFile(null); }}>컴파일 wiki ({tree?.wiki.length ?? '…'})</button>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: '260px 1fr', height: '60vh' }}>
        <div className="border border-line rounded overflow-auto scrolly p-1">
          {!tree && <div className="text-txt3 text-xs p-2">불러오는 중…</div>}
          {tree && list.length === 0 && <div className="text-txt3 text-xs p-2">파일 없음</div>}
          {nodes.map((n) => <TreeNode key={n.path} node={n} depth={0} onOpen={openFile} selected={sel} />)}
        </div>
        <div className="border border-line rounded overflow-auto scrolly bg-bg min-w-0">
          {loading && <div className="text-txt3 text-xs p-3">불러오는 중…</div>}
          {!loading && file && (
            <div>
              <div className="sticky top-0 bg-card border-b border-line px-3 py-1.5 text-xs font-mono truncate">{file.name}</div>
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-txt2 p-3">{file.content}</pre>
            </div>
          )}
          {!loading && !file && <div className="text-txt3 text-xs p-3">왼쪽에서 파일을 선택하세요.</div>}
        </div>
      </div>
    </Modal>
  );
}
