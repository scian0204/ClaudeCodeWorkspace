import { useEffect, useRef, useState } from 'react';
import { useStore, type DmChannel } from '../lib/store';
import { Avatar, avatarUrl, MobileMenuButton } from '../lib/ui';
import { useT } from '../lib/i18n';

// Channel display name: the other person for a DM, the group name for a group.
function channelLabel(ch: DmChannel, meId: string | undefined, t: (k: string) => string): string {
  if (ch.kind === 'group') return ch.name || t('dm.group');
  const other = ch.members.find((m) => m.userId !== meId);
  return other?.displayName || t('dm.dm');
}
function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Lightweight human-only chat view (NOT the heavy Claude Chat). Pure text bubbles + composer.
export function DmView() {
  const { user, channels, activeChannelId, channelMessages, sendDm, promoteChannel } = useStore();
  const t = useT();
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const ch = channels.find((c) => c.id === activeChannelId);

  // Stick to the bottom as messages arrive / on open.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [channelMessages.length, activeChannelId]);

  if (!ch) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2.5 px-3 md:px-5 py-2.5 border-b border-line shrink-0">
          <MobileMenuButton />
          <span className="text-txt3 text-sm">{t('dm.notFound')}</span>
        </div>
      </div>
    );
  }

  const isAdmin = user?.role === 'admin';
  const label = channelLabel(ch, user?.id, t);
  const other = ch.kind === 'dm' ? ch.members.find((m) => m.userId !== user?.id) : undefined;
  const byId = new Map(ch.members.map((m) => [m.userId, m]));

  const send = () => {
    const v = text.trim();
    if (!v) return;
    sendDm(v);
    setText('');
  };
  const promote = () => {
    if (confirm(t('dm.promoteConfirm', { name: label }))) promoteChannel(ch.id);
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* header */}
      <div className="flex items-center gap-2.5 px-3 md:px-5 py-2.5 border-b border-line shrink-0">
        <MobileMenuButton />
        {ch.kind === 'group'
          ? <div className="avatar" style={{ width: 28, height: 28, fontSize: 14, background: 'var(--line2, #888)' }}>👥</div>
          : <Avatar name={other?.displayName} color={other?.avatarColor} src={avatarUrl(other && { id: other.userId, avatar: other.avatar })} />}
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm truncate">{label}</div>
          {ch.kind === 'group' && (
            <div className="text-[11px] text-txt3 truncate">{t('dm.memberCount', { count: ch.members.length })}</div>
          )}
        </div>
        {isAdmin && ch.kind === 'group' && (
          <button className="btn-ghost !py-1 !text-xs shrink-0" title={t('dm.promoteHint')} onClick={promote}>{t('dm.promote')}</button>
        )}
      </div>

      {/* messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrolly px-3 md:px-5 py-4 min-h-0">
        {channelMessages.length === 0 && <div className="text-center text-txt3 text-sm mt-8">{t('dm.emptyHint')}</div>}
        {channelMessages.map((m) => {
          const mine = m.userId === user?.id;
          const author = byId.get(m.userId);
          return (
            <div key={m.id} className={`flex gap-2 mb-3 ${mine ? 'flex-row-reverse' : ''}`}>
              {!mine && <Avatar name={author?.displayName} color={author?.avatarColor} src={avatarUrl(author && { id: author.userId, avatar: author.avatar })} size={26} />}
              <div className={`max-w-[78%] min-w-0 ${mine ? 'items-end' : ''} flex flex-col`}>
                {!mine && ch.kind === 'group' && (
                  <span className="text-[11px] text-txt3 mb-0.5 px-1">{author?.displayName || '?'}</span>
                )}
                <div className={`rounded-2xl px-3 py-1.5 text-sm break-words whitespace-pre-wrap leading-relaxed
                  ${mine ? 'bg-clay text-white rounded-br-sm' : 'bg-line rounded-bl-sm text-txt'}`}>
                  {m.text}
                </div>
                <span className={`text-[10px] text-txt3 mt-0.5 px-1 ${mine ? 'text-right' : ''}`}>{fmtTime(m.createdAt)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* composer */}
      <div className="border-t border-line px-3 md:px-5 py-2.5 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            className="input flex-1 resize-none max-h-40" rows={1} value={text} autoFocus
            placeholder={t('dm.composerPlaceholder', { name: label })}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button className="btn-primary shrink-0 !py-2" onClick={send} disabled={!text.trim()}>{t('dm.send')}</button>
        </div>
        <div className="text-[11px] text-txt3 mt-1">{t('dm.composerHint')}</div>
      </div>
    </div>
  );
}
