import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as DM from '@radix-ui/react-dropdown-menu';
import * as Dialog from '@radix-ui/react-dialog';
import { useStore, type Block, type Msg, type Attachment, type Project } from '../lib/store';
import { ProjectCreateForm } from './ProjectCreateForm';
import { api, type UploadState } from '../lib/api';
import { UploadProgress } from './UploadProgress';
import { Avatar, timeAgo, useIsMobile, MobileMenuButton, ClayDots, ClaySpark, ClayWait, useGuideInset, useAutoGrow, useInputHistory, useStickToBottom, MdMirror } from '../lib/ui';
import { copyToClipboard } from '../lib/clipboard';
import { MembersDialog } from './MembersDialog';
import { ExportSessionModal } from './ExportSessionModal';
import { ToolDiff, fileEditOf, diffCounts } from './ToolDiff';
import { WikiExplorer } from './WikiExplorer';
import { FileExplorer } from './FileExplorer';
import { GitPanel } from './GitPanel';
import { SearchButton } from './SearchPalette';
import { SourcesPanel, CiteHighlighter } from './SourcesPanel';
import { TasksPanel, isTaskLive } from './TasksPanel';
import { extractSources, markCitations, useCite, type WikiSource } from '../lib/wikiCite';
import { md } from '../lib/md';
import { useT } from '../lib/i18n';
import { withKeys } from '../lib/shortcuts';
import { WORKSPACE_CMDS, splitCommand } from '../lib/cli-commands';
import { AsideChat } from './AsideChat';
import {
  IconChevronDown, IconChevronRight, IconChevronUp, IconTheme, IconFolder, IconFile, IconTrash,
  IconGauge, IconEye, IconBook, IconArchive, IconSparkle, IconCopy, IconPencil, IconHelp,
  IconTerminal, IconX, IconPaperclip, IconSend, IconShield, IconBolt, IconCheckSquare, IconCrown,
  IconGitBranch, IconClock, IconCheckCircle, IconBan, IconWarning, IconLink, IconRotateCcw,
  IconCheck, IconRefresh, IconSquare, IconMessage, IconActivity, IconDownload, IconUsers, IconBox,
  IconPlus,
} from '../lib/icons';

const MODELS: Record<string, string> = {
  'claude-opus-4-8': 'Opus 4.8', 'claude-sonnet-5': 'Sonnet 5', 'claude-haiku-4-5-20251001': 'Haiku 4.5',
};
const MODES: Record<string, { key: string; Icon: typeof IconCheck }> = {
  default: { key: 'chat.modeDefault', Icon: IconShield },
  acceptEdits: { key: 'chat.modeAcceptEdits', Icon: IconPencil },
  bypassPermissions: { key: 'chat.modeBypass', Icon: IconBolt },
  plan: { key: 'chat.modePlan', Icon: IconCheckSquare },
};
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

const clampPanelW = (w: number) => Math.max(300, Math.min(w, 1000));
const storedW = (key: string, fallback: number) => {
  const v = Number(localStorage.getItem(key));
  return v ? clampPanelW(v) : fallback;
};

export function Chat() {
  const c = useStore((s) => s.current)!;
  const viewMode = useStore((s) => s.viewMode);
  const taskPanelEnabled = useStore((s) => s.taskPanelEnabled);
  const tasksOpen = useStore((s) => s.tasksOpen);
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [panelW, setPanelW] = useState(() => storedW('wikiSourcesW', 360));
  const [tasksW, setTasksW] = useState(() => storedW('tasksW', 340));
  const resize = (w: number) => { const c2 = clampPanelW(w); setPanelW(c2); localStorage.setItem('wikiSourcesW', String(c2)); };
  const resizeTasks = (w: number) => { const c2 = clampPanelW(w); setTasksW(c2); localStorage.setItem('tasksW', String(c2)); };
  const isWiki = !!c.wikiTopicId;
  const isReview = c.kind === 'review';
  const isMobile = useIsMobile();
  // On a phone force chat-only: the split view and the code-server editor iframe are unusable at
  // that width, and the wiki sources panel would crowd out the answer. Citations still render inline.
  // Same coercion without a working Docker daemon — a remembered 'editor' mode would otherwise render
  // an iframe pointing at a container that can never be spawned.
  const dockerReady = useStore((s) => s.dockerReady);
  const vm = isMobile || !dockerReady ? 'chat' : viewMode;
  const showSources = isWiki && !isMobile;
  const showTasks = taskPanelEnabled && tasksOpen;
  const base = isMobile ? '1fr'
    : isWiki ? (sourcesOpen ? `1fr ${panelW}px` : '1fr 44px')
    : (vm === 'split' && !isReview ? '1fr 1fr' : '1fr'); // review is chat-only (no project → no editor)
  // the task panel is an extra right column on desktop; on a phone it renders as a full-screen
  // overlay (see TasksPanel), so it must stay out of the grid template there
  const cols = showTasks && !isMobile ? `${base} ${tasksW}px` : base;
  return (
    <div className="flex flex-col min-w-0 h-full">
      <Header />
      <div className="flex-1 grid min-h-0 relative" style={{ gridTemplateColumns: cols, gridTemplateRows: 'minmax(0, 1fr)' }}>
        {vm !== 'editor' && <ChatPane key={c.chatSessionId} />}
        {showSources
          ? <SourcesPanel topicId={c.wikiTopicId!} open={sourcesOpen} onToggle={() => setSourcesOpen((v) => !v)} width={panelW} onResize={resize} />
          : (!isWiki && vm !== 'chat' && <EditorPane />)}
        {showTasks && <TasksPanel width={tasksW} onResize={resizeTasks} />}
        {/* the /btw window — floats over the conversation, answers without joining it */}
        <AsideChat />
      </div>
      {isWiki && <CiteHighlighter />}
    </div>
  );
}

// Header pill that opens the task panel. Counts what the turn spawned behind the main thread and
// glints while any of it is still running, so background work is visible without opening the panel.
function TasksButton() {
  const enabled = useStore((s) => s.taskPanelEnabled);
  const tasks = useStore((s) => s.tasks);
  const tasksOpen = useStore((s) => s.tasksOpen);
  const setTasksOpen = useStore((s) => s.setTasksOpen);
  const t = useT();
  if (!enabled) return null;
  const live = tasks.filter(isTaskLive).length;
  return (
    <button className={`pill inline-flex items-center gap-1 ${tasksOpen ? 'text-clay' : ''}`}
      title={withKeys(t('tasks.toggle'), 'Mod+Shift+E')} onClick={() => setTasksOpen(!tasksOpen)}>
      <span className={live ? 'clay-shimmer inline-flex' : 'inline-flex'}><IconActivity size={13} /></span>
      {t('tasks.pill')}
      {tasks.length > 0 && <span className="text-[10px] font-mono">{live ? `${live}/${tasks.length}` : tasks.length}</span>}
    </button>
  );
}

// Header pill: which team agent drives the MAIN thread (SDK options.agent), "next turn onward".
// Hidden when the feature is off or no agent exists to pick.
function AgentPicker() {
  const teamAgentsEnabled = useStore((s) => s.teamAgentsEnabled);
  const c = useStore((s) => s.current);
  const setAgent = useStore((s) => s.setAgent);
  const t = useT();
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    if (!teamAgentsEnabled) return;
    api.get('/api/agents').then((r) => {
      setRows([...(r.common || []), ...(r.mine || []), ...(r.projects || [])]);
    }).catch(() => {});
  }, [teamAgentsEnabled]);
  // project agents only apply to sessions of their project — mirror resolveAgents' filter
  const names = [...new Set(rows
    .filter((a) => a.enabled && (a.scope !== 'project' || a.projectId === c?.projectId))
    .map((a) => a.name))];
  if (!teamAgentsEnabled || !c || (names.length === 0 && !c.agent)) return null;
  return (
    <DM.Root>
      <DM.Trigger asChild>
        <button className="pill inline-flex items-center gap-1" disabled={!!c.readOnly} title={t('chat.agentPickerTip')}>
          <IconSparkle size={13} />{c.agent || t('chat.agentDefault')}<IconChevronDown size={14} />
        </button>
      </DM.Trigger>
      <Menu>
        <MenuItem onSelect={() => void setAgent(null)}>{t('chat.agentDefault')}</MenuItem>
        {names.map((n) => <MenuItem key={n} onSelect={() => void setAgent(n)}>{n}</MenuItem>)}
      </Menu>
    </DM.Root>
  );
}

