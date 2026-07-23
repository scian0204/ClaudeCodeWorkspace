import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as DM from '@radix-ui/react-dropdown-menu';
import { useStore, type Block, type Msg } from '../lib/store';
import { api } from '../lib/api';
import { Avatar, timeAgo } from '../lib/ui';
import { MembersDialog } from './MembersDialog';
import { WikiExplorer } from './WikiExplorer';
import { FileExplorer } from './FileExplorer';
import { GitPanel } from './GitPanel';
import { SourcesPanel, CiteHighlighter } from './SourcesPanel';
import { extractSources, markCitations, type WikiSource } from '../lib/wikiCite';
import { md } from '../lib/md';
import { useT } from '../lib/i18n';

const MODELS: Record<string, string> = {
  'claude-opus-4-8': 'Opus 4.8', 'claude-sonnet-5': 'Sonnet 5', 'claude-haiku-4-5-20251001': 'Haiku 4.5',
};
const MODES: Record<string, string> = {
  default: 'chat.modeDefault', acceptEdits: 'chat.modeAcceptEdits', bypassPermissions: 'chat.modeBypass', plan: 'chat.modePlan',
};

const clampPanelW = (w: number) => Math.max(300, Math.min(w, 1000));

export function Chat() {
  const c = useStore((s) => s.current)!;
  const viewMode = useStore((s) => s.viewMode);
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [panelW, setPanelW] = useState(() => {
    const v = Number(localStorage.getItem('wikiSourcesW'));
    return v ? clampPanelW(v) : 360;
  });
  const resize = (w: number) => { const c2 = clampPanelW(w); setPanelW(c2); localStorage.setItem('wikiSourcesW', String(c2)); };
  const isWiki = !!c.wikiTopicId;
  const cols = isWiki
    ? (sourcesOpen ? `1fr ${panelW}px` : '1fr 44px')
    : (viewMode === 'split' ? '1fr 1fr' : '1fr');
  return (
    <div className="flex flex-col min-w-0 h-full">
      <Header />
      <div className="flex-1 grid min-h-0" style={{ gridTemplateColumns: cols, gridTemplateRows: 'minmax(0, 1fr)' }}>
        {viewMode !== 'editor' && <ChatPane key={c.chatSessionId} />}
        {isWiki
          ? <SourcesPanel topicId={c.wikiTopicId!} open={sourcesOpen} onToggle={() => setSourcesOpen((v) => !v)} width={panelW} onResize={resize} />
          : (viewMode !== 'chat' && <EditorPane />)}
      </div>
      {isWiki && <CiteHighlighter />}
    </div>
  );
}

