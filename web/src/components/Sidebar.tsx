import { useState, useRef } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { Avatar, timeAgo, LangToggle } from '../lib/ui';
import { Modal } from './Modal';
import { MyTokenModal } from './TokenSettings';
import { useT } from '../lib/i18n';

export function Sidebar() {
  const { user, sessions, rooms, wikiTopics, current, openPrivate, openRoom, openWiki, newSession, newRoom, logout, setPanel, panel, deleteSession, deleteRoom, deleteWikiTopic } = useStore();
  const [showRoom, setShowRoom] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [showWiki, setShowWiki] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const isAdmin = user?.role === 'admin';
  const t = useT();

  const create = async () => { if (!roomName.trim()) return; await newRoom(roomName.trim()); setRoomName(''); setShowRoom(false); };

  return (
    <aside className="bg-rail border-r border-line flex flex-col min-h-0">
      <div className="px-3.5 pt-3.5 pb-2">
        <div className="flex items-center gap-2.5 mb-3.5">
          <img src="/favicon.svg" alt="" className="w-[26px] h-[26px] rounded-md" />
          <div className="leading-tight">
            <div className="font-semibold text-sm">ClaudeCode Workspace</div>
            <div className="text-[11px] text-txt3">{t('sidebar.teamName', { name: user?.displayName ?? '' })}</div>
          </div>
          <LangToggle className="ml-auto text-[11px] text-txt3 hover:text-txt border border-line rounded px-1.5 py-0.5" />
        </div>
        <button className="btn-primary w-full flex items-center justify-center gap-2 !py-2" onClick={() => newSession()}>{t('sidebar.newChat')}</button>
      </div>

      <div className="flex-1 overflow-y-auto scrolly px-2 pb-1">
        <Section label={t('sidebar.personal')} onAdd={() => newSession()} />
        {sessions.length === 0 && <div className="text-[11px] text-txt3 px-2 py-1">{t('common.none')}</div>}
        {sessions.map((s) => (
          <Item key={s.id} active={panel === null && current?.chatSessionId === s.id} onClick={() => { setPanel(null); openPrivate(s.id); }}>
            <span className="opacity-70">💬</span>
            <span className="flex-1 truncate text-[13px]">{s.title}</span>
            <span className="text-[11px] text-txt3 group-hover:hidden">{timeAgo(s.updatedAt)}</span>
            <button className="hidden group-hover:block text-txt3 hover:text-danger text-xs px-1" title={t('sidebar.deleteChatTitle')}
              onClick={(e) => { e.stopPropagation(); if (confirm(t('sidebar.deleteChatConfirm', { title: s.title }))) deleteSession(s.id); }}>🗑</button>
          </Item>
        ))}

        <Section label={t('sidebar.rooms')} onAdd={() => setShowRoom(true)} />
        {rooms.length === 0 && <div className="text-[11px] text-txt3 px-2 py-1">{t('common.none')}</div>}
        {rooms.map((r) => (
          <Item key={r.id} active={panel === null && current?.roomId === r.id} onClick={() => { setPanel(null); openRoom(r.id); }}>
            <span className="w-[7px] h-[7px] rounded-full bg-ok shrink-0" />
            <span className="flex-1 truncate text-[13px]">{r.name}</span>
            <span className="flex group-hover:hidden">
              {r.members.slice(0, 3).map((m) => (
                <span key={m.userId} className="w-[17px] h-[17px] rounded-full grid place-items-center text-[9px] text-white font-semibold -ml-1.5 border-[1.5px]"
                  style={{ background: m.avatarColor, borderColor: 'var(--rail)' }}>{m.displayName.slice(0, 2).toUpperCase()}</span>
              ))}
            </span>
            <button className="hidden group-hover:block text-txt3 hover:text-danger text-xs px-1" title={t('sidebar.deleteRoomTitle')}
              onClick={(e) => { e.stopPropagation(); if (confirm(t('sidebar.deleteRoomConfirm', { name: r.name }))) deleteRoom(r.id); }}>🗑</button>
          </Item>
        ))}

        <Section label="LLM Wiki" onAdd={isAdmin ? () => setShowWiki(true) : undefined} />
        {wikiTopics.length === 0 && <div className="text-[11px] text-txt3 px-2 py-1">{isAdmin ? t('sidebar.createTopicHint') : t('common.none')}</div>}
        {wikiTopics.map((wt) => (
          <Item key={wt.id} active={panel === null && current?.wikiTopicId === wt.id} onClick={() => { setPanel(null); openWiki(wt.id); }}>
            <span className="opacity-70">{wt.compileStatus === 'compiling' ? '⏳' : wt.compileStatus === 'error' ? '⚠️' : '📚'}</span>
            <span className="flex-1 truncate text-[13px]">{wt.name}</span>
            {wt.compileStatus === 'compiling' && <span className="text-[10px] text-txt3 group-hover:hidden">{t('sidebar.compiling')}</span>}
            {isAdmin && (
              <button className="hidden group-hover:block text-txt3 hover:text-danger text-xs px-1" title={t('sidebar.deleteTopicTitle')}
                onClick={(e) => { e.stopPropagation(); if (confirm(t('sidebar.deleteTopicConfirm', { name: wt.name }))) deleteWikiTopic(wt.id); }}>🗑</button>
            )}
          </Item>
        ))}
      </div>

      <div className="border-t border-line p-2.5">
        <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-md">
          <Avatar name={user?.displayName} color={user?.avatarColor} />
          <div className="flex-1 text-[13px]">{user?.displayName}</div>
          <span className="text-[10px] bg-claysoft text-clay px-1.5 py-0.5 rounded-full font-semibold">{user?.role}</span>
        </div>
        <button className="flex items-center gap-2.5 px-2 py-1.5 rounded-md w-full hover:bg-line text-left text-[13px] text-txt2" onClick={() => setShowToken(true)}>
          <span className="w-7 text-center">🔑</span> {t('sidebar.myToken')}
          {!user?.hasClaudeToken && <span className="ml-auto text-[10px] bg-warnsoft text-warn px-1.5 py-0.5 rounded-full">{t('sidebar.tokenUnregistered')}</span>}
        </button>
        <button className="flex items-center gap-2.5 px-2 py-1.5 rounded-md w-full hover:bg-line text-left text-[13px] text-txt2" onClick={() => setPanel('plugins')}>
          <span className="w-7 text-center">🧩</span> {t('sidebar.plugins')}
        </button>
        {user?.role === 'admin' && (
          <button className="flex items-center gap-2.5 px-2 py-1.5 rounded-md w-full hover:bg-line text-left text-[13px] text-txt2" onClick={() => setPanel('admin')}>
            <span className="w-7 text-center">🛠</span> {t('sidebar.adminPanel')}
          </button>
        )}
        <button className="flex items-center gap-2.5 px-2 py-1.5 rounded-md w-full hover:bg-line text-left text-[13px] text-txt2" onClick={() => logout()}>
          <span className="w-7 text-center">↩</span> {t('sidebar.logout')}
        </button>
      </div>

      <Modal open={showRoom} onOpenChange={setShowRoom} title={t('sidebar.newRoomTitle')}>
        <input className="input mb-3" placeholder={t('sidebar.roomNamePlaceholder')} value={roomName} autoFocus
          onChange={(e) => setRoomName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setShowRoom(false)}>{t('common.cancel')}</button>
          <button className="btn-primary" onClick={create}>{t('common.create')}</button>
        </div>
      </Modal>

      {showWiki && <WikiCreateModal onClose={() => setShowWiki(false)} />}
      <MyTokenModal open={showToken} onClose={() => setShowToken(false)} />
    </aside>
  );
}

