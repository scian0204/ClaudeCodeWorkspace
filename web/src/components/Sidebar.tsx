import { useState, useRef, useEffect } from 'react';
import { useStore, useBrand, type ReviewSessionSummary, type ReviewRepo, type DmChannel, type PrivateSession, type RoomSummary, type WikiTopic } from '../lib/store';
import { api, type UploadState } from '../lib/api';
import { Avatar, avatarUrl, timeAgo, LangSelect, ClaySpark } from '../lib/ui';
import { fmtKeys, withKeys } from '../lib/shortcuts';
import { openContextMenu, type CtxRows } from '../lib/contextmenu';
import { copyToClipboard } from '../lib/clipboard';
import { collectDrop, collectPick, type Collected } from '../lib/dropfiles';
import { Modal } from './Modal';
import { ImportSessionModal } from './ImportSessionModal';
import { WikiExplorer } from './WikiExplorer';
import { SearchButton } from './SearchPalette';
import { UploadProgress } from './UploadProgress';
import { useT } from '../lib/i18n';
import {
  IconX, IconUpload, IconMessage, IconPencil, IconTrash, IconUsers, IconClock, IconWarning,
  IconBook, IconPuzzle, IconSliders, IconLogout, IconFile, IconBox, IconRefresh, IconPlus,
  IconCheckCircle, IconBan, IconGitBranch, IconCheckSquare, IconSquare, IconFolder, IconPanelLeft,
  IconGlobe, IconKeyboard, IconSparkle, IconChevronDown, IconChevronRight, IconCopy,
} from '../lib/icons';

