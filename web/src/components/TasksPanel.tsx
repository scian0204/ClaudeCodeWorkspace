import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type AgentTask } from '../lib/store';
import { useT } from '../lib/i18n';
import { useIsMobile } from '../lib/ui';
import { BlockList } from './Chat';
import {
  IconActivity, IconUsers, IconTerminal, IconGitBranch, IconEye, IconBox, IconChevronRight,
  IconChevronDown, IconCheck, IconX, IconBan, IconSquare, IconClock, IconDot, IconDotOutline,
} from '../lib/icons';

// Right-side panel for everything a turn spawns behind the main thread: Task-tool subagents,
// backgrounded shells, local workflows, MCP monitors. The list is a server-pushed snapshot
// (`tasks:update`), so this component only groups/filters — it never tracks task state itself.

type Filter = 'all' | 'subagent' | 'shell' | 'workflow';

const KIND_ICON: Record<string, typeof IconBox> = {
  subagent: IconUsers, shell: IconTerminal, workflow: IconGitBranch, monitor: IconEye,
};
const kindIcon = (kind: string) => KIND_ICON[kind] || IconBox;

const RUNNING = ['running', 'pending', 'paused'];
export const isTaskLive = (t: AgentTask) => RUNNING.includes(t.status);
const matches = (t: AgentTask, f: Filter) => f === 'all' || t.kind === f;

function statusUi(task: AgentTask, t: (k: string, p?: any) => string) {
  switch (task.status) {
    case 'completed': return { label: t('tasks.sDone'), color: 'var(--ok)', Icon: IconCheck };
    case 'failed': return { label: t('tasks.sFailed'), color: 'var(--danger)', Icon: IconX };
    case 'killed': return { label: t('tasks.sKilled'), color: 'var(--danger)', Icon: IconBan };
    case 'stopped': return { label: t('tasks.sStopped'), color: 'var(--txt-3)', Icon: IconSquare };
    case 'paused': return { label: t('tasks.sPaused'), color: 'var(--warn)', Icon: IconClock };
    case 'pending': return { label: t('tasks.sPending'), color: 'var(--txt-3)', Icon: IconDotOutline };
    default: return { label: t('tasks.sRunning'), color: 'var(--clay)', Icon: IconDot };
  }
}

const fmtDur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};
const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));

// Ticks once a second only while something is actually running, so a settled list costs nothing.
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function TasksPanel({ width, onResize }: { width: number; onResize: (w: number) => void }) {
  const tasks = useStore((s) => s.tasks);
  const setTasksOpen = useStore((s) => s.setTasksOpen);
  const isMobile = useIsMobile();
  const [filter, setFilter] = useState<Filter>('all');
  const t = useT();
  const live = tasks.some(isTaskLive);
  const now = useNow(live);

  // newest first — a long turn keeps the interesting rows at the top
  const rows = useMemo(() => tasks.filter((x) => matches(x, filter)).slice().reverse(), [tasks, filter]);
  const tabs: Filter[] = ['all', 'subagent', 'shell', 'workflow'];
  const count = (f: Filter) => tasks.filter((x) => matches(x, f)).length;

  // drag the left edge to resize (desktop only; Chat clamps + persists the width)
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX, startW = width;
    const move = (ev: MouseEvent) => onResize(startW - (ev.clientX - startX));
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.body.style.userSelect = 'none';
  };

  const body = (
    <>
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line shrink-0">
        <span className={live ? 'text-clay' : 'text-txt3'}><IconActivity size={15} /></span>
        <span className="font-semibold text-sm">{t('tasks.title')}</span>
        <span className="text-txt3 text-xs">{tasks.length}</span>
        <button className="ml-auto text-txt3 hover:text-clay" title={t('tasks.collapse')} aria-label={t('tasks.collapse')}
          onClick={() => setTasksOpen(false)}>{isMobile ? <IconX size={16} /> : <IconChevronRight size={16} />}</button>
      </div>
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-line shrink-0 overflow-x-auto scrolly">
        {tabs.map((f) => {
          const n = count(f);
          if (f !== 'all' && n === 0) return null;
          return (
            <button key={f} onClick={() => setFilter(f)}
              className={`text-[11px] px-2 py-0.5 rounded-full border shrink-0 ${filter === f ? 'bg-clay text-white border-clay' : 'border-line text-txt2 hover:border-clay'}`}>
              {t(`tasks.tab.${f}`)} {n}
            </button>
          );
        })}
      </div>
      <div className="flex-1 overflow-y-auto scrolly p-2 min-h-0">
        {rows.length === 0
          ? <div className="text-txt3 text-xs p-2 leading-relaxed">{t('tasks.empty')}</div>
          : rows.map((x) => <TaskRow key={x.id} task={x} now={now} />)}
      </div>
    </>
  );

  // Phone: a full-screen overlay instead of a grid column — a 300px+ side column would leave the chat
  // unusable, and the page must never scroll sideways.
  if (isMobile) return <div className="fixed inset-0 z-50 bg-panel flex flex-col min-h-0">{body}</div>;

  return (
    <aside className="relative border-l border-line bg-panel flex flex-col min-h-0">
      <div onMouseDown={startDrag} title={t('tasks.resize')}
        className="absolute left-0 top-0 h-full w-1.5 -ml-0.5 cursor-col-resize z-10 hover:bg-clay/40" />
      {body}
    </aside>
  );
}

