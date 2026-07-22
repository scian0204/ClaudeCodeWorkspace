import { useEffect, useState } from 'react';
import { useStore } from './lib/store';
import { useT } from './lib/i18n';
import { Login } from './pages/Login';
import { Shell } from './components/Shell';

export function App() {
  const user = useStore((s) => s.user);
  const bootstrap = useStore((s) => s.bootstrap);
  const t = useT();
  const [ready, setReady] = useState(false);

  useEffect(() => { bootstrap().finally(() => setReady(true)); }, [bootstrap]);

  if (!ready) return <div className="h-full grid place-items-center text-txt3">{t('app.loading')}</div>;
  return user ? <Shell /> : <Login />;
}