function Header() {
  const { current: c, presence, control, toggleTheme, setViewMode, viewMode, setModel, setMode } = useStore();
  const [showMembers, setShowMembers] = useState(false);
  const [explorer, setExplorer] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);
  const t = useT();
  if (!c) return null;
  const isRoom = c.kind === 'room';
  const owner = c.room?.members.find((m) => m.isOwner);

  return (
    <header className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line bg-panel shrink-0">
      <div className="font-semibold text-sm flex items-center gap-2 min-w-0">
        <span className="w-[7px] h-[7px] rounded-full bg-ok shrink-0" />
        <span className="truncate">{c.title}</span>
        <span className="text-txt3 text-xs font-mono truncate hidden md:inline">{c.wikiTopicId ? t('chat.knowledgeQuery') : (c.projectId ? '' : t('chat.noProject'))}</span>
      </div>
      <div className="flex-1" />

      {isRoom && (
        <>
          <div className="flex items-center">
            {(c.room?.members || []).slice(0, 4).map((m) => (
              <span key={m.userId} title={m.displayName}
                className="w-6 h-6 rounded-full grid place-items-center text-[10px] text-white font-semibold -ml-1.5 border-2"
                style={{ background: m.avatarColor, borderColor: 'var(--panel)', opacity: presence.some((p) => p.id === m.userId) ? 1 : 0.5 }}>
                {m.displayName.slice(0, 2).toUpperCase()}</span>
            ))}
          </div>
          <button className="pill" onClick={() => setShowMembers(true)}>{t('chat.ownerMembers', { owner: owner?.displayName || t('chat.roomOwner') })}</button>
        </>
      )}

      {!c.wikiTopicId && <ProjectMenu />}
      {!c.wikiTopicId && c.projectId && <button className="pill" title={t('chat.projectFileExplorer')} onClick={() => setExplorer(true)}>{t('chat.filesBtn')}</button>}
      {!c.wikiTopicId && c.projectId && <button className="pill" title={t('git.title')} onClick={() => setGitOpen(true)}>{t('git.pill')}</button>}

      <DM.Root>
        <DM.Trigger asChild><button className="pill">{MODELS[c.model] || c.model} ▾</button></DM.Trigger>
        <Menu>
          {Object.entries(MODELS).map(([id, label]) => (
            <MenuItem key={id} onSelect={() => setModel(id)}>{label}</MenuItem>
          ))}
        </Menu>
      </DM.Root>

      <DM.Root>
        <DM.Trigger asChild><button className="pill" disabled={isRoom && !control.canSetMode}>{t(MODES[c.permissionMode]) || c.permissionMode} ▾</button></DM.Trigger>
        <Menu>
          {Object.entries(MODES).map(([id, label]) => (
            <MenuItem key={id} onSelect={() => setMode(id)}>{t(label)}</MenuItem>
          ))}
          {isRoom && !control.canSetMode && <div className="px-2 py-1 text-[11px] text-txt3">{t('chat.ownerOnlyMode')}</div>}
        </Menu>
      </DM.Root>

      {!c.wikiTopicId && (
        <div className="seg">
          {(['chat', 'split', 'editor'] as const).map((m) => (
            <button key={m} className={viewMode === m ? 'on' : ''} onClick={() => setViewMode(m)}>
              {m === 'chat' ? t('chat.viewChat') : m === 'split' ? t('chat.viewSplit') : t('chat.viewEditor')}
            </button>
          ))}
        </div>
      )}
      <button className="toolbtn" title={t('chat.toggleTheme')} onClick={toggleTheme}>◐</button>

      {gitOpen && c.projectId && <GitPanel projectId={c.projectId} open={gitOpen} onClose={() => setGitOpen(false)} />}
      {showMembers && c.room && <MembersDialog open={showMembers} onClose={() => setShowMembers(false)} />}
      {explorer && c.projectId && (
        <FileExplorer
          title={t('chat.fileExplorerTitle', { title: c.title })}
          sources={[{ key: 'files', label: t('chat.filesSource') }]}
          loadTree={() => api.get(`/api/projects/${c.projectId}/tree`).then((r) => ({ files: r.files }))}
          fileUrl={(_dir, p) => `/api/projects/${c.projectId}/file?path=${encodeURIComponent(p)}`}
          blobUrl={(_dir, p) => `/api/projects/${c.projectId}/blob?path=${encodeURIComponent(p)}`}
          onClose={() => setExplorer(false)}
        />
      )}
    </header>
  );
}

function ProjectMenu() {
  const { current: c, projects, setProject, deleteProject } = useStore();
  const [roomProjects, setRoomProjects] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [creds, setCreds] = useState<any[]>([]);
  const [credentialId, setCredentialId] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const refresh = useStore((s) => s.refreshLists);

  useEffect(() => {
    if (c?.kind === 'room' && c.roomId) api.get(`/api/projects/room/${c.roomId}`).then((r) => setRoomProjects(r.projects)).catch(() => {});
  }, [c?.roomId, c?.kind]);
  useEffect(() => { api.get('/api/git-credentials').then((r) => setCreds([...(r.mine || []), ...(r.common || [])])).catch(() => {}); }, []);

  const t = useT();
  if (!c) return null;
  const list = [...projects.common.map((p) => ({ ...p, tag: t('chat.tagCommon') })),
    ...(c.kind === 'room' ? roomProjects.map((p) => ({ ...p, tag: t('chat.tagRoom') })) : projects.mine.map((p) => ({ ...p, tag: t('chat.tagMine') })))];
  const cur = list.find((p) => p.id === c.projectId);

  const create = async () => {
    const name = newName.trim(); const git = gitUrl.trim();
    if (!name && !git) return;
    const scope = c.kind === 'room' ? 'room' : 'user';
    setBusy(true);
    try {
      const { project } = await api.post('/api/projects', { scope, name, roomId: c.roomId, gitUrl: git || undefined, credentialId: (git && credentialId) || undefined });
      setNewName(''); setGitUrl(''); await refresh();
      if (c.kind === 'room') { const r = await api.get(`/api/projects/room/${c.roomId}`); setRoomProjects(r.projects); }
      await setProject(project.id);
      setMenuOpen(false);
    } catch (e: any) { useStore.getState().setError(e.message); }
    finally { setBusy(false); }
  };

  const removeProject = async (p: { id: string; name: string }) => {
    if (!confirm(t('chat.deleteProjectConfirm', { name: p.name }))) return;
    try {
      await deleteProject(p.id);
      if (c.kind === 'room' && c.roomId) { const r = await api.get(`/api/projects/room/${c.roomId}`); setRoomProjects(r.projects); }
    } catch (e: any) { useStore.getState().setError(e.message); }
  };

  return (
    <DM.Root open={menuOpen} onOpenChange={setMenuOpen}>
      <DM.Trigger asChild><button className="pill">📁 {cur ? cur.name : t('chat.project')} ▾</button></DM.Trigger>
      <Menu>
        {list.length === 0 && <div className="px-2 py-1 text-[11px] text-txt3">{t('chat.noProjects')}</div>}
        {list.map((p) => (
          <div key={p.id} className="flex items-center gap-1.5 px-2 py-1.5 text-sm rounded hover:bg-line group">
            <button className="flex items-center gap-1.5 flex-1 min-w-0 text-left" onClick={() => { setProject(p.id); setMenuOpen(false); }}>
              <span className="text-[10px] text-txt3">[{p.tag}]</span>
              <span className="flex-1 truncate">{p.name}</span>
            </button>
            <button title={t('common.delete')} className="text-txt3 hover:text-danger opacity-50 group-hover:opacity-100 px-0.5 shrink-0"
              onClick={() => removeProject(p)}>🗑</button>
          </div>
        ))}
        <div className="border-t border-line my-1" />
        <div className="flex flex-col gap-1 p-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <input className="input !py-1 !text-xs" placeholder={t('chat.newProjectNamePlaceholder')} value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !gitUrl.trim()) { e.preventDefault(); create(); } }} />
          <input className="input !py-1 !text-xs" placeholder={t('chat.gitCloneUrlPlaceholder')} value={gitUrl}
            onChange={(e) => setGitUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } }} />
          {gitUrl.trim() && (
            <select className="input !py-1 !text-xs" value={credentialId} onChange={(e) => setCredentialId(e.target.value)}>
              <option value="">{t('chat.credAuto')}</option>
              {creds.map((cr) => <option key={cr.id} value={cr.id}>[{cr.provider}] {cr.host} · {cr.username}</option>)}
            </select>
          )}
          <button className="btn-ghost !py-1 !text-xs" disabled={busy} onClick={create}>
            {busy ? t('common.creating') : gitUrl.trim() ? t('chat.cloneCreate') : t('chat.createBtn')}
          </button>
        </div>
      </Menu>
    </DM.Root>
  );
}

