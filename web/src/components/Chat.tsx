import { useEffect, useRef, useState } from 'react';
import * as DM from '@radix-ui/react-dropdown-menu';
import { useStore, type Block, type Msg } from '../lib/store';
import { api } from '../lib/api';
import { Avatar } from '../lib/ui';
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
      <div className="flex-1 grid min-h-0" style={{ gridTemplateColumns: viewMode === 'split' ? '1fr 1fr' : viewMode === 'editor' ? '0 1fr' : '1fr' }}>
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
        <span className="text-txt3 text-xs font-mono truncate hidden md:inline">{c.projectId ? '' : '~/(프로젝트 미선택)'}</span>
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

      <ProjectMenu />

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

      <div className="seg">
        {(['chat', 'split', 'editor'] as const).map((m) => (
          <button key={m} className={viewMode === m ? 'on' : ''} onClick={() => setViewMode(m)}>
            {m === 'chat' ? '대화' : m === 'split' ? '분할' : '에디터'}
          </button>
        ))}
      </div>
      <button className="toolbtn" title="테마 전환" onClick={toggleTheme}>◐</button>

      {showMembers && c.room && <MembersDialog open={showMembers} onClose={() => setShowMembers(false)} />}
    </header>
  );
}

function ProjectMenu() {
  const { current: c, projects, setProject } = useStore();
  const [roomProjects, setRoomProjects] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const refresh = useStore((s) => s.refreshLists);

  useEffect(() => {
    if (c?.kind === 'room' && c.roomId) api.get(`/api/projects/room/${c.roomId}`).then((r) => setRoomProjects(r.projects)).catch(() => {});
  }, [c?.roomId, c?.kind]);

  if (!c) return null;
  const list = [...projects.common.map((p) => ({ ...p, tag: '공통' })),
    ...(c.kind === 'room' ? roomProjects.map((p) => ({ ...p, tag: '방' })) : projects.mine.map((p) => ({ ...p, tag: '개인' })))];
  const cur = list.find((p) => p.id === c.projectId);

  const create = async () => {
    if (!newName.trim()) return;
    const scope = c.kind === 'room' ? 'room' : 'user';
    const { project } = await api.post('/api/projects', { scope, name: newName.trim(), roomId: c.roomId });
    setNewName(''); await refresh();
    if (c.kind === 'room') { const r = await api.get(`/api/projects/room/${c.roomId}`); setRoomProjects(r.projects); }
    await setProject(project.id);
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
        <div className="flex gap-1 p-1" onKeyDown={(e) => e.stopPropagation()}>
          <input className="input !py-1 !text-xs" placeholder="새 프로젝트" value={newName}
            onChange={(e) => setNewName(e.target.value)} onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } }} />
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

function ChatPane() {
  const { current: c, messages, live, viewMode } = useStore();
  const streamRef = useRef<HTMLDivElement>(null);
  useEffect(() => { streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight }); }, [messages, live]);
  if (!c) return null;

  return (
    <div className={`flex flex-col min-w-0 min-h-0 ${viewMode === 'split' ? 'border-r border-line' : ''}`}>
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
  return (
    <div className="flex gap-3 mb-5">
      <Avatar name={m.authorName || undefined} claude={isClaude} color={colorFromMsg(m)} />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-txt2 font-semibold mb-1">{isClaude ? 'Claude' : m.authorName}</div>
        {!isClaude && <div className="text-sm whitespace-pre-wrap break-words">{m.content.text}</div>}
        {isClaude && <BlockList blocks={blocks} />}
        {m.content.interrupted && <div className="text-[11px] text-warn mt-1">⏹ 중단됨</div>}
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
        ? <div key={i} className="font-serif text-[15px] leading-relaxed whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: sanitize(b.text) }} />
        : <ToolCard key={i} b={b} />)}
    </>
  );
}

function ToolCard({ b }: { b: Extract<Block, { type: 'tool_use' }> }) {
  const [open, setOpen] = useState(false);
  const cmd = b.input?.command || b.input?.file_path || b.input?.path || JSON.stringify(b.input || {}).slice(0, 80);
  return (
    <div className="border border-line rounded-lg my-2 overflow-hidden bg-card">
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer text-xs" onClick={() => setOpen(!open)}>
        <span className="text-clay">⌘</span>
        <span className="font-semibold">{b.name}</span>
        <code className="font-mono text-txt2 truncate flex-1">{String(cmd)}</code>
        <span className="text-[11px] flex items-center gap-1" style={{ color: b.output == null ? 'var(--txt-3)' : b.isError ? 'var(--danger)' : 'var(--ok)' }}>
          {b.output == null ? '실행 중…' : b.isError ? '✗ 오류' : '✓ 완료'}
        </span>
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
          <div className="text-xs font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--warn)' }}>⚠ 툴 승인 요청 — {p.tool}</div>
          <code className="font-mono text-xs bg-card px-1.5 py-1 rounded border border-line block truncate">{p.input?.command || p.input?.file_path || JSON.stringify(p.input)}</code>
          {control.canApprove ? (
            <div className="flex gap-2 mt-2.5">
              <button className="rounded-md px-3.5 py-1.5 text-xs font-semibold text-white" style={{ background: 'var(--ok)' }} onClick={() => respond(p.requestId, 'allow')}>허용</button>
              <button className="btn-ghost !py-1.5 !text-xs" onClick={() => respond(p.requestId, 'deny')}>거부</button>
              <button className="btn-ghost !py-1.5 !text-xs" onClick={() => respond(p.requestId, 'always')}>항상 허용</button>
            </div>
          ) : (
            <div className="text-[11px] text-txt2 mt-2">승인권자(방장/위임자)의 응답 대기 중…</div>
          )}
        </div>
      ))}
    </div>
  );
}

function Composer() {
  const { current: c, send, queue, cancel, interrupt, turnActive, congested, user } = useStore();
  const [text, setText] = useState('');
  if (!c) return null;
  const isRoom = c.kind === 'room';
  const submit = () => { if (!text.trim()) return; send(text.trim()); setText(''); };

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
        <div className="border border-line2 rounded-xl bg-card p-3">
          <textarea
            className="w-full bg-transparent outline-none resize-none text-sm text-txt placeholder:text-txt3"
            rows={2} placeholder={isRoom ? `${c.title}에 메시지…  (당신 발화는 [${user?.displayName}]로 전달)` : '메시지…'}
            value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-txt3">{turnActive ? 'Claude 응답 중' : 'Enter 전송 · Shift+Enter 줄바꿈'}</span>
            <button className="ml-auto bg-clay text-white rounded-lg w-8 h-8 grid place-items-center" onClick={submit} aria-label="보내기">➤</button>
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
function sanitize(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, '<code class="font-mono text-[13px] px-1 rounded" style="background:var(--claysoft)">$1</code>');
}
