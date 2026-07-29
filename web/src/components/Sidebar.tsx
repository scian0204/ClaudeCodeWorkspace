import { useState, useRef, useEffect } from 'react';
import { useStore, type ReviewSessionSummary, type ReviewRepo, type DmChannel } from '../lib/store';
import { api, type UploadState } from '../lib/api';
import { Avatar, avatarUrl, timeAgo, LangToggle } from '../lib/ui';
import { Modal } from './Modal';
import { ImportSessionModal } from './ImportSessionModal';
import { UploadProgress } from './UploadProgress';
import { useT } from '../lib/i18n';
import {
  IconX, IconDownload, IconMessage, IconPencil, IconTrash, IconUsers, IconClock, IconWarning,
  IconBook, IconPuzzle, IconSliders, IconLogout, IconFile, IconBox, IconRefresh, IconPlus,
  IconCheckCircle, IconBan, IconGitBranch, IconCheckSquare, IconSquare,
} from '../lib/icons';

export function Sidebar() {
  const { user, sessions, rooms, wikiTopics, current, openPrivate, openRoom, openWiki, newSession, newRoom, logout, setPanel, panel, deleteSession, deleteRoom, deleteWikiTopic, renameSession, sidebarOpen, setSidebarOpen, sessionImportEnabled, pendingRequestCount, channels, activeChannelId, openChannel, dmEnabled } = useStore();
  const [showRoom, setShowRoom] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [showWiki, setShowWiki] = useState(false);
  const [showDm, setShowDm] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const isAdmin = user?.role === 'admin';
  const t = useT();

  const channelLabel = (ch: DmChannel) => (ch.kind === 'group' ? (ch.name || t('dm.group')) : (ch.members.find((m) => m.userId !== user?.id)?.displayName || t('dm.dm')));

  const create = async () => { if (!roomName.trim()) return; await newRoom(roomName.trim()); setRoomName(''); setShowRoom(false); };

  return (
    <aside className={`bg-rail border-r border-line flex flex-col min-h-0 h-full
      max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:w-[264px] max-md:z-50 max-md:shadow-2xl
      max-md:transition-transform max-md:duration-200 ${sidebarOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'}`}>
      <div className="px-3.5 pt-3.5 pb-2 relative">
        <button className="toolbtn md:hidden absolute top-2.5 right-2.5 z-10" aria-label={t('nav.closeMenu')} onClick={() => setSidebarOpen(false)}><IconX /></button>
        <LangToggle className="absolute top-3 right-3 text-[11px] text-txt3 hover:text-txt border border-line rounded px-1.5 py-0.5 z-10 max-md:right-11" />
        <div className="flex items-center gap-2.5 mb-3.5 pr-9">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="w-[26px] h-[26px] rounded-md shrink-0" />
          <div className="leading-tight min-w-0">
            <div className="font-semibold text-sm whitespace-nowrap">ClaudeCode Workspace</div>
            <div className="text-[11px] text-txt3 truncate">{t('sidebar.teamName', { name: user?.displayName ?? '' })}</div>
          </div>
        </div>
        <button className="btn-primary w-full flex items-center justify-center gap-2 !py-2" onClick={() => newSession()}>{t('sidebar.newChat')}</button>
      </div>

      <div className="flex-1 overflow-y-auto scrolly px-2 pb-1">
        <Section label={t('sidebar.personal')} onAdd={() => newSession()}
          extra={sessionImportEnabled ? <button className="cursor-pointer leading-none text-txt3 hover:text-txt" title={t('import.button')} aria-label={t('import.button')} onClick={() => setImportOpen(true)}><IconDownload size={15} /></button> : undefined} />
        {sessions.length === 0 && <div className="text-[11px] text-txt3 px-2 py-1">{t('common.none')}</div>}
        {sessions.map((s) => (
          <Item key={s.id} active={panel === null && current?.chatSessionId === s.id} onClick={() => { setPanel(null); openPrivate(s.id); }}>
            <span className="opacity-70"><IconMessage size={15} /></span>
            <span className="flex-1 truncate text-[13px]">{s.title}</span>
            <span className="text-[11px] text-txt3 group-hover:hidden">{timeAgo(s.updatedAt)}</span>
            <button className="hidden group-hover:block text-txt3 hover:text-clay px-1" title={t('sidebar.renameChatTitle')} aria-label={t('sidebar.renameChatTitle')}
              onClick={(e) => { e.stopPropagation(); const nt = prompt(t('sidebar.renameChatPrompt'), s.title); if (nt && nt.trim() && nt.trim() !== s.title) renameSession(s.id, nt.trim()); }}><IconPencil size={14} /></button>
            <button className="hidden group-hover:block text-txt3 hover:text-danger px-1" title={t('sidebar.deleteChatTitle')} aria-label={t('sidebar.deleteChatTitle')}
              onClick={(e) => { e.stopPropagation(); if (confirm(t('sidebar.deleteChatConfirm', { title: s.title }))) deleteSession(s.id); }}><IconTrash size={14} /></button>
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
            <button className="hidden group-hover:block text-txt3 hover:text-danger px-1" title={t('sidebar.deleteRoomTitle')} aria-label={t('sidebar.deleteRoomTitle')}
              onClick={(e) => { e.stopPropagation(); if (confirm(t('sidebar.deleteRoomConfirm', { name: r.name }))) deleteRoom(r.id); }}><IconTrash size={14} /></button>
          </Item>
        ))}

        {dmEnabled && <>
          <Section label={t('dm.section')} onAdd={() => setShowDm(true)} />
          {channels.length === 0 && <div className="text-[11px] text-txt3 px-2 py-1">{t('common.none')}</div>}
          {channels.map((ch) => {
            const other = ch.kind === 'dm' ? ch.members.find((m) => m.userId !== user?.id) : undefined;
            return (
              <Item key={ch.id} active={panel === null && activeChannelId === ch.id} onClick={() => openChannel(ch.id)}>
                {ch.kind === 'group'
                  ? <span className="w-[18px] h-[18px] rounded-full grid place-items-center shrink-0 text-white" style={{ background: 'var(--line2, #888)' }}><IconUsers size={11} /></span>
                  : <Avatar name={other?.displayName} color={other?.avatarColor} src={avatarUrl(other && { id: other.userId, avatar: other.avatar })} size={18} />}
                <span className="flex-1 truncate text-[13px]">{channelLabel(ch)}</span>
                {ch.unread > 0 && <span className="text-[10px] bg-clay text-white px-1.5 py-0.5 rounded-full font-semibold min-w-[18px] text-center">{ch.unread}</span>}
              </Item>
            );
          })}
        </>}

        <Section label="LLM Wiki" onAdd={isAdmin ? () => setShowWiki(true) : undefined} />
        {wikiTopics.length === 0 && <div className="text-[11px] text-txt3 px-2 py-1">{isAdmin ? t('sidebar.createTopicHint') : t('common.none')}</div>}
        {wikiTopics.map((wt) => (
          <Item key={wt.id} active={panel === null && current?.wikiTopicId === wt.id} onClick={() => { setPanel(null); openWiki(wt.id); }}>
            <span className="opacity-70">{wt.compileStatus === 'compiling' ? <IconClock size={15} /> : wt.compileStatus === 'error' ? <IconWarning size={15} className="text-warn" /> : <IconBook size={15} />}</span>
            <span className="flex-1 truncate text-[13px]">{wt.name}</span>
            {wt.compileStatus === 'compiling' && <span className="text-[10px] text-txt3 group-hover:hidden">{t('sidebar.compiling')}</span>}
            {isAdmin && (
              <button className="hidden group-hover:block text-txt3 hover:text-danger px-1" title={t('sidebar.deleteTopicTitle')} aria-label={t('sidebar.deleteTopicTitle')}
                onClick={(e) => { e.stopPropagation(); if (confirm(t('sidebar.deleteTopicConfirm', { name: wt.name }))) deleteWikiTopic(wt.id); }}><IconTrash size={14} /></button>
            )}
          </Item>
        ))}

        <ReviewSection />
      </div>

      <div className="border-t border-line p-2.5">
        <button className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md w-full text-left ${panel === 'me' ? 'bg-claysoft' : 'hover:bg-line'}`} onClick={() => setPanel('me')}>
          <Avatar name={user?.displayName} color={user?.avatarColor} src={avatarUrl(user)} />
          <div className="flex-1 text-[13px] min-w-0 truncate">{user?.displayName}</div>
          {!user?.hasClaudeToken && <span className="text-[10px] bg-warnsoft text-warn px-1.5 py-0.5 rounded-full whitespace-nowrap">{t('sidebar.tokenUnregistered')}</span>}
          <span className="text-[10px] bg-claysoft text-clay px-1.5 py-0.5 rounded-full font-semibold">{user?.role}</span>
        </button>
        <button className="flex items-center gap-2.5 px-2 py-1.5 rounded-md w-full hover:bg-line text-left text-[13px] text-txt2" onClick={() => setPanel('plugins')}>
          <span className="w-7 grid place-items-center"><IconPuzzle size={17} /></span> {t('sidebar.plugins')}
        </button>
        {user?.role === 'admin' && (
          <button className="flex items-center gap-2.5 px-2 py-1.5 rounded-md w-full hover:bg-line text-left text-[13px] text-txt2" onClick={() => setPanel('admin')}>
            <span className="w-7 grid place-items-center"><IconSliders size={17} /></span> {t('sidebar.adminPanel')}
            {pendingRequestCount > 0 && <span className="ml-auto text-[10px] bg-warnsoft text-warn px-1.5 py-0.5 rounded-full whitespace-nowrap">{pendingRequestCount}</span>}
          </button>
        )}
        <button className="flex items-center gap-2.5 px-2 py-1.5 rounded-md w-full hover:bg-line text-left text-[13px] text-txt2" onClick={() => logout()}>
          <span className="w-7 grid place-items-center"><IconLogout size={17} /></span> {t('sidebar.logout')}
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
      {showDm && <NewChannelModal onClose={() => setShowDm(false)} />}
      {importOpen && sessionImportEnabled && <ImportSessionModal onClose={() => setImportOpen(false)} />}
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
  const [precompiled, setPrecompiled] = useState(false); // upload IS an already-compiled wiki
  const [files, setFiles] = useState<{ name: string; size: number }[]>([]);
  const [progress, setProgress] = useState<UploadState | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const t = useT();

  const uploadCollected = async (list: { file: File; rel: string }[]) => {
    if (!list.length) return;
    try {
      const r = await api.uploadFiles(`/api/wiki/staging/${sid}/files`, list, setProgress);
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
    try { await newWikiTopic({ name: name.trim(), description: desc.trim(), stagingId: sid, precompiled }); onClose(); }
    catch (e: any) { setError(e.message); setBusy(false); }
  };

  return (
    <Modal open onOpenChange={(o) => { if (!o) cancel(); }} title={t('sidebar.newWikiTopicTitle')} width={480}>
      <input className="input mb-2" placeholder={t('sidebar.topicNamePlaceholder')} value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      <textarea className="input mb-2 resize-none" rows={3} placeholder={t('sidebar.topicDescPlaceholder')}
        value={desc} onChange={(e) => setDesc(e.target.value)} />

      <label className="flex items-start gap-2 mb-2 text-xs text-txt2 cursor-pointer select-none">
        <input type="checkbox" className="mt-0.5" checked={precompiled} onChange={(e) => setPrecompiled(e.target.checked)} />
        <span>
          {t('sidebar.precompiledLabel')} <span className="text-txt3">{t('sidebar.precompiledSkip')}</span>
          <span className="block text-[11px] text-txt3">{t('sidebar.precompiledHint')}</span>
        </span>
      </label>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-lg px-3 py-4 text-center mb-2 transition-colors ${dragOver ? 'border-clay bg-claysoft' : 'border-line'}`}>
        <div className="text-xs text-txt2 mb-2">{t(precompiled ? 'sidebar.dropZonePrecompiled' : 'sidebar.dropZone')}</div>
        <div className="flex justify-center gap-2">
          <button className="btn-ghost !py-1 !text-xs" disabled={progress !== null} onClick={() => fileRef.current?.click()}>{t('sidebar.chooseFiles')}</button>
          <button className="btn-ghost !py-1 !text-xs" disabled={progress !== null} onClick={() => dirRef.current?.click()}>{t('sidebar.chooseFolder')}</button>
        </div>
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => pick(e.target.files)} />
        <input ref={dirRef} type="file" multiple className="hidden"
          {...{ webkitdirectory: '', directory: '' } as any} onChange={(e) => pick(e.target.files)} />
      </div>

      {progress && <UploadProgress s={progress} />}

      <div className="max-h-44 overflow-auto scrolly mb-3 border border-line rounded divide-y divide-line">
        {files.length === 0 && <div className="text-[11px] text-txt3 px-2 py-1.5">{t('sidebar.noFilesUploaded')}</div>}
        {files.map((f) => (
          <div key={f.name} className="flex items-center gap-2 px-2 py-1.5 text-xs">
            <IconFile size={14} className="text-txt3 shrink-0" />
            <span className="flex-1 truncate" title={f.name}>{f.name}</span>
            <span className="text-txt3 text-[11px]">{fmtSize(f.size)}</span>
            <button className="text-txt3 hover:text-danger" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => removeFile(f.name)}><IconTrash size={14} /></button>
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

// Start a DM (pick one user) or create a group (name + pick many). Reuses the directory picker
// pattern from MembersDialog.
function NewChannelModal({ onClose }: { onClose: () => void }) {
  const { user, createDm, createGroup, setError } = useStore();
  const [mode, setMode] = useState<'dm' | 'group'>('dm');
  const [dir, setDir] = useState<{ id: string; displayName: string; avatarColor: string; avatar: string | null }[]>([]);
  const [groupName, setGroupName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const t = useT();

  useEffect(() => { api.get('/api/users/directory').then((r) => setDir(r.users)).catch(() => {}); }, []);
  const candidates = dir.filter((d) => d.id !== user?.id);

  const startDm = async (userId: string) => {
    setBusy(true);
    try { await createDm(userId); onClose(); } catch (e: any) { setError(e.message); setBusy(false); }
  };
  const toggle = (id: string) => {
    const next = new Set(picked); next.has(id) ? next.delete(id) : next.add(id); setPicked(next);
  };
  const create = async () => {
    if (!groupName.trim()) { setError(t('dm.groupNameRequired')); return; }
    setBusy(true);
    try { await createGroup(groupName.trim(), [...picked]); onClose(); } catch (e: any) { setError(e.message); setBusy(false); }
  };

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={t('dm.newTitle')} width={420}>
      <div className="flex gap-2 mb-3">
        <button className={`text-xs px-3 py-1 rounded-full border ${mode === 'dm' ? 'bg-claysoft border-clay text-clay' : 'border-line text-txt3'}`} onClick={() => setMode('dm')}>{t('dm.tabDm')}</button>
        <button className={`text-xs px-3 py-1 rounded-full border ${mode === 'group' ? 'bg-claysoft border-clay text-clay' : 'border-line text-txt3'}`} onClick={() => setMode('group')}>{t('dm.tabGroup')}</button>
      </div>

      {mode === 'group' && (
        <input className="input mb-2" placeholder={t('dm.groupNamePlaceholder')} value={groupName} autoFocus
          onChange={(e) => setGroupName(e.target.value)} />
      )}

      <div className="max-h-64 overflow-auto scrolly border border-line rounded divide-y divide-line mb-3">
        {candidates.length === 0 && <div className="text-[11px] text-txt3 px-2 py-1.5">{t('common.none')}</div>}
        {candidates.map((d) => (
          <button key={d.id} disabled={busy}
            className="flex items-center gap-2 px-2.5 py-2 w-full text-left hover:bg-line disabled:opacity-50"
            onClick={() => (mode === 'dm' ? startDm(d.id) : toggle(d.id))}>
            <Avatar name={d.displayName} color={d.avatarColor} src={avatarUrl(d)} size={24} />
            <span className="flex-1 truncate text-[13px]">{d.displayName}</span>
            {mode === 'group' && <span className={picked.has(d.id) ? 'text-clay' : 'text-txt3'}>{picked.has(d.id) ? <IconCheckSquare size={16} /> : <IconSquare size={16} />}</span>}
          </button>
        ))}
      </div>

      {mode === 'group' && (
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button className="btn-primary" onClick={create} disabled={busy || !groupName.trim()}>{busy ? t('common.creating') : t('dm.createGroup')}</button>
        </div>
      )}
      {mode === 'dm' && <div className="text-[11px] text-txt3">{t('dm.dmPickHint')}</div>}
    </Modal>
  );
}

function verdictBadge(verdict: string) {
  switch (verdict) {
    case 'running': return <IconClock size={15} className="text-clay" />;
    case 'merge_safe': return <IconCheckCircle size={15} className="text-ok" />;
    case 'do_not_merge': return <IconBan size={15} className="text-danger" />;
    case 'conflict': return <IconWarning size={15} className="text-warn" />;
    case 'error': return <IconWarning size={15} className="text-danger" />;
    default: return <IconGitBranch size={15} className="text-txt3" />;
  }
}

// PR-review section: admin sees each watched repo with its PR sessions nested (+ poll/delete);
// members see only the review sessions for PRs they authored (read-only).
function ReviewSection() {
  const { reviewRepos, reviewSessions, current, panel, setPanel, openReview, deleteReviewRepo, pollReviewRepo, user } = useStore();
  const [showAdd, setShowAdd] = useState(false);
  const [editRepo, setEditRepo] = useState<ReviewRepo | null>(null);
  const [busyPoll, setBusyPoll] = useState<string | null>(null);
  const isAdmin = user?.role === 'admin';
  const t = useT();

  const poll = async (id: string) => {
    setBusyPoll(id);
    try { await pollReviewRepo(id); } catch (e: any) { useStore.getState().setError(e.message); } finally { setBusyPoll(null); }
  };

  const sessionItem = (s: ReviewSessionSummary) => (
    <Item key={s.id} active={panel === null && current?.reviewId === s.id} onClick={() => { setPanel(null); openReview(s.id); }}>
      <span className="opacity-70">{verdictBadge(s.verdict)}</span>
      <span className={`flex-1 truncate text-[13px] ${s.prState !== 'open' ? 'line-through text-txt3' : ''}`} title={s.verdictSummary || s.prTitle}>
        <span className="text-txt3">#{s.prNumber}</span> {s.prTitle}
      </span>
    </Item>
  );

  return (
    <>
      <Section label={t('review.section')} onAdd={isAdmin ? () => setShowAdd(true) : undefined} />
      {isAdmin ? (
        reviewRepos.length === 0
          ? <div className="text-[11px] text-txt3 px-2 py-1">{t('review.addRepoHint')}</div>
          : reviewRepos.map((r) => (
            <div key={r.id}>
              <div className="group flex items-center gap-1.5 px-2 py-1 text-[11px] text-txt2">
                <span className="opacity-70"><IconBox size={14} /></span>
                <span className="flex-1 truncate font-semibold" title={`${r.host}/${r.slug}`}>{r.name}</span>
                <span className="text-txt3 group-hover:hidden">{t('review.openCount', { count: r.openCount })}</span>
                <button className="hidden group-hover:block hover:text-clay disabled:opacity-40" title={t('review.pollNow')} aria-label={t('review.pollNow')}
                  disabled={busyPoll === r.id} onClick={() => poll(r.id)}>{busyPoll === r.id ? '…' : <IconRefresh size={13} />}</button>
                <button className="hidden group-hover:block hover:text-clay" title={t('review.editRepoTitle')} aria-label={t('review.editRepoTitle')}
                  onClick={() => setEditRepo(r)}><IconPencil size={13} /></button>
                <button className="hidden group-hover:block hover:text-danger" title={t('review.deleteRepoTitle')} aria-label={t('review.deleteRepoTitle')}
                  onClick={() => { if (confirm(t('review.deleteRepoConfirm', { name: r.name }))) deleteReviewRepo(r.id); }}><IconTrash size={13} /></button>
              </div>
              {r.pollError && <div className="px-2 pb-1 text-[10px] text-danger truncate" title={r.pollError}>{t('review.pollErrorLabel')}</div>}
              {reviewSessions.filter((s) => s.repoId === r.id).map(sessionItem)}
            </div>
          ))
      ) : (
        reviewSessions.length === 0
          ? <div className="text-[11px] text-txt3 px-2 py-1">{t('common.none')}</div>
          : reviewSessions.map(sessionItem)
      )}
      {showAdd && <AddReviewRepoModal onClose={() => setShowAdd(false)} />}
      {editRepo && <EditReviewRepoModal repo={editRepo} onClose={() => setEditRepo(null)} />}
    </>
  );
}

// Admin-only: register a remote to watch. Requires a merge/push-capable git credential for that host.
function AddReviewRepoModal({ onClose }: { onClose: () => void }) {
  const newReviewRepo = useStore((s) => s.newReviewRepo);
  const setError = useStore((s) => s.setError);
  const [name, setName] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [sandboxImage, setSandboxImage] = useState('');
  const [credentialId, setCredentialId] = useState('');
  const [provider, setProvider] = useState('');
  const [creds, setCreds] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const t = useT();

  useEffect(() => { api.get('/api/git-credentials').then((r) => setCreds([...(r.mine || []), ...(r.common || [])])).catch(() => {}); }, []);

  const submit = async () => {
    if (!gitUrl.trim()) { setError(t('review.gitUrlRequired')); return; }
    if (!credentialId) { setError(t('review.credRequired')); return; }
    setBusy(true);
    try {
      await newReviewRepo({ name: name.trim() || undefined, gitUrl: gitUrl.trim(), credentialId, provider: provider || undefined, baseBranch: baseBranch.trim() || undefined, sandboxImage: sandboxImage.trim() || undefined });
      onClose();
    } catch (e: any) { setError(e.message); setBusy(false); }
  };

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={t('review.addRepoTitle')} width={460}>
      <div className="text-[11px] text-txt3 mb-2">{t('review.addRepoHelp')}</div>
      <input className="input mb-2" placeholder={t('review.repoNamePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input mb-2" placeholder={t('review.gitUrlPlaceholder')} value={gitUrl} autoFocus onChange={(e) => setGitUrl(e.target.value)} />
      <input className="input mb-2" placeholder={t('review.baseBranchPlaceholder')} value={baseBranch} onChange={(e) => setBaseBranch(e.target.value)} />
      <input className="input mb-1" placeholder={t('review.sandboxImagePlaceholder')} value={sandboxImage} onChange={(e) => setSandboxImage(e.target.value)} />
      <div className="text-[11px] text-txt3 mb-2">{t('review.sandboxImageHint')}</div>
      <select className="input mb-2" value={credentialId} onChange={(e) => setCredentialId(e.target.value)}>
        <option value="">{t('review.selectCred')}</option>
        {creds.map((cr) => <option key={cr.id} value={cr.id}>[{cr.provider}] {cr.host} · {cr.username}</option>)}
      </select>
      <select className="input mb-3" value={provider} onChange={(e) => setProvider(e.target.value)}>
        <option value="">{t('review.providerAuto')}</option>
        <option value="github">GitHub</option>
        <option value="gitlab">GitLab</option>
        <option value="bitbucket">Bitbucket</option>
      </select>
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? t('review.cloning') : t('review.addRepoBtn')}</button>
      </div>
    </Modal>
  );
}

// Admin-only: edit a registered repo's non-destructive fields (name / base branch / build image / credential).
// gitUrl/provider are immutable here — changing them means a different repo (delete + re-add).
function EditReviewRepoModal({ repo, onClose }: { repo: ReviewRepo; onClose: () => void }) {
  const updateReviewRepo = useStore((s) => s.updateReviewRepo);
  const setError = useStore((s) => s.setError);
  const [name, setName] = useState(repo.name);
  const [baseBranch, setBaseBranch] = useState(repo.baseBranch || '');
  const [sandboxImage, setSandboxImage] = useState(repo.sandboxImage || '');
  const [credentialId, setCredentialId] = useState('');
  const [creds, setCreds] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const t = useT();

  useEffect(() => { api.get('/api/git-credentials').then((r) => setCreds([...(r.mine || []), ...(r.common || [])])).catch(() => {}); }, []);

  const submit = async () => {
    if (!name.trim()) { setError(t('review.repoNameRequired')); return; }
    setBusy(true);
    try {
      await updateReviewRepo(repo.id, { name: name.trim(), baseBranch: baseBranch.trim(), sandboxImage: sandboxImage.trim(), credentialId: credentialId || undefined });
      onClose();
    } catch (e: any) { setError(e.message); setBusy(false); }
  };

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={t('review.editRepoTitle')} width={460}>
      <div className="text-[11px] text-txt3 mb-2" title={`${repo.host}/${repo.slug}`}>{repo.host}/{repo.slug}</div>
      <input className="input mb-2" placeholder={t('review.repoNamePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input mb-2" placeholder={t('review.baseBranchPlaceholder')} value={baseBranch} onChange={(e) => setBaseBranch(e.target.value)} />
      <input className="input mb-1" placeholder={t('review.sandboxImagePlaceholder')} value={sandboxImage} onChange={(e) => setSandboxImage(e.target.value)} />
      <div className="text-[11px] text-txt3 mb-2">{t('review.sandboxImageHint')}</div>
      <select className="input mb-3" value={credentialId} onChange={(e) => setCredentialId(e.target.value)}>
        <option value="">{t('review.credKeep')}</option>
        {creds.filter((cr) => cr.host === repo.host).map((cr) => <option key={cr.id} value={cr.id}>[{cr.provider}] {cr.host} · {cr.username}</option>)}
      </select>
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? t('review.saving') : t('common.save')}</button>
      </div>
    </Modal>
  );
}

function Section({ label, onAdd, extra }: { label: string; onAdd?: () => void; extra?: React.ReactNode }) {
  return (
    <div className="text-[11px] tracking-wider uppercase text-txt3 px-2 pt-3 pb-1 font-semibold flex justify-between items-center">
      {label}
      <span className="flex items-center gap-1.5">
        {extra}
        {onAdd && <span className="cursor-pointer leading-none text-txt3 hover:text-txt" onClick={onAdd}><IconPlus size={15} /></span>}
      </span>
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
