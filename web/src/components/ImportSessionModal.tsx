import { useState, useRef, useEffect, useMemo } from 'react';
import ignore from 'ignore';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { Modal } from './Modal';

type Collected = { file: File; rel: string };
type Sess = { uuid: string; title: string; mtime: number; msgCount: number };
type TreeNode = { name: string; rel: string; dir: boolean; children: TreeNode[] };

// Recursively walk a dropped FileSystemEntry tree (all depths), collecting files with their
// path relative to the drop root — mirrors Sidebar.WikiCreateModal's drag-drop recursion.
function readEntries(reader: any): Promise<any[]> {
  return new Promise((res, rej) => reader.readEntries(res, rej));
}
async function traverseEntry(entry: any, parent: string, out: Collected[]) {
  if (entry.isFile) {
    const file: File = await new Promise((res, rej) => entry.file(res, rej));
    out.push({ file, rel: parent ? `${parent}/${file.name}` : file.name });
  } else if (entry.isDirectory) {
    const p = parent ? `${parent}/${entry.name}` : entry.name;
    const reader = entry.createReader();
    let batch: any[];
    do { batch = await readEntries(reader); for (const e of batch) await traverseEntry(e, p, out); } while (batch.length);
  }
}

// Folder pickers/drops prepend the picked folder's own name as the first path segment. Strip it
// so rels are project-root-relative (so `.gitignore`, `CLAUDE.md`, `.claude/` match at the root).
function stripRoot(list: Collected[]): Collected[] {
  const first = list[0]?.rel.split('/')[0];
  if (!first || !list.every((x) => x.rel === first || x.rel.startsWith(first + '/'))) return list;
  return list.map((x) => ({ file: x.file, rel: x.rel.slice(first.length + 1) })).filter((x) => x.rel);
}

// CLAUDE.md and everything under .claude/ are required — force-checked and locked in the tree.
const isEssential = (rel: string) => rel === 'CLAUDE.md' || rel.startsWith('.claude/');

function buildTree(rels: string[]): TreeNode[] {
  const root: TreeNode = { name: '', rel: '', dir: true, children: [] };
  for (const rel of rels) {
    const parts = rel.split('/');
    let node = root, acc = '';
    for (let i = 0; i < parts.length; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      const isFile = i === parts.length - 1;
      let child = node.children.find((c) => c.name === parts[i] && c.dir === !isFile);
      if (!child) { child = { name: parts[i], rel: acc, dir: !isFile, children: [] }; node.children.push(child); }
      node = child;
    }
  }
  return root.children;
}
function fileRels(node: TreeNode): string[] { return node.dir ? node.children.flatMap(fileRels) : [node.rel]; }
function sortChildren(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
}