export function Sidebar() {
  const { user, sessions, rooms, projects, wikiTopics, current, openPrivate, openRoom, openWiki, newSession, newRoom, logout, setPanel, panel, deleteSession, deleteRoom, deleteWikiTopic, renameSession, retitleSession, autoTitleEnabled, setError, sidebarOpen, setSidebarOpen, sidebarCollapsed, setSidebarCollapsed, sessionImportEnabled, teamAgentsEnabled, pendingRequestCount, updateAvailable, updateLatest, channels, activeChannelId, openChannel, dmEnabled, goHome, setShortcutsOpen, titling, projectChanges } = useStore();
  const [showRoom, setShowRoom] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [showWiki, setShowWiki] = useState(false);
  const [showDm, setShowDm] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const brand = useBrand();
  const [srcTopic, setSrcTopic] = useState<string | null>(null); // wiki topic whose sources are open in the explorer
  const [cfgTopic, setCfgTopic] = useState<string | null>(null); // wiki topic whose settings dialog is open
  // collapsed session groups (project ids, '' = unassigned) — same localStorage habit as sidebarCollapsed
  const [closedGroups, setClosedGroups] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('sidebarGroups') || '[]'); } catch { return []; }
  });
  const isAdmin = user?.role === 'admin';
  const t = useT();

  const toggleGroup = (key: string) => setClosedGroups((c) => {
    const next = c.includes(key) ? c.filter((k) => k !== key) : [...c, key];
    localStorage.setItem('sidebarGroups', JSON.stringify(next));
    return next;
  });

  // Chats sit under their project: common projects first, then personal, unassigned last. A session
  // pointing at a project the user can't see (removed, room-scoped) falls into unassigned so it
  // can never disappear from the list. Empty projects get no header.
  const projList = [
    ...projects.common.map((p) => ({ ...p, tag: t('chat.tagCommon') })),
    ...projects.mine.map((p) => ({ ...p, tag: t('chat.tagMine') })),
  ];
  const groups = [...projList.map((p) => ({ key: p.id, name: p.name, tag: p.tag })), { key: '', name: t('sidebar.noProjectGroup'), tag: '' }]
    .map((g) => ({ ...g, items: sessions.filter((s) => (projList.some((p) => p.id === s.projectId) ? s.projectId : '') === g.key) }))
    .filter((g) => g.items.length > 0);

  const channelLabel = (ch: DmChannel) => (ch.kind === 'group' ? (ch.name || t('dm.group')) : (ch.members.find((m) => m.userId !== user?.id)?.displayName || t('dm.dm')));

  const create = async () => { if (!roomName.trim()) return; await newRoom(roomName.trim()); setRoomName(''); setShowRoom(false); };

  // One copy of each row action, shared by the hover buttons and the right-click menu.
  const renameChat = (s: PrivateSession) => {
    const nt = prompt(t('sidebar.renameChatPrompt'), s.title);
    if (nt && nt.trim() && nt.trim() !== s.title) renameSession(s.id, nt.trim());
  };
  // Ask the model to name the chat after its conversation. No confirm: it only replaces a title, and
  // Rename right above it undoes that in one step.
  // naming in flight: this tab pressed the button, or the server is naming the chat anyway (first
  // turn just ended, another tab pressed it) — one flag in the store covers both
  const isNaming = (id: string) => titling.includes(id);
  const retitleChat = (s: PrivateSession) => { retitleSession(s.id).catch((e: any) => setError(e.message)); };
  const removeChat = (s: PrivateSession) => { if (confirm(t('sidebar.deleteChatConfirm', { title: s.title }))) deleteSession(s.id); };
  const removeRoom = (r: RoomSummary) => { if (confirm(t('sidebar.deleteRoomConfirm', { name: r.name }))) deleteRoom(r.id); };
  const removeTopic = (wt: WikiTopic) => { if (confirm(t('sidebar.deleteTopicConfirm', { name: wt.name }))) deleteWikiTopic(wt.id); };

  return (
    <aside className={`bg-rail border-r border-line flex flex-col min-h-0 h-full
      max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:w-[264px] max-md:z-50 max-md:shadow-2xl
      max-md:transition-transform max-md:duration-200 ${sidebarOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'}
      ${sidebarCollapsed ? 'md:hidden' : ''}`}>
      <div className="px-3.5 pt-3.5 pb-2">
        {/* One flow row instead of absolutely-positioned chrome: the title used to run underneath the
            language toggle, since nowrap text ignores the padding reserved for it. */}
        <div className="flex items-start gap-1 mb-3.5">
          {/* the logo is the way back to the landing screen */}
          <button className="flex items-center gap-2 min-w-0 flex-1 text-left rounded-md hover:opacity-80"
            title={withKeys(t('nav.home'), 'Mod+Shift+H')} onClick={() => goHome()}>
            <img src={brand.logo} alt="" className="w-[26px] h-[26px] rounded-md shrink-0 object-contain" />
            <div className="leading-tight min-w-0">
              <div className="font-semibold text-sm tracking-tight truncate">{brand.title}</div>
              <div className="text-[11px] text-txt3 truncate">{t('sidebar.teamName', { name: user?.displayName ?? '' })}</div>
            </div>
          </button>
          {/* only the drawer/collapse control lives up here — the language switch moved to the footer
              so the brand title gets the full width instead of being truncated */}
          <div className="shrink-0">
            <button className="toolbtn md:hidden" aria-label={t('nav.closeMenu')} onClick={() => setSidebarOpen(false)}><IconX /></button>
            <button className="toolbtn max-md:hidden" title={withKeys(t('nav.collapseSidebar'), 'Mod+B')} aria-label={t('nav.collapseSidebar')}
              onClick={() => setSidebarCollapsed(true)}><IconPanelLeft /></button>
          </div>
        </div>
        <button className="btn-primary w-full flex items-center justify-center gap-2 !py-2" title={withKeys(t('sidebar.newChat'), 'Mod+Shift+O')} onClick={() => newSession()}><IconPlus size={16} />{t('sidebar.newChat')}</button>
        <SearchButton label className="mt-2" />
      </div>

      <div className="flex-1 overflow-y-auto scrolly px-2 pb-1">
        <Section label={t('sidebar.personal')} onAdd={() => newSession()}
          extra={sessionImportEnabled ? <button className="cursor-pointer leading-none text-txt3 hover:text-txt" title={t('import.button')} aria-label={t('import.button')} onClick={() => setImportOpen(true)}><IconUpload size={15} /></button> : undefined} />
        {sessions.length === 0 && <div className="text-[11px] text-txt3 px-2 py-1">{t('common.none')}</div>}
        {groups.map((g) => (<div key={g.key || '_none'} className="mb-2">
          <GroupHeader name={g.name} tag={g.tag} count={g.items.length}
            open={!closedGroups.includes(g.key)} onToggle={() => toggleGroup(g.key)}
            onAdd={() => newSession(g.key || undefined)} />
          {!closedGroups.includes(g.key) && g.items.map((s) => (
          <Item key={s.id} active={panel === null && current?.chatSessionId === s.id} onClick={() => { setPanel(null); openPrivate(s.id); }}
            menu={[{ label: t('ctx.open'), icon: <IconMessage size={14} />, onSelect: () => { setPanel(null); openPrivate(s.id); } }]}>
            <span className="opacity-70"><IconMessage size={15} /></span>
            {/* while the model is picking a name, the row title itself waits with the clay glint */}
            <span className={`flex-1 truncate text-[13px] ${isNaming(s.id) ? 'clay-shimmer' : ''}`}>{s.title}</span>
            {/* its project changed somewhere else and nobody has looked yet */}
            {projectChanges[s.id] && <span className="w-[7px] h-[7px] rounded-full bg-clay shrink-0" title={t('watch.dot')} />}
            <span className="text-[11px] text-txt3 group-hover:hidden">{timeAgo(s.updatedAt)}</span>
            {autoTitleEnabled && (
              <button className={`${isNaming(s.id) ? 'block' : 'hidden group-hover:block'} text-txt3 hover:text-clay px-1`}
                disabled={isNaming(s.id)} aria-busy={isNaming(s.id)}
                title={t(isNaming(s.id) ? 'sidebar.retitleChatBusy' : 'sidebar.retitleChatTitle')}
                aria-label={t(isNaming(s.id) ? 'sidebar.retitleChatBusy' : 'sidebar.retitleChatTitle')}
                onClick={(e) => { e.stopPropagation(); void retitleChat(s); }}>
                {isNaming(s.id) ? <ClaySpark size={15} /> : <IconSparkle size={14} />}</button>
            )}
            <button className="hidden group-hover:block text-txt3 hover:text-clay px-1" title={t('sidebar.renameChatTitle')} aria-label={t('sidebar.renameChatTitle')}
              onClick={(e) => { e.stopPropagation(); renameChat(s); }}><IconPencil size={14} /></button>
            <button className="hidden group-hover:block text-txt3 hover:text-danger px-1" title={t('sidebar.deleteChatTitle')} aria-label={t('sidebar.deleteChatTitle')}
              onClick={(e) => { e.stopPropagation(); removeChat(s); }}><IconTrash size={14} /></button>
          </Item>
          ))}
        </div>))}

        <Section label={t('sidebar.rooms')} onAdd={() => setShowRoom(true)} />
        {rooms.length === 0 && <div className="text-[11px] text-txt3 px-2 py-1">{t('common.none')}</div>}
        {rooms.map((r) => (
          <Item key={r.id} active={panel === null && current?.roomId === r.id} onClick={() => { setPanel(null); openRoom(r.id); }}
            menu={[{ label: t('ctx.open'), icon: <IconMessage size={14} />, onSelect: () => { setPanel(null); openRoom(r.id); } }]}>
            <span className="w-[7px] h-[7px] rounded-full bg-ok shrink-0" />
            <span className="flex-1 truncate text-[13px]">{r.name}</span>
            {projectChanges[r.chatSessionId] && <span className="w-[7px] h-[7px] rounded-full bg-clay shrink-0" title={t('watch.dot')} />}
            <span className="flex group-hover:hidden">
              {r.members.slice(0, 3).map((m) => (
                <span key={m.userId} className="w-[17px] h-[17px] rounded-full grid place-items-center text-[9px] text-white font-semibold -ml-1.5 border-[1.5px]"
                  style={{ background: m.avatarColor, borderColor: 'var(--rail)' }}>{m.displayName.slice(0, 2).toUpperCase()}</span>
              ))}
            </span>
            <button className="hidden group-hover:block text-txt3 hover:text-danger px-1" title={t('sidebar.deleteRoomTitle')} aria-label={t('sidebar.deleteRoomTitle')}
              onClick={(e) => { e.stopPropagation(); removeRoom(r); }}><IconTrash size={14} /></button>
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
          <Item key={wt.id} active={panel === null && current?.wikiTopicId === wt.id} onClick={() => { setPanel(null); openWiki(wt.id); }}
            menu={[{ label: t('ctx.open'), icon: <IconBook size={14} />, onSelect: () => { setPanel(null); openWiki(wt.id); } }]}>
            <span className="opacity-70">{wt.compileStatus === 'compiling' ? <IconClock size={15} /> : wt.compileStatus === 'error' ? <IconWarning size={15} className="text-warn" /> : <IconBook size={15} />}</span>
            <span className="flex-1 truncate text-[13px]">{wt.name}</span>
            {wt.kind === 'minutes' && <span className="text-[10px] text-txt3 border border-line rounded px-1 shrink-0 group-hover:hidden">{t('wiki.minutesTag')}</span>}
            {wt.compileStatus === 'compiling' && <span className="text-[10px] text-txt3 group-hover:hidden">{t('sidebar.compiling')}</span>}
            {isAdmin && (
              // source manager: the same explorer the chat banner opens, reachable without switching threads
              <button className="hidden group-hover:block text-txt3 hover:text-clay px-1" title={t('sidebar.manageSourcesTitle')} aria-label={t('sidebar.manageSourcesTitle')}
                onClick={(e) => { e.stopPropagation(); setSrcTopic(wt.id); }}><IconFolder size={14} /></button>
            )}
            {isAdmin && (
              <button className="hidden group-hover:block text-txt3 hover:text-clay px-1" title={t('wiki.topicSettings')} aria-label={t('wiki.topicSettings')}
                onClick={(e) => { e.stopPropagation(); setCfgTopic(wt.id); }}><IconSliders size={14} /></button>
            )}
            {isAdmin && (
              <button className="hidden group-hover:block text-txt3 hover:text-danger px-1" title={t('sidebar.deleteTopicTitle')} aria-label={t('sidebar.deleteTopicTitle')}
                onClick={(e) => { e.stopPropagation(); removeTopic(wt); }}><IconTrash size={14} /></button>
            )}
          </Item>
        ))}

        <ReviewSection />
      </div>

      <div className="border-t border-line p-2.5">
        <button className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md w-full text-left ${panel === 'me' ? 'bg-claysoft' : 'hover:bg-line'}`} onClick={() => setPanel('me')}>
          <Avatar name={user?.displayName} color={user?.avatarColor} src={avatarUrl(user)} />
          <div className="flex-1 text-[13px] min-w-0 truncate">{user?.displayName}</div>
          {/* same gate as the nag: a sign-in or provider profile is auth, so no warning badge */}
          {!user?.hasClaudeAuth && <span className="text-[10px] bg-warnsoft text-warn px-1.5 py-0.5 rounded-full whitespace-nowrap">{t('sidebar.tokenUnregistered')}</span>}
          <span className="text-[10px] bg-claysoft text-clay px-1.5 py-0.5 rounded-full font-semibold">{user?.role}</span>
        </button>
        <button className="flex items-center gap-2.5 px-2 py-1.5 rounded-md w-full hover:bg-line text-left text-[13px] text-txt2" onClick={() => setPanel('plugins')}>
          <span className="w-7 grid place-items-center"><IconPuzzle size={17} /></span> {t('sidebar.plugins')}
        </button>
        {teamAgentsEnabled && (
          <button className="flex items-center gap-2.5 px-2 py-1.5 rounded-md w-full hover:bg-line text-left text-[13px] text-txt2" onClick={() => setPanel('agents')}>
            <span className="w-7 grid place-items-center"><IconUsers size={17} /></span> {t('sidebar.agents')}
          </button>
        )}
        {/* A published update is worth seeing without opening the panel, so the row that leads there
            carries it: highlighted, with the version on a pill next to the pending-approvals count. */}
        {user?.role === 'admin' && (
          <button onClick={() => setPanel('admin')}
            title={updateAvailable ? (updateLatest ? t('admin.upd.bannerNew', { v: `v${updateLatest}` }) : t('admin.upd.bannerImage')) : undefined}
            className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md w-full text-left text-[13px] ${updateAvailable ? 'text-clay bg-claysoft font-semibold' : 'text-txt2 hover:bg-line'}`}>
            <span className="w-7 grid place-items-center"><IconSliders size={17} /></span> {t('sidebar.adminPanel')}
            <span className="ml-auto flex items-center gap-1 shrink-0">
              {updateAvailable && (
                <span className="text-[10px] bg-clay text-white px-1.5 py-0.5 rounded-full whitespace-nowrap">
                  {updateLatest ? `v${updateLatest}` : t('sidebar.updateBadge')}
                </span>
              )}
              {pendingRequestCount > 0 && <span className="text-[10px] bg-warnsoft text-warn px-1.5 py-0.5 rounded-full whitespace-nowrap">{pendingRequestCount}</span>}
            </span>
          </button>
        )}
        <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-md w-full text-[13px] text-txt2">
          <span className="w-7 grid place-items-center"><IconGlobe size={17} /></span> {t('lang.label')}
          <LangSelect className="ml-auto shrink-0 max-w-[104px] text-[11px] text-txt2 bg-card border border-line2 rounded-md px-1.5 py-0.5 outline-none cursor-pointer" />
        </div>
        <button className="flex items-center gap-2.5 px-2 py-1.5 rounded-md w-full hover:bg-line text-left text-[13px] text-txt2" onClick={() => setShortcutsOpen(true)}>
          <span className="w-7 grid place-items-center"><IconKeyboard size={17} /></span> {t('sc.footer')}
          <span className="ml-auto text-[10px] font-mono text-txt3">{fmtKeys('?')}</span>
        </button>
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
      {srcTopic && <WikiExplorer topicId={srcTopic} onClose={() => setSrcTopic(null)} />}
      {cfgTopic && <WikiSettingsModal topicId={cfgTopic} onClose={() => setCfgTopic(null)} />}
      {showDm && <NewChannelModal onClose={() => setShowDm(false)} />}
      {importOpen && sessionImportEnabled && <ImportSessionModal onClose={() => setImportOpen(false)} />}
    </aside>
  );
}

