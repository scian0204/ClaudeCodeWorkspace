// Side chat — the window the CLI's `/btw` opens, rebuilt for the browser.
//
// A small panel floating over the open conversation: ask something about the work in progress and
// get an answer that never lands in the transcript. The server forks the chat's own CLI session for
// it (server/src/claude/aside.ts), so the answer knows everything the conversation knows while the
// conversation itself stays exactly as it was.
//
// Read-only by construction, so there are no tool cards and no permission prompts to render — text
// in, text out. Nothing here survives a reload; that is the feature, not a shortcut.
import { useEffect, useRef, useState } from 'react';
import { useStore, type Block, type GuideMsg } from '../lib/store';
import { useT } from '../lib/i18n';
import { useIsMobile, ClayDots, useInputHistory, useStickToBottom } from '../lib/ui';
import { md } from '../lib/md';
import { IconX, IconSend, IconSparkle, IconRotateCcw } from '../lib/icons';

export function AsideChat() {
  const enabled = useStore((s) => s.asideEnabled);
  const open = useStore((s) => s.asideOpen);
  const hasChat = useStore((s) => !!s.current);
  if (!enabled || !open || !hasChat) return null;
  return <AsidePanel />;
}

function AsidePanel() {
  const messages = useStore((s) => s.asideMessages);
  const live = useStore((s) => s.asideLive);
  const busy = useStore((s) => s.asideBusy);
  const title = useStore((s) => s.current?.title || '');
  const send = useStore((s) => s.sendAside);
  const clear = useStore((s) => s.clearAsideThread);
  const stop = useStore((s) => s.interruptAside);
  const setOpen = useStore((s) => s.setAsideOpen);
  const isMobile = useIsMobile();
  const t = useT();
  const [text, setText] = useState('');
  const { ref: bodyRef, onScroll, follow } = useStickToBottom<HTMLDivElement>();
  const taRef = useRef<HTMLTextAreaElement>(null);

  const fit = () => {
    const ta = taRef.current; if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 112)}px`;
  };
  // ↑/↓ recall what I asked here before
  const histKey = useInputHistory(
    messages.filter((m) => m.role === 'user').map((m) => m.content?.text || ''), text,
    (v) => { setText(v); requestAnimationFrame(fit); },
  );

  useEffect(() => { follow(); }, [messages, live, follow]);
  useEffect(() => { taRef.current?.focus(); }, []);
  // Esc closes the panel. Captured before it reaches the page so the main composer's own Esc
  // (interrupt the running turn) does not fire while the person is typing in here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [setOpen]);

  const submit = () => {
    const body = text.trim();
    if (!body || busy) return;
    setText('');
    if (taRef.current) taRef.current.style.height = 'auto';
    void send(body);
  };

  // <md: a full-screen sheet — a floating card on a phone would cover the chat anyway and be too
  // small to read. ≥md: a card pinned over the top-right of the conversation, clear of the composer.
  const shell = isMobile
    ? 'fixed inset-0 z-50 flex flex-col bg-panel'
    : 'absolute right-4 top-4 z-30 flex flex-col w-[420px] max-w-[calc(100%-2rem)] h-[min(560px,calc(100%-2rem))] bg-panel border border-line rounded-2xl shadow-2xl overflow-hidden';

  return (
    <div className={shell} role="dialog" aria-label={t('aside.title')}>
      <header className="flex items-center gap-2 px-3 py-2.5 border-b border-line shrink-0">
        <span className="text-clay"><IconSparkle size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate">{t('aside.title')}</div>
          <div className="text-[11px] text-txt3 truncate">{title}</div>
        </div>
        <button type="button" className="toolbtn shrink-0" title={t('aside.newThread')} aria-label={t('aside.newThread')}
          onClick={() => { void clear(); }}><IconRotateCcw size={15} /></button>
        <button type="button" className="toolbtn shrink-0" title={t('aside.close')} aria-label={t('aside.close')}
          onClick={() => setOpen(false)}><IconX size={15} /></button>
      </header>

      <div ref={bodyRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto scrolly px-3 py-3">
        {messages.length === 0 && !live && (
          <p className="text-sm text-txt2 leading-relaxed">{t('aside.greeting')}</p>
        )}
        {messages.map((m) => <AsideBubble key={m.id} m={m} />)}
        {live && <div className="mb-3"><AsideBlocks blocks={live.blocks} /></div>}
        {busy && !live?.blocks.length && <div className="text-xs text-txt3 mb-3"><ClayDots size={5} /></div>}
      </div>

      <div className="border-t border-line p-2.5 shrink-0">
        <div className="border border-line2 rounded-xl bg-card px-3 py-2 flex items-end gap-2">
          <textarea
            ref={taRef}
            rows={1}
            className="flex-1 bg-transparent outline-none resize-none text-sm text-txt placeholder:text-txt3 py-1.5 max-h-28 scrolly"
            placeholder={t('aside.placeholder')}
            value={text}
            onChange={(e) => { setText(e.target.value); fit(); }}
            // isComposing guard: without it a Korean IME re-sends the last syllable on Enter
            onKeyDown={(e) => {
              if (histKey(e)) return;
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
            }}
          />
          {busy ? (
            <button type="button" className="toolbtn shrink-0 text-danger" title={t('aside.stop')} aria-label={t('aside.stop')}
              onClick={() => { void stop(); }}><IconX size={15} /></button>
          ) : (
            <button type="button" className="bg-clay text-white rounded-lg w-8 h-8 grid place-items-center shrink-0 disabled:opacity-40"
              disabled={!text.trim()} title={t('aside.send')} aria-label={t('aside.send')}
              onClick={submit}><IconSend size={15} /></button>
          )}
        </div>
      </div>
    </div>
  );
}

function AsideBubble({ m }: { m: GuideMsg }) {
  if (m.role === 'user') {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2 text-sm break-words whitespace-pre-wrap bg-clay text-white">
          {m.content.text}
        </div>
      </div>
    );
  }
  return <div className="mb-3"><AsideBlocks blocks={m.content.blocks || []} /></div>;
}

function AsideBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => (b.type === 'text'
        ? <div key={i} className="text-sm text-txt break-words leading-relaxed"
            dangerouslySetInnerHTML={{ __html: md(b.text) }} />
        : null))}
    </>
  );
}
