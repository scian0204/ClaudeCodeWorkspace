// The floating guide assistant: a round button in the bottom-right corner that opens a small chat
// panel. It answers "what can this do?" questions and actually carries the request out — it drives
// the workspace API as the signed-in user, so it can never do more than that user could click.
//
// Everything streams over the socket (see the guide:* handlers in lib/store.ts), so a turn started
// in one tab renders in all of them.
import { useEffect, useRef, useState } from 'react';
import { useStore, type Block, type GuideMsg } from '../lib/store';
import { useT } from '../lib/i18n';
import { useIsMobile, ClayDots } from '../lib/ui';
import { md } from '../lib/md';
import { IconGuide, IconX, IconSend, IconSparkle, IconTerminal, IconRotateCcw, IconCheck } from '../lib/icons';

const SUGGESTIONS = ['guide.sug1', 'guide.sug2', 'guide.sug3', 'guide.sug4'];

export function Guide() {
  const enabled = useStore((s) => s.guideEnabled);
  const open = useStore((s) => s.guideOpen);
  const unread = useStore((s) => s.guideUnread);
  const setOpen = useStore((s) => s.setGuideOpen);
  const t = useT();
  if (!enabled) return null;
  return (
    <>
      {open && <GuidePanel />}
      {/* The launcher hides while the panel is open on a phone — there the panel is full-screen and
          the header's close button is the way out. */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={t(open ? 'guide.close' : 'guide.open')}
        title={t('guide.title')}
        className={`fixed right-3 bottom-3 md:right-5 md:bottom-5 z-50 w-12 h-12 md:w-14 md:h-14 rounded-full
          bg-clay text-white shadow-lg grid place-items-center transition hover:brightness-110
          active:scale-95 ${open ? 'hidden md:grid' : ''}`}
      >
        {open ? <IconX size={22} /> : <IconGuide size={24} />}
        {unread && !open && <span className="absolute top-0.5 right-0.5 w-2.5 h-2.5 rounded-full bg-white border-2 border-clay" />}
      </button>
    </>
  );
}

function GuidePanel() {
  const messages = useStore((s) => s.guideMessages);
  const live = useStore((s) => s.guideLive);
  const busy = useStore((s) => s.guideBusy);
  const writeEnabled = useStore((s) => s.guideWriteEnabled);
  const send = useStore((s) => s.sendGuide);
  const clear = useStore((s) => s.clearGuideThread);
  const stop = useStore((s) => s.interruptGuide);
  const setOpen = useStore((s) => s.setGuideOpen);
  const isMobile = useIsMobile();
  const t = useT();
  const [text, setText] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // stick to the bottom as the answer streams in
  useEffect(() => {
    const el = bodyRef.current; if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, live]);
  useEffect(() => { taRef.current?.focus(); }, []);

  const submit = (v?: string) => {
    const body = (v ?? text).trim();
    if (!body || busy) return;
    setText('');
    if (taRef.current) taRef.current.style.height = 'auto';
    void send(body);
  };

  // <md: a full-screen sheet (a 400px card on a phone is unusable). ≥md: a card above the launcher.
  const shell = isMobile
    ? 'fixed inset-0 z-50 flex flex-col bg-panel'
    : 'fixed right-5 bottom-24 z-50 flex flex-col w-[400px] h-[min(640px,calc(100vh-9rem))] bg-panel border border-line rounded-2xl shadow-2xl overflow-hidden';

  return (
    <div className={shell} role="dialog" aria-label={t('guide.title')}>
      <header className="flex items-center gap-2 px-3 py-2.5 border-b border-line shrink-0">
        <span className="text-clay"><IconSparkle size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate">{t('guide.title')}</div>
          <div className="text-[11px] text-txt3 truncate">{t(writeEnabled ? 'guide.subtitle' : 'guide.subtitleReadOnly')}</div>
        </div>
        <button type="button" className="toolbtn shrink-0" title={t('guide.newThread')} aria-label={t('guide.newThread')}
          onClick={() => { void clear(); }}><IconRotateCcw size={15} /></button>
        <button type="button" className="toolbtn shrink-0" title={t('guide.close')} aria-label={t('guide.close')}
          onClick={() => setOpen(false)}><IconX size={15} /></button>
      </header>

      <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto scrolly px-3 py-3">
        {messages.length === 0 && !live && (
          <div className="text-sm text-txt2">
            <p className="mb-3 leading-relaxed">{t('guide.greeting')}</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((k) => (
                <button key={k} type="button" onClick={() => submit(t(k))}
                  className="text-xs px-2.5 py-1 rounded-full border border-line text-txt2 hover:border-clay hover:text-clay transition">
                  {t(k)}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => <GuideBubble key={m.id} m={m} />)}
        {live && <div className="mb-3"><GuideBlocks blocks={live.blocks} /></div>}
        {busy && !live?.blocks.length && <div className="text-xs text-txt3 mb-3"><ClayDots size={5} /></div>}
      </div>

      <div className="border-t border-line p-2.5 shrink-0">
        <div className="border border-line2 rounded-xl bg-card px-3 py-2 flex items-end gap-2">
          <textarea
            ref={taRef}
            rows={1}
            className="flex-1 bg-transparent outline-none resize-none text-sm text-txt placeholder:text-txt3 max-h-28 scrolly"
            placeholder={t('guide.placeholder')}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              e.currentTarget.style.height = 'auto';
              e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 112)}px`;
            }}
            // isComposing guard: without it a Korean IME re-sends the last syllable on Enter
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
          />
          {busy ? (
            <button type="button" className="toolbtn shrink-0 text-danger" title={t('guide.stop')} aria-label={t('guide.stop')}
              onClick={() => { void stop(); }}><IconX size={15} /></button>
          ) : (
            <button type="button" className="bg-clay text-white rounded-lg w-8 h-8 grid place-items-center shrink-0 disabled:opacity-40"
              disabled={!text.trim()} title={t('guide.send')} aria-label={t('guide.send')}
              onClick={() => submit()}><IconSend size={15} /></button>
          )}
        </div>
      </div>
    </div>
  );
}

function GuideBubble({ m }: { m: GuideMsg }) {
  if (m.role === 'user') {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2 text-sm break-words whitespace-pre-wrap bg-clay text-white">
          {m.content.text}
        </div>
      </div>
    );
  }
  return <div className="mb-3"><GuideBlocks blocks={m.content.blocks || []} /></div>;
}

function GuideBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => (b.type === 'text'
        ? <div key={i} className="text-sm text-txt break-words leading-relaxed"
            dangerouslySetInnerHTML={{ __html: md(b.text) }} />
        : <GuideToolChip key={i} b={b} />))}
    </>
  );
}

// Compact one-line record of what the assistant did. The full tool card from the main chat is far
// too heavy for a 400px panel — the interesting part here is just "which call, and did it work".
function GuideToolChip({ b }: { b: Extract<Block, { type: 'tool_use' }> }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const label = b.name.endsWith('__ui')
    ? `${b.input?.action || 'ui'}${b.input?.value ? ` ${b.input.value}` : ''}`
    : `${b.input?.method || ''} ${b.input?.path || ''}`.trim() || b.name;
  const done = b.output != null;
  return (
    <div className="my-1.5 border border-line rounded-lg bg-card overflow-hidden">
      <button type="button" className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-left"
        onClick={() => setOpen(!open)}>
        <span className="text-clay shrink-0"><IconTerminal size={12} /></span>
        <code className="font-mono text-txt2 truncate flex-1">{label}</code>
        <span className="shrink-0 flex items-center gap-1" style={{ color: !done ? 'var(--txt-3)' : b.isError ? 'var(--danger)' : 'var(--ok)' }}>
          {done && (b.isError ? <IconX size={11} /> : <IconCheck size={11} />)}
          {t(!done ? 'chat.toolRunning' : b.isError ? 'chat.toolError' : 'chat.toolDone')}
        </span>
      </button>
      {open && done && (
        <div className="border-t border-line px-2.5 py-1.5 font-mono text-[11px] text-txt2 whitespace-pre-wrap bg-bg max-h-40 overflow-auto scrolly">{b.output}</div>
      )}
    </div>
  );
}