function fmtSize(n: number) { return n >= 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}B`; }

// Starting a topic. Four ways in, picked at the top of the dialog: upload files (the original
// flow - drop whole folders, each file streams to a server staging area with real progress), pull
// in an existing chat or project, or start empty and let the conversations fill it. The topic's
// "grow from conversations" mode is chosen here too, since it decides what happens from turn one.
function WikiCreateModal({ onClose }: { onClose: () => void }) {
  const newWikiTopic = useStore((s) => s.newWikiTopic);
  const setError = useStore((s) => s.setError);
  const sessions = useStore((s) => s.sessions);
  const rooms = useStore((s) => s.rooms);
  const projects = useStore((s) => s.projects);
  const learnEnabled = useStore((s) => s.wikiAutoLearnEnabled);
  const [sid] = useState(() => (crypto.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32));
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [kind, setKind] = useState<'wiki' | 'minutes'>('wiki');
  const [seed, setSeed] = useState<'upload' | 'session' | 'project' | 'blank'>('upload');
  const [seedSessionId, setSeedSessionId] = useState('');
  const [seedProjectId, setSeedProjectId] = useState('');
  const [autoLearn, setAutoLearn] = useState('ask');
  const [precompiled, setPrecompiled] = useState(false); // upload IS an already-compiled wiki
  const [files, setFiles] = useState<{ name: string; size: number }[]>([]);
  const [progress, setProgress] = useState<UploadState | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const t = useT();

  const uploadCollected = async (list: Collected[]) => {
    if (!list.length) return;
    try {
      const r = await api.uploadFiles(`/api/wiki/staging/${sid}/files`, list, setProgress);
      setFiles(r.files || []);
    } catch (e: any) { setError(e.message); }
    finally { setProgress(null); if (fileRef.current) fileRef.current.value = ''; if (dirRef.current) dirRef.current.value = ''; }
  };

  const pick = (fl: FileList | null) => { void uploadCollected(collectPick(fl)); };

  const onDrop = async (ev: React.DragEvent) => {
    ev.preventDefault(); setDragOver(false);
    await uploadCollected(await collectDrop(ev.dataTransfer));
  };

  const removeFile = async (rel: string) => {
    try { const r = await api.del(`/api/wiki/staging/${sid}/file?path=${encodeURIComponent(rel)}`); setFiles(r.files || []); }
    catch (e: any) { setError(e.message); }
  };

  // staged bytes are only ever wanted by an upload-seeded topic - drop them whichever way we leave
  const cancel = () => { api.del(`/api/wiki/staging/${sid}`).catch(() => {}); onClose(); };

  const confirm = async () => {
    if (!name.trim()) { setError(t('sidebar.topicNameRequired')); return; }
    if ((seed === 'session' && !seedSessionId) || (seed === 'project' && !seedProjectId)) {
      setError(t('wiki.seedRequired')); return;
    }
    setBusy(true);
    try {
      await newWikiTopic({
        name: name.trim(), description: desc.trim(), seedType: seed, autoLearn, kind,
        stagingId: seed === 'upload' ? sid : undefined,
        precompiled: seed === 'upload' && precompiled,
        seedSessionId: seed === 'session' ? seedSessionId : undefined,
        seedProjectId: seed === 'project' ? seedProjectId : undefined,
      });
      if (seed !== 'upload') api.del(`/api/wiki/staging/${sid}`).catch(() => {});
      onClose();
    } catch (e: any) { setError(e.message); setBusy(false); }
  };

  const SEEDS = [
    { key: 'upload', label: t('wiki.seedUpload'), hint: t('wiki.seedUploadHint') },
    { key: 'session', label: t('wiki.seedSession'), hint: t('wiki.seedSessionHint') },
    { key: 'project', label: t('wiki.seedProject'), hint: t('wiki.seedProjectHint') },
    { key: 'blank', label: t('wiki.seedBlank'), hint: t('wiki.seedBlankHint') },
  ] as const;

  return (
    <Modal open onOpenChange={(o) => { if (!o) cancel(); }} title={t('sidebar.newWikiTopicTitle')} width={480}>
      <input className="input mb-2" placeholder={t('sidebar.topicNamePlaceholder')} value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      <textarea className="input mb-3 resize-none" rows={3} placeholder={t('sidebar.topicDescPlaceholder')}
        value={desc} onChange={(e) => setDesc(e.target.value)} />

      {/* what this base IS: synthesized articles, or per-meeting minutes with decision/action registers */}
      <div className="text-[11px] text-txt3 mb-1">{t('wiki.kindLabel')}</div>
      <div className="seg w-full mb-1.5">
        {(['wiki', 'minutes'] as const).map((k) => (
          <button key={k} className={`flex-1 ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
            {t(k === 'wiki' ? 'wiki.kindWiki' : 'wiki.kindMinutes')}
          </button>
        ))}
      </div>
      <div className="text-[11px] text-txt3 mb-3">{t(kind === 'minutes' ? 'wiki.kindMinutesHint' : 'wiki.kindWikiHint')}</div>

      {/* start-from picker: a 2-col grid rather than a segmented row, so four labels still fit on a phone */}
      <div className="text-[11px] text-txt3 mb-1">{t('wiki.seedLabel')}</div>
      <div className="grid grid-cols-2 gap-1.5 mb-1.5">
        {SEEDS.map((o) => (
          <button key={o.key} onClick={() => {
            setSeed(o.key);
            // an empty base with learning off can neither answer nor fill up, so starting blank
            // moves the mode off 'off' unless the admin has already chosen one deliberately
            if (o.key === 'blank' && autoLearn === 'off') setAutoLearn('auto');
          }}
            className={`text-xs rounded-md border px-2 py-1.5 text-left ${seed === o.key ? 'border-clay bg-claysoft text-clay font-semibold' : 'border-line hover:bg-line'}`}>
            {o.label}
          </button>
        ))}
      </div>
      <div className="text-[11px] text-txt3 mb-3">{SEEDS.find((o) => o.key === seed)?.hint}</div>

      {seed === 'session' && (
        <select className="input mb-3" value={seedSessionId} onChange={(e) => setSeedSessionId(e.target.value)}>
          <option value="">{t('wiki.seedNone')}</option>
          <optgroup label={t('wiki.seedGroupPersonal')}>
            {sessions.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          </optgroup>
          <optgroup label={t('wiki.seedGroupRoom')}>
            {rooms.map((r) => <option key={r.id} value={r.chatSessionId}>{r.name}</option>)}
          </optgroup>
        </select>
      )}

      {seed === 'project' && (
        <select className="input mb-3" value={seedProjectId} onChange={(e) => setSeedProjectId(e.target.value)}>
          <option value="">{t('wiki.seedNone')}</option>
          <optgroup label={t('wiki.seedGroupCommon')}>
            {projects.common.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </optgroup>
          <optgroup label={t('wiki.seedGroupMine')}>
            {projects.mine.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </optgroup>
        </select>
      )}

      {seed === 'upload' && <>
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
          <div className="text-xs text-txt2 mb-2 inline-flex items-center gap-1"><IconFolder size={14} />{t(precompiled ? 'sidebar.dropZonePrecompiled' : 'sidebar.dropZone')}</div>
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
      </>}

      <LearnModePicker value={autoLearn} onChange={setAutoLearn} enabled={learnEnabled} />

      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] text-txt3">{t('sidebar.queryOnlyHint')}</span>
        {seed === 'upload' && files.length > 0 && <span className="text-[11px] text-txt3">{t('sidebar.fileCount', { count: files.length })}</span>}
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={cancel} disabled={busy}>{t('common.cancel')}</button>
        <button className="btn-primary" onClick={confirm} disabled={busy || progress !== null}>
          {busy ? t('common.creating') : seed === 'upload' && files.length ? t('sidebar.confirmWithCount', { count: files.length }) : t('common.confirm')}
        </button>
      </div>
    </Modal>
  );
}

