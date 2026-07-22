import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { Sidebar } from './Sidebar';
import { Chat } from './Chat';
import { AdminPanel } from './AdminPanel';
import { PluginsPanel } from './PluginsPanel';
import { MyTokenModal } from './TokenSettings';
import { useT } from '../lib/i18n';

function Empty() {
  const newSession = useStore((s) => s.newSession);
  const t = useT();
  return (
    <div className="h-full grid place-items-center text-center">
      <div>
        <img src="/favicon.svg" alt="" className="w-16 h-16 mx-auto mb-3" />
        <div className="text-txt2 mb-4">{t('shell.emptyHint')}</div>
        <button className="btn-primary" onClick={() => newSession()}>{t('shell.newConversation')}</button>
      </div>
    </div>
  );
}

function Toast({ msg, onClose }: { msg: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-card border border-danger text-danger text-sm rounded-lg px-4 py-2 shadow-lg z-[60] flex items-center gap-3">
      <span>{msg}</span>
      <button className="text-txt3 hover:text-txt" onClick={onClose}>✕</button>
    </div>
  );
}

export function Shell() {
  const current = useStore((s) => s.current);
  const panel = useStore((s) => s.panel);
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);
  const user = useStore((s) => s.user);

  // Nag users without a personal token to register one — every login, until registered or dismissed.
  const [nagDismissed, setNagDismissed] = useState(false);
  useEffect(() => { setNagDismissed(false); }, [user?.id]);
  const showNag = !!user && !user.hasClaudeToken && !nagDismissed;

  return (
    <div className="grid h-full overflow-hidden" style={{ gridTemplateColumns: '264px 1fr', gridTemplateRows: 'minmax(0, 1fr)' }}>
      <Sidebar />
      <main className="min-w-0 min-h-0 bg-panel flex flex-col">
        {panel === 'admin' ? <AdminPanel /> : panel === 'plugins' ? <PluginsPanel /> : current ? <Chat /> : <Empty />}
      </main>
      {error && <Toast msg={error} onClose={() => setError(null)} />}
      <MyTokenModal open={showNag} nag onClose={() => setNagDismissed(true)} />
    </div>
  );
}