function fmtSize(n: number) { return n >= 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}B`; }

// Recursively walk a dropped FileSystemEntry tree (all depths), collecting files with their
// path relative to the drop root (so nested folders are preserved on the server).
function readEntries(reader: any): Promise<any[]> {
  return new Promise((res, rej) => reader.readEntries(res, rej));
}
async function traverseEntry(entry: any, parent: string, out: { file: File; rel: string }[]) {
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

// Bulk-upload flow: drop whole folders (recursed to any depth) or pick files/a folder → each file
// streams to a server staging area (real progress), the confirmed list shows relative paths with
// per-file delete, then 확인 finalizes the topic (moves staged tree in) / 취소 discards.
function WikiCreateModal({ onClose }: { onClose: () => void }) {
  const newWikiTopic = useStore((s) => s.newWikiTopic);
  const setError = useStore((s) => s.setError);
  const [sid] = useState(() => (crypto.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32));
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [files, setFiles] = useState<{ name: string; size: number }[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const t = useT();

  const uploadCollected = async (list: { file: File; rel: string }[]) => {
    if (!list.length) return;
    const form = new FormData();
    for (const { file, rel } of list) form.append(rel, file, file.name); // rel carried in field NAME (filename gets basenamed)
    setProgress(0);
    try {
      const r = await api.uploadProgress(`/api/wiki/staging/${sid}/files`, form, setProgress);
      setFiles(r.files || []);
    } catch (e: any) { setError(e.message); }
    finally { setProgress(null); if (fileRef.current) fileRef.current.value = ''; if (dirRef.current) dirRef.current.value = ''; }
  };

  const pick = (fl: FileList | null) => {
    if (!fl?.length) return;
    // webkitRelativePath is set for the folder picker; empty for the flat picker → use name
    uploadCollected(Array.from(fl).map((f) => ({ file: f, rel: (f as any).webkitRelativePath || f.name })));
  };

  const onDrop = async (ev: React.DragEvent) => {
    ev.preventDefault(); setDragOver(false);
    const items = ev.dataTransfer.items;
    const entries: any[] = [];
    for (let i = 0; i < items.length; i++) { const en = (items[i] as any).webkitGetAsEntry?.(); if (en) entries.push(en); }
    const out: { file: File; rel: string }[] = [];
    if (entries.length) { for (const en of entries) await traverseEntry(en, '', out); }
    else { for (const f of Array.from(ev.dataTransfer.files)) out.push({ file: f, rel: f.name }); }
    await uploadCollected(out);
  };

  const removeFile = async (rel: string) => {
    try { const r = await api.del(`/api/wiki/staging/${sid}/file?path=${encodeURIComponent(rel)}`); setFiles(r.files || []); }
    catch (e: any) { setError(e.message); }
  };

  const cancel = () => { api.del(`/api/wiki/staging/${sid}`).catch(() => {}); onClose(); };

  const confirm = async () => {
    if (!name.trim()) { setError(t('sidebar.topicNameRequired')); return; }
    setBusy(true);
    try { await newWikiTopic({ name: name.trim(), description: desc.trim(), stagingId: sid }); onClose(); }
    catch (e: any) { setError(e.message); setBusy(false); }
  };

  return (
    <Modal open onOpenChange={(o) => { if (!o) cancel(); }} title={t('sidebar.newWikiTopicTitle')} width={480}>
      <input className="input mb-2" placeholder={t('sidebar.topicNamePlaceholder')} value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      <textarea className="input mb-2 resize-none" rows={3} placeholder={t('sidebar.topicDescPlaceholder')}
        value={desc} onChange={(e) => setDesc(e.target.value)} />

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-lg px-3 py-4 text-center mb-2 transition-colors ${dragOver ? 'border-clay bg-claysoft' : 'border-line'}`}>
        <div className="text-xs text-txt2 mb-2">{t('sidebar.dropZone')}</div>
        <div className="flex justify-center gap-2">
          <button className="btn-ghost !py-1 !text-xs" disabled={progress !== null} onClick={() => fileRef.current?.click()}>{t('sidebar.chooseFiles')}</button>
          <button className="btn-ghost !py-1 !text-xs" disabled={progress !== null} onClick={() => dirRef.current?.click()}>{t('sidebar.chooseFolder')}</button>
        </div>
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => pick(e.target.files)} />
        <input ref={dirRef} type="file" multiple className="hidden"
          {...{ webkitdirectory: '', directory: '' } as any} onChange={(e) => pick(e.target.files)} />
      </div>

      {progress !== null && (
        <div className="mb-2">
          <div className="h-1.5 bg-line rounded overflow-hidden"><div className="h-full bg-clay transition-all" style={{ width: `${progress}%` }} /></div>
          <div className="text-[11px] text-txt3 mt-0.5">{t('sidebar.uploading', { progress })}</div>
        </div>
      )}

      <div className="max-h-44 overflow-auto scrolly mb-3 border border-line rounded divide-y divide-line">
        {files.length === 0 && <div className="text-[11px] text-txt3 px-2 py-1.5">{t('sidebar.noFilesUploaded')}</div>}
        {files.map((f) => (
          <div key={f.name} className="flex items-center gap-2 px-2 py-1.5 text-xs">
            <span>📄</span>
            <span className="flex-1 truncate" title={f.name}>{f.name}</span>
            <span className="text-txt3 text-[11px]">{fmtSize(f.size)}</span>
            <button className="text-txt3 hover:text-danger" title={t('common.delete')} onClick={() => removeFile(f.name)}>🗑</button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] text-txt3">{t('sidebar.queryOnlyHint')}</span>
        {files.length > 0 && <span className="text-[11px] text-txt3">{t('sidebar.fileCount', { count: files.length })}</span>}
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={cancel} disabled={busy}>{t('common.cancel')}</button>
        <button className="btn-primary" onClick={confirm} disabled={busy || progress !== null}>
          {busy ? t('common.creating') : files.length ? t('sidebar.confirmWithCount', { count: files.length }) : t('common.confirm')}
        </button>
      </div>
    </Modal>
  );
}

function Section({ label, onAdd }: { label: string; onAdd?: () => void }) {
  return (
    <div className="text-[11px] tracking-wider uppercase text-txt3 px-2 pt-3 pb-1 font-semibold flex justify-between items-center">
      {label}{onAdd && <span className="cursor-pointer text-sm leading-none" onClick={onAdd}>＋</span>}
    </div>
  );
}
function Item({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClick}
      className={`group flex items-center gap-2.5 px-2.5 py-1.5 rounded-md cursor-pointer text-txt2 ${active ? 'bg-claysoft text-txt' : 'hover:bg-line'}`}>
      {children}
    </div>
  );
}
