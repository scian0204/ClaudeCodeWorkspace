import { useState } from 'react';
import { useStore } from '../lib/store';
import { Avatar, timeAgo } from '../lib/ui';
import { Modal } from './Modal';

export function Sidebar() {
  const { user, sessions, rooms, current, openPrivate, openRoom, newSession, newRoom, logout, setPanel, panel } = useStore();
  const [showRoom, setShowRoom] = useState(false);
  const [roomName, setRoomName] = useState('');

  const create = async () => { if (!roomName.trim()) return; await newRoom(roomName.trim()); setRoomName(''); setShowRoom(false); };

  return (
    <aside className="bg-rail border-r border-line flex flex-col min-h-0">
      <div className="px-3.5 pt-3.5 pb-2">
        <div className="flex items-center gap-2.5 mb-3.5">
          <img src="/favicon.svg" alt="" className="w-[26px] h-[26px] rounded-md" />
          <div className="leading-tight">
            <div className="font-semibold text-sm">ClaudeCode Workspace</div>
            <div className="text-[11px] text-txt3">{user?.displayName} 팀</div>
          </div>
        </div>
        <button className="btn-primary w-full flex items-center justify-center gap-2 !py-2" onClick={() => newSession()}>＋ 새 대화</button>
      </div>

      <div className="flex-1 overflow-y-auto scrolly px-2 pb-1">
        <Section label="개인" onAdd={() => newSession()} />
        {sessions.length === 0 && <div className="text-[11px] text-txt3 px-2 py-1">아직 없음</div>}
        {sessions.map((s) => (
          <Item key={s.id} active={panel === null && current?.chatSessionId === s.id} onClick={() => { setPanel(null); openPrivate(s.id); }}>
            <span className="opacity-70">💬</span>
            <span className="flex-1 truncate text-[13px]">{s.title}</span>
            <span className="text-[11px] text-txt3">{timeAgo(s.updatedAt)}</span>
          </Item>
        ))}

        <Section label="대화방" onAdd={() => setShowRoom(true)} />
        {rooms.length === 0 && <div className="text-[11px] text-txt3 px-2 py-1">아직 없음</div>}
        {rooms.map((r) => (
          <Item key={r.id} active={panel === null && current?.roomId === r.id} onClick={() => { setPanel(null); openRoom(r.id); }}>
            <span className="w-[7px] h-[7px] rounded-full bg-ok shrink-0" />
            <span className="flex-1 truncate text-[13px]">{r.name}</span>
            <span className="flex">
              {r.members.slice(0, 3).map((m) => (
                <span key={m.userId} className="w-[17px] h-[17px] rounded-full grid place-items-center text-[9px] text-white font-semibold -ml-1.5 border-[1.5px]"
                  style={{ background: m.avatarColor, borderColor: 'var(--rail)' }}>{m.displayName.slice(0, 2).toUpperCase()}</span>
              ))}
            </span>
          </Item>
        ))}
      </div>

      <div className="border-t border-line p-2.5">
        <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-md">
          <Avatar name={user?.displayName} color={user?.avatarColor} />
          <div className="flex-1 text-[13px]">{user?.displayName}</div>
          <span className="text-[10px] bg-claysoft text-clay px-1.5 py-0.5 rounded-full font-semibold">{user?.role}</span>
        </div>
        <button className="flex items-center gap-2.5 px-2 py-1.5 rounded-md w-full hover:bg-line text-left text-[13px] text-txt2" onClick={() => setPanel('plugins')}>
          <span className="w-7 text-center">🧩</span> 플러그인
        </button>
        {user?.role === 'admin' && (
          <button className="flex items-center gap-2.5 px-2 py-1.5 rounded-md w-full hover:bg-line text-left text-[13px] text-txt2" onClick={() => setPanel('admin')}>
            <span className="w-7 text-center">🛠</span> 관리자 패널
          </button>
        )}
        <button className="flex items-center gap-2.5 px-2 py-1.5 rounded-md w-full hover:bg-line text-left text-[13px] text-txt2" onClick={() => logout()}>
          <span className="w-7 text-center">↩</span> 로그아웃
        </button>
      </div>

      <Modal open={showRoom} onOpenChange={setShowRoom} title="새 대화방 만들기">
        <input className="input mb-3" placeholder="대화방 이름" value={roomName} autoFocus
          onChange={(e) => setRoomName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setShowRoom(false)}>취소</button>
          <button className="btn-primary" onClick={create}>만들기</button>
        </div>
      </Modal>
    </aside>
  );
}

function Section({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <div className="text-[11px] tracking-wider uppercase text-txt3 px-2 pt-3 pb-1 font-semibold flex justify-between items-center">
      {label}<span className="cursor-pointer text-sm leading-none" onClick={onAdd}>＋</span>
    </div>
  );
}
function Item({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClick}
      className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md cursor-pointer text-txt2 ${active ? 'bg-claysoft text-txt' : 'hover:bg-line'}`}>
      {children}
    </div>
  );
}
