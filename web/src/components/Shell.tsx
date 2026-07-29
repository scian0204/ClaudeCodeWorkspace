import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { Sidebar } from './Sidebar';
import { Chat } from './Chat';
import { DmView } from './DmView';
import { AdminPanel } from './AdminPanel';
import { PluginsPanel } from './PluginsPanel';
import { MyPage } from './MyPage';
import { MyTokenModal } from './TokenSettings';
import { MobileMenuButton } from '../lib/ui';
import { useT } from '../lib/i18n';
import { IconX } from '../lib/icons';

function Empty() {
  const newSession = useStore((s) => s.newSession);
  const t = useT();
  return (
    <div className="h-full flex flex-col">
      {/* mobile-only top bar so the drawer stays reachable when no thread is open */}
      <div className="md:hidden flex items-center gap-2.5 px-3 py-2.5 border-b border-line shrink-0">
        <MobileMenuButton />
        <span className="font-semibold text-sm truncate">ClaudeCode Workspace</span>
      </div>
      <div className="flex-1 grid place-items-center text-center p-4">
        <div>
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="w-16 h-16 mx-auto mb-3" />
          <div className="text-txt2 mb-4">{t('shell.emptyHint')}</div>
          <button className="btn-primary" onClick={() => newSession()}>{t('shell.newConversation')}</button>
        </div>
      </div>
    </div>
  );
}

function Toast({ msg, onClose }: { msg: string; onClose: () => void }) {
  const t = useT();
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-card border border-danger text-danger text-sm rounded-lg px-4 py-2 shadow-lg z-[60] flex items-center gap-3">
      <span>{msg}</span>
      <button className="text-txt3 hover:text-txt" aria-label={t('common.close')} onClick={onClose}><IconX size={15} /></button>
    </div>
  );
}

export function Shell() {
  const current = useStore((s) => s.current);
  const activeChannelId = useStore((s) => s.activeChannelId);
  const panel = useStore((s) => s.panel);
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const user = useStore((s) => s.user);

  // Nag users without a personal token to register one — every login, until registered or dismissed.
  const [nagDismissed, setNagDismissed] = useState(false);
  useEffect(() => { setNagDismissed(false); }, [user?.id]);
  const showNag = !!user && !user.hasClaudeToken && !nagDismissed;

  // ≥md: two static columns (264px sidebar + content). <md: single column, sidebar becomes an
  // off-canvas drawer (positioned by Sidebar itself) over a tap-to-dismiss backdrop.
  return (
    <div className="h-full overflow-hidden md:grid md:grid-cols-[264px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]">
      {sidebarOpen && <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />}
      <Sidebar />
      <main className="min-w-0 min-h-0 h-full bg-panel flex flex-col">
        {panel === 'admin' ? <AdminPanel /> : panel === 'plugins' ? <PluginsPanel /> : panel === 'me' ? <MyPage /> : activeChannelId ? <DmView /> : current ? <Chat /> : <Empty />}
      </main>
      {error && <Toast msg={error} onClose={() => setError(null)} />}
      <MyTokenModal open={showNag} nag onClose={() => setNagDismissed(true)} />
    </div>
  );
}
