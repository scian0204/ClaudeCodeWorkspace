import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { Modal } from './Modal';

const PERMS: [string, string][] = [
  ['approve', '승인'], ['interrupt', '중단'], ['invite', '초대'], ['kick', '추방'], ['transfer', '방장이양'], ['delete_room', '방삭제'],
];

export function MembersDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { current: c, control, reloadRoom, refreshLists, user, openRoom, setPanel } = useStore();
  const [dir, setDir] = useState<any[]>([]);
  const [invitee, setInvitee] = useState('');
  const room = c?.room;

  useEffect(() => { api.get('/api/users/directory').then((r) => setDir(r.users)).catch(() => {}); }, []);
  if (!c || !room) return null;
  const canManage = control.canSetMode; // owner/admin sets delegations
  const memberIds = new Set(room.members.map((m) => m.userId));
  const candidates = dir.filter((d) => !memberIds.has(d.id));

  const toggle = async (userId: string, perm: string, on: boolean) => {
    await api.post(`/api/rooms/${room.id}/members/${userId}/delegation`, { perm, on });
    await reloadRoom();
  };
  const invite = async () => {
    if (!invitee) return;
    try { await api.post(`/api/rooms/${room.id}/members`, { userId: invitee }); setInvitee(''); await reloadRoom(); }
    catch (e: any) { useStore.getState().setError(e.message); }
  };
  const kick = async (userId: string) => { try { await api.del(`/api/rooms/${room.id}/members/${userId}`); await reloadRoom(); } catch (e: any) { useStore.getState().setError(e.message); } };
  const transfer = async (userId: string) => { try { await api.post(`/api/rooms/${room.id}/transfer`, { userId }); await reloadRoom(); } catch (e: any) { useStore.getState().setError(e.message); } };
  const leave = async () => { try { await api.del(`/api/rooms/${room.id}/members/${user!.id}`); onClose(); await refreshLists(); setPanel(null); } catch (e: any) { useStore.getState().setError(e.message); } };
  const del = async () => {
    if (!confirm('대화방을 삭제할까요? 되돌릴 수 없습니다.')) return;
    try { await api.del(`/api/rooms/${room.id}`); onClose(); await refreshLists(); useStore.setState({ current: null }); }
    catch (e: any) { useStore.getState().setError(e.message); }
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={`멤버 · ${room.name}`} width={520}>
      <div className="space-y-2 mb-4">
        {room.members.map((m) => (
          <div key={m.userId} className="border border-line rounded-lg p-2.5">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full grid place-items-center text-[10px] text-white font-semibold" style={{ background: m.avatarColor }}>{m.displayName.slice(0, 2).toUpperCase()}</span>
              <span className="text-sm font-medium">{m.displayName}</span>
              {m.isOwner && <span className="text-[10px] bg-claysoft text-clay px-1.5 py-0.5 rounded-full font-semibold">👑 방장</span>}
              <div className="ml-auto flex gap-2">
                {!m.isOwner && canManage && <button className="text-[11px] text-txt3 hover:text-clay" onClick={() => transfer(m.userId)}>방장 이양</button>}
                {!m.isOwner && canManage && <button className="text-[11px] text-txt3 hover:text-danger" onClick={() => kick(m.userId)}>추방</button>}
                {m.userId === user?.id && !m.isOwner && <button className="text-[11px] text-txt3 hover:text-danger" onClick={leave}>나가기</button>}
              </div>
            </div>
            {!m.isOwner && (
              <div className="flex flex-wrap gap-1.5 mt-2 pl-8">
                {PERMS.map(([perm, label]) => {
                  const on = m.delegations.includes(perm);
                  return (
                    <button key={perm} disabled={!canManage}
                      onClick={() => toggle(m.userId, perm, !on)}
                      className={`text-[11px] px-2 py-0.5 rounded-full border ${on ? 'bg-oksoft border-ok text-ok' : 'border-line text-txt3'} ${canManage ? 'cursor-pointer' : 'opacity-60'}`}>
                      {on ? '✓ ' : ''}{label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {canManage && candidates.length > 0 && (
        <div className="flex gap-2 mb-3">
          <select className="input" value={invitee} onChange={(e) => setInvitee(e.target.value)}>
            <option value="">멤버 초대…</option>
            {candidates.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}
          </select>
          <button className="btn-primary shrink-0" onClick={invite}>초대</button>
        </div>
      )}

      <div className="text-[11px] text-txt3 border-t border-line pt-3">
        위임 규칙: 승인·중단·초대·추방·방장이양·방삭제는 위임 가능. <b>방 권한모드 변경은 방장 전용(위임 불가)</b>.
      </div>
      {control.isOwner && (
        <div className="mt-3 flex justify-end">
          <button className="text-xs text-danger hover:underline" onClick={del}>대화방 삭제</button>
        </div>
      )}
    </Modal>
  );
}
