import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { md } from '../lib/md';
import { useT } from '../lib/i18n';
import { isImage, isMarkdown, resolveRelAsset } from './FileExplorer';
import { citeId, extractSources, resolveRealPath, useCite, type WikiSource } from '../lib/wikiCite';

// Toggles the `.on` class on every in-text citation mark matching the hovered source, so hovering
// a panel row lights up its mentions in the answer (and vice-versa). Marks are non-React DOM.
export function CiteHighlighter() {
  const hovered = useCite((s) => s.hovered);
  useLayoutEffect(() => {
    if (!hovered) return;
    const on: Element[] = [];
    document.querySelectorAll('mark.wiki-cite').forEach((el) => {
      if ((el as HTMLElement).dataset.src === hovered) { el.classList.add('on'); on.push(el); }
    });
    return () => on.forEach((el) => el.classList.remove('on'));
  }, [hovered]);
  return null;
}

// Right-side panel for LLM-Wiki threads: aggregates every source the assistant cited across the
// conversation (grouped wiki / raw), highlights on hover, and previews the file on click.
export function SourcesPanel({ topicId, open, onToggle, width, onResize }: { topicId: string; open: boolean; onToggle: () => void; width: number; onResize: (w: number) => void }) {
  const messages = useStore((s) => s.messages);
  const live = useStore((s) => s.live);
  const { hovered, preview, setHovered, openPreview } = useCite();
  const t = useT();

  // drag the left edge to widen/narrow the panel (delta-based; Chat clamps + persists)
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX, startW = width;
    const move = (ev: MouseEvent) => onResize(startW - (ev.clientX - startX));
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.body.style.userSelect = 'none';
  };

  // reset the open preview when switching threads/topics
  useEffect(() => () => openPreview(null), [topicId]);

  const sources = useMemo(() => {
    const seen = new Set<string>();
    const all: WikiSource[] = [];
    const add = (arr: WikiSource[]) => arr.forEach((s) => { const id = citeId(s); if (!seen.has(id)) { seen.add(id); all.push(s); } });
    for (const m of messages) if (m.role === 'assistant') add(extractSources(m.content.blocks || [], topicId));
    if (live) add(extractSources(live.blocks, topicId));
    return all;
  }, [messages, live, topicId]);

  if (!open) {
    return (
      <aside className="border-l border-line bg-panel flex flex-col items-center pt-3 gap-2 select-none">
        <button className="toolbtn" title={t('wikiSources.expand')} onClick={onToggle}>📎</button>
        {sources.length > 0 && <span className="text-[10px] text-txt3">{sources.length}</span>}
      </aside>
    );
  }

  const groups: { dir: 'wiki' | 'raw'; label: string }[] = [
    { dir: 'wiki', label: t('wikiSources.wikiGroup') },
    { dir: 'raw', label: t('wikiSources.rawGroup') },
  ];

  return (
    <aside className="relative border-l border-line bg-panel flex flex-col min-h-0">
      <div onMouseDown={startDrag} title={t('wikiSources.resize')}
        className="absolute left-0 top-0 h-full w-1.5 -ml-0.5 cursor-col-resize z-10 hover:bg-clay/40" />
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line shrink-0">
        <span>📎</span>
        <span className="font-semibold text-sm">{t('wikiSources.title')}</span>
        <span className="text-txt3 text-xs">{sources.length}</span>
        <button className="ml-auto text-txt3 hover:text-clay text-sm" title={t('wikiSources.collapse')} onClick={onToggle}>»</button>
      </div>

      {preview ? (
        <CitePreview topicId={topicId} src={preview} onBack={() => openPreview(null)} />
      ) : (
        <div className="flex-1 overflow-y-auto scrolly p-2">
          {sources.length === 0 && <div className="text-txt3 text-xs p-2 leading-relaxed">{t('wikiSources.empty')}</div>}
          {groups.map(({ dir, label }) => {
            const rows = sources.filter((s) => s.dir === dir);
            if (!rows.length) return null;
            return (
              <div key={dir} className="mb-3">
                <div className="text-[10px] uppercase tracking-wider text-txt3 px-1 mb-1">{label} · {rows.length}</div>
                {rows.map((s) => {
                  const id = citeId(s);
                  const base = s.path.split('/').pop() || s.path;
                  return (
                    <button key={id} data-src-row={id} title={`${s.dir}/${s.path}`}
                      onMouseEnter={() => setHovered(id)} onMouseLeave={() => setHovered(null)}
                      onClick={() => openPreview(s)}
                      className={`w-full text-left flex items-center gap-1.5 px-2 py-1.5 rounded text-xs mb-0.5 border transition
                        ${hovered === id ? 'border-clay bg-claysoft text-clay' : 'border-transparent hover:bg-line text-txt2'}`}>
                      <span className="shrink-0">{isImage(base) ? '🖼' : '📄'}</span>
                      <span className="truncate flex-1">{base}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}

function CitePreview({ topicId, src, onBack }: { topicId: string; src: WikiSource; onBack: () => void }) {
  const [real, setReal] = useState<WikiSource>(src);
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [raw, setRaw] = useState(false);
  const t = useT();
  const base = real.path.split('/').pop() || real.path;

  useEffect(() => {
    let cancelled = false;
    setFile(null); setRaw(false); setNotFound(false); setLoading(true);
    (async () => {
      // the model's written path is approximate — map it onto a real tree entry before fetching
      const r = await resolveRealPath(topicId, src);
      if (cancelled) return;
      setReal(r);
      if (isImage(r.path)) { setLoading(false); return; } // rendered via <img>, no text fetch
      try {
        const d = await api.get(`/api/wiki/topics/${topicId}/file?dir=${r.dir}&path=${encodeURIComponent(r.path)}`);
        if (!cancelled) setFile(d);
      } catch { if (!cancelled) setNotFound(true); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [topicId, src.dir, src.path]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-line shrink-0 text-xs">
        <button className="text-txt3 hover:text-clay" onClick={onBack}>{t('wikiSources.back')}</button>
        <span className="font-mono truncate flex-1" title={`${real.dir}/${real.path}`}>{base}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: 'var(--claysoft)', color: 'var(--clay)' }}>{real.dir}</span>
        {isMarkdown(real.path) && !isImage(real.path) && !notFound && (
          <button className="shrink-0 px-1.5 py-0.5 rounded border border-line hover:text-clay" onClick={() => setRaw(!raw)}>
            {raw ? t('fileExplorer.rendered') : t('fileExplorer.source')}
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto scrolly bg-bg min-w-0">
        {notFound ? (
          <div className="text-txt3 text-xs p-3">{t('wikiSources.notFound')}</div>
        ) : isImage(real.path) ? (
          <div className="p-3"><img src={`/api/wiki/topics/${topicId}/blob?dir=${real.dir}&path=${encodeURIComponent(real.path)}`} alt={base} className="max-w-full h-auto rounded border border-line" /></div>
        ) : loading ? (
          <div className="text-txt3 text-xs p-3">{t('fileExplorer.loading')}</div>
        ) : file && isMarkdown(real.path) && !raw ? (
          <div className="p-3 text-sm break-words leading-relaxed" dangerouslySetInnerHTML={{ __html: md(file.content, { img: (s) => `/api/wiki/topics/${topicId}/blob?dir=${real.dir}&path=${encodeURIComponent(resolveRelAsset(real.path.split('/').slice(0, -1).join('/'), s))}` }) }} />
        ) : file ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-txt2 p-3">{file.content}</pre>
        ) : null}
      </div>
    </div>
  );
}