function Menu({ children }: { children: React.ReactNode }) {
  return (
    <DM.Portal>
      <DM.Content sideOffset={4} align="end"
        className="bg-panel border border-line rounded-lg p-1 shadow-2xl z-50 min-w-[190px] text-txt">
        {children}
      </DM.Content>
    </DM.Portal>
  );
}
function MenuItem({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
  return <DM.Item onSelect={onSelect} className="px-2 py-1.5 text-sm rounded cursor-pointer hover:bg-line outline-none data-[highlighted]:bg-line">{children}</DM.Item>;
}

function WikiBanner() {
  const c = useStore((s) => s.current);
  const topicId = c?.wikiTopicId;
  const topic = useStore((s) => s.wikiTopics.find((t) => t.id === topicId));
  const step = useStore((s) => (topicId ? s.wikiProgress[topicId] : undefined));
  const isAdmin = useStore((s) => s.user?.role === 'admin');
  const [open, setOpen] = useState(false);
  const [explorer, setExplorer] = useState(false);
  const [files, setFiles] = useState<{ name: string; content: string }[] | null>(null);
  const [source, setSource] = useState<string>('');
  const [sel, setSel] = useState<string | null>(null);
  const status = topic?.compileStatus;

  useEffect(() => {
    setFiles(null); setSel(null); setSource('');
    if (!topicId || status === 'compiling') return; // (re)fetch once compile settles
    api.get(`/api/wiki/topics/${topicId}/files`).then((r) => { setFiles(r.files); setSource(r.source); }).catch(() => setFiles([]));
  }, [topicId, status]);

  const t = useT();
  if (!topicId) return null;
  const selFile = files?.find((f) => f.name === sel);
  const recompile = () => api.post(`/api/wiki/topics/${topicId}/recompile`).catch((e) => useStore.getState().setError(e.message));

  const statusEl =
    status === 'compiling' ? <span className="text-clay">{t('chat.compiling')}</span>
      : status === 'error' ? <span className="text-danger" title={topic?.compileError || ''}>{t('chat.compileError')}</span>
      : status === 'done' ? <span className="text-ok">{t('chat.compiled')}{topic?.compiledAt ? ` · ${timeAgo(topic.compiledAt)}` : ''}</span>
      : <span className="text-txt3">{t('chat.notCompiled')}</span>;

  return (
    <div className="border-b border-line bg-card text-xs shrink-0">
      <div className="flex items-center gap-2 px-5 py-2">
        <span className="cursor-pointer" onClick={() => setOpen(!open)}>📚</span>
        <span className="font-semibold cursor-pointer" onClick={() => setOpen(!open)}>{c?.title}</span>
        {statusEl}
        {files && <span className="text-txt3">· {source === 'raw' ? t('chat.rawCount', { count: files.length }) : t('chat.articleCount', { count: files.length })}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button className="text-txt3 hover:text-clay" onClick={() => setExplorer(true)}>{t('chat.fileExplorerBtn')}</button>
          {isAdmin && <button className="text-txt3 hover:text-clay disabled:opacity-40" disabled={status === 'compiling'} onClick={recompile}>{t('chat.recompile')}</button>}
          <span className="cursor-pointer text-txt3" onClick={() => setOpen(!open)}>{open ? '▲' : '▼'}</span>
        </div>
      </div>
      {explorer && <WikiExplorer topicId={topicId} onClose={() => setExplorer(false)} />}
      {status === 'compiling' && (
        <div className="px-5 pb-2 text-clay flex items-center gap-2">
          <span className="tdot" /><span className="tdot" /><span className="tdot" />
          <span>{t('chat.compilingHint')}</span>
          {step && <span className="text-txt3 font-mono truncate">{step}</span>}
        </div>
      )}
      {status === 'error' && topic?.compileError && <div className="px-5 pb-2 text-danger truncate" title={topic.compileError}>{t('chat.errorPrefix', { error: topic.compileError })}</div>}
      {open && status !== 'compiling' && (
        <div className="px-5 pb-3">
          {source === 'raw' && files && files.length > 0 && <div className="text-txt3 mb-1">{t('chat.rawShown')}</div>}
          {files && files.length === 0 && <div className="text-txt3">{t('chat.noDocs')}</div>}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {files?.map((f) => (
              <button key={f.name} className={`px-2 py-0.5 rounded border text-[11px] ${sel === f.name ? 'border-clay text-clay' : 'border-line text-txt2'}`}
                onClick={() => setSel(sel === f.name ? null : f.name)}>{f.name}</button>
            ))}
          </div>
          {selFile && <pre className="whitespace-pre-wrap font-mono text-[11px] text-txt2 bg-bg border border-line rounded p-2 max-h-56 overflow-auto scrolly">{selFile.content}</pre>}
        </div>
      )}
    </div>
  );
}

// /clear and /compact reset (or compact) the CLI conversation. We keep every message in the DB,
// so in the UI we fold the history above each such command into a collapsed toggle. Each command
// closes a segment; segments before the final one collapse, so folds stack as they accumulate.
function boundaryCmd(m: Msg): 'clear' | 'compact' | null {
  if (m.role !== 'user') return null;
  const mt = (m.content?.text || '').trim().match(/^\/(clear|compact)\b/);
  return mt ? (mt[1] as 'clear' | 'compact') : null;
}
interface Segment { key: string; cmd: 'clear' | 'compact' | null; msgs: Msg[]; }
function segmentMessages(messages: Msg[]): Segment[] {
  const segs: Segment[] = [];
  let cur: Msg[] = [];
  for (const m of messages) {
    cur.push(m);
    const cmd = boundaryCmd(m);
    if (cmd) { segs.push({ key: m.id, cmd, msgs: cur }); cur = []; }
  }
  segs.push({ key: 'live', cmd: null, msgs: cur }); // trailing (open) segment
  return segs;
}

function ChatPane() {
  const { current: c, messages, live, viewMode } = useStore();
  const streamRef = useRef<HTMLDivElement>(null);
  useEffect(() => { streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight }); }, [messages, live]);
  const segments = useMemo(() => segmentMessages(messages), [messages]);
  if (!c) return null;

  return (
    <div className={`flex flex-col min-w-0 min-h-0 ${viewMode === 'split' ? 'border-r border-line' : ''}`}>
      <WikiBanner />
      <div ref={streamRef} className="flex-1 overflow-y-auto scrolly px-5 py-5">
        <div className="max-w-[760px] mx-auto">
          {segments.map((seg) => seg.cmd
            ? <FoldedSegment key={seg.key} seg={seg} />
            : seg.msgs.map((m) => <MessageView key={m.id} m={m} />))}
          {live && <LiveView />}
        </div>
      </div>
      <PermissionArea />
      <Composer />
    </div>
  );
}