function TaskRow({ task, now }: { task: AgentTask; now: number }) {
  const [open, setOpen] = useState(false);
  const [watch, setWatch] = useState(false);
  const t = useT();
  const st = statusUi(task, t);
  const Icon = kindIcon(task.kind);
  const running = isTaskLive(task);
  const elapsed = running ? now - task.startedAt : (task.endedAt ? task.endedAt - task.startedAt : task.durationMs);
  const detail = task.error || task.summary;
  // live sub-transcript (tmux-style): everything this subagent streamed during the in-flight turn,
  // joined to the task via the spawning Task call's tool_use id
  const live = useStore((s) => s.live);
  const subBlocks = useMemo(
    () => (task.toolUseId && live ? live.blocks.filter((b) => b.parentId === task.toolUseId) : []),
    [live, task.toolUseId]);
  const subDelta = (task.toolUseId && live?.subDelta[task.toolUseId]) || '';
  const watchable = subBlocks.length > 0 || !!subDelta;

  return (
    <div className={`border rounded-lg mb-1.5 overflow-hidden ${running ? 'border-clay/50 bg-claysoft' : 'border-line bg-card'}`}>
      <div className={`flex items-start gap-2 px-2.5 py-2 text-xs ${detail ? 'cursor-pointer' : ''}`} onClick={() => detail && setOpen(!open)}>
        <span className="shrink-0 mt-px" style={{ color: st.color }} title={st.label}>
          {running ? <span className="clay-shimmer inline-flex"><Icon size={14} /></span> : <Icon size={14} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 font-semibold"
              style={{ background: 'var(--claysoft)', color: 'var(--clay)' }}>
              {task.agentType || t(`tasks.kind.${task.kind}`, { kind: task.kind })}
            </span>
            {task.background && <span className="text-[10px] text-txt3 shrink-0">{t('tasks.background')}</span>}
            {task.ambient && <span className="text-[10px] text-txt3 shrink-0">{t('tasks.ambient')}</span>}
            <span className="ml-auto shrink-0 inline-flex items-center gap-1" style={{ color: st.color }}>
              <st.Icon size={11} />{st.label}
            </span>
          </div>
          <div className="text-txt2 break-words mt-1 leading-snug">{task.label || t('tasks.noLabel')}</div>
          <div className="text-[10px] text-txt3 mt-1 flex items-center gap-2 flex-wrap font-mono">
            {elapsed != null && <span>{fmtDur(elapsed)}</span>}
            {task.tokens != null && <span>{fmtTokens(task.tokens)} tok</span>}
            {task.toolUses != null && <span>{t('tasks.toolUses', { n: task.toolUses })}</span>}
            {task.lastTool && <span className="truncate">{task.lastTool}</span>}
            {watchable && (
              <button className={`inline-flex items-center gap-1 shrink-0 ${watch ? 'text-clay' : 'text-txt3 hover:text-clay'}`}
                title={t('tasks.watchTip')} onClick={(e) => { e.stopPropagation(); setWatch(!watch); }}>
                <IconEye size={12} />{t('tasks.watch')}
              </button>
            )}
            {detail && <span className="ml-auto text-txt3">{open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}</span>}
          </div>
        </div>
      </div>
      {watch && watchable && <SubagentLive blocks={subBlocks} delta={subDelta} streaming={running} />}
      {open && detail && (
        <div className={`border-t border-line px-2.5 py-2 text-[11px] whitespace-pre-wrap break-words bg-bg max-h-56 overflow-auto scrolly ${task.error ? 'text-danger' : 'text-txt2'}`}>
          {detail}
        </div>
      )}
    </div>
  );
}

// One subagent's own pane: its completed blocks plus the still-streaming text tail, pinned to the
// bottom like a terminal so new output stays in view.
function SubagentLive({ blocks, delta, streaming }: { blocks: any[]; delta: string; streaming: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight; }, [blocks, delta]);
  return (
    <div ref={ref} className="border-t border-line px-2.5 py-2 bg-bg max-h-72 overflow-auto scrolly text-[12px]">
      <BlockList nested blocks={blocks} />
      {delta && <div className="whitespace-pre-wrap break-words text-txt2">{delta}</div>}
      {streaming && <span className="inline-block w-1.5 h-3.5 bg-clay/70 align-text-bottom animate-pulse" />}
    </div>
  );
}