function Header() {
  const { current: c, presence, toggleTheme, setViewMode, viewMode, dockerReady, dockerReason } = useStore();
  const naming = useStore((s) => (s.current ? s.titling.includes(s.current.chatSessionId) : false));
  const [showMembers, setShowMembers] = useState(false);
  const sessionExportEnabled = useStore((s) => s.sessionExportEnabled);
  // store-lifted (not useState) so the global shortcuts can toggle them (Mod+Shift+F / Mod+Shift+G)
  const explorer = useStore((s) => s.explorerOpen);
  const setExplorer = useStore((s) => s.setExplorerOpen);
  const gitOpen = useStore((s) => s.gitPanelOpen);
  const setGitOpen = useStore((s) => s.setGitPanelOpen);
  const exporting = useStore((s) => s.exportOpen);
  const setExporting = useStore((s) => s.setExportOpen);
  const t = useT();
  if (!c) return null;
  const isRoom = c.kind === 'room';
  const isReview = c.kind === 'review';
  const owner = c.room?.members.find((m) => m.isOwner);


  return (
    <header className="flex items-center gap-2 md:gap-2.5 px-3 md:px-4 py-2.5 border-b border-line bg-panel shrink-0 flex-wrap">
      <MobileMenuButton />
      <SearchButton />
      <div className="font-semibold text-sm flex items-center gap-2 min-w-0">
        <span className="w-[7px] h-[7px] rounded-full bg-ok shrink-0" />
        {/* the model is picking this chat's name right now — the title waits with the clay glint */}
        <span className={`truncate ${naming ? 'clay-shimmer' : ''}`}>{c.title}</span>
        {/* Reachable on a phone, unlike the sidebar row actions (hover / right-click only). */}
        {!c.roomId && !c.wikiTopicId && <RetitleButton sessionId={c.chatSessionId} />}
        {!c.roomId && !c.wikiTopicId && !isReview && sessionExportEnabled && (
          <button className="toolbtn !p-1 shrink-0" title={t('export.button')} aria-label={t('export.button')} onClick={() => setExporting(true)}>
            <IconDownload size={13} />
          </button>
        )}
        <span className="text-txt3 text-xs font-mono truncate hidden md:inline-flex items-center gap-1">{c.wikiTopicId ? <><IconBook size={12} />{t('chat.knowledgeQuery')}</> : (c.projectId ? '' : t('chat.noProject'))}</span>
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
          <button className="pill inline-flex items-center gap-1" onClick={() => setShowMembers(true)}><IconCrown size={13} />{t('chat.ownerMembers', { owner: owner?.displayName || t('chat.roomOwner') })}</button>
        </>
      )}

      {isReview && c.review && <ReviewControls />}

      {!c.wikiTopicId && !isReview && <ProjectMenu />}
      {!c.wikiTopicId && !isReview && <WikiLinkMenu />}
      {!c.wikiTopicId && c.projectId && <button className="pill inline-flex items-center gap-1" title={withKeys(t('chat.projectFileExplorer'), 'Mod+Shift+F')} onClick={() => setExplorer(true)}><IconFolder size={13} />{t('chat.filesBtn')}</button>}
      {!c.wikiTopicId && c.projectId && <button className="pill inline-flex items-center gap-1" title={withKeys(t('git.title'), 'Mod+Shift+G')} onClick={() => setGitOpen(true)}><IconGitBranch size={13} />{t('git.pill')}</button>}

      {/* model · effort · permission mode · usage now live under the composer (TurnControls) —
          the header row had outgrown one line and wrapped */}
      {!c.wikiTopicId && !isReview && <AgentPicker />}
      {!isReview && <PoolPicker />}
      {!c.wikiTopicId && !isReview && <SandboxToggle />}

      <TasksButton />

      {!c.wikiTopicId && !isReview && (
        <div className="seg hidden md:flex">
          {(['chat', 'split', 'editor'] as const).map((m) => {
            // the editor is a spawned code-server container — with no working daemon the button can
            // only fail, so disable it and say why instead of letting the click 501
            const off = m !== 'chat' && !dockerReady;
            return (
              <button key={m} className={viewMode === m ? 'on' : ''} disabled={off}
                title={off ? t('chat.editorNeedsDocker', { reason: t(`docker.reason.${dockerReason}`) }) : undefined}
                onClick={() => setViewMode(m)}>
                {m === 'chat' ? t('chat.viewChat') : m === 'split' ? t('chat.viewSplit') : t('chat.viewEditor')}
              </button>
            );
          })}
        </div>
      )}
      <button className="toolbtn" title={withKeys(t('chat.toggleTheme'), 'Mod+Shift+L')} aria-label={t('chat.toggleTheme')} onClick={toggleTheme}><IconTheme /></button>

      {exporting && <ExportSessionModal sessionId={c.chatSessionId} onClose={() => setExporting(false)} />}
      {gitOpen && c.projectId && <GitPanel projectId={c.projectId} open={gitOpen} onClose={() => setGitOpen(false)} />}
      {showMembers && c.room && <MembersDialog open={showMembers} onClose={() => setShowMembers(false)} />}
      {explorer && c.projectId && (
        <FileExplorer
          title={t('chat.fileExplorerTitle', { title: c.title })}
          sources={[{ key: 'files', label: t('chat.filesSource') }]}
          loadDir={(_src, rel) => api.get(`/api/projects/${c.projectId}/tree?path=${encodeURIComponent(rel)}`)}
          fileUrl={(_dir, p) => `/api/projects/${c.projectId}/file?path=${encodeURIComponent(p)}`}
          blobUrl={(_dir, p) => `/api/projects/${c.projectId}/blob?path=${encodeURIComponent(p)}`}
          onClose={() => setExplorer(false)}
        />
      )}
    </header>
  );
}

// Name the open chat after its conversation, from the header — the one place that works on a phone.
// Private chats only: a room is named by its room, a wiki thread by its topic, a review by its PR,
// and the server refuses those anyway.
function RetitleButton({ sessionId }: { sessionId: string }) {
  const t = useT();
  const enabled = useStore((s) => s.autoTitleEnabled);
  const retitle = useStore((s) => s.retitleSession);
  const setError = useStore((s) => s.setError);
  // this tab pressed it, or the server is naming the chat anyway (first turn / another tab)
  const naming = useStore((s) => s.titling.includes(sessionId));
  if (!enabled) return null;
  return (
    <button className="shrink-0 text-txt3 hover:text-clay"
      disabled={naming} aria-busy={naming} title={t(naming ? 'sidebar.retitleChatBusy' : 'sidebar.retitleChatTitle')}
      aria-label={t(naming ? 'sidebar.retitleChatBusy' : 'sidebar.retitleChatTitle')}
      onClick={() => { retitle(sessionId).catch((e: any) => setError(e.message)); }}>
      {naming ? <ClaySpark size={15} /> : <IconSparkle size={13} />}</button>
  );
}

function ProjectMenu() {
  const { current: c, projects, setProject, deleteProject } = useStore();
  const [roomProjects, setRoomProjects] = useState<any[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scope, setScope] = useState<'user' | 'common'>('user'); // private session: create personal, or request/create common

  useEffect(() => {
    if (c?.kind === 'room' && c.roomId) api.get(`/api/projects/room/${c.roomId}`).then((r) => setRoomProjects(r.projects)).catch(() => {});
  }, [c?.roomId, c?.kind]);

  const t = useT();
  if (!c) return null;
  const isRoom = c.kind === 'room';
  const list = [...projects.common.map((p) => ({ ...p, tag: t('chat.tagCommon') })),
    ...(isRoom ? roomProjects.map((p) => ({ ...p, tag: t('chat.tagRoom') })) : projects.mine.map((p) => ({ ...p, tag: t('chat.tagMine') })))];
  const cur = list.find((p) => p.id === c.projectId);

  const onCreated = async (project: Project) => {
    if (isRoom && c.roomId) { const r = await api.get(`/api/projects/room/${c.roomId}`); setRoomProjects(r.projects); }
    await setProject(project.id);
  };

  const removeProject = async (p: { id: string; name: string }) => {
    if (!confirm(t('chat.deleteProjectConfirm', { name: p.name }))) return;
    try {
      await deleteProject(p.id);
      if (isRoom && c.roomId) { const r = await api.get(`/api/projects/room/${c.roomId}`); setRoomProjects(r.projects); }
    } catch (e: any) { useStore.getState().setError(e.message); }
  };

  return (
    <DM.Root open={menuOpen} onOpenChange={setMenuOpen}>
      <DM.Trigger asChild><button className="pill"><IconFolder size={14} />{cur ? cur.name : t('chat.project')}<IconChevronDown size={14} /></button></DM.Trigger>
      <Menu>
        {list.length === 0 && <div className="px-2 py-1 text-[11px] text-txt3">{t('chat.noProjects')}</div>}
        {list.map((p) => (
          <div key={p.id} className="flex items-center gap-1.5 px-2 py-1.5 text-sm rounded hover:bg-line group">
            <button className="flex items-center gap-1.5 flex-1 min-w-0 text-left" onClick={() => { setProject(p.id); setMenuOpen(false); }}>
              <span className="text-[10px] text-txt3">[{p.tag}]</span>
              <span className="flex-1 truncate">{p.name}</span>
            </button>
            <button title={t('common.delete')} aria-label={t('common.delete')} className="text-txt3 hover:text-danger opacity-50 group-hover:opacity-100 px-0.5 shrink-0"
              onClick={() => removeProject(p)}><IconTrash size={14} /></button>
          </div>
        ))}
        <div className="border-t border-line my-1" />
        <div className="flex flex-col gap-1.5 p-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {!isRoom && (
            <div className="seg self-start">
              <button className={scope === 'user' ? 'on' : ''} onClick={() => setScope('user')}>{t('project.scopePersonal')}</button>
              <button className={scope === 'common' ? 'on' : ''} onClick={() => setScope('common')}>{t('project.scopeCommon')}</button>
            </div>
          )}
          <ProjectCreateForm
            key={isRoom ? 'room' : scope}
            scope={isRoom ? 'room' : scope}
            roomId={c.roomId}
            compact
            onCreated={onCreated}
            onDone={() => setMenuOpen(false)}
          />
        </div>
      </Menu>
    </DM.Root>
  );
}