const hhmm = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const mmdd = (ts: number) => new Date(ts).toLocaleDateString([], { month: '2-digit', day: '2-digit' });
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

function FoldedSegment({ seg }: { seg: Segment }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const a = seg.msgs[0].createdAt;
  const b = seg.msgs[seg.msgs.length - 1].createdAt;
  const range = sameDay(a, b) ? `${mmdd(a)} ${hhmm(a)}–${hhmm(b)}` : `${mmdd(a)} ${hhmm(a)} – ${mmdd(b)} ${hhmm(b)}`;
  const label = seg.cmd === 'clear' ? t('chat.foldClear') : t('chat.foldCompact');
  return (
    <div className="border border-line rounded-lg my-3 bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer text-xs select-none" onClick={() => setOpen(!open)}>
        <span className="text-txt3">{open ? '▼' : '▶'}</span>
        <span className="text-clay">🗂</span>
        <code className="font-mono text-clay">/{seg.cmd}</code>
        <span className="font-semibold text-txt2">{label}</span>
        <span className="text-txt3 font-mono truncate">{range}</span>
        <span className="ml-auto text-txt3 shrink-0">{t('chat.foldMessages', { count: seg.msgs.length })}</span>
      </div>
      {open && (
        <div className="border-t border-line px-3 pt-3 pb-1 bg-bg">
          {seg.msgs.map((m) => <MessageView key={m.id} m={m} />)}
        </div>
      )}
    </div>
  );
}

