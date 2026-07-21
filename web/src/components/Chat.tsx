import { useEffect, useRef, useState } from 'react';
import * as DM from '@radix-ui/react-dropdown-menu';
import { useStore, type Block, type Msg } from '../lib/store';
import { api } from '../lib/api';
import { Avatar, timeAgo } from '../lib/ui';
import { MembersDialog } from './MembersDialog';

const MODELS: Record<string, string> = {
  'claude-opus-4-8': 'Opus 4.8', 'claude-sonnet-5': 'Sonnet 5', 'claude-haiku-4-5-20251001': 'Haiku 4.5',
};
const MODES: Record<string, string> = {
  default: '🛡 기본(승인)', acceptEdits: '✎ 편집 자동승인', bypassPermissions: '⚡ 전체 허용', plan: '📋 플랜',
};

export function Chat() {
  const c = useStore((s) => s.current)!;
  const viewMode = useStore((s) => s.viewMode);
  return (
    <div className="flex flex-col min-w-0 h-full">
      <Header />
      <div className="flex-1 grid min-h-0" style={{ gridTemplateColumns: viewMode === 'split' ? '1fr 1fr' : '1fr', gridTemplateRows: 'minmax(0, 1fr)' }}>
        {viewMode !== 'editor' && <ChatPane key={c.chatSessionId} />}
        {viewMode !== 'chat' && <EditorPane />}
      </div>
    </div>
  );
}

function Header() {
  const { current: c, presence, control, toggleTheme, setViewMode, viewMode, setModel, setMode } = useStore();
  const [showMembers, setShowMembers] = useState(false);
  if (!c) return null;
  const isRoom = c.kind === 'room';
  const owner = c.room?.members.find((m) => m.isOwner);

  return (
    <header className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line bg-panel shrink-0">
      <div className="font-semibold text-sm flex items-center gap-2 min-w-0">
        <span className="w-[7px] h-[7px] rounded-full bg-ok shrink-0" />
        <span className="truncate">{c.title}</span>
        <span className="text-txt3 text-xs font-mono truncate hidden md:inline">{c.wikiTopicId ? '📚 지식 기반 질의' : (c.projectId ? '' : '~/(프로젝트 미선택)')}</span>
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
          <button className="pill" onClick={() => setShowMembers(true)}>👑 {owner?.displayName || '방장'} · 멤버</button>
        </>
      )}

      {!c.wikiTopicId && <ProjectMenu />}

      <DM.Root>
        <DM.Trigger asChild><button className="pill">{MODELS[c.model] || c.model} ▾</button></DM.Trigger>
        <Menu>
          {Object.entries(MODELS).map(([id, label]) => (
            <MenuItem key={id} onSelect={() => setModel(id)}>{label}</MenuItem>
          ))}
        </Menu>
      </DM.Root>

      <DM.Root>
        <DM.Trigger asChild><button className="pill" disabled={isRoom && !control.canSetMode}>{MODES[c.permissionMode] || c.permissionMode} ▾</button></DM.Trigger>
        <Menu>
          {Object.entries(MODES).map(([id, label]) => (
            <MenuItem key={id} onSelect={() => setMode(id)}>{label}</MenuItem>
          ))}
          {isRoom && !control.canSetMode && <div className="px-2 py-1 text-[11px] text-txt3">방장만 변경 가능</div>}
        </Menu>
      </DM.Root>

      {!c.wikiTopicId && (
        <div className="seg">
          {(['chat', 'split', 'editor'] as const).map((m) => (
            <button key={m} className={viewMode === m ? 'on' : ''} onClick={() => setViewMode(m)}>
              {m === 'chat' ? '대화' : m === 'split' ? '분할' : '에디터'}
            </button>
          ))}
        </div>
      )}
      <button className="toolbtn" title="테마 전환" onClick={toggleTheme}>◐</button>

      {showMembers && c.room && <MembersDialog open={showMembers} onClose={() => setShowMembers(false)} />}
    </header>
  );
}

