import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { Modal } from './Modal';

const PERMS: [string, string][] = [
  ['approve', 'members.permApprove'], ['interrupt', 'members.permInterrupt'], ['invite', 'members.permInvite'], ['kick', 'members.permKick'], ['transfer', 'members.permTransfer'], ['delete_room', 'members.permDeleteRoom'],
];

export function MembersDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { current: c, control, reloadRoom, refreshLists, user, openRoom, setPanel } = useStore();
  const [dir, setDir] = useState<any[]>([]);
  const [invitee, setInvitee] = useState('');
  const t = useT();
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
    if (!confirm(t('members.deleteRoomConfirm'))) return;
    try { await api.del(`/api/rooms/${room.id}`); onClose(); await refreshLists(); useStore.setState({ current: null }); }
    catch (e: any) { useStore.getState().setError(e.message); }
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={t('members.title', { name: room.name })} width={520}>
      <div className="space-y-2 mb-4">
        {room.members.map((m) => (
          <div key={m.userId} className="border border-line rounded-lg p-2.5">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full grid place-items-center text-[10px] text-white font-semibold" style={{ background: m.avatarColor }}>{m.displayName.slice(0, 2).toUpperCase()}</span>
              <span className="text-sm font-medium">{m.displayName}</span>
              {m.isOwner && <span className="text-[10px] bg-claysoft text-clay px-1.5 py-0.5 rounded-full font-semibold">{t('members.ownerBadge')}</span>}
              <div className="ml-auto flex gap-2">
                {!m.isOwner && canManage && <button className="text-[11px] text-txt3 hover:text-clay" onClick={() => transfer(m.userId)}>{t('members.transferOwnership')}</button>}
                {!m.isOwner && canManage && <button className="text-[11px] text-txt3 hover:text-danger" onClick={() => kick(m.userId)}>{t('members.permKick')}</button>}
                {m.userId === user?.id && !m.isOwner && <button className="text-[11px] text-txt3 hover:text-danger" onClick={leave}>{t('members.leave')}</button>}
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
                      {on ? '✓ ' : ''}{t(label)}
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
            <option value="">{t('members.invitePlaceholder')}</option>
            {candidates.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}
          </select>
          <button className="btn-primary shrink-0" onClick={invite}>{t('members.permInvite')}</button>
        </div>
      )}

      <div className="text-[11px] text-txt3 border-t border-line pt-3">
        {t('members.delegationRuleIntro')} <b>{t('members.delegationRuleBold')}</b>.
      </div>
      {control.isOwner && (
        <div className="mt-3 flex justify-end">
          <button className="text-xs text-danger hover:underline" onClick={del}>{t('members.deleteRoom')}</button>
        </div>
      )}
    </Modal>
  );
}