// `side`/`align`: header pills drop down and hang off their right edge; the composer pills sit at the
// bottom of the screen, so they open upward from their left edge instead.
function Menu({ children, side, align = 'end' }: { children: React.ReactNode; side?: 'top' | 'bottom'; align?: 'start' | 'end' }) {
  return (
    <DM.Portal>
      <DM.Content sideOffset={4} side={side} align={align}
        className="bg-panel border border-line rounded-lg p-1 shadow-2xl z-50 min-w-[190px] text-txt">
        {children}
      </DM.Content>
    </DM.Portal>
  );
}
function MenuItem({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
  return <DM.Item onSelect={onSelect} className="px-2 py-1.5 text-sm rounded cursor-pointer hover:bg-line outline-none data-[highlighted]:bg-line">{children}</DM.Item>;
}

// ── session usage popover (context window + claude.ai plan rate limits) ──
type UsageWin = { utilization: number | null; resetsAt: string | null };
interface Usage {
  context: { totalTokens: number; maxTokens: number; percentage: number; model: string } | null;
  rateLimitsAvailable: boolean;
  subscriptionType: string | null;
  rateLimits: { fiveHour: UsageWin | null; sevenDay: UsageWin | null; modelScoped: ({ displayName: string } & UsageWin)[] } | null;
  authKind: 'oauth' | 'apiKey' | 'other' | 'none';
  limitsUnknown?: boolean; // the lookup did not come back — not the same as "this account has none"
}

const fmtTokens = (n: number): string =>
  n >= 1_000_000 ? (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  : String(n);

// wall-clock HH:MM of an epoch-millis instant (auto-resume banner: "재시도 예정 14:20")
const fmtClock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function resetsIn(iso: string | null, t: (k: string, p?: any) => string): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return t('usage.resettingNow');
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? t('usage.resetsInHm', { h, m }) : t('usage.resetsInM', { m });
}

function UsageBar({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(100, pct));
  const color = p >= 90 ? 'var(--danger)' : p >= 70 ? 'var(--warn)' : 'var(--clay)';
  return (
    <div className="h-1.5 rounded-full bg-line overflow-hidden mt-1">
      <div className="h-full rounded-full" style={{ width: `${p}%`, background: color }} />
    </div>
  );
}

function LimitRow({ label, w }: { label: string; w: UsageWin | null }) {
  const t = useT();
  const pct = w?.utilization ?? null;
  return (
    <div className="mt-2.5">
      <div className="flex items-baseline justify-between text-xs gap-2">
        <span className="font-medium truncate">{label}</span>
        <span className="text-txt3 shrink-0 flex items-center gap-2">
          {w?.resetsAt && <span className="text-[11px]">{resetsIn(w.resetsAt, t)}</span>}
          <span className="font-mono tabular-nums">{pct != null ? `${Math.round(pct)}%` : '—'}</span>
        </span>
      </div>
      <UsageBar pct={pct ?? 0} />
    </div>
  );
}

function UsagePill() {
  const c = useStore((s) => s.current)!;
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(false);
  const t = useT();

  // Header/UsagePill isn't remounted on session switch (only ChatPane is keyed), so clear stale
  // data when the session changes — otherwise the pill badge shows the previous session's %.
  useEffect(() => { setData(null); }, [c.chatSessionId]);

  // Every open refetches; the server answers from its short probe cache unless fresh=1 (the
  // refresh button), which re-asks the CLI directly.
  const aliveRef = useRef(true);
  const load = (fresh = false) => {
    aliveRef.current = true;
    setLoading(true);
    api.get(`/api/sessions/${c.chatSessionId}/usage${fresh ? '?fresh=1' : ''}`)
      .then((r) => { if (aliveRef.current) setData(r.usage); })
      .catch(() => { if (aliveRef.current) setData(null); })
      .finally(() => { if (aliveRef.current) setLoading(false); });
  };
  useEffect(() => {
    if (!open) return;
    load();
    return () => { aliveRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, c.chatSessionId]);

  // The panel is placed the moment it opens — when it still holds only the loading line — and the
  // limit rows arrive after, making it taller. It now opens upward (it sits under the composer), so
  // that growth would run off the bottom of the screen and cover the pill. A resize event is what
  // the positioner listens to, so send one once the rows are actually in the DOM.
  useEffect(() => { if (open) window.dispatchEvent(new Event('resize')); }, [open, data, loading]);

  const ctx = data?.context;
  const rl = data?.rateLimits;
  const pctLabel = ctx ? `${Math.round(ctx.percentage)}%` : '—';

  return (
    <DM.Root open={open} onOpenChange={setOpen}>
      <DM.Trigger asChild>
        <button className="ctl" title={t('usage.title')}><IconGauge size={12} />{pctLabel}<IconChevronDown size={12} /></button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content sideOffset={4} side="top" align="end" collisionPadding={8}
          className="bg-panel border border-line rounded-lg p-3.5 shadow-2xl z-50 w-[320px] max-w-[calc(100vw-1.5rem)] max-h-[70vh] overflow-y-auto text-txt">
          {/* context window */}
          <div className="flex items-baseline justify-between text-xs gap-2">
            <span className="font-semibold">{t('usage.contextWindow')}</span>
            <span className="text-txt3 font-mono tabular-nums shrink-0">
              {ctx ? `${fmtTokens(ctx.totalTokens)} / ${fmtTokens(ctx.maxTokens)} (${Math.round(ctx.percentage)}%)`
                : loading ? t('usage.loading') : '—'}
            </span>
          </div>
          {ctx
            ? <UsageBar pct={ctx.percentage} />
            : !loading && <div className="text-[11px] text-txt3 mt-1">{t('usage.noContext')}</div>}

          <div className="border-t border-line my-3" />

          {/* plan rate limits */}
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] uppercase tracking-wider text-txt3">{t('usage.limits')}</span>
            <button className="text-txt3 hover:text-clay disabled:opacity-40" title={t('usage.refresh')}
              aria-label={t('usage.refresh')} disabled={loading} onClick={() => load(true)}>
              <IconRefresh size={12} className={loading ? 'animate-spin' : undefined} />
            </button>
          </div>
          {data?.rateLimitsAvailable && rl ? (
            <>
              <LimitRow label={t('usage.fiveHour')} w={rl.fiveHour} />
              <LimitRow label={t('usage.weeklyAll')} w={rl.sevenDay} />
              {rl.modelScoped.map((m) => (
                <LimitRow key={m.displayName} label={t('usage.weeklyModel', { model: m.displayName })} w={m} />
              ))}
            </>
          ) : (
            // Three different reasons the rows are missing, and they must not be confused:
            //  · the lookup did not come back (server says limitsUnknown, or it answered "available"
            //    without the windows) — temporary, the refresh button retries;
            //  · an OAuth token that reports no window is a *scope* problem, not a plan problem —
            //    `claude setup-token` mints an inference-only token, the CLI needs user:profile, and
            //    the fix is actionable (browser sign-in from My Page);
            //  · anything else genuinely has no plan window (API key, Bedrock, custom provider).
            <div className="text-[11px] text-txt3">
              {loading ? t('usage.loading')
                : !data ? t('usage.unknownRetry')
                : (data.limitsUnknown || data.rateLimitsAvailable) ? t('usage.unknownRetry')
                : t(data.authKind === 'oauth' ? 'usage.unavailableScope' : 'usage.unavailable')}
            </div>
          )}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

const VERDICT_UI: Record<string, { key: string; color: string; Icon?: typeof IconCheck }> = {
  running: { key: 'review.vRunning', color: 'var(--clay)', Icon: IconClock },
  merge_safe: { key: 'review.vSafe', color: 'var(--ok)', Icon: IconCheckCircle },
  do_not_merge: { key: 'review.vHold', color: 'var(--danger)', Icon: IconBan },
  conflict: { key: 'review.vConflict', color: 'var(--danger)', Icon: IconWarning },
  error: { key: 'review.vError', color: 'var(--danger)', Icon: IconWarning },
  unknown: { key: 'review.vUnknown', color: 'var(--txt-3)' },
  none: { key: 'review.vNone', color: 'var(--txt-3)' },
};

// Review header: PR link, base←head, the auto-pipeline VERDICT, and (admin) re-run + remote-merge.
// The PR author sees the verdict + a read-only badge (no actions).
function ReviewControls() {
  const c = useStore((s) => s.current)!;
  const { autoReviewRun, approveReview, setError } = useStore();
  const [busy, setBusy] = useState<'' | 'auto' | 'approve'>('');
  const t = useT();
  const rv = c.review!;
  const readOnly = !!c.readOnly;
  const v = VERDICT_UI[rv.verdict] || VERDICT_UI.none;

  const runAuto = async () => {
    setBusy('auto');
    try { await autoReviewRun(rv.reviewId); setError(null); }
    catch (e: any) { setError(e.message); } finally { setBusy(''); }
  };
  const approve = async () => {
    if (!confirm(t('review.approveConfirm', { n: rv.prNumber }))) return;
    setBusy('approve');
    try { const r = await approveReview(rv.reviewId); setError(t('review.approveDone', { out: r.output })); }
    catch (e: any) { setError(e.message); } finally { setBusy(''); }
  };

  return (
    <>
      <span className="text-txt3 text-xs font-mono truncate hidden lg:inline" title={`${rv.baseRef} ← ${rv.headRef}`}>{rv.baseRef} ← {rv.headRef}</span>
      <a className="pill inline-flex items-center gap-1" href={rv.prUrl} target="_blank" rel="noreferrer" title={rv.prUrl}><IconLink size={13} />{t('review.prLink', { n: rv.prNumber })}</a>
      <span className="text-[11px] font-semibold inline-flex items-center gap-1" style={{ color: v.color }} title={rv.verdictSummary || ''}>{v.Icon && <v.Icon size={12} />}{t(v.key)}</span>
      {readOnly
        ? <span className="pill inline-flex items-center gap-1" title={t('review.readOnlyHint')}><IconEye size={14} />{t('review.readOnly')}</span>
        : <>
            <button className="pill inline-flex items-center gap-1" disabled={busy !== '' || rv.verdict === 'running'} onClick={runAuto} title={t('review.autoRunHint')}><IconRotateCcw size={13} />{busy === 'auto' || rv.verdict === 'running' ? t('review.autoRunning') : t('review.autoRun')}</button>
            <button className="pill inline-flex items-center gap-1" disabled={busy !== ''} onClick={approve} title={t('review.approveHint')}><IconCheckCircle size={13} />{busy === 'approve' ? t('review.approving') : t('review.approve')}</button>
          </>}
    </>
  );
}

// The reverse of opening a wiki topic: an ordinary chat or room names one as reference knowledge,
// and its turns look the base up before answering. Rooms share the row, so one member linking a
// topic links it for everyone in that room - which is the point of a shared session.
function WikiLinkMenu() {
  const c = useStore((s) => s.current);
  const topics = useStore((s) => s.wikiTopics);
  const enabled = useStore((s) => s.wikiLinkEnabled);
  const setWikiRef = useStore((s) => s.setWikiRef);
  const setError = useStore((s) => s.setError);
  const [open, setOpen] = useState(false);
  const t = useT();
  if (!c || !enabled) return null;
  const cur = topics.find((x) => x.id === c.wikiRefId);

  const pick = async (id: string | null) => {
    setOpen(false);
    try { await setWikiRef(id); } catch (e: any) { setError(e.message); }
  };

  return (
    <DM.Root open={open} onOpenChange={setOpen}>
      <DM.Trigger asChild>
        <button className={`pill ${cur ? 'text-clay' : ''}`} title={t('wiki.linkTitle')}>
          <IconBook size={14} />{cur ? cur.name : t('wiki.linkPill')}<IconChevronDown size={14} />
        </button>
      </DM.Trigger>
      <Menu>
        <div className="px-2 py-1 text-[11px] text-txt3">{t('wiki.linkHint')}</div>
        <button className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-line" onClick={() => pick(null)}>
          {t('wiki.linkNone')}
        </button>
        {topics.length === 0 && <div className="px-2 py-1 text-[11px] text-txt3">{t('wiki.linkEmpty')}</div>}
        {topics.map((w) => (
          <button key={w.id} className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-sm rounded hover:bg-line ${w.id === c.wikiRefId ? 'text-clay font-semibold' : ''}`}
            onClick={() => pick(w.id)}>
            <IconBook size={13} className="shrink-0" /><span className="flex-1 truncate text-left">{w.name}</span>
            {w.id === c.wikiRefId && <IconCheck size={13} />}
          </button>
        ))}
      </Menu>
    </DM.Root>
  );
}

// What the learner did with the conversation, right above the composer. 'ask' mode leaves a card
// per parked addition (add / skip, with the article itself one click away); 'auto' mode leaves a
// one-line note that it already went in, dismissible.
function WikiKnowledgeCards() {
  const proposals = useStore((s) => s.wikiProposals);
  const learned = useStore((s) => s.wikiLearned);
  const decide = useStore((s) => s.decideWikiProposal);
  const dismiss = useStore((s) => s.dismissWikiLearned);
  const setError = useStore((s) => s.setError);
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const t = useT();
  if (!proposals.length && !learned.length) return null;

  const act = async (id: string, accept: boolean) => {
    setBusy(id);
    try { await decide(id, accept); } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  };

  return (
    <div className="px-3 md:px-5 pb-2 space-y-2">
      {proposals.map((pr) => (
        <div key={pr.id} className="max-w-[760px] mx-auto rounded-lg border border-line bg-claysoft px-3 py-2.5 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <IconBook size={14} className="text-clay shrink-0" />
            <span className="font-semibold">{t('wiki.proposalTitle')}</span>
            <span className="text-txt3">{t('wiki.proposalTo', { topic: pr.topicName })}</span>
          </div>
          <div className="mt-1.5 font-medium truncate" title={pr.title}>{pr.title}</div>
          {shown === pr.id && (
            <pre className="mt-1.5 max-h-52 overflow-auto scrolly whitespace-pre-wrap break-words text-[11px] text-txt2 bg-card border border-line rounded p-2">{pr.content}</pre>
          )}
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <button className="pill" onClick={() => setShown(shown === pr.id ? null : pr.id)}>{t('wiki.proposalPreview')}</button>
            <div className="flex-1" />
            <button className="pill" disabled={busy === pr.id} onClick={() => act(pr.id, false)}>{t('wiki.proposalSkip')}</button>
            <button className="btn-primary !py-1 !text-xs" disabled={busy === pr.id} onClick={() => act(pr.id, true)}>{t('wiki.proposalAdd')}</button>
          </div>
        </div>
      ))}
      {learned.map((l) => (
        <div key={l.id} className="max-w-[760px] mx-auto rounded-lg border border-line bg-card px-3 py-2 text-xs flex items-center gap-2">
          <IconBook size={14} className="text-clay shrink-0" />
          <span className="flex-1 min-w-0 truncate">{t('wiki.learnedNotice', { topic: l.topicName, title: l.title })}</span>
          <button className="text-txt3 hover:text-txt shrink-0" aria-label={t('common.close')} onClick={() => dismiss(l.id)}><IconX size={13} /></button>
        </div>
      ))}
    </div>
  );
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
    status === 'compiling' ? <span className="text-clay inline-flex items-center gap-1"><IconClock size={13} />{t('chat.compiling')}</span>
      : status === 'error' ? <span className="text-danger inline-flex items-center gap-1" title={topic?.compileError || ''}><IconWarning size={13} />{t('chat.compileError')}</span>
      : status === 'done' ? <span className="text-ok inline-flex items-center gap-1"><IconCheck size={13} />{t('chat.compiled')}{topic?.compiledAt ? ` · ${timeAgo(topic.compiledAt)}` : ''}</span>
      : <span className="text-txt3">{t('chat.notCompiled')}</span>;

  return (
    <div className="border-b border-line bg-card text-xs shrink-0">
      <div className="flex items-center gap-2 px-3 md:px-5 py-2 flex-wrap">
        <span className="cursor-pointer" onClick={() => setOpen(!open)}><IconBook size={15} /></span>
        <span className="font-semibold cursor-pointer" onClick={() => setOpen(!open)}>{c?.title}</span>
        {statusEl}
        {files && <span className="text-txt3">· {source === 'raw' ? t('chat.rawCount', { count: files.length }) : t('chat.articleCount', { count: files.length })}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button className="text-txt3 hover:text-clay inline-flex items-center gap-1" onClick={() => setExplorer(true)}><IconFolder size={13} />{t('chat.fileExplorerBtn')}</button>
          {isAdmin && <button className="text-txt3 hover:text-clay disabled:opacity-40 inline-flex items-center gap-1" disabled={status === 'compiling'} onClick={recompile}><IconRefresh size={13} />{t('chat.recompile')}</button>}
          <span className="cursor-pointer text-txt3" onClick={() => setOpen(!open)}>{open ? <IconChevronUp size={15} /> : <IconChevronDown size={15} />}</span>
        </div>
      </div>
      {explorer && <WikiExplorer topicId={topicId} onClose={() => setExplorer(false)} />}
      {status === 'compiling' && (
        <div className="px-5 pb-2 flex items-center gap-2 min-w-0">
          <ClayWait label={t('chat.compilingHint')} />
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
  const highlight = useStore((s) => s.highlightMsgId);
  const { ref: streamRef, onScroll, follow, stick } = useStickToBottom<HTMLDivElement>();
  const jumpedRef = useRef<string | null>(null); // ChatPane is keyed by session, so this resets on switch
  // Follow the newest message while the reader sits at the bottom; once they scroll up, streaming
  // leaves the view alone until they come back down. A search hit instead scrolls its target into
  // view — once (jumpedRef) — and parks there for the same reason.
  useEffect(() => {
    if (highlight && jumpedRef.current !== highlight) {
      const el = document.getElementById(`msg-${highlight}`);
      if (el) { jumpedRef.current = highlight; stick.current = false; el.scrollIntoView({ block: 'center' }); return; }
    }
    follow();
  }, [messages, live, highlight, follow, stick]);
  const segments = useMemo(() => segmentMessages(messages), [messages]);
  if (!c) return null;

  return (
    <div className={`flex flex-col min-w-0 min-h-0 ${viewMode === 'split' ? 'border-r border-line' : ''}`}>
      <WikiBanner />
      <div ref={streamRef} onScroll={onScroll} className="flex-1 overflow-y-auto scrolly px-3 md:px-5 py-4 md:py-5">
        <div className="max-w-[760px] mx-auto">
          {segments.map((seg) => seg.cmd
            ? <FoldedSegment key={seg.key} seg={seg} />
            : seg.msgs.map((m) => <MessageView key={m.id} m={m} />))}
          {live && <LiveView />}
        </div>
      </div>
      <WikiKnowledgeCards />
      <PermissionArea />
      <Composer />
    </div>
  );
}

const hhmm = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const mmdd = (ts: number) => new Date(ts).toLocaleDateString([], { month: '2-digit', day: '2-digit' });
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

function FoldedSegment({ seg }: { seg: Segment }) {
  const highlight = useStore((s) => s.highlightMsgId);
  // a search hit inside a folded /clear|/compact block opens it, else the target would be unreachable
  const [open, setOpen] = useState(() => !!highlight && seg.msgs.some((m) => m.id === highlight));
  const t = useT();
  const a = seg.msgs[0].createdAt;
  const b = seg.msgs[seg.msgs.length - 1].createdAt;
  const range = sameDay(a, b) ? `${mmdd(a)} ${hhmm(a)}–${hhmm(b)}` : `${mmdd(a)} ${hhmm(a)} – ${mmdd(b)} ${hhmm(b)}`;
  const label = seg.cmd === 'clear' ? t('chat.foldClear') : t('chat.foldCompact');
  return (
    <div className="border border-line rounded-lg my-3 bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer text-xs select-none" onClick={() => setOpen(!open)}>
        <span className="text-txt3">{open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}</span>
        <span className="text-clay"><IconArchive size={14} /></span>
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
  const highlighted = useStore((s) => s.highlightMsgId) === m.id; // search hit landed here
  const isClaude = m.role === 'assistant';
  const blocks: Block[] = isClaude ? (m.content.blocks || []) : [];
  const topicId = useStore((s) => s.current?.wikiTopicId);
  const sessionId = useStore((s) => s.current?.chatSessionId) || '';
  const isRoom = useStore((s) => s.current?.kind === 'room');
  const tree = useCite((s) => (topicId ? s.trees[topicId] || null : null));
  const sources = useMemo(() => (topicId && isClaude ? extractSources(blocks, topicId, tree) : []), [blocks, topicId, isClaude, tree]);
  const { deleteMessage, editMessage } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content.text || '');
  const [copied, setCopied] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(editRef, editing ? draft : '');
  const t = useT();
  const canEdit = !isClaude && !m.chat; // instruct messages regenerate from that point; casual chat is delete-only

  const copyText = isClaude
    ? blocks.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n\n')
    : (m.content.text || '');
  const copy = () => {
    void copyToClipboard(copyText).then((ok) => {
      if (!ok) return useStore.getState().setError(t('chat.copyFailed'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  // Re-asking the same thing verbatim is a legitimate edit: it truncates from here and regenerates.
  // (An unchanged-text guard used to swallow it, so "같은 내용 다시 질의" did nothing.)
  const saveEdit = () => {
    const edited = draft.trim();
    setEditing(false);
    if (edited) editMessage(m.id, edited);
  };

  const startEdit = () => { setDraft(m.content.text || ''); setEditing(true); };
  const remove = () => { if (confirm(t('chat.deleteMessageConfirm'))) deleteMessage(m.id); };

  return (
    // right-click needs no wiring here: the menu mirrors the row's own hover buttons (copy/edit/delete)
    <div id={`msg-${m.id}`} className={`group flex gap-3 mb-5 ${highlighted ? 'ring-2 ring-clay rounded-lg -m-1 p-1 scroll-mt-6' : ''}`}>
      <Avatar name={m.authorName || undefined} claude={isClaude} color={colorFromMsg(m)} />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-txt2 font-semibold mb-1 flex items-center gap-2">
          {isClaude ? 'Claude' : m.authorName}
          {!isClaude && isRoom && !m.chat && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-normal inline-flex items-center gap-1" style={{ background: 'var(--claysoft)', color: 'var(--clay)' }}><IconSparkle size={11} />{t('chat.claudeBadge')}</span>
          )}
          <span className="hidden group-hover:flex items-center gap-1.5 text-txt3">
            {copyText && <button className={copied ? 'text-ok inline-flex items-center gap-1' : 'hover:text-clay'} title={t('chat.copy')} aria-label={t('chat.copy')} onClick={copy}>{copied ? <><IconCheck size={13} />{t('chat.copied')}</> : <IconCopy size={14} />}</button>}
            {canEdit && <button className="hover:text-clay" title={t('chat.edit')} aria-label={t('chat.edit')} onClick={startEdit}><IconPencil size={14} /></button>}
            <button className="hover:text-danger" title={t('common.delete')} aria-label={t('common.delete')} onClick={remove}><IconTrash size={14} /></button>
          </span>
        </div>
        {editing ? (
          <div className="border border-line2 rounded-lg bg-card p-2">
            <div className="relative">
              <MdMirror text={draft} taRef={editRef} className="text-sm" />
              <textarea ref={editRef} className="relative z-10 block w-full bg-transparent outline-none resize-none text-sm text-transparent caret-clay noscrollbar min-h-[42px]" rows={2}
                value={draft} autoFocus onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') setEditing(false); }} />
            </div>
            <div className="flex gap-2 justify-end mt-1">
              <button className="btn-ghost !py-1 !text-xs" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
              <button className="rounded-md px-3 py-1 text-xs font-semibold text-white bg-clay" onClick={saveEdit}>{t('chat.saveRegenerate')}</button>
            </div>
          </div>
        ) : (
          <>
            {!isClaude && (m.content.text || '').trim() && <div className="text-sm break-words leading-relaxed" dangerouslySetInnerHTML={{ __html: md(m.content.text || '') }} />}
            {!isClaude && Array.isArray(m.content.attachments) && m.content.attachments.length > 0 && (
              <AttachmentList atts={m.content.attachments} sessionId={sessionId} />
            )}
            {isClaude && <BlockList blocks={blocks} sources={sources} hideTools={!!topicId} />}
            {isClaude && m.content.onPlanOf && (
              <div className="text-[11px] text-txt3 mt-1 inline-flex items-center gap-1" title={t('pool.ranOnTip')}>
                <IconUsers size={12} />{t('pool.ranOn', { name: m.content.onPlanOf })}
              </div>
            )}
            {m.content.interrupted && <div className="text-[11px] text-warn mt-1 inline-flex items-center gap-1"><IconSquare size={12} />{t('chat.interrupted')}</div>}
          </>
        )}
      </div>
    </div>
  );
}

// Which shared plan this session's turns run on. Hidden entirely while pooling is off, so a
// workspace that never turns it on sees no new control.
// mirrors server/src/auth/token-pool.ts
const POOL_OWN = 'own'; // this session opts out — every sender pays for their own turns
const POOL_ALL = 'all'; // the derived workspace-wide pool: everyone who registered a plan

function PoolPicker() {
  const t = useT();
  const { current: c, pools, poolAllUsers, myPoolId, tokenPoolEnabled, setPool } = useStore();
  if (!tokenPoolEnabled || !c) return null;
  const nameOf = (p: { id: string; name: string }) => (p.id === POOL_ALL ? t('pool.allUsersName') : p.name);
  // Three states, matching the server's resolution order:
  //   a pool (a party, or the workspace-wide one) → that pool;
  //   POOL_OWN → every sender pays for their own turns;
  //   null → inherit (the sender's own pool, else the workspace-wide one if the admin turned it on).
  const bound = pools.find((p) => p.id === c.poolId);
  const mine = pools.find((p) => p.id === myPoolId);
  // The inherit row names what it currently resolves to, but is prefixed so it never reads as the
  // same choice as picking that pool outright — those two entries would otherwise share a label.
  const inheritTarget = mine ? mine.name : poolAllUsers ? t('pool.allUsersName') : t('pool.own');
  const inheritLabel = t('pool.auto', { name: inheritTarget });
  const label = bound ? nameOf(bound) : c.poolId === POOL_OWN ? t('pool.own') : inheritLabel;
  // one tick on whichever entry is active, so the pill's state is readable inside the menu too
  const Row = ({ on, children }: { on: boolean; children: React.ReactNode }) => (
    <span className="inline-flex items-center gap-1.5">
      <IconCheck size={12} className={on ? 'text-clay' : 'opacity-0'} />{children}
    </span>
  );
  return (
    <DM.Root>
      <DM.Trigger asChild><button className="pill" disabled={!!c.readOnly} title={t('pool.pickTip')}><IconUsers size={13} />{label}<IconChevronDown size={14} /></button></DM.Trigger>
      <Menu>
        <MenuItem onSelect={() => void setPool(null)}><Row on={!c.poolId}>{inheritLabel}</Row></MenuItem>
        {/* explicit opt-out: "not set" now inherits, so without this a shared room could never be put
            back on "everyone pays for their own turns" */}
        <MenuItem onSelect={() => void setPool(POOL_OWN)}><Row on={c.poolId === POOL_OWN}>{t('pool.ownExplicit')}</Row></MenuItem>
        {pools.map((p) => (
          <MenuItem key={p.id} onSelect={() => void setPool(p.id)}>
            <Row on={c.poolId === p.id}>{nameOf(p)}</Row>
          </MenuItem>
        ))}
        {!pools.length && <div className="px-2 py-1 text-[11px] text-txt3">{t('pool.none')}</div>}
      </Menu>
    </DM.Root>
  );
}

// Per-session build container. Hidden while the admin flag is off or Docker isn't wired — the
// toggle would have nothing to spawn.
function SandboxToggle() {
  const t = useT();
  const { current: c, sessionSandboxEnabled, dockerReady, setSandbox } = useStore();
  if (!sessionSandboxEnabled || !dockerReady || !c) return null;
  const on = c.sandbox === 1;
  return (
    <button className={`pill inline-flex items-center gap-1 ${on ? 'ring-1 ring-clay text-clay' : ''}`}
      disabled={!!c.readOnly} title={t(on ? 'sandbox.onTip' : 'sandbox.offTip')}
      onClick={() => void setSandbox(!on)}>
      <IconBox size={13} />{t(on ? 'sandbox.on' : 'sandbox.off')}
    </button>
  );
}

// Rough chars-per-output-token, used only to keep the meter moving between the SDK's exact
// per-message totals. Mixed Korean/English/code lands near 3; the next turn:usage corrects it.
const CHARS_PER_TOKEN = 3;

function LiveView() {
  const live = useStore((s) => s.live)!;
  const isWiki = useStore((s) => !!s.current?.wikiTopicId);
  const t = useT();
  const out = live.outTokens + Math.round(live.outChars / CHARS_PER_TOKEN);
  const approx = live.outChars > 0;
  return (
    <div className="flex gap-3 mb-5">
      <Avatar claude />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-txt2 font-semibold mb-1">Claude</div>
        <BlockList blocks={live.blocks} hideTools={isWiki} />
        <div className="flex items-center gap-2.5 mt-1 flex-wrap">
          <ClayWait label={t(live.thinking ? 'chat.thinkingLive' : 'chat.working')} className="text-[13px] italic" />
          {live.credential && (
            <span className="text-[11px] text-txt3 inline-flex items-center gap-1 shrink-0" title={t('pool.ranOnTip')}>
              <IconUsers size={11} />{t('pool.ranOn', { name: live.credential })}
            </span>
          )}
          {(live.inTokens > 0 || out > 0) && (
            <span className="text-[11px] text-txt3 font-mono tabular-nums shrink-0" title={t('chat.liveTokensTip')}>
              {live.inTokens > 0 ? t('chat.inTokens', { n: fmtTokens(live.inTokens) }) : ''}
              {live.inTokens > 0 && out > 0 ? ' · ' : ''}
              {out > 0 ? t('chat.outTokens', { n: (approx ? '~' : '') + fmtTokens(out) }) : ''}
            </span>
          )}
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

// `nested` = rendering a single subagent's own pane (task panel live view): show its text blocks.
// In the main transcript nested text is skipped — it streams in the task panel, not the thread.
// `hideTools` drops the tool cards entirely: in an LLM Wiki thread the reader wants the answer and
// its sources, not the file reads that produced it (that is what the sources panel is for).
export function BlockList({ blocks: allBlocks, sources = [], nested = false, hideTools = false }: { blocks: Block[]; sources?: WikiSource[]; nested?: boolean; hideTools?: boolean }) {
  const blocks = useMemo(() => (hideTools ? allBlocks.filter((b) => b.type !== 'tool_use') : allBlocks), [allBlocks, hideTools]);
  const foldMin = useStore((s) => s.toolFoldMin); // 0 = folding off
  // A long unbroken run of tool calls between two sentences is the noisiest thing in a transcript.
  // Collapse runs of `foldMin`+ into one row; anything shorter renders as before.
  const rows = useMemo(() => {
    const out: { key: string; text?: Extract<Block, { type: 'text' }>; run?: Extract<Block, { type: 'tool_use' }>[] }[] = [];
    let run: Extract<Block, { type: 'tool_use' }>[] = [];
    // Key off the run's FIRST tool id, not the block index: while a turn streams the trailing run
    // keeps growing, and an index-based key changed on every new tool — remounting the row and
    // throwing away the open/closed state the user (or the fold) had just settled on.
    const flush = () => { if (run.length) { out.push({ key: `r${run[0].id}`, run }); run = []; } };
    blocks.forEach((b, i) => {
      if (b.type === 'tool_use') { run.push(b); return; }
      flush();
      out.push({ key: `t${i}`, text: b });
    });
    flush();
    return out;
  }, [blocks]);
  return (
    <>
      {rows.map((r) => {
        if (r.text) return r.text.parentId && !nested ? null : <MdText key={r.key} text={r.text.text} sources={sources} />;
        const run = r.run!;
        if (!foldMin || run.length < foldMin) return run.map((b, i) => <ToolCard key={`${r.key}-${i}`} b={b} />);
        return <ToolRun key={r.key} run={run} />;
      })}
    </>
  );
}

// A collapsed run of consecutive tool calls. Stays shut while the turn streams — the header already
// says how many ran, which tools, and whether one is still going — and only springs open on its own
// when something failed, because a fold that hides the call that broke is worse than the noise it
// saves. It used to open whenever any call was unfinished, which made the row flap open and shut
// once per tool for the whole turn.
function ToolRun({ run }: { run: Extract<Block, { type: 'tool_use' }>[] }) {
  const t = useT();
  const [manual, setManual] = useState<boolean | null>(null);
  const busy = run.some((b) => b.output == null);
  const failed = run.some((b) => b.isError);
  const open = manual ?? failed;
  // "Bash ×3, Read ×2" — what the run actually did, without expanding it
  const summary = useMemo(() => {
    const n = new Map<string, number>();
    for (const b of run) n.set(b.name, (n.get(b.name) || 0) + 1);
    return [...n].map(([name, c]) => (c > 1 ? `${name} ×${c}` : name)).join(', ');
  }, [run]);
  return (
    <div className="my-2">
      <button className="w-full flex items-center gap-2 px-3 py-1.5 text-xs border border-line rounded-lg bg-card hover:bg-line/40 transition text-left"
        onClick={() => setManual(!open)} aria-expanded={open}>
        <span className="text-txt3 shrink-0">{open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}</span>
        <span className="text-clay shrink-0"><IconTerminal size={14} /></span>
        <span className="font-semibold shrink-0">{t('chat.toolRunCount', { n: String(run.length) })}</span>
        <span className="font-mono text-txt2 truncate flex-1 min-w-0">{summary}</span>
        {busy ? <span className="text-[11px] text-txt3 shrink-0">{t('chat.toolRunning')}</span>
          : failed ? <span className="text-[11px] shrink-0 inline-flex items-center gap-1" style={{ color: 'var(--danger)' }}><IconX size={12} />{t('chat.toolError')}</span>
          : <span className="text-[11px] shrink-0 inline-flex items-center gap-1" style={{ color: 'var(--ok)' }}><IconCheck size={12} />{t('chat.toolDone')}</span>}
      </button>
      {open && <div className="pl-3 border-l-2 border-line ml-1.5">{run.map((b, i) => <ToolCard key={i} b={b} />)}</div>}
    </div>
  );
}

function ToolCard({ b }: { b: Extract<Block, { type: 'tool_use' }> }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  // AskUserQuestion's pick is fed back as a (technically) denied tool result — the SDK flags it
  // is_error even though nothing failed. Render it as a normal choice, not "오류".
  const isAsk = b.name === 'AskUserQuestion';
  const cancelled = isAsk && b.output === 'Denied.';
  // file edits (Edit/Write/MultiEdit) get a diff body + a collapsed +N −N badge instead of raw output
  const hunks = isAsk ? null : fileEditOf(b.name, b.input);
  const counts = hunks ? diffCounts(hunks) : null;
  const cmd = isAsk
    ? (b.input?.questions?.[0]?.question || t('chat.question'))
    : (b.input?.command || b.input?.file_path || b.input?.path || JSON.stringify(b.input || {}).slice(0, 80));
  const status: { text: string; color: string; Icon?: typeof IconCheck } =
    b.output == null ? { text: t('chat.toolRunning'), color: 'var(--txt-3)' }
    : isAsk ? (cancelled ? { text: t('chat.cancelled'), color: 'var(--txt-3)' } : { text: t('chat.selected'), color: 'var(--ok)', Icon: IconCheck })
    : b.isError ? { text: t('chat.toolError'), color: 'var(--danger)', Icon: IconX }
    : { text: t('chat.toolDone'), color: 'var(--ok)', Icon: IconCheck };
  return (
    <div className="border border-line rounded-lg my-2 overflow-hidden bg-card">
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer text-xs" onClick={() => setOpen(!open)}>
        <span className="text-clay">{isAsk ? <IconHelp size={14} /> : hunks ? <IconPencil size={14} /> : <IconTerminal size={14} />}</span>
        <span className="font-semibold">{isAsk ? t('chat.question') : b.name}</span>
        {/* a subagent ran this, not the main thread — otherwise it reads as a top-level tool call */}
        {b.parentId && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: 'var(--claysoft)', color: 'var(--clay)' }}
            title={t('tasks.nestedTip')}>{b.agentType || t('tasks.nested')}</span>
        )}
        <code className="font-mono text-txt2 truncate flex-1">{String(cmd)}</code>
        {counts && (
          <span className="font-mono text-[11px] shrink-0 inline-flex items-center gap-1">
            {b.name === 'Write' && <span className="text-txt3">{t('chat.diffFullWrite')}</span>}
            <span className="text-ok">+{counts.add}</span>
            {counts.del > 0 && <span className="text-danger">-{counts.del}</span>}
          </span>
        )}
        <span className="text-[11px] flex items-center gap-1" style={{ color: status.color }}>{status.Icon && <status.Icon size={12} />}{status.text}</span>
      </div>
      {open && (hunks && !b.isError
        ? <div className="border-t border-line"><ToolDiff hunks={hunks} /></div>
        : b.output != null && (
          <div className="border-t border-line px-3 py-2 font-mono text-xs text-txt2 whitespace-pre-wrap bg-bg max-h-64 overflow-auto scrolly">{b.output}</div>
        ))}
    </div>
  );
}

function PermissionArea() {
  const { pending, control, respond } = useStore();
  if (pending.length === 0) return null;
  return (
    <div className="px-3 md:px-5 pb-1 max-w-[760px] mx-auto w-full">
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
  const hunks = fileEditOf(p.tool, p.input); // an Edit/Write approval shows exactly what it would change
  return (
    <>
      <div className="text-xs font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--warn)' }}><IconWarning size={14} />{t('chat.toolApprovalRequest', { tool: p.tool })}</div>
      <code className="font-mono text-xs bg-card px-1.5 py-1 rounded border border-line block truncate">{p.input?.command || p.input?.file_path || JSON.stringify(p.input)}</code>
      {hunks && <div className="mt-2 border border-line rounded-md overflow-hidden bg-card"><ToolDiff hunks={hunks} /></div>}
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
          <div className="text-xs font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--warn)' }}><IconHelp size={14} className="shrink-0" />{q.question}</div>
          <div className="flex flex-col gap-1.5">
            {(q.options || []).map((o: any, oi: number) => (
              <button key={oi} className="text-left border border-line rounded-md px-3 py-2 bg-card hover:bg-line transition"
                onClick={() => respond(p.requestId, 'answer', t('chat.userChoiceAnswer', { question: q.question, label: o.label }) + (o.description ? ` (${o.description})` : ''))}>
                <div className="font-semibold text-xs">{o.label}</div>
                {o.description && <div className="text-[11px] text-txt2 mt-0.5">{o.description}</div>}
              </button>
            ))}
            <CustomAnswer question={q.question} onSubmit={(text) => respond(p.requestId, 'answer', t('chat.userChoiceAnswer', { question: q.question, label: text }))} />
          </div>
        </div>
      ))}
      <button className="btn-ghost !py-1.5 !text-xs self-start" onClick={() => respond(p.requestId, 'deny')}>{t('common.cancel')}</button>
    </div>
  );
}

// The "Other" row of an AskUserQuestion: free text instead of one of the offered options. The typed
// answer travels the same respond(..., 'answer', …) path a button pick does.
function CustomAnswer({ question, onSubmit }: { question: string; onSubmit: (text: string) => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const send = () => { const v = text.trim(); if (v) onSubmit(v); };
  return (
    <div className="flex items-center gap-1.5 border border-line rounded-md px-3 py-1.5 bg-card focus-within:border-clay transition">
      <span className="font-semibold text-xs shrink-0 text-txt2">{t('chat.customAnswer')}</span>
      <input
        className="flex-1 min-w-0 bg-transparent text-xs outline-none placeholder:text-txt3"
        value={text}
        placeholder={t('chat.customAnswerPlaceholder')}
        aria-label={t('chat.customAnswer') + ' — ' + question}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
      />
      <button className="btn-ghost !py-1 !px-2 !text-xs shrink-0 disabled:opacity-40" disabled={!text.trim()} onClick={send}>{t('chat.send')}</button>
    </div>
  );
}

// Client-side UI actions (run immediately on select). Real Claude Code commands + skills
// are fetched per session and merged in below, and the CLI's terminal-only commands are re-pointed
// at their workspace counterpart (../lib/cli-commands) at the end of the palette.
// `run` returns true when it handled the command; false means "this one still needs an argument",
// and the composer fills the command in and ghosts the hint instead of sending anything.
const CLIENT_CMDS: { cmd: string; label: string; kind: 'ui'; run: (s: any, arg: string) => boolean }[] = [
  { cmd: '/new', label: 'chat.cmdNew', kind: 'ui', run: (s) => { void s.newSession(); return true; } },
  { cmd: '/split', label: 'chat.cmdSplit', kind: 'ui', run: (s) => { s.setViewMode('split'); return true; } },
  { cmd: '/editor', label: 'chat.cmdEditor', kind: 'ui', run: (s) => { s.setViewMode('editor'); return true; } },
  { cmd: '/chat', label: 'chat.cmdChat', kind: 'ui', run: (s) => { s.setViewMode('chat'); return true; } },
  { cmd: '/interrupt', label: 'chat.cmdInterrupt', kind: 'ui', run: (s) => { s.interrupt(); return true; } },
];
type Cmd = { cmd: string; label: string; kind: 'ui' | 'cmd'; desc?: string; hint?: string; run?: (s: any, arg: string) => boolean };

// callback ref for the highlighted menu row — keeps it in view on keyboard nav (slash + @ menus).
// Module-scope so its identity is stable: React then only re-invokes it on the row entering/leaving
// selection, not every render. block:'nearest' is a no-op when the row is already visible.
const scrollSel = (el: HTMLDivElement | null) => el?.scrollIntoView({ block: 'nearest' });

// ── @ file/folder references ──
// The tree endpoint lists files only; derive the folder paths from them so both are pickable.
type Ref = { path: string; dir: boolean };
function buildRefs(files: { name: string }[]): Ref[] {
  const dirs = new Set<string>();
  for (const f of files) { const parts = f.name.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/')); }
  return [...[...dirs].map((path) => ({ path, dir: true })), ...files.map((f) => ({ path: f.name, dir: false }))];
}
// The @-token immediately left of the caret (mid-text ok): '@' at start or after whitespace,
// then path chars up to the caret. Returns the query + the '@' index.
function atTokenAt(text: string, caret: number): { q: string; start: number } | null {
  const m = text.slice(0, caret).match(/(?:^|\s)@([^\s@]*)$/);
  return m ? { q: m[1], start: caret - m[1].length - 1 } : null;
}
function filterRefs(refs: Ref[], q: string, limit = 50): Ref[] {
  const ql = q.toLowerCase();
  const base = (p: string) => p.slice(p.lastIndexOf('/') + 1).toLowerCase();
  return refs
    .filter((r) => !ql || r.path.toLowerCase().includes(ql))
    .map((r) => { const b = base(r.path); const pl = r.path.toLowerCase();
      const score = !ql ? 0 : b.startsWith(ql) ? 0 : pl.startsWith(ql) ? 1 : b.includes(ql) ? 2 : 3; return { r, score }; })
    .sort((a, b) => a.score - b.score || a.r.path.length - b.r.path.length || a.r.path.localeCompare(b.r.path))
    .slice(0, limit).map((s) => s.r);
}

// Attachment chips: image → thumbnail, other → file icon + name. Preview src is the local/demo url
// when present, otherwise the authed GET endpoint (persisted transcript messages). onRemove → composer.
function AttachmentList({ atts, sessionId, onRemove }: { atts: Attachment[]; sessionId: string; onRemove?: (name: string) => void }) {
  const t = useT();
  const [preview, setPreview] = useState<{ src: string; name: string } | null>(null);
  if (!atts?.length) return null;
  const srcOf = (a: Attachment) => a.url || `/api/sessions/${sessionId}/attachments/${encodeURIComponent(a.name)}`;
  return (
    <>
      <div className="flex flex-wrap gap-2 mt-2">
        {atts.map((a) => (
          <div key={a.name} className="relative border border-line rounded-lg overflow-hidden bg-card flex items-center max-w-full">
            {a.isImage
              ? <img src={srcOf(a)} alt={a.name} title={a.name} onClick={() => setPreview({ src: srcOf(a), name: a.name })}
                  className="w-16 h-16 object-cover cursor-zoom-in" loading="lazy" />
              : <span className="flex items-center gap-1.5 px-2.5 py-2 text-xs text-txt2 max-w-[180px]"><IconFile size={14} className="shrink-0" /><span className="truncate">{a.name}</span></span>}
            {onRemove && (
              <button type="button" onClick={() => onRemove(a.name)} title={t('chat.attachRemove')} aria-label={t('chat.attachRemove')}
                className="absolute top-0.5 right-0.5 w-4 h-4 grid place-items-center rounded-full bg-black/60 text-white leading-none"><IconX size={11} /></button>
            )}
          </div>
        ))}
      </div>
      <ImageLightbox preview={preview} onClose={() => setPreview(null)} />
    </>
  );
}

// Full-image popup for a clicked attachment thumbnail. Radix Dialog gives Esc-to-close + focus trap;
// backdrop and image click both close (image itself has no zoom, so click-anywhere-closes is fine).
function ImageLightbox({ preview, onClose }: { preview: { src: string; name: string } | null; onClose: () => void }) {
  const t = useT();
  return (
    <Dialog.Root open={!!preview} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/80 z-[70]" />
        <Dialog.Content aria-describedby={undefined} onClick={onClose}
          className="fixed inset-0 z-[70] grid place-items-center p-4 outline-none">
          <Dialog.Title className="sr-only">{t('chat.imgPreview')}</Dialog.Title>
          {preview && <img src={preview.src} alt={preview.name} className="max-w-[95vw] max-h-[92vh] object-contain rounded-lg shadow-2xl" />}
          <button type="button" onClick={onClose} title={t('chat.imgPreviewClose')} aria-label={t('chat.imgPreviewClose')}
            className="fixed top-4 right-4 w-9 h-9 grid place-items-center rounded-full bg-black/60 text-white"><IconX size={18} /></button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Anything but the default mode loosens what Claude may do without asking, so it says so in colour.
const MODE_TONE: Record<string, string> = {
  default: '', acceptEdits: 'text-clay', bypassPermissions: 'text-danger', plan: 'text-clay',
};

// Permission mode, at the left end of the composer row: the knob people flip most, so it keeps its
// icon and reads in colour whenever it is not the asking-first default.
function ModeControl() {
  const c = useStore((s) => s.current);
  const control = useStore((s) => s.control);
  const setMode = useStore((s) => s.setMode);
  const t = useT();
  if (!c) return null;
  const isRoom = c.kind === 'room';
  const isReview = c.kind === 'review';
  const m = MODES[c.permissionMode];
  return (
    <DM.Root>
      <DM.Trigger asChild>
        <button className={`ctl ${MODE_TONE[c.permissionMode] || ''}`} disabled={(isRoom || isReview) && !control.canSetMode}>
          {m ? <><m.Icon size={12} />{t(m.key)}</> : c.permissionMode}<IconChevronDown size={12} />
        </button>
      </DM.Trigger>
      <Menu side="top" align="start">
        {Object.entries(MODES).map(([id, mm]) => (
          <MenuItem key={id} onSelect={() => setMode(id)}><span className="inline-flex items-center gap-1.5"><mm.Icon size={14} />{t(mm.key)}</span></MenuItem>
        ))}
        {isRoom && !control.canSetMode && <div className="px-2 py-1 text-[11px] text-txt3">{t('chat.ownerOnlyMode')}</div>}
      </Menu>
    </DM.Root>
  );
}

// Model · effort · usage, at the right end of the composer row, next to send.
function RunControls() {
  const c = useStore((s) => s.current);
  const setModel = useStore((s) => s.setModel);
  const setEffort = useStore((s) => s.setEffort);
  // model list is admin-configurable (server registry); fetch it, fall back to the built-in defaults
  const [models, setModels] = useState<Record<string, string>>(MODELS);
  useEffect(() => { api.get('/api/config').then((cf) => { if (cf?.models) setModels(cf.models); }).catch(() => {}); }, []);
  const t = useT();
  if (!c) return null;
  // an id the registry doesn't name still has to fit the row — "claude-opus-4-8" reads as "opus-4-8"
  const modelLabel = models[c.model] || c.model.replace(/^claude-/, '');
  return (
    <>
      <DM.Root>
        <DM.Trigger asChild><button className="ctl" disabled={!!c.readOnly} title={t('chat.model')}>{modelLabel}<IconChevronDown size={12} /></button></DM.Trigger>
        <Menu side="top" align="end">
          {Object.entries(models).map(([id, label]) => (
            <MenuItem key={id} onSelect={() => setModel(id)}>{label}</MenuItem>
          ))}
        </Menu>
      </DM.Root>

      <DM.Root>
        <DM.Trigger asChild><button className="ctl" disabled={!!c.readOnly} title={t('cfg.defaultEffort')}>{t('effort.' + c.effort)}<IconChevronDown size={12} /></button></DM.Trigger>
        <Menu side="top" align="end">
          {EFFORTS.map((lvl) => (
            <MenuItem key={lvl} onSelect={() => setEffort(lvl)}>{t('effort.' + lvl)}</MenuItem>
          ))}
        </Menu>
      </DM.Root>

      <UsagePill />
    </>
  );
}

function Composer() {
  const store = useStore();
  const { current: c, send, queue, cancel, interrupt, turnActive, congested, user, commands, resumes, cancelResume } = store;
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState<UploadState | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [sel, setSel] = useState(0);
  const [caret, setCaret] = useState(0);
  const [refs, setRefs] = useState<Ref[] | null>(null);
  const [atClosed, setAtClosed] = useState(false);
  // the box was filled by ↑/↓, not typed — the / and @ menus open on typing, and a recalled command
  // ("/review …") would otherwise pop the command menu and swallow the next ↑
  const [recalled, setRecalled] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(taRef, text);
  // ↑/↓ recall: this thread's own messages, oldest first (someone else's turn in a room is not
  // "what I typed", so it stays out).
  const histKey = useInputHistory(
    store.messages.filter((m) => m.role === 'user' && (!m.authorId || m.authorId === store.user?.id)).map((m) => m.content?.text || ''),
    text,
    (v, recalled) => { setText(v); setSel(0); setAtClosed(false); setRecalled(recalled); setCaret(v.length); },
  );
  const [toolbarRef, guideInset] = useGuideInset(store.guideEnabled);
  const t = useT();
  const roomId = c?.kind === 'room' ? (c.roomId ?? null) : null;
  const [mode, setModeRaw] = useState<'chat' | 'claude'>('chat');
  const [includeChat, setIncludeChat] = useState(false);
  const setMode = (m: 'chat' | 'claude') => { setModeRaw(m); if (roomId) localStorage.setItem(`roomMode:${roomId}`, m); };
  useEffect(() => { setModeRaw(roomId ? ((localStorage.getItem(`roomMode:${roomId}`) as 'chat' | 'claude') || 'chat') : 'claude'); }, [roomId]);
  // Session switch: drop pending attachments + revoke their object URLs so they don't leak across
  // sessions and can't be silently mis-sent to a different session. (deps: session id only)
  useEffect(() => {
    atts.forEach((a) => { if (a.url) URL.revokeObjectURL(a.url); });
    setAtts([]); setUploading(null);
  }, [c?.chatSessionId]);
  if (!c) return null;
  const isRoom = c.kind === 'room';
  const readOnly = !!c.readOnly; // review PR author — can watch, can't send
  const wikiCompiling = !!c.wikiTopicId && store.wikiTopics.find((t) => t.id === c.wikiTopicId)?.compileStatus === 'compiling';
  const wikiStep = c.wikiTopicId ? store.wikiProgress[c.wikiTopicId] : undefined;
  // room team-chat mode is text-only (no Claude) → no attachments there
  const canAttach = !readOnly && !wikiCompiling && !(isRoom && mode === 'chat');

  // Upload each picked/pasted file (one request each — uploadFiles returns the last body, so we can't
  // batch and still recover every server-assigned name). Keep a local objectURL for instant image preview.
  const uploadPicked = async (files: File[]) => {
    const list = files.filter(Boolean);
    if (!list.length || !canAttach) return;
    for (const f of list) {
      try {
        const r = await api.uploadFiles(`/api/sessions/${c.chatSessionId}/attachments`, [{ file: f, rel: f.name }], setUploading);
        const rf = (r.files || [])[0];
        if (rf) setAtts((prev) => [...prev, { name: rf.name, isImage: rf.isImage, url: rf.isImage ? URL.createObjectURL(f) : undefined }]);
      } catch (e: any) { store.setError(e.message); }
    }
    setUploading(null);
    if (fileRef.current) fileRef.current.value = '';
  };
  const removeAtt = async (name: string) => {
    const a = atts.find((x) => x.name === name);
    if (a?.url) URL.revokeObjectURL(a.url);
    setAtts((prev) => prev.filter((x) => x.name !== name));
    try { await api.del(`/api/sessions/${c.chatSessionId}/attachments/${encodeURIComponent(name)}`); } catch { /* noop */ }
  };
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imgs = Array.from(e.clipboardData?.items || []).filter((it) => it.kind === 'file' && it.type.startsWith('image/'));
    if (!imgs.length || !canAttach) return;
    e.preventDefault(); // a screenshot paste shouldn't also dump into the textarea
    const files = imgs.map((it) => it.getAsFile()).filter(Boolean) as File[];
    // pasted screenshots usually have no filename → synthesize one so the server has a basename
    void uploadPicked(files.map((f) => (f.name ? f : new File([f], `screenshot-${Date.now()}.png`, { type: f.type || 'image/png' }))));
  };

  // full palette: client UI actions + real CLI slash commands (built-in + plugin + skill), with hints
  const seen = new Set<string>();
  const palette: Cmd[] = [
    ...CLIENT_CMDS,
    ...commands.map((ci): Cmd => ({ cmd: '/' + ci.name, label: ci.description, kind: 'cmd', desc: ci.description, hint: ci.argumentHint })),
    // Last on purpose: should the CLI really expose a command of the same name in this session, the
    // real one wins and the stand-in never shadows it. Calling `w.run(store, …)` here instead of
    // passing `run: w.run` along is also deliberate — this is the one spot that type-checks the store
    // against the fields cli-commands.ts declares, so renaming one there cannot go unnoticed.
    ...WORKSPACE_CMDS.flatMap((w): Cmd[] => w.cmds.map((cmd) => ({
      cmd, label: w.label, kind: 'ui', hint: w.hint, run: (_s: unknown, arg: string) => w.run(store, arg),
    }))),
  ].filter((p) => (seen.has(p.cmd) ? false : seen.add(p.cmd)));

  const word = text.toLowerCase();
  const showMenu = !recalled && /^\/[^\s]*$/.test(text); // menu shows while typing the command token (no space yet)
  const matches = showMenu ? palette.filter((x) => x.cmd.toLowerCase().startsWith(word)).slice(0, 50) : [];
  const showSlash = matches.length > 0;

  // parameter guide: once a command is chosen (space typed, no args yet), ghost its argument hint
  const firstTok = text.split(' ')[0];
  const active = text.startsWith('/') ? palette.find((p) => p.cmd === firstTok) : undefined;
  const argsTyped = text.length > firstTok.length && text.slice(firstTok.length).trim().length > 0;
  const showHint = !!active?.hint && !showSlash && !argsTyped;

  // @ file/folder reference picker — any session that has a project (not wiki knowledge queries)
  const canRef = !c.wikiTopicId && !!c.projectId;
  const atTok = canRef && !atClosed && !recalled ? atTokenAt(text, Math.min(caret, text.length)) : null;
  useEffect(() => { setRefs(null); }, [c.projectId]); // project switched → drop cached tree
  useEffect(() => {
    if (canRef && atTok && refs === null && c.projectId)
      api.get(`/api/projects/${c.projectId}/tree`).then((r) => setRefs(buildRefs(r.files || []))).catch(() => setRefs([]));
  }, [canRef, !!atTok, refs, c.projectId]);
  const atMatches = atTok && refs ? filterRefs(refs, atTok.q) : [];
  const showAt = !showSlash && !!atTok && atMatches.length > 0;

  const menuOpen = showSlash || showAt;
  const menuMatches: (Cmd | Ref)[] = showSlash ? matches : atMatches;

  const pickSlash = (i: number) => {
    const m = matches[i]; if (!m) return;
    if (m.run?.(store, splitCommand(text).arg)) { setText(''); setCaret(0); setSel(0); return; }
    setText(m.cmd + ' '); setSel(0); taRef.current?.focus(); // fill for args; the hint ghosts in; Enter sends → CLI runs it
  };
  const pickAt = (i: number) => {
    const r = atMatches[i]; if (!r || !atTok) return;
    const insert = '@' + r.path + (r.dir ? '/' : '') + ' ';
    const before = text.slice(0, atTok.start), after = text.slice(caret);
    const pos = before.length + insert.length;
    setText(before + insert + after); setSel(0); setAtClosed(false);
    requestAnimationFrame(() => { const ta = taRef.current; if (ta) { ta.focus(); ta.setSelectionRange(pos, pos); } setCaret(pos); });
  };
  const pickMenu = (i: number) => (showSlash ? pickSlash(i) : pickAt(i));
  const submit = () => {
    if (wikiCompiling || readOnly) return;
    if (menuOpen) return pickMenu(Math.min(sel, menuMatches.length - 1));
    if (uploading) return; // an upload is still in flight — sending now would drop the pending file from the turn
    if (!text.trim() && !atts.length) return; // allow attachment-only sends
    // Typed out in full ("/permissions plan") the menu is already closed, so the pick path above
    // never runs — catch it here too or the CLI gets a command it cannot answer.
    const { token, arg } = splitCommand(text);
    if (palette.find((p) => p.cmd === token)?.run?.(store, arg)) { setText(''); setCaret(0); return; }
    const attachments = atts.length ? atts.map((a) => ({ name: a.name, isImage: a.isImage })) : undefined;
    // A slash command runs on the CLI, so it is never team chat — the room composer opens in chat
    // mode, and sending one there used to just post the text. (The server enforces this too.)
    const isCmd = text.trim().startsWith('/');
    send(text.trim(), { chat: isRoom && mode === 'chat' && !isCmd, includeChat: isRoom && mode === 'claude' && includeChat, attachments });
    atts.forEach((a) => { if (a.url) URL.revokeObjectURL(a.url); });
    setText(''); setCaret(0); setAtts([]);
  };

  return (
    <div className="px-3 md:px-5 pb-4 pt-2 shrink-0">
      <div className="max-w-[760px] mx-auto">
        {resumes.length > 0 && (
          <div className="text-xs mb-2 flex flex-col gap-1">
            {resumes.map((r) => (
              <div key={r.id} className="flex items-start gap-2 bg-warnsoft border border-line rounded-lg px-2.5 py-1.5">
                <span className="text-warn shrink-0 mt-px"><IconClock size={12} /></span>
                <span className="text-txt2 min-w-0 break-words">
                  {t('chat.resumeScheduled', { time: fmtClock(r.resumeAt), name: r.author.name })}
                </span>
                <button className="ml-auto shrink-0 text-txt3 hover:text-danger" title={t('common.cancel')}
                  aria-label={t('common.cancel')} onClick={() => cancelResume(r.id)}><IconX size={13} /></button>
              </div>
            ))}
          </div>
        )}
        {(queue.running || queue.waiting.length > 0 || congested) && (
          <div className="text-xs text-txt3 mb-2 flex items-center gap-2 flex-wrap">
            {queue.running && <ClayWait size={5} label={t('chat.authorWorking', { name: queue.running.author.name })} />}
            {turnActive && (
              <button className="text-danger hover:underline" onClick={interrupt}>{t('chat.interruptShort')}</button>
            )}
            {queue.waiting.map((w) => (
              <span key={w.id} className="bg-rail border border-line rounded-full px-2.5 py-0.5 text-txt2 flex items-center gap-1">
                {t('chat.authorWaiting', { name: w.author.name })}
                {(w.author.id === user?.id) && <button className="text-danger" title={t('common.cancel')} aria-label={t('common.cancel')} onClick={() => cancel(w.id)}><IconX size={13} /></button>}
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
                  <div key={m.cmd} ref={i === sel ? scrollSel : undefined} onMouseEnter={() => setSel(i)} onClick={() => pickSlash(i)}
                    className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm ${i === sel ? 'bg-line' : ''}`}>
                    <code className="font-mono text-clay text-xs shrink-0">{m.cmd}</code>
                    {/* a long hint (the permission modes) must give way on a phone rather than push the badge out */}
                    {m.hint && <code className="font-mono text-txt3 text-[11px] min-w-0 truncate">{m.hint}</code>}
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
          {showAt && (
            <div className="absolute bottom-full mb-2 left-0 right-0 bg-panel border border-line rounded-lg shadow-2xl overflow-hidden z-40">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-txt3 border-b border-line flex justify-between">
                <span>{t('chat.filesRef')}</span><span>{atMatches.length}</span>
              </div>
              <div className="max-h-64 overflow-y-auto scrolly">
                {atMatches.map((r, i) => (
                  <div key={(r.dir ? 'd:' : 'f:') + r.path} ref={i === sel ? scrollSel : undefined} onMouseEnter={() => setSel(i)} onClick={() => pickAt(i)}
                    className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm ${i === sel ? 'bg-line' : ''}`}>
                    <span className="shrink-0 text-txt3">{r.dir ? <IconFolder size={14} /> : <IconFile size={14} />}</span>
                    <code className="font-mono text-txt2 text-xs truncate flex-1">{r.path}{r.dir ? '/' : ''}</code>
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                      style={{ background: 'var(--claysoft)', color: 'var(--clay)' }}>
                      {r.dir ? t('chat.refFolder') : t('chat.refFile')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="border border-line2 rounded-xl bg-card p-3 relative"
            onDragOver={canAttach ? (e) => e.preventDefault() : undefined}
            onDrop={canAttach ? (e) => { e.preventDefault(); void uploadPicked(Array.from(e.dataTransfer?.files || [])); } : undefined}>
            {showHint && (
              <div className="absolute left-3 right-3 top-3 text-sm leading-[inherit] whitespace-pre-wrap break-words pointer-events-none select-none z-0" aria-hidden>
                <span className="invisible">{text}</span><span className="text-txt3">{active!.hint}</span>
              </div>
            )}
            {/* live markdown: painted behind the textarea, which keeps the caret/IME/menus */}
            {/* `block` on the textarea matters: as an inline box it leaves a baseline gap under itself,
                which would make the wrapper (and the inset-0 mirror) a few px taller and scroll out of step */}
            <div className="relative">
            <MdMirror text={text} taRef={taRef} className="text-sm" />
            <textarea ref={taRef} disabled={wikiCompiling || readOnly} data-composer=""
              className="relative z-10 block w-full bg-transparent outline-none resize-none text-sm text-transparent caret-clay placeholder:text-txt3 disabled:opacity-50 noscrollbar min-h-[42px]"
              rows={2} placeholder={readOnly ? t('review.readOnlyPlaceholder') : wikiCompiling ? t('chat.topicCompiling') : isRoom ? (mode === 'chat' ? t('chat.roomChatPlaceholder', { title: c.title }) : t('chat.roomMessagePlaceholder', { title: c.title, name: user?.displayName ?? '' })) : t('chat.messagePlaceholder')}
              value={text}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
              onPaste={onPaste}
              onChange={(e) => {
                let v = e.target.value;
                let pos = e.target.selectionStart ?? v.length;
                if (isRoom) { const mm = v.match(/^@(\ud074\ub85c\ub4dc|claude)\s?/i); if (mm) { v = v.slice(mm[0].length); setMode('claude'); pos = Math.max(0, pos - mm[0].length); } }
                setText(v); setSel(0); setAtClosed(false); setRecalled(false); setCaret(Math.min(pos, v.length));
              }}
              onKeyDown={(e) => {
                if (menuOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab')) {
                  e.preventDefault();
                  const up = e.key === 'ArrowUp';
                  setSel((p) => up ? (p - 1 + menuMatches.length) % menuMatches.length : (p + 1) % menuMatches.length);
                  return;
                }
                if (histKey(e)) return; // ↑/↓ from the edge line walks past messages (menu arrows win above)
                if (e.key === 'Escape') {
                  if (showAt) { e.preventDefault(); setAtClosed(true); return; }
                  if (showSlash) { e.preventDefault(); setText(''); return; }
                  if (turnActive) { e.preventDefault(); interrupt(); return; } // no menu open → stop the running turn
                }
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
              }} />
            </div>
            {uploading && <div className="mt-2"><UploadProgress s={uploading} /></div>}
            <AttachmentList atts={atts} sessionId={c.chatSessionId} onRemove={removeAtt} />
            {/* guideInset keeps send/attach clear of the guide launcher, which floats in this exact
                corner — 0 whenever the row already ends left of it (see useGuideInset). */}
            {/* One line: what the turn runs as on the left, what it costs and send on the right. The
                keyboard hint is the only thing that may go — it drops out before the row can wrap. */}
            <div ref={toolbarRef} style={{ paddingRight: guideInset || undefined }}
              className="flex items-center gap-1 mt-1.5 min-w-0 flex-wrap md:flex-nowrap">
              <ModeControl />
              <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { void uploadPicked(Array.from(e.target.files || [])); }} />
              {canAttach && (
                <button type="button" className="ctl" disabled={!!uploading} title={t('chat.attach')} aria-label={t('chat.attach')} onClick={() => fileRef.current?.click()}><IconPlus size={15} /></button>
              )}
              {isRoom && (
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => setMode('chat')} className={`text-xs px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${mode === 'chat' ? 'bg-clay text-white border-clay' : 'border-line text-txt2 hover:border-clay'}`}><IconMessage size={12} />{t('chat.modeChat')}</button>
                  <button type="button" onClick={() => setMode('claude')} className={`text-xs px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${mode === 'claude' ? 'bg-clay text-white border-clay' : 'border-line text-txt2 hover:border-clay'}`}><IconSparkle size={12} />{t('chat.modeClaude')}</button>
                </div>
              )}
              {isRoom && mode === 'claude' && (
                <label className="flex items-center gap-1 text-xs text-txt2 shrink-0 cursor-pointer" title={t('chat.includeChatTip')}>
                  <input type="checkbox" checked={includeChat} onChange={(e) => setIncludeChat(e.target.checked)} /> {t('chat.includeChat')}
                </label>
              )}
              <span className="text-xs text-txt3 truncate min-w-0 px-1">
                {wikiCompiling ? <ClayWait size={5} label={wikiStep ? t('chat.compilingStep', { step: wikiStep }) : t('chat.compilingReady')} />
                  : turnActive ? <ClayWait size={5} label={t('chat.claudeResponding')} />
                  : <span className="hidden lg:inline">{isRoom && mode === 'chat' ? t('chat.composerHintChat') : t(canRef ? 'chat.composerHintRef' : 'chat.composerHint')}</span>}
              </span>
              <div className="ml-auto flex items-center gap-1 shrink-0">
                <RunControls />
                <button className="bg-clay text-white rounded-lg w-7 h-7 grid place-items-center disabled:opacity-40 shrink-0" disabled={wikiCompiling || readOnly || !!uploading} onClick={submit} aria-label={t('chat.send')}><IconSend size={15} /></button>
              </div>
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