// Multi-step local-session import: pick a project folder (collected, not uploaded) → prune a
// gitignore-aware file tree and upload the checked files → pick the ~/.claude session folder (or
// skip) → choose which transcripts to clone as private sessions. Mirrors the wiki staging flow.
export function ImportSessionModal({ onClose }: { onClose: () => void }) {
  const importSessions = useStore((s) => s.importSessions);
  const setError = useStore((s) => s.setError);
  const [sid] = useState(() => (crypto.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32));
  const [step, setStep] = useState<'project' | 'tree' | 'claude' | 'sessions'>('project');
  const [collected, setCollected] = useState<Collected[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [sessionChecked, setSessionChecked] = useState<Record<string, boolean>>({});
  const [projectName, setProjectName] = useState('');
  const [claudeNotFound, setClaudeNotFound] = useState(false);
  const projectDirRef = useRef<HTMLInputElement>(null);
  const claudeDirRef = useRef<HTMLInputElement>(null);
  const t = useT();

  const tree = useMemo(() => buildTree(collected.map((c) => c.rel)), [collected]);

  // Collect the project folder WITHOUT uploading; seed default checks from root .gitignore + .git/.
  const enterTree = async (raw: Collected[]) => {
    const list = stripRoot(raw);
    if (!list.length) return;
    let ig: ReturnType<typeof ignore> | null = null;
    const gi = list.find((x) => x.rel === '.gitignore');
    if (gi) { try { ig = ignore().add(await gi.file.text()); } catch { /* ignore malformed */ } }
    const init: Record<string, boolean> = {};
    for (const { rel } of list) init[rel] = isEssential(rel) || (!(ig && ig.ignores(rel)) && !rel.split('/').includes('.git'));
    setCollected(list); setChecked(init); setStep('tree');
  };

  const pickProject = (fl: FileList | null) => {
    if (!fl?.length) return;
    enterTree(Array.from(fl).map((f) => ({ file: f, rel: (f as any).webkitRelativePath || f.name })));
    if (projectDirRef.current) projectDirRef.current.value = '';
  };
  const onDropProject = async (ev: React.DragEvent) => {
    ev.preventDefault(); setDragOver(false);
    const items = ev.dataTransfer.items;
    const entries: any[] = [];
    for (let i = 0; i < items.length; i++) { const en = (items[i] as any).webkitGetAsEntry?.(); if (en) entries.push(en); }
    const out: Collected[] = [];
    if (entries.length) { for (const en of entries) await traverseEntry(en, '', out); }
    else { for (const f of Array.from(ev.dataTransfer.files)) out.push({ file: f, rel: f.name }); }
    await enterTree(out);
  };

  const toggleDir = (node: TreeNode, value: boolean) => {
    const files = fileRels(node);
    setChecked((prev) => { const next = { ...prev }; for (const r of files) if (!isEssential(r)) next[r] = value; return next; });
  };

  const uploadProject = async () => {
    const sel = collected.filter((c) => checked[c.rel]);
    if (!sel.length) return;
    const form = new FormData();
    for (const { file, rel } of sel) form.append(rel, file, file.name); // rel carried in field NAME
    setProgress(0);
    try {
      await api.uploadProgress(`/api/import/staging/${sid}/files?slot=project`, form, setProgress);
      setStep('claude');
    } catch (e: any) { setError(e.message); }
    finally { setProgress(null); }
  };

  // Entering the .claude step auto-opens the folder picker (the guide explains which folder).
  useEffect(() => { if (step === 'claude') claudeDirRef.current?.click(); }, [step]);

  const pickClaude = async (fl: FileList | null) => {
    if (!fl?.length) return;
    setClaudeNotFound(false);
    const form = new FormData();
    for (const f of Array.from(fl)) form.append((f as any).webkitRelativePath || f.name, f, f.name);
    setProgress(0);
    try {
      await api.uploadProgress(`/api/import/staging/${sid}/files?slot=claude`, form, setProgress);
      const r = await api.get(`/api/import/staging/${sid}/sessions`);
      if (r.found === false) { setClaudeNotFound(true); return; }
      setProjectName(r.projectTail || '');
      const ss: Sess[] = r.sessions || [];
      setSessions(ss);
      const sc: Record<string, boolean> = {}; for (const s of ss) sc[s.uuid] = true; setSessionChecked(sc);
      setStep('sessions');
    } catch (e: any) { setError(e.message); }
    finally { setProgress(null); if (claudeDirRef.current) claudeDirRef.current.value = ''; }
  };

  const skipClaude = () => { setSessions([]); setSessionChecked({}); setStep('sessions'); };

  const checkedUuids = sessions.filter((s) => sessionChecked[s.uuid]).map((s) => s.uuid);
  const confirm = async () => {
    setBusy(true);
    try {
      await importSessions({ sid, projectName: projectName.trim() || undefined, sessionUuids: checkedUuids });
      onClose();
    } catch (e: any) { setError(e.message); setBusy(false); }
  };

  const cancel = () => { api.del(`/api/import/staging/${sid}`).catch(() => {}); onClose(); };

  const renderNode = (node: TreeNode, depth: number): React.ReactElement => {
    const pad = { paddingLeft: depth * 16 + 4 };
    if (!node.dir) {
      const ess = isEssential(node.rel);
      return (
        <label key={node.rel} style={pad} className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-line/50 cursor-pointer">
          <input type="checkbox" checked={!!checked[node.rel]} disabled={ess}
            onChange={(e) => setChecked((p) => ({ ...p, [node.rel]: e.target.checked }))} />
          <span className="opacity-70">📄</span>
          <span className="flex-1 truncate" title={node.rel}>{node.name}</span>
          {ess && <span className="text-txt3 shrink-0 text-[10px]" title={t('import.essentialLocked')}>🔒</span>}
        </label>
      );
    }
    const files = fileRels(node);
    const all = files.length > 0 && files.every((r) => checked[r]);
    const some = files.some((r) => checked[r]);
    return (
      <div key={node.rel}>
        <label style={pad} className="flex items-center gap-2 px-2 py-1 text-xs font-medium hover:bg-line/50 cursor-pointer">
          <input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = some && !all; }}
            onChange={(e) => toggleDir(node, e.target.checked)} />
          <span className="opacity-70">📁</span>
          <span className="flex-1 truncate" title={node.rel}>{node.name}</span>
        </label>
        {sortChildren(node.children).map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  const progressBar = progress !== null && (
    <div className="mb-2">
      <div className="h-1.5 bg-line rounded overflow-hidden"><div className="h-full bg-clay transition-all" style={{ width: `${progress}%` }} /></div>
    </div>
  );

  const allSessionsSel = sessions.length > 0 && sessions.every((s) => sessionChecked[s.uuid]);

  return (
    <Modal open onOpenChange={(o) => { if (!o) cancel(); }} title={t('import.title')} width={560}>
      {step === 'project' && (
        <div>
          <div className="text-xs text-txt2 mb-2">{t('import.pickProject')}</div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDropProject}
            className={`border-2 border-dashed rounded-lg px-3 py-6 text-center transition-colors ${dragOver ? 'border-clay bg-claysoft' : 'border-line'}`}>
            <button className="btn-ghost !py-1 !text-xs" onClick={() => projectDirRef.current?.click()}>{t('import.chooseFolder')}</button>
            <input ref={projectDirRef} type="file" multiple className="hidden"
              {...{ webkitdirectory: '', directory: '' } as any} onChange={(e) => pickProject(e.target.files)} />
          </div>
          <div className="text-[11px] text-txt3 mt-2">{t('import.gitignoreHint')}</div>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-ghost" onClick={cancel}>{t('import.cancel')}</button>
          </div>
        </div>
      )}

      {step === 'tree' && (
        <div>
          <div className="text-[11px] text-txt3 mb-2">{t('import.gitignoreHint')}</div>
          {progressBar}
          <div className="max-h-[46vh] overflow-auto scrolly border border-line rounded mb-3">
            {sortChildren(tree).map((n) => renderNode(n, 0))}
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={cancel} disabled={progress !== null}>{t('import.cancel')}</button>
            <button className="btn-primary" onClick={uploadProject} disabled={progress !== null || !collected.some((c) => checked[c.rel])}>
              {t('import.uploadProject')}
            </button>
          </div>
        </div>
      )}

      {step === 'claude' && (
        <div>
          <div className="rounded-lg border border-line bg-rail/40 p-3 mb-3">
            <div className="text-sm font-medium mb-1">{t('import.claudeGuideTitle')}</div>
            <div className="text-xs text-txt2 leading-relaxed">{t('import.claudeGuideBody', { example: 'C:\\dev\\MyProj \u2192 C--dev-MyProj' })}</div>
          </div>
          {progressBar}
          {claudeNotFound && <div className="text-[11px] text-warn mb-2">{t('import.noSessions')}</div>}
          <input ref={claudeDirRef} type="file" multiple className="hidden"
            {...{ webkitdirectory: '', directory: '' } as any} onChange={(e) => pickClaude(e.target.files)} />
          <div className="flex flex-col md:flex-row md:justify-end gap-2">
            <button className="btn-ghost" onClick={skipClaude} disabled={progress !== null}>{t('import.claudeSkip')}</button>
            <button className="btn-primary" onClick={() => claudeDirRef.current?.click()} disabled={progress !== null}>{t('import.claudePick')}</button>
          </div>
        </div>
      )}

      {step === 'sessions' && (
        <div>
          <div className="text-xs text-txt2 mb-1">{t('import.projectName')}</div>
          <input className="input mb-3" value={projectName} autoFocus onChange={(e) => setProjectName(e.target.value)} />

          {sessions.length === 0 ? (
            <div className="text-[11px] text-txt3 mb-3">{t('import.noSessions')}</div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs text-txt2">{t('import.selectSessions')}</div>
                <label className="flex items-center gap-1.5 text-[11px] text-txt3 cursor-pointer select-none">
                  <input type="checkbox" checked={allSessionsSel}
                    onChange={(e) => { const v = e.target.checked; const sc: Record<string, boolean> = {}; for (const s of sessions) sc[s.uuid] = v; setSessionChecked(sc); }} />
                  {t('import.selectAll')}
                </label>
              </div>
              <div className="max-h-[40vh] overflow-auto scrolly border border-line rounded divide-y divide-line mb-3">
                {sessions.map((s) => (
                  <label key={s.uuid} className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-line/50 cursor-pointer">
                    <input type="checkbox" checked={!!sessionChecked[s.uuid]}
                      onChange={(e) => setSessionChecked((p) => ({ ...p, [s.uuid]: e.target.checked }))} />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate" title={s.title}>{s.title}</span>
                      <span className="block text-[10px] text-txt3">{t('import.sessionMeta', { count: s.msgCount, date: new Date(s.mtime).toLocaleDateString() })}</span>
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}

          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={cancel} disabled={busy}>{t('import.cancel')}</button>
            <button className="btn-primary" onClick={confirm}
              disabled={busy || (checkedUuids.length === 0 && !projectName.trim())}>
              {busy ? t('import.importing') : t('import.confirm')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