function MessageView({ m }: { m: Msg }) {
  const isClaude = m.role === 'assistant';
  const blocks: Block[] = isClaude ? (m.content.blocks || []) : [];
  const topicId = useStore((s) => s.current?.wikiTopicId);
  const sources = useMemo(() => (topicId && isClaude ? extractSources(blocks, topicId) : []), [blocks, topicId, isClaude]);
  const { deleteMessage, editMessage } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content.text || '');
  const [copied, setCopied] = useState(false);
  const t = useT();
  const canEdit = !isClaude; // user messages can be edited → regenerate from that point

  const copyText = isClaude
    ? blocks.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n\n')
    : (m.content.text || '');
  const copy = () => {
    navigator.clipboard.writeText(copyText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const saveEdit = () => {
    const edited = draft.trim();
    setEditing(false);
    if (edited && edited !== m.content.text) editMessage(m.id, edited);
  };

  return (
    <div className="group flex gap-3 mb-5">
      <Avatar name={m.authorName || undefined} claude={isClaude} color={colorFromMsg(m)} />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-txt2 font-semibold mb-1 flex items-center gap-2">
          {isClaude ? 'Claude' : m.authorName}
          <span className="hidden group-hover:flex items-center gap-1.5 text-txt3">
            {copyText && <button className={copied ? 'text-ok' : 'hover:text-clay'} title={t('chat.copy')} onClick={copy}>{copied ? t('chat.copied') : '📋'}</button>}
            {canEdit && <button className="hover:text-clay" title={t('chat.edit')} onClick={() => { setDraft(m.content.text || ''); setEditing(true); }}>✎</button>}
            <button className="hover:text-danger" title={t('common.delete')} onClick={() => { if (confirm(t('chat.deleteMessageConfirm'))) deleteMessage(m.id); }}>🗑</button>
          </span>
        </div>
        {editing ? (
          <div className="border border-line2 rounded-lg bg-card p-2">
            <textarea className="w-full bg-transparent outline-none resize-none text-sm text-txt" rows={3}
              value={draft} autoFocus onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') setEditing(false); }} />
            <div className="flex gap-2 justify-end mt-1">
              <button className="btn-ghost !py-1 !text-xs" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
              <button className="rounded-md px-3 py-1 text-xs font-semibold text-white bg-clay" onClick={saveEdit}>{t('chat.saveRegenerate')}</button>
            </div>
          </div>
        ) : (
          <>
            {!isClaude && <div className="text-sm break-words leading-relaxed" dangerouslySetInnerHTML={{ __html: md(m.content.text || '') }} />}
            {isClaude && <BlockList blocks={blocks} sources={sources} />}
            {m.content.interrupted && <div className="text-[11px] text-warn mt-1">{t('chat.interrupted')}</div>}
          </>
        )}
      </div>
    </div>
  );
}

function LiveView() {
  const live = useStore((s) => s.live)!;
  const t = useT();
  return (
    <div className="flex gap-3 mb-5">
      <Avatar claude />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-txt2 font-semibold mb-1">Claude</div>
        <BlockList blocks={live.blocks} />
        <div className="flex items-center gap-1.5 text-txt3 text-[13px] italic mt-1">
          <span className="tdot" /><span className="tdot" /><span className="tdot" /> {t('chat.working')}
        </div>
      </div>
    </div>
  );
}

// Rendered answer text. In wiki mode, mentions of cited sources are wrapped as hoverable/clickable
// <mark> citations (markCitations mutates the DOM after React sets innerHTML; re-runs when either
// the html or the source set changes).
function MdText({ text, sources }: { text: string; sources: WikiSource[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => md(text), [text]);
  useLayoutEffect(() => { if (ref.current) markCitations(ref.current, sources); }, [html, sources]);
  return <div ref={ref} className="font-serif text-[15px] leading-relaxed break-words" dangerouslySetInnerHTML={{ __html: html }} />;
}

function BlockList({ blocks, sources = [] }: { blocks: Block[]; sources?: WikiSource[] }) {
  return (
    <>
      {blocks.map((b, i) => b.type === 'text'
        ? <MdText key={i} text={b.text} sources={sources} />
        : <ToolCard key={i} b={b} />)}
    </>
  );
}

function ToolCard({ b }: { b: Extract<Block, { type: 'tool_use' }> }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  // AskUserQuestion's pick is fed back as a (technically) denied tool result — the SDK flags it
  // is_error even though nothing failed. Render it as a normal choice, not "오류".
  const isAsk = b.name === 'AskUserQuestion';
  const cancelled = isAsk && b.output === 'Denied.';
  const cmd = isAsk
    ? (b.input?.questions?.[0]?.question || t('chat.question'))
    : (b.input?.command || b.input?.file_path || b.input?.path || JSON.stringify(b.input || {}).slice(0, 80));
  const status =
    b.output == null ? { text: t('chat.toolRunning'), color: 'var(--txt-3)' }
    : isAsk ? (cancelled ? { text: t('chat.cancelled'), color: 'var(--txt-3)' } : { text: t('chat.selected'), color: 'var(--ok)' })
    : b.isError ? { text: t('chat.toolError'), color: 'var(--danger)' }
    : { text: t('chat.toolDone'), color: 'var(--ok)' };
  return (
    <div className="border border-line rounded-lg my-2 overflow-hidden bg-card">
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer text-xs" onClick={() => setOpen(!open)}>
        <span className="text-clay">{isAsk ? '❓' : '⌘'}</span>
        <span className="font-semibold">{isAsk ? t('chat.question') : b.name}</span>
        <code className="font-mono text-txt2 truncate flex-1">{String(cmd)}</code>
        <span className="text-[11px] flex items-center gap-1" style={{ color: status.color }}>{status.text}</span>
      </div>
      {open && b.output != null && (
        <div className="border-t border-line px-3 py-2 font-mono text-xs text-txt2 whitespace-pre-wrap bg-bg max-h-64 overflow-auto scrolly">{b.output}</div>
      )}
    </div>
  );
}

function PermissionArea() {
  const { pending, control, respond } = useStore();
  if (pending.length === 0) return null;
  return (
    <div className="px-5 pb-1 max-w-[760px] mx-auto w-full">
      {pending.map((p) => (
        <div key={p.requestId} className="border rounded-lg p-3 my-2" style={{ borderColor: 'var(--warn)', background: 'var(--warn-soft)' }}>
          {p.tool === 'AskUserQuestion'
            ? <AskQuestion p={p} canApprove={control.canApprove} respond={respond} />
            : <ToolApproval p={p} canApprove={control.canApprove} respond={respond} />}
        </div>
      ))}
    </div>
  );
}

function ToolApproval({ p, canApprove, respond }: { p: any; canApprove: boolean; respond: any }) {
  const t = useT();
  return (
    <>
      <div className="text-xs font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--warn)' }}>{t('chat.toolApprovalRequest', { tool: p.tool })}</div>
      <code className="font-mono text-xs bg-card px-1.5 py-1 rounded border border-line block truncate">{p.input?.command || p.input?.file_path || JSON.stringify(p.input)}</code>
      {canApprove ? (
        <div className="flex gap-2 mt-2.5">
          <button className="rounded-md px-3.5 py-1.5 text-xs font-semibold text-white" style={{ background: 'var(--ok)' }} onClick={() => respond(p.requestId, 'allow')}>{t('chat.allow')}</button>
          <button className="btn-ghost !py-1.5 !text-xs" onClick={() => respond(p.requestId, 'deny')}>{t('chat.deny')}</button>
          <button className="btn-ghost !py-1.5 !text-xs" onClick={() => respond(p.requestId, 'always')}>{t('chat.alwaysAllow')}</button>
        </div>
      ) : (
        <div className="text-[11px] text-txt2 mt-2">{t('chat.awaitingApprovalResponse')}</div>
      )}
    </>
  );
}

// Claude asked the user to choose (AskUserQuestion). Render the real options as buttons;
// the pick is fed back to Claude as the tool result via respond(..., 'answer', text).
// ponytail: one pick resolves the whole request — for multi-question asks only the clicked
// question is answered. Fine for the common single-question case; revisit if multi-question shows up.
function AskQuestion({ p, canApprove, respond }: { p: any; canApprove: boolean; respond: any }) {
  const qs: any[] = p.input?.questions || [];
  const t = useT();
  if (!canApprove) {
    return <div className="text-[11px] text-txt2">{t('chat.awaitingApprovalChoice')}</div>;
  }
  return (
    <div className="flex flex-col gap-3">
      {qs.map((q, qi) => (
        <div key={qi}>
          <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--warn)' }}>❓ {q.question}</div>
          <div className="flex flex-col gap-1.5">
            {(q.options || []).map((o: any, oi: number) => (
              <button key={oi} className="text-left border border-line rounded-md px-3 py-2 bg-card hover:bg-line transition"
                onClick={() => respond(p.requestId, 'answer', t('chat.userChoiceAnswer', { question: q.question, label: o.label }) + (o.description ? ` (${o.description})` : ''))}>
                <div className="font-semibold text-xs">{o.label}</div>
                {o.description && <div className="text-[11px] text-txt2 mt-0.5">{o.description}</div>}
              </button>
            ))}
          </div>
        </div>
      ))}
      <button className="btn-ghost !py-1.5 !text-xs self-start" onClick={() => respond(p.requestId, 'deny')}>{t('common.cancel')}</button>
    </div>
  );
}

// Client-side UI actions (run immediately on select). Real Claude Code commands + skills
// are fetched per session and merged in below.
const CLIENT_CMDS: { cmd: string; label: string; kind: 'ui'; run: (s: any) => void }[] = [
  { cmd: '/new', label: 'chat.cmdNew', kind: 'ui', run: (s) => s.newSession() },
  { cmd: '/split', label: 'chat.cmdSplit', kind: 'ui', run: (s) => s.setViewMode('split') },
  { cmd: '/editor', label: 'chat.cmdEditor', kind: 'ui', run: (s) => s.setViewMode('editor') },
  { cmd: '/chat', label: 'chat.cmdChat', kind: 'ui', run: (s) => s.setViewMode('chat') },
  { cmd: '/interrupt', label: 'chat.cmdInterrupt', kind: 'ui', run: (s) => s.interrupt() },
];
type Cmd = { cmd: string; label: string; kind: 'ui' | 'cmd'; desc?: string; hint?: string; run?: (s: any) => void };

function Composer() {
  const store = useStore();
  const { current: c, send, queue, cancel, interrupt, turnActive, congested, user, commands } = store;
  const [text, setText] = useState('');
  const [sel, setSel] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const t = useT();
  if (!c) return null;
  const isRoom = c.kind === 'room';
  const wikiCompiling = !!c.wikiTopicId && store.wikiTopics.find((t) => t.id === c.wikiTopicId)?.compileStatus === 'compiling';
  const wikiStep = c.wikiTopicId ? store.wikiProgress[c.wikiTopicId] : undefined;

  // full palette: client UI actions + real CLI slash commands (built-in + plugin + skill), with hints
  const seen = new Set<string>();
  const palette: Cmd[] = [
    ...CLIENT_CMDS,
    ...commands.map((ci): Cmd => ({ cmd: '/' + ci.name, label: ci.description, kind: 'cmd', desc: ci.description, hint: ci.argumentHint })),
  ].filter((p) => (seen.has(p.cmd) ? false : seen.add(p.cmd)));

  const word = text.toLowerCase();
  const showMenu = /^\/[^\s]*$/.test(text); // menu shows while typing the command token (no space yet)
  const matches = showMenu ? palette.filter((x) => x.cmd.toLowerCase().startsWith(word)).slice(0, 50) : [];
  const showSlash = matches.length > 0;

  // parameter guide: once a command is chosen (space typed, no args yet), ghost its argument hint
  const firstTok = text.split(' ')[0];
  const active = text.startsWith('/') ? palette.find((p) => p.cmd === firstTok) : undefined;
  const argsTyped = text.length > firstTok.length && text.slice(firstTok.length).trim().length > 0;
  const showHint = !!active?.hint && !showSlash && !argsTyped;

  const pick = (i: number) => {
    const m = matches[i]; if (!m) return;
    if (m.run) { m.run(store); setText(''); setSel(0); return; }
    setText(m.cmd + ' '); setSel(0); taRef.current?.focus(); // fill for args; the hint ghosts in; Enter sends → CLI runs it
  };
  const submit = () => {
    if (wikiCompiling) return;
    if (showSlash) return pick(Math.min(sel, matches.length - 1));
    if (!text.trim()) return;
    send(text.trim()); setText('');
  };

  return (
    <div className="px-5 pb-4 pt-2 shrink-0">
      <div className="max-w-[760px] mx-auto">
        {(queue.running || queue.waiting.length > 0 || congested) && (
          <div className="text-xs text-txt3 mb-2 flex items-center gap-2 flex-wrap">
            {queue.running && <span>{t('chat.authorWorking', { name: queue.running.author.name })}</span>}
            {turnActive && (
              <button className="text-danger hover:underline" onClick={interrupt}>{t('chat.interruptShort')}</button>
            )}
            {queue.waiting.map((w) => (
              <span key={w.id} className="bg-rail border border-line rounded-full px-2.5 py-0.5 text-txt2 flex items-center gap-1">
                {t('chat.authorWaiting', { name: w.author.name })}
                {(w.author.id === user?.id) && <button className="text-danger" title={t('common.cancel')} onClick={() => cancel(w.id)}>✕</button>}
              </span>
            ))}
            {congested && <span className="text-warn">{t('chat.congested')}</span>}
          </div>
        )}
        <div className="relative">
          {showSlash && (
            <div className="absolute bottom-full mb-2 left-0 right-0 bg-panel border border-line rounded-lg shadow-2xl overflow-hidden z-40">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-txt3 border-b border-line flex justify-between">
                <span>{t('chat.commandsSkills')}</span><span>{matches.length}</span>
              </div>
              <div className="max-h-64 overflow-y-auto scrolly">
                {matches.map((m, i) => (
                  <div key={m.cmd} onMouseEnter={() => setSel(i)} onClick={() => pick(i)}
                    className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm ${i === sel ? 'bg-line' : ''}`}>
                    <code className="font-mono text-clay text-xs shrink-0">{m.cmd}</code>
                    {m.hint && <code className="font-mono text-txt3 text-[11px] shrink-0">{m.hint}</code>}
                    <span className="text-txt2 text-xs truncate">{m.desc || (m.kind === 'ui' ? t(m.label) : '')}</span>
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                      style={{ background: 'var(--claysoft)', color: 'var(--clay)' }}>
                      {m.kind === 'ui' ? 'UI' : t('chat.cmdBadge')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="border border-line2 rounded-xl bg-card p-3 relative">
            {showHint && (
              <div className="absolute left-3 right-3 top-3 text-sm leading-[inherit] whitespace-pre-wrap break-words pointer-events-none select-none z-0" aria-hidden>
                <span className="invisible">{text}</span><span className="text-txt3">{active!.hint}</span>
              </div>
            )}
            <textarea ref={taRef} disabled={wikiCompiling}
              className="relative z-10 w-full bg-transparent outline-none resize-none text-sm text-txt placeholder:text-txt3 disabled:opacity-50"
              rows={2} placeholder={wikiCompiling ? t('chat.topicCompiling') : isRoom ? t('chat.roomMessagePlaceholder', { title: c.title, name: user?.displayName ?? '' }) : t('chat.messagePlaceholder')}
              value={text} onChange={(e) => { setText(e.target.value); setSel(0); }}
              onKeyDown={(e) => {
                if (showSlash && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab')) {
                  e.preventDefault();
                  const up = e.key === 'ArrowUp';
                  setSel((p) => up ? (p - 1 + matches.length) % matches.length : (p + 1) % matches.length);
                  return;
                }
                if (showSlash && e.key === 'Escape') { e.preventDefault(); setText(''); return; }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
              }} />
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-txt3 truncate">{wikiCompiling ? (wikiStep ? t('chat.compilingStep', { step: wikiStep }) : t('chat.compilingReady')) : turnActive ? t('chat.claudeResponding') : t('chat.composerHint')}</span>
              <button className="ml-auto bg-clay text-white rounded-lg w-8 h-8 grid place-items-center disabled:opacity-40" disabled={wikiCompiling} onClick={submit} aria-label={t('chat.send')}>➤</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditorPane() {
  const { editorUrl, current: c } = useStore();
  const t = useT();
  if (!c) return null;
  if (!editorUrl) return (
    <div className="grid place-items-center bg-[#1e1e1e] text-[#bbb] text-sm">
      <div className="text-center">
        <div className="mb-2">{t('chat.openingEditor')}</div>
        <div className="text-xs text-[#888]">{c.projectId ? '' : t('chat.selectProjectFirst')}</div>
      </div>
    </div>
  );
  return <iframe title="code-server" src={editorUrl} className="w-full h-full border-0 bg-[#1e1e1e]" />;
}

function colorFromMsg(m: Msg): string {
  const s = m.authorId || m.authorName || 'x';
  let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const C = ['#5b6b8c', '#8c5b6b', '#5b8c6b', '#6b5b8c', '#8c7a5b', '#5b8c8a'];
  return C[h % C.length];
}