function ProjectMenu() {
  const { current: c, projects, setProject } = useStore();
  const [roomProjects, setRoomProjects] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useStore((s) => s.refreshLists);

  useEffect(() => {
    if (c?.kind === 'room' && c.roomId) api.get(`/api/projects/room/${c.roomId}`).then((r) => setRoomProjects(r.projects)).catch(() => {});
  }, [c?.roomId, c?.kind]);

  if (!c) return null;
  const list = [...projects.common.map((p) => ({ ...p, tag: '공통' })),
    ...(c.kind === 'room' ? roomProjects.map((p) => ({ ...p, tag: '방' })) : projects.mine.map((p) => ({ ...p, tag: '개인' })))];
  const cur = list.find((p) => p.id === c.projectId);

  const create = async () => {
    const name = newName.trim(); const git = gitUrl.trim();
    if (!name && !git) return;
    const scope = c.kind === 'room' ? 'room' : 'user';
    setBusy(true);
    try {
      const { project } = await api.post('/api/projects', { scope, name, roomId: c.roomId, gitUrl: git || undefined });
      setNewName(''); setGitUrl(''); await refresh();
      if (c.kind === 'room') { const r = await api.get(`/api/projects/room/${c.roomId}`); setRoomProjects(r.projects); }
      await setProject(project.id);
    } catch (e: any) { useStore.getState().setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <DM.Root>
      <DM.Trigger asChild><button className="pill">📁 {cur ? cur.name : '프로젝트'} ▾</button></DM.Trigger>
      <Menu>
        {list.length === 0 && <div className="px-2 py-1 text-[11px] text-txt3">프로젝트 없음</div>}
        {list.map((p) => (
          <MenuItem key={p.id} onSelect={() => setProject(p.id)}>
            <span className="text-[10px] text-txt3 mr-1">[{p.tag}]</span>{p.name}
          </MenuItem>
        ))}
        <div className="border-t border-line my-1" />
        <div className="flex flex-col gap-1 p-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <input className="input !py-1 !text-xs" placeholder="새 프로젝트 이름 (git이면 선택)" value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !gitUrl.trim()) { e.preventDefault(); create(); } }} />
          <input className="input !py-1 !text-xs" placeholder="git clone URL (선택)" value={gitUrl}
            onChange={(e) => setGitUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } }} />
          <button className="btn-ghost !py-1 !text-xs" disabled={busy} onClick={create}>
            {busy ? '생성 중…' : gitUrl.trim() ? '⬇ Clone & 생성' : '＋ 생성'}
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
  const [files, setFiles] = useState<{ name: string; content: string }[] | null>(null);
  const [source, setSource] = useState<string>('');
  const [sel, setSel] = useState<string | null>(null);
  const status = topic?.compileStatus;

  useEffect(() => {
    setFiles(null); setSel(null); setSource('');
    if (!topicId || status === 'compiling') return; // (re)fetch once compile settles
    api.get(`/api/wiki/topics/${topicId}/files`).then((r) => { setFiles(r.files); setSource(r.source); }).catch(() => setFiles([]));
  }, [topicId, status]);

  if (!topicId) return null;
  const selFile = files?.find((f) => f.name === sel);
  const recompile = () => api.post(`/api/wiki/topics/${topicId}/recompile`).catch((e) => useStore.getState().setError(e.message));

  const statusEl =
    status === 'compiling' ? <span className="text-clay">⏳ 컴파일 중…</span>
      : status === 'error' ? <span className="text-danger" title={topic?.compileError || ''}>⚠ 컴파일 오류</span>
      : status === 'done' ? <span className="text-ok">✓ 컴파일됨{topic?.compiledAt ? ` · ${timeAgo(topic.compiledAt)}` : ''}</span>
      : <span className="text-txt3">미컴파일</span>;

  return (
    <div className="border-b border-line bg-card text-xs shrink-0">
      <div className="flex items-center gap-2 px-5 py-2">
        <span className="cursor-pointer" onClick={() => setOpen(!open)}>📚</span>
        <span className="font-semibold cursor-pointer" onClick={() => setOpen(!open)}>{c?.title}</span>
        {statusEl}
        {files && <span className="text-txt3">· {source === 'raw' ? `원본 ${files.length}` : `아티클 ${files.length}`}</span>}
        <div className="ml-auto flex items-center gap-2">
          {isAdmin && <button className="text-txt3 hover:text-clay disabled:opacity-40" disabled={status === 'compiling'} onClick={recompile}>↻ 재컴파일</button>}
          <span className="cursor-pointer text-txt3" onClick={() => setOpen(!open)}>{open ? '▲' : '▼'}</span>
        </div>
      </div>
      {status === 'compiling' && (
        <div className="px-5 pb-2 text-clay flex items-center gap-2">
          <span className="tdot" /><span className="tdot" /><span className="tdot" />
          <span>컴파일 중 — 완료 후 질의 가능.</span>
          {step && <span className="text-txt3 font-mono truncate">{step}</span>}
        </div>
      )}
      {status === 'error' && topic?.compileError && <div className="px-5 pb-2 text-danger truncate" title={topic.compileError}>오류: {topic.compileError}</div>}
      {open && status !== 'compiling' && (
        <div className="px-5 pb-3">
          {source === 'raw' && files && files.length > 0 && <div className="text-txt3 mb-1">아직 미컴파일 — 원본 표시 중. 답변은 컴파일 후 정확합니다.</div>}
          {files && files.length === 0 && <div className="text-txt3">문서 없음 — 관리자가 파일을 추가하면 근거로 쓰입니다.</div>}
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

function ChatPane() {
  const { current: c, messages, live, viewMode } = useStore();
  const streamRef = useRef<HTMLDivElement>(null);
  useEffect(() => { streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight }); }, [messages, live]);
  if (!c) return null;

  return (
    <div className={`flex flex-col min-w-0 min-h-0 ${viewMode === 'split' ? 'border-r border-line' : ''}`}>
      <WikiBanner />
      <div ref={streamRef} className="flex-1 overflow-y-auto scrolly px-5 py-5">
        <div className="max-w-[760px] mx-auto">
          {messages.map((m) => <MessageView key={m.id} m={m} />)}
          {live && <LiveView />}
        </div>
      </div>
      <PermissionArea />
      <Composer />
    </div>
  );
}

function MessageView({ m }: { m: Msg }) {
  const isClaude = m.role === 'assistant';
  const blocks: Block[] = isClaude ? (m.content.blocks || []) : [];
  const { deleteMessage, editMessage } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content.text || '');
  const canEdit = !isClaude; // user messages can be edited → regenerate from that point

  const saveEdit = () => {
    const t = draft.trim();
    setEditing(false);
    if (t && t !== m.content.text) editMessage(m.id, t);
  };

  return (
    <div className="group flex gap-3 mb-5">
      <Avatar name={m.authorName || undefined} claude={isClaude} color={colorFromMsg(m)} />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-txt2 font-semibold mb-1 flex items-center gap-2">
          {isClaude ? 'Claude' : m.authorName}
          <span className="hidden group-hover:flex items-center gap-1.5 text-txt3">
            {canEdit && <button className="hover:text-clay" title="수정" onClick={() => { setDraft(m.content.text || ''); setEditing(true); }}>✎</button>}
            <button className="hover:text-danger" title="삭제" onClick={() => { if (confirm('이 메시지를 삭제할까요?')) deleteMessage(m.id); }}>🗑</button>
          </span>
        </div>
        {editing ? (
          <div className="border border-line2 rounded-lg bg-card p-2">
            <textarea className="w-full bg-transparent outline-none resize-none text-sm text-txt" rows={3}
              value={draft} autoFocus onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') setEditing(false); }} />
            <div className="flex gap-2 justify-end mt-1">
              <button className="btn-ghost !py-1 !text-xs" onClick={() => setEditing(false)}>취소</button>
              <button className="rounded-md px-3 py-1 text-xs font-semibold text-white bg-clay" onClick={saveEdit}>저장 후 재생성</button>
            </div>
          </div>
        ) : (
          <>
            {!isClaude && <div className="text-sm break-words leading-relaxed" dangerouslySetInnerHTML={{ __html: md(m.content.text || '') }} />}
            {isClaude && <BlockList blocks={blocks} />}
            {m.content.interrupted && <div className="text-[11px] text-warn mt-1">⏹ 중단됨</div>}
          </>
        )}
      </div>
    </div>
  );
}

function LiveView() {
  const live = useStore((s) => s.live)!;
  return (
    <div className="flex gap-3 mb-5">
      <Avatar claude />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-txt2 font-semibold mb-1">Claude</div>
        <BlockList blocks={live.blocks} />
        <div className="flex items-center gap-1.5 text-txt3 text-[13px] italic mt-1">
          <span className="tdot" /><span className="tdot" /><span className="tdot" /> 작업 중…
        </div>
      </div>
    </div>
  );
}

function BlockList({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => b.type === 'text'
        ? <div key={i} className="font-serif text-[15px] leading-relaxed break-words" dangerouslySetInnerHTML={{ __html: md(b.text) }} />
        : <ToolCard key={i} b={b} />)}
    </>
  );
}

