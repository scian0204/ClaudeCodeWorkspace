// Per-session project file-change watch: the header switch + the notice card above the composer.
// Server side: server/src/watch/manager.ts.
import { useEffect, useState } from 'react';
import * as DM from '@radix-ui/react-dropdown-menu';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { IconEye, IconChevronDown, IconCheck, IconX, IconBolt } from '../lib/icons';

// Header-pill dropdown, laid out like the other pill menus (hangs off the trigger's right edge).
function Menu({ children }: { children: React.ReactNode }) {
  return (
    <DM.Portal>
      <DM.Content align="end" sideOffset={6}
        className="z-50 min-w-[200px] max-w-[86vw] rounded-lg border border-line bg-panel p-1 shadow-xl">
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

// Watch this session's project for changes made anywhere else: another chat's turn, an edit in the
// VS Code view, a git pull. 'notify' only posts a notice; 'prompt' also sends the stored text as a
// turn, so that mode is offered only while the admin flag allows it and needs a non-empty prompt.
export function WatchMenu() {
  const c = useStore((s) => s.current);
  const enabled = useStore((s) => s.projectWatchEnabled);
  const promptEnabled = useStore((s) => s.projectWatchPromptEnabled);
  const maxChars = useStore((s) => s.projectWatchPromptMax);
  const setWatch = useStore((s) => s.setWatch);
  const setError = useStore((s) => s.setError);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [wantPrompt, setWantPrompt] = useState(false);
  const [status, setStatus] = useState<{ watching: boolean; error: string | null; scope?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const t = useT();
  const mode = c?.watchMode || 'off';

  // Whether the OS actually accepted the watch is a per-project fact (a platform limit, a directory
  // that vanished), so the switch reports it instead of looking on while nothing is happening.
  useEffect(() => {
    if (!open || !c?.projectId) return;
    setDraft(c.watchPrompt || '');
    setWantPrompt(mode === 'prompt');
    setStatus(null);
    api.get(`/api/projects/${c.projectId}/watch`).then(setStatus).catch(() => setStatus(null));
  }, [open, c?.projectId]);

  if (!c || !enabled || !c.projectId) return null;

  const pick = async (m: string) => {
    if (m === 'prompt') { setWantPrompt(true); return; } // needs the text first — the button saves it
    setWantPrompt(false);
    setBusy(true);
    try { await setWatch(m); setOpen(false); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const savePrompt = async () => {
    if (!draft.trim()) { setError(t('watch.promptRequired')); return; }
    setBusy(true);
    try { await setWatch('prompt', draft.slice(0, maxChars)); setOpen(false); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const label = mode === 'prompt' ? t('watch.modePrompt') : mode === 'notify' ? t('watch.modeNotify') : t('watch.pill');
  const modes: { key: string; label: string; off?: boolean }[] = [
    { key: 'off', label: t('watch.modeOff') },
    { key: 'notify', label: t('watch.modeNotify') },
    { key: 'prompt', label: t('watch.modePrompt'), off: !promptEnabled },
  ];
  const picked = (key: string) => (wantPrompt ? key === 'prompt' : key === mode);

  return (
    <DM.Root open={open} onOpenChange={setOpen}>
      <DM.Trigger asChild>
        <button className={`pill inline-flex items-center gap-1 ${mode !== 'off' ? 'text-clay' : ''}`} title={t('watch.title')}>
          <IconEye size={13} /><span className="max-w-[110px] truncate">{label}</span><IconChevronDown size={13} />
        </button>
      </DM.Trigger>
      <Menu>
        <div className="px-2 py-1 text-[11px] text-txt3 max-w-[280px] whitespace-normal">{t('watch.hint')}</div>
        {modes.map((m) => (
          <button key={m.key} disabled={busy || m.off} title={m.off ? t('watch.modePromptOff') : undefined}
            className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-sm rounded hover:bg-line disabled:opacity-40 ${picked(m.key) ? 'text-clay font-semibold' : ''}`}
            onClick={(e) => { e.preventDefault(); void pick(m.key); }}>
            <span className="flex-1 truncate text-left">{m.label}</span>
            {picked(m.key) && <IconCheck size={13} />}
          </button>
        ))}
        {wantPrompt && (
          <div className="mt-1 w-[min(320px,80vw)] space-y-1.5 border-t border-line p-1.5"
            onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <div className="text-[11px] text-txt3">{t('watch.promptLabel')}</div>
            <textarea className="input w-full resize-y text-xs !py-1.5 min-h-[72px]" maxLength={maxChars}
              placeholder={t('watch.promptPlaceholder')} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="text-[10px] text-txt3 whitespace-normal">{t('watch.promptVars')}</div>
            <button className="btn-primary w-full !py-1 !text-xs" disabled={busy} onClick={() => void savePrompt()}>{t('common.save')}</button>
          </div>
        )}
        <div className="mt-1 max-w-[280px] border-t border-line px-2 py-1.5 text-[10px] text-txt3 whitespace-normal">
          {mode !== 'off' && (
            <div className={status?.watching ? 'text-ok' : 'text-warn'}>
              {status?.watching ? t('watch.watching') : t('watch.notWatching')}
              {status?.error ? ` · ${status.error}` : ''}
            </div>
          )}
          <div>{t('watch.selfHint')}</div>
        </div>
      </Menu>
    </DM.Root>
  );
}

// "someone else changed this project" — one card above the composer listing what moved. In 'prompt'
// mode it also says the stored prompt already went out, so the turn that appears is explained.
export function ProjectChangeCard() {
  const c = useStore((s) => s.current);
  const change = useStore((s) => (s.current ? s.projectChanges[s.current.chatSessionId] : undefined));
  const dismiss = useStore((s) => s.dismissProjectChange);
  const setExplorer = useStore((s) => s.setExplorerOpen);
  const t = useT();
  if (!c || !change) return null;
  const rest = change.count - change.files.length;
  return (
    <div className="px-3 md:px-5 pb-2">
      <div className="mx-auto max-w-[760px] rounded-lg border border-line bg-claysoft px-3 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <IconEye size={14} className="text-clay shrink-0" />
          <span className="font-semibold">{t('watch.changedTitle')}</span>
          <span className="text-txt3">{t('watch.changedMeta', { project: change.projectName, count: change.count })}</span>
          <div className="flex-1" />
          <button className="text-txt3 hover:text-txt shrink-0" aria-label={t('common.close')}
            onClick={() => dismiss(c.chatSessionId)}><IconX size={13} /></button>
        </div>
        <ul className="scrolly mt-1.5 max-h-32 overflow-y-auto font-mono text-[11px] text-txt2">
          {change.files.map((f) => <li key={f} className="truncate" title={f}>{f}</li>)}
          {rest > 0 && <li className="text-txt3">{t('watch.changedMore', { n: rest })}</li>}
        </ul>
        {change.fired && (
          <div className="mt-1.5 inline-flex items-center gap-1 text-clay"><IconBolt size={13} />{t('watch.fired')}</div>
        )}
        {c.projectId && (
          <div className="mt-2"><button className="pill" onClick={() => setExplorer(true)}>{t('chat.filesBtn')}</button></div>
        )}
      </div>
    </div>
  );
}
