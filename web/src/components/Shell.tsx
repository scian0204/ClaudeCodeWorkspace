import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { Sidebar } from './Sidebar';
import { Chat } from './Chat';
import { DmView } from './DmView';
import { AdminPanel } from './AdminPanel';
import { PluginsPanel } from './PluginsPanel';
import { MyPage } from './MyPage';
import { MyTokenModal } from './TokenSettings';
import { SearchPalette, SearchButton } from './SearchPalette';
import { MobileMenuButton } from '../lib/ui';
import { useT } from '../lib/i18n';
import { IconX, IconPlus } from '../lib/icons';

function Empty() {
  const newSession = useStore((s) => s.newSession);
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const t = useT();
  return (
    <div className="h-full flex flex-col">
      {/* top bar so the sidebar stays reachable when no thread is open — mobile always, desktop only while collapsed */}
      <div className={`${collapsed ? '' : 'md:hidden'} flex items-center gap-2.5 px-3 py-2.5 border-b border-line shrink-0`}>
        <MobileMenuButton />
        <span className="font-semibold text-sm truncate flex-1">ClaudeCode Workspace</span>
        <SearchButton />
      </div>
      <div className="flex-1 grid place-items-center text-center p-4">
        <div>
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="w-16 h-16 mx-auto mb-3" />
          <div className="text-txt2 mb-4">{t('shell.emptyHint')}</div>
          <button className="btn-primary inline-flex items-center gap-1.5" onClick={() => newSession()}><IconPlus size={16} />{t('shell.newConversation')}</button>
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
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const user = useStore((s) => s.user);

  const searchEnabled = useStore((s) => s.searchEnabled);
  const setSearchOpen = useStore((s) => s.setSearchOpen);

  // Nag users without a personal token to register one — every login, until registered or dismissed.
  const [nagDismissed, setNagDismissed] = useState(false);
  useEffect(() => { setNagDismissed(false); }, [user?.id]);
  const showNag = !!user && !user.hasClaudeToken && !nagDismissed;

  // Ctrl/Cmd+K opens unified search from anywhere (also Ctrl/Cmd+/ — some browsers eat Cmd+K).
  useEffect(() => {
    if (!searchEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.key === '/')) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchEnabled, setSearchOpen]);

  // ≥md: two static columns (264px sidebar + content), or one when collapsed. <md: single column,
  // sidebar becomes an off-canvas drawer (positioned by Sidebar itself) over a tap-to-dismiss backdrop.
  return (
    <div className={`h-full overflow-hidden md:grid md:grid-rows-[minmax(0,1fr)] ${collapsed ? 'md:grid-cols-[minmax(0,1fr)]' : 'md:grid-cols-[264px_minmax(0,1fr)]'}`}>
      {sidebarOpen && <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />}
      <Sidebar />
      <main className="min-w-0 min-h-0 h-full bg-panel flex flex-col">
        {panel === 'admin' ? <AdminPanel /> : panel === 'plugins' ? <PluginsPanel /> : panel === 'me' ? <MyPage /> : activeChannelId ? <DmView /> : current ? <Chat /> : <Empty />}
      </main>
      {error && <Toast msg={error} onClose={() => setError(null)} />}
      <SearchPalette />
      <MyTokenModal open={showNag} nag onClose={() => setNagDismissed(true)} />
    </div>
  );
}