function ToolCard({ b }: { b: Extract<Block, { type: 'tool_use' }> }) {
  const [open, setOpen] = useState(false);
  // AskUserQuestion's pick is fed back as a (technically) denied tool result — the SDK flags it
  // is_error even though nothing failed. Render it as a normal choice, not "오류".
  const isAsk = b.name === 'AskUserQuestion';
  const cancelled = isAsk && b.output === 'Denied.';
  const cmd = isAsk
    ? (b.input?.questions?.[0]?.question || '질문')
    : (b.input?.command || b.input?.file_path || b.input?.path || JSON.stringify(b.input || {}).slice(0, 80));
  const status =
    b.output == null ? { text: '실행 중…', color: 'var(--txt-3)' }
    : isAsk ? (cancelled ? { text: '취소됨', color: 'var(--txt-3)' } : { text: '✓ 선택됨', color: 'var(--ok)' })
    : b.isError ? { text: '✗ 오류', color: 'var(--danger)' }
    : { text: '✓ 완료', color: 'var(--ok)' };
  return (
    <div className="border border-line rounded-lg my-2 overflow-hidden bg-card">
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer text-xs" onClick={() => setOpen(!open)}>
        <span className="text-clay">{isAsk ? '❓' : '⌘'}</span>
        <span className="font-semibold">{isAsk ? '질문' : b.name}</span>
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
  return (
    <>
      <div className="text-xs font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--warn)' }}>⚠ 툴 승인 요청 — {p.tool}</div>
      <code className="font-mono text-xs bg-card px-1.5 py-1 rounded border border-line block truncate">{p.input?.command || p.input?.file_path || JSON.stringify(p.input)}</code>
      {canApprove ? (
        <div className="flex gap-2 mt-2.5">
          <button className="rounded-md px-3.5 py-1.5 text-xs font-semibold text-white" style={{ background: 'var(--ok)' }} onClick={() => respond(p.requestId, 'allow')}>허용</button>
          <button className="btn-ghost !py-1.5 !text-xs" onClick={() => respond(p.requestId, 'deny')}>거부</button>
          <button className="btn-ghost !py-1.5 !text-xs" onClick={() => respond(p.requestId, 'always')}>항상 허용</button>
        </div>
      ) : (
        <div className="text-[11px] text-txt2 mt-2">승인권자(방장/위임자)의 응답 대기 중…</div>
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
  if (!canApprove) {
    return <div className="text-[11px] text-txt2">승인권자(방장/위임자)의 선택 대기 중…</div>;
  }
  return (
    <div className="flex flex-col gap-3">
      {qs.map((q, qi) => (
        <div key={qi}>
          <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--warn)' }}>❓ {q.question}</div>
          <div className="flex flex-col gap-1.5">
            {(q.options || []).map((o: any, oi: number) => (
              <button key={oi} className="text-left border border-line rounded-md px-3 py-2 bg-card hover:bg-line transition"
                onClick={() => respond(p.requestId, 'answer', `[사용자 선택] 질문 "${q.question}" → "${o.label}"${o.description ? ` (${o.description})` : ''}`)}>
                <div className="font-semibold text-xs">{o.label}</div>
                {o.description && <div className="text-[11px] text-txt2 mt-0.5">{o.description}</div>}
              </button>
            ))}
          </div>
        </div>
      ))}
      <button className="btn-ghost !py-1.5 !text-xs self-start" onClick={() => respond(p.requestId, 'deny')}>취소</button>
    </div>
  );
}

// Client-side UI actions (run immediately on select). Real Claude Code commands + skills
// are fetched per session and merged in below.
const CLIENT_CMDS: { cmd: string; label: string; kind: 'ui'; run: (s: any) => void }[] = [
  { cmd: '/new', label: '새 대화 시작', kind: 'ui', run: (s) => s.newSession() },
  { cmd: '/split', label: '분할 뷰 (채팅 + 에디터)', kind: 'ui', run: (s) => s.setViewMode('split') },
  { cmd: '/editor', label: '에디터 뷰 열기', kind: 'ui', run: (s) => s.setViewMode('editor') },
  { cmd: '/chat', label: '대화 뷰', kind: 'ui', run: (s) => s.setViewMode('chat') },
  { cmd: '/interrupt', label: '실행 중인 턴 중단', kind: 'ui', run: (s) => s.interrupt() },
];
type Cmd = { cmd: string; label: string; kind: 'ui' | 'cmd'; desc?: string; hint?: string; run?: (s: any) => void };

function Composer() {
  const store = useStore();
  const { current: c, send, queue, cancel, interrupt, turnActive, congested, user, commands } = store;
  const [text, setText] = useState('');
  const [sel, setSel] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
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
            {queue.running && <span>🕒 {queue.running.author.name} 작업 중</span>}
            {turnActive && (
              <button className="text-danger hover:underline" onClick={interrupt}>· 중단</button>
            )}
            {queue.waiting.map((w) => (
              <span key={w.id} className="bg-rail border border-line rounded-full px-2.5 py-0.5 text-txt2 flex items-center gap-1">
                {w.author.name} 대기
                {(w.author.id === user?.id) && <button className="text-danger" title="취소" onClick={() => cancel(w.id)}>✕</button>}
              </span>
            ))}
            {congested && <span className="text-warn">· 잠시 혼잡 (대기 중)</span>}
          </div>
        )}
        <div className="relative">
          {showSlash && (
            <div className="absolute bottom-full mb-2 left-0 right-0 bg-panel border border-line rounded-lg shadow-2xl overflow-hidden z-40">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-txt3 border-b border-line flex justify-between">
                <span>명령어 · 스킬</span><span>{matches.length}</span>
              </div>
              <div className="max-h-64 overflow-y-auto scrolly">
                {matches.map((m, i) => (
                  <div key={m.cmd} onMouseEnter={() => setSel(i)} onClick={() => pick(i)}
                    className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm ${i === sel ? 'bg-line' : ''}`}>
                    <code className="font-mono text-clay text-xs shrink-0">{m.cmd}</code>
                    {m.hint && <code className="font-mono text-txt3 text-[11px] shrink-0">{m.hint}</code>}
                    <span className="text-txt2 text-xs truncate">{m.desc || (m.kind === 'ui' ? m.label : '')}</span>
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                      style={{ background: 'var(--claysoft)', color: 'var(--clay)' }}>
                      {m.kind === 'ui' ? 'UI' : '명령'}
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
              rows={2} placeholder={wikiCompiling ? '주제 컴파일 중 — 완료 후 질의 가능' : isRoom ? `${c.title}에 메시지…  (당신 발화는 [${user?.displayName}]로 전달)` : '메시지…  (/ 입력 시 명령어)'}
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
              <span className="text-xs text-txt3 truncate">{wikiCompiling ? `⏳ 컴파일 중${wikiStep ? ` — ${wikiStep}` : ' — 완료 후 질의 가능'}` : turnActive ? 'Claude 응답 중' : 'Enter 전송 · Shift+Enter 줄바꿈 · / 명령어'}</span>
              <button className="ml-auto bg-clay text-white rounded-lg w-8 h-8 grid place-items-center disabled:opacity-40" disabled={wikiCompiling} onClick={submit} aria-label="보내기">➤</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditorPane() {
  const { editorUrl, current: c } = useStore();
  if (!c) return null;
  if (!editorUrl) return (
    <div className="grid place-items-center bg-[#1e1e1e] text-[#bbb] text-sm">
      <div className="text-center">
        <div className="mb-2">에디터를 여는 중…</div>
        <div className="text-xs text-[#888]">{c.projectId ? '' : '헤더에서 프로젝트를 먼저 선택하세요.'}</div>
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
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Lightweight Markdown → HTML (escape-first, so it's XSS-safe).
// ponytail: intentionally partial — headings, bold/italic, code, lists, links, quotes.
// Not a full CommonMark parser; good enough for chat rendering like the Claude app.
function md(src: string): string {
  const codeBlocks: string[] = [];
  // 1) pull fenced code blocks out first so inline rules don't touch them
  let s = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    const i = codeBlocks.length;
    codeBlocks.push(`<pre class="bg-bg border border-line rounded-lg p-3 my-2 overflow-x-auto scrolly"><code class="font-mono text-[13px]">${esc(code.replace(/\n$/, ''))}</code></pre>`);
    return ` CB${i} `;
  });
  s = esc(s);
  const inline = (t: string) => t
    .replace(/`([^`]+)`/g, '<code class="font-mono text-[13px] px-1 rounded" style="background:var(--claysoft)">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-clay underline">$1</a>');
  // 2) block-level: headings, lists, blockquotes, paragraphs
  const lines = s.split('\n');
  const out: string[] = [];
  let list: '' | 'ul' | 'ol' = '';
  const closeList = () => { if (list) { out.push(`</${list}>`); list = ''; } };
  for (const line of lines) {
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    const qt = /^&gt;\s?(.*)$/.exec(line);
    if (h) { closeList(); const n = h[1].length; out.push(`<h${n} class="font-semibold ${n === 1 ? 'text-lg' : n === 2 ? 'text-base' : 'text-sm'} mt-2 mb-1">${inline(h[2])}</h${n}>`); }
    else if (ul) { if (list !== 'ul') { closeList(); list = 'ul'; out.push('<ul class="list-disc pl-5 my-1">'); } out.push(`<li>${inline(ul[1])}</li>`); }
    else if (ol) { if (list !== 'ol') { closeList(); list = 'ol'; out.push('<ol class="list-decimal pl-5 my-1">'); } out.push(`<li>${inline(ol[1])}</li>`); }
    else if (qt) { closeList(); out.push(`<blockquote class="border-l-2 border-line pl-3 text-txt2 my-1">${inline(qt[1])}</blockquote>`); }
    else if (line.trim() === '') { closeList(); out.push(''); }
    else { closeList(); out.push(`<span>${inline(line)}</span>`); }
  }
  closeList();
  let html = out.join('\n').replace(/\n/g, '<br/>');
  // restore code blocks (strip the <br/> the join may have added around the placeholder)
  html = html.replace(/(<br\/>)? CB(\d+) (<br\/>)?/g, (_m, _a, i) => codeBlocks[+i]);
  return html;
}