// off / ask first / add automatically. Shared by the create dialog and the per-topic settings, so
// the wording a user picked from is the same in both places.
function LearnModePicker({ value, onChange, enabled }: { value: string; onChange: (v: string) => void; enabled: boolean }) {
  const t = useT();
  return (
    <div className="mb-3">
      <div className="text-[11px] text-txt3 mb-1">{t('wiki.learnLabel')}</div>
      <div className="seg w-full">
        {(['off', 'ask', 'auto'] as const).map((m) => (
          <button key={m} className={`flex-1 ${value === m ? 'on' : ''}`} onClick={() => onChange(m)}>
            {t(m === 'off' ? 'wiki.learnOff' : m === 'ask' ? 'wiki.learnAsk' : 'wiki.learnAuto')}
          </button>
        ))}
      </div>
      <div className="text-[11px] text-txt3 mt-1">{enabled ? t('wiki.learnHint') : t('wiki.learnDisabled')}</div>
    </div>
  );
}

// Per-topic settings an admin can change after the fact: what it is called, what it is for, and
// what a finished conversation is allowed to add to it.
function WikiSettingsModal({ topicId, onClose }: { topicId: string; onClose: () => void }) {
  const topic = useStore((s) => s.wikiTopics.find((x) => x.id === topicId));
  const updateWikiTopic = useStore((s) => s.updateWikiTopic);
  const setError = useStore((s) => s.setError);
  const learnEnabled = useStore((s) => s.wikiAutoLearnEnabled);
  const [name, setName] = useState(topic?.name || '');
  const [desc, setDesc] = useState(topic?.description || '');
  const [autoLearn, setAutoLearn] = useState(topic?.autoLearn || 'off');
  const [busy, setBusy] = useState(false);
  const t = useT();
  if (!topic) return null;

  const save = async () => {
    if (!name.trim()) { setError(t('sidebar.topicNameRequired')); return; }
    setBusy(true);
    try { await updateWikiTopic(topicId, { name: name.trim(), description: desc.trim(), autoLearn }); onClose(); }
    catch (e: any) { setError(e.message); setBusy(false); }
  };

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={t('wiki.topicSettings')} width={420}>
      <input className="input mb-2" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder={t('sidebar.topicNamePlaceholder')} />
      <textarea className="input mb-3 resize-none" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t('sidebar.topicDescPlaceholder')} />
      <LearnModePicker value={autoLearn} onChange={setAutoLearn} enabled={learnEnabled} />
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
        <button className="btn-primary" onClick={save} disabled={busy}>{t('common.save')}</button>
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
                {!r.pollEnabled && <span className="text-txt3 shrink-0" title={t('review.pollDisabledHint')}>{t('review.pollOffTag')}</span>}
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
  const webhookEnabled = useStore((s) => s.reviewWebhookEnabled);
  const setError = useStore((s) => s.setError);
  const [name, setName] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [sandboxImage, setSandboxImage] = useState('');
  const [credentialId, setCredentialId] = useState('');
  const [provider, setProvider] = useState('');
  const [creds, setCreds] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [pollEnabled, setPollEnabled] = useState(true);
  const [webhook, setWebhook] = useState(false);
  // Set once the repo is created with a webhook: its URL/secret are shown right here, because this
  // is the moment the admin needs them — otherwise they'd have to reopen the edit dialog to look.
  const [created, setCreated] = useState<ReviewRepo | null>(null);
  const t = useT();

  useEffect(() => { api.get('/api/git-credentials').then((r) => setCreds([...(r.mine || []), ...(r.common || [])])).catch(() => {}); }, []);

  const submit = async () => {
    if (!gitUrl.trim()) { setError(t('review.gitUrlRequired')); return; }
    if (!credentialId) { setError(t('review.credRequired')); return; }
    setBusy(true);
    try {
      const repo = await newReviewRepo({ name: name.trim() || undefined, gitUrl: gitUrl.trim(), credentialId, provider: provider || undefined, baseBranch: baseBranch.trim() || undefined, sandboxImage: sandboxImage.trim() || undefined, webhook, pollEnabled });
      if (repo?.webhookSecret) { setCreated(repo); setBusy(false); return; } // show the hook fields first
      onClose();
    } catch (e: any) { setError(e.message); setBusy(false); }
  };

  if (created?.webhookSecret) {
    return (
      <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={t('review.webhookIssuedTitle')} width={460}>
        <div className="text-[11px] text-txt3 mb-2">{t('review.webhookIssuedHint')}</div>
        <WebhookFields repo={created} secret={created.webhookSecret} />
        <div className="flex justify-end">
          <button className="btn-primary" onClick={onClose}>{t('common.close')}</button>
        </div>
      </Modal>
    );
  }

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
      <div className="border-t border-line pt-2 mb-3">
        <CheckRow checked={pollEnabled} onToggle={() => setPollEnabled(!pollEnabled)}
          label={t('review.pollEnabledLabel')} hint={t(pollEnabled ? 'review.pollEnabledHint' : 'review.pollDisabledHint')} />
        {webhookEnabled && (
          <CheckRow checked={webhook} onToggle={() => setWebhook(!webhook)}
            label={t('review.webhookAtCreate')} hint={t('review.webhookHint')} />
        )}
      </div>
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
  const setReviewWebhook = useStore((s) => s.setReviewWebhook);
  const webhookEnabled = useStore((s) => s.reviewWebhookEnabled);
  const setError = useStore((s) => s.setError);
  const [name, setName] = useState(repo.name);
  const [baseBranch, setBaseBranch] = useState(repo.baseBranch || '');
  const [sandboxImage, setSandboxImage] = useState(repo.sandboxImage || '');
  const [credentialId, setCredentialId] = useState('');
  const [creds, setCreds] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState(repo.webhookSecret);
  const [hookBusy, setHookBusy] = useState(false);
  const [pollEnabled, setPollEnabled] = useState(repo.pollEnabled);
  const t = useT();

  const toggleHook = async (enable: boolean) => {
    setHookBusy(true);
    try { setSecret(await setReviewWebhook(repo.id, enable)); } catch (e: any) { setError(e.message); } finally { setHookBusy(false); }
  };

  useEffect(() => { api.get('/api/git-credentials').then((r) => setCreds([...(r.mine || []), ...(r.common || [])])).catch(() => {}); }, []);

  const submit = async () => {
    if (!name.trim()) { setError(t('review.repoNameRequired')); return; }
    setBusy(true);
    try {
      await updateReviewRepo(repo.id, { name: name.trim(), baseBranch: baseBranch.trim(), sandboxImage: sandboxImage.trim(), credentialId: credentialId || undefined, pollEnabled });
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
      <div className="border-t border-line pt-2 mb-3">
        <CheckRow checked={pollEnabled} onToggle={() => setPollEnabled(!pollEnabled)}
          label={t('review.pollEnabledLabel')} hint={t(pollEnabled ? 'review.pollEnabledHint' : 'review.pollDisabledHint')} />
      </div>
      {webhookEnabled && (
        <div className="border-t border-line pt-2 mb-3">
          <div className="text-[12px] font-semibold mb-1">{t('review.webhookTitle')}</div>
          <div className="text-[11px] text-txt3 mb-2">{t('review.webhookHint')}</div>
          {secret ? (
            <>
              <WebhookFields repo={repo} secret={secret} />
              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost" disabled={hookBusy}
                  onClick={() => { if (confirm(t('review.webhookRotateConfirm'))) void toggleHook(true); }}>{t('review.webhookRotate')}</button>
                <button className="btn-ghost text-danger" disabled={hookBusy}
                  onClick={() => { if (confirm(t('review.webhookDisableConfirm'))) void toggleHook(false); }}>{t('review.webhookDisable')}</button>
              </div>
            </>
          ) : (
            <button className="btn-ghost" disabled={hookBusy} onClick={() => void toggleHook(true)}>{t('review.webhookEnable')}</button>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? t('review.saving') : t('common.save')}</button>
      </div>
    </Modal>
  );
}

// The webhook URL + secret + per-provider setup steps. Shown right after a repo is created with a
// hook, and in the edit dialog for an existing one. GitHub/GitLab take the secret in their own field
// so their URL stays bare; Bitbucket has no secret field, so its secret rides in the query string.
function WebhookFields({ repo, secret }: { repo: { id: string; provider: string }; secret: string }) {
  const t = useT();
  const url = `${location.origin}/api/review/hooks/${repo.id}`
    + (repo.provider === 'bitbucket' ? `?token=${encodeURIComponent(secret)}` : '');
  const hintKey = repo.provider === 'gitlab' ? 'review.webhookGitlab'
    : repo.provider === 'bitbucket' ? 'review.webhookBitbucket' : 'review.webhookGithub';
  return (
    <>
      <CopyField label={t('review.webhookUrl')} value={url} />
      {repo.provider !== 'bitbucket' && <CopyField label={t('review.webhookSecretLabel')} value={secret} />}
      <div className="text-[11px] text-txt3 mb-2">{t(hintKey)}</div>
    </>
  );
}

// Checkbox row with a hint line under it (repo polling / webhook opt-in).
function CheckRow({ checked, onToggle, label, hint }: { checked: boolean; onToggle: () => void; label: string; hint: string }) {
  return (
    <div className="mb-1">
      <button className="flex items-center gap-2 text-left w-full" aria-pressed={checked} onClick={onToggle}>
        <span className={`shrink-0 ${checked ? 'text-clay' : 'text-txt3'}`}>{checked ? <IconCheckSquare size={16} /> : <IconSquare size={16} />}</span>
        <span className="text-[12px] flex-1">{label}</span>
      </button>
      <div className="text-[11px] text-txt3 mt-0.5">{hint}</div>
    </div>
  );
}

// Read-only value + copy button (webhook URL / secret — both get pasted into the provider's form).
function CopyField({ label, value }: { label: string; value: string }) {
  const t = useT();
  return (
    <div className="mb-2">
      <div className="text-[10px] uppercase tracking-wider text-txt3 mb-0.5">{label}</div>
      <div className="flex items-center gap-1">
        <input className="input flex-1 min-w-0 text-[11px] font-mono" readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        <button className="btn-ghost px-2 shrink-0" title={t('ctx.copy')} aria-label={t('ctx.copy')}
          onClick={() => void copyToClipboard(value)}><IconCopy size={13} /></button>
      </div>
    </div>
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
// Collapsible project header above a group of chats — same row look as the review-repo header.
function GroupHeader({ name, tag, count, open, onToggle, onAdd }: { name: string; tag: string; count: number; open: boolean; onToggle: () => void; onAdd?: () => void }) {
  const t = useT();
  return (
    // named for screen readers (and for the right-click menu, which reads controls off the DOM)
    <button className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] text-txt2 hover:text-txt" aria-expanded={open}
      aria-label={t(open ? 'sidebar.collapseGroup' : 'sidebar.expandGroup', { name })} onClick={onToggle}>
      <span className="opacity-70 shrink-0">{open ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}</span>
      <span className="opacity-70 shrink-0"><IconFolder size={13} /></span>
      <span className="flex-1 truncate text-left font-semibold" title={name}>{name}</span>
      {tag && <span className="text-txt3 shrink-0">{tag}</span>}
      <span className="text-txt3 shrink-0">{count}</span>
      {onAdd && <span role="button" aria-label={t('sidebar.newChatInProject')} title={t('sidebar.newChatInProject')}
        className="cursor-pointer leading-none text-txt3 hover:text-txt shrink-0"
        onClick={(e) => { e.stopPropagation(); onAdd(); }}><IconPlus size={13} /></span>}
    </button>
  );
}
// `menu` = the row's own right-click items (falls back to the app-wide default menu when absent).
function Item({ active, onClick, menu, children }: { active?: boolean; onClick: () => void; menu?: CtxRows; children: React.ReactNode }) {
  return (
    <div onClick={onClick} onContextMenu={menu ? (e) => openContextMenu(e, menu) : undefined}
      className={`group flex items-center gap-2.5 px-2.5 py-1.5 rounded-md cursor-pointer text-txt2 ${active ? 'bg-claysoft text-txt' : 'hover:bg-line'}`}>
      {children}
    </div>
  );
}
