// Workspace-wide search palette (Ctrl/Cmd+K). One input over GET /api/search: results are a single
// newest/oldest timeline, narrowed by a surface tab (all · personal · rooms · DM · projects · wiki ·
// PR reviews · people). Kept mounted by Shell (not conditionally rendered) so a project / wiki-file
// hit can hand off to a FileExplorer modal after the palette itself closes.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type SearchHit, type HitType } from '../lib/store';
import { api } from '../lib/api';
import { Modal } from './Modal';
import { FileExplorer } from './FileExplorer';
import { timeAgo } from '../lib/ui';
import { useT } from '../lib/i18n';
import {
  IconSearch, IconMessage, IconUsers, IconFolder, IconBook, IconFile, IconGitBranch, IconUser,
} from '../lib/icons';

const MIN_CHARS = 2;
const DEBOUNCE_MS = 220;

const ICONS: Record<HitType, (p: { size?: number; className?: string }) => React.ReactElement> = {
  chat: IconMessage, session: IconMessage, room: IconUsers, dm: IconMessage, channel: IconUsers,
  project: IconFolder, wiki: IconBook, wikiFile: IconFile, review: IconGitBranch, user: IconUser,
};

type Explorer =
  | { kind: 'project'; projectId: string; title: string }
  | { kind: 'wiki'; topicId: string; title: string; dir: 'raw' | 'wiki'; filePath: string };

// Sort is time-only. Undated hits (people, wiki documents) have nothing to sort by, so they trail
// the list in both directions instead of pretending to be the oldest.
type SortMode = 'newest' | 'oldest';
const SORTS: SortMode[] = ['newest', 'oldest'];
function byTime(list: SearchHit[], dir: SortMode): SearchHit[] {
  const dated = list.filter((h) => h.ts).sort((a, b) => (dir === 'newest' ? b.ts! - a.ts! : a.ts! - b.ts!));
  return [...dated, ...list.filter((h) => !h.ts)];
}

// The filter tabs are per FEATURE, not per hit type: a message inside a room belongs under "rooms",
// the same message shape inside a wiki thread belongs under "LLM Wiki". `nav.kind` already says
// which surface a chat hit came from, so fold the finer hit types onto that.
type Surface = 'private' | 'room' | 'dm' | 'project' | 'wiki' | 'review' | 'user';
const TABS: Surface[] = ['private', 'room', 'dm', 'project', 'wiki', 'review', 'user'];
function surfaceOf(h: SearchHit): Surface {
  switch (h.type) {
    case 'chat': return h.nav.kind === 'room' ? 'room' : h.nav.kind === 'wiki' ? 'wiki' : h.nav.kind === 'review' ? 'review' : 'private';
    case 'session': return 'private';
    case 'room': return 'room';
    case 'dm': case 'channel': return 'dm';
    case 'project': return 'project';
    case 'wiki': case 'wikiFile': return 'wiki';
    case 'review': return 'review';
    case 'user': return 'user';
  }
}

export function SearchPalette() {
  const searchOpen = useStore((s) => s.searchOpen);
  const setSearchOpen = useStore((s) => s.setSearchOpen);
  const openHit = useStore((s) => s.openHit);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const [sort, setSort] = useState<SortMode>(() => {
    const saved = localStorage.getItem('searchSort') as SortMode | null;
    return saved && SORTS.includes(saved) ? saved : 'newest';
  });
  const [tab, setTab] = useState<Surface | 'all'>('all');
  const [explorer, setExplorer] = useState<Explorer | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const t = useT();

  const term = q.trim();
  // The server caps hits per surface, so it must know which end to keep: "oldest first" needs the
  // oldest candidates, not the newest ones re-sorted.
  const sortParam = sort;
  useEffect(() => {
    if (!searchOpen) return;
    if (term.length < MIN_CHARS) { setHits([]); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    const timer = setTimeout(() => {
      api.get(`/api/search?q=${encodeURIComponent(term)}&sort=${sortParam}`)
        .then((r) => {
          if (!alive) return;
          const list: SearchHit[] = r.hits || [];
          setHits(list); setSel(0);
          // a filter the new query has nothing for would show an empty palette — fall back to 전체
          setTab((cur) => (cur !== 'all' && !list.some((h) => surfaceOf(h) === cur) ? 'all' : cur));
        })
        .catch(() => { if (alive) setHits([]); })
        .finally(() => { if (alive) setLoading(false); });
    }, DEBOUNCE_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [term, searchOpen, sortParam]);

  // Per-tab counts drive the badges; only surfaces with hits get a tab.
  const counts = useMemo(() => {
    const m = {} as Record<Surface, number>;
    for (const h of hits) { const s = surfaceOf(h); m[s] = (m[s] || 0) + 1; }
    return m;
  }, [hits]);
  // Rendered order == keyboard order: one time-sorted list, filtered by the active tab.
  const rows = useMemo(() => byTime(tab === 'all' ? hits : hits.filter((h) => surfaceOf(h) === tab), sort),
    [hits, tab, sort]);

  const pickSort = (mode: SortMode) => { localStorage.setItem('searchSort', mode); setSort(mode); setSel(0); };
  const pickTab = (next: Surface | 'all') => { setTab(next); setSel(0); };

  useEffect(() => { // keep the highlighted row in view while arrowing
    listRef.current?.querySelector('[data-sel="1"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const activate = (hit: SearchHit) => {
    const n = hit.nav;
    if (n.kind === 'project' && n.projectId) {
      setSearchOpen(false);
      setExplorer({ kind: 'project', projectId: n.projectId, title: hit.title });
      return;
    }
    if (n.kind === 'wikiFile' && n.topicId && n.filePath) {
      setSearchOpen(false);
      setExplorer({ kind: 'wiki', topicId: n.topicId, title: hit.subtitle || hit.title, dir: n.dir || 'wiki', filePath: n.filePath });
      return;
    }
    void openHit(hit); // closes the palette itself
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) { // IME: Enter commits the composition first
      e.preventDefault();
      if (rows[sel]) activate(rows[sel]);
    }
  };

  return (
    <>
      <Modal open={searchOpen} onOpenChange={setSearchOpen} title={t('search.title')} width={640}>
        <div className="flex items-center gap-2 border border-line rounded-lg px-2.5 py-1.5 mb-2 focus-within:border-clay">
          <span className="text-txt3"><IconSearch size={15} /></span>
          {/* the last query is kept (re-open → same results); selecting it on focus makes typing replace it */}
          <input className="bg-transparent outline-none flex-1 text-sm min-w-0" autoFocus value={q}
            placeholder={t('search.placeholder')} onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown} />
          {loading && <span className="text-[11px] text-txt3 shrink-0">{t('search.searching')}</span>}
        </div>

        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className="text-[11px] text-txt3">{t('search.sortLabel')}</span>
          <div className="seg">
            {SORTS.map((m) => (
              <button key={m} className={sort === m ? 'on' : ''} onClick={() => pickSort(m)}>{t(`search.sort.${m}`)}</button>
            ))}
          </div>
          {rows.length > 0 && <span className="text-[11px] text-txt3 ml-auto">{t('search.resultCount', { count: rows.length })}</span>}
        </div>

        {/* feature filter: 전체 + every surface that actually has hits. Scrolls sideways on a phone. */}
        {hits.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto scrolly pb-1.5 mb-1 -mx-1 px-1">
            <TabBtn active={tab === 'all'} label={t('search.tab.all')} count={hits.length} onClick={() => pickTab('all')} />
            {TABS.filter((s) => counts[s]).map((s) => (
              <TabBtn key={s} active={tab === s} label={t(`search.tab.${s}`)} count={counts[s]} onClick={() => pickTab(s)} />
            ))}
          </div>
        )}

        <div ref={listRef} className="max-h-[50vh] overflow-auto scrolly -mx-1 px-1">
          {term.length < MIN_CHARS && <div className="text-[11px] text-txt3 px-1 py-2">{t('search.minChars', { n: MIN_CHARS })}</div>}
          {term.length >= MIN_CHARS && !loading && rows.length === 0 && (
            <div className="text-[11px] text-txt3 px-1 py-2">{t('search.empty', { q: term })}</div>
          )}
          {rows.map((h, i) => <Row key={h.id} hit={h} index={i} active={i === sel} onHover={setSel} onPick={activate} />)}
        </div>
        <div className="text-[10px] text-txt3 pt-2 border-t border-line mt-2">{t('search.navHint')}</div>
      </Modal>

      {explorer?.kind === 'project' && (
        <FileExplorer
          title={t('chat.fileExplorerTitle', { title: explorer.title })}
          sources={[{ key: 'files', label: t('chat.filesSource') }]}
          loadTree={() => api.get(`/api/projects/${explorer.projectId}/tree`).then((r) => ({ files: r.files }))}
          fileUrl={(_dir, p) => `/api/projects/${explorer.projectId}/file?path=${encodeURIComponent(p)}`}
          blobUrl={(_dir, p) => `/api/projects/${explorer.projectId}/blob?path=${encodeURIComponent(p)}`}
          onClose={() => setExplorer(null)}
        />
      )}
      {explorer?.kind === 'wiki' && (
        <FileExplorer
          title={t('chat.fileExplorerTitle', { title: explorer.title })}
          sources={[{ key: 'raw', label: t('wikiExplorer.sourceRaw') }, { key: 'wiki', label: t('wikiExplorer.sourceWiki') }]}
          loadTree={() => api.get(`/api/wiki/topics/${explorer.topicId}/tree`)}
          fileUrl={(dir, p) => `/api/wiki/topics/${explorer.topicId}/file?dir=${dir}&path=${encodeURIComponent(p)}`}
          blobUrl={(dir, p) => `/api/wiki/topics/${explorer.topicId}/blob?dir=${dir}&path=${encodeURIComponent(p)}`}
          initialDir={explorer.dir}
          initialPath={explorer.filePath}
          onClose={() => setExplorer(null)}
        />
      )}
    </>
  );
}

// Filter chip for one surface (or 전체), with its hit count.
function TabBtn({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full border whitespace-nowrap shrink-0 ${active ? 'bg-claysoft border-clay text-clay' : 'border-line text-txt3 hover:text-txt'}`}>
      {label} <span className="opacity-70">{count}</span>
    </button>
  );
}

// One result row. The list is a flat timeline, so every row carries its own type badge.
function Row({ hit, index, active, onHover, onPick }: {
  hit: SearchHit; index: number; active: boolean;
  onHover: (i: number) => void; onPick: (h: SearchHit) => void;
}) {
  const t = useT();
  const Icon = ICONS[hit.type];
  return (
    <button data-sel={active ? '1' : '0'} onMouseEnter={() => onHover(index)} onClick={() => onPick(hit)}
      className={`flex flex-col items-start gap-0.5 w-full text-left px-2 py-1.5 rounded-md ${active ? 'bg-claysoft' : 'hover:bg-line'}`}>
      <span className="flex items-center gap-2 w-full min-w-0">
        <span className="text-[10px] text-txt3 shrink-0 inline-flex items-center gap-1 border border-line rounded px-1 py-px">
          <Icon size={10} />{t(`search.group.${hit.type}`)}
        </span>
        <span className="text-[13px] truncate flex-1">{hit.title}</span>
        {hit.ts ? <span className="text-[10px] text-txt3 shrink-0">{timeAgo(hit.ts)}</span> : null}
      </span>
      {hit.subtitle && <span className="text-[11px] text-txt3 truncate max-w-full">{hit.subtitle}</span>}
      {/* w-full is load-bearing: items-start would otherwise size this to its content, and a long
          unwrapped snippet (a path, a CJK run) would push the row wider than the palette. */}
      {hit.snippet && <span className="text-[11px] text-txt2 break-words w-full">{hit.snippet}</span>}
    </button>
  );
}

// Search entry point for every top bar + the sidebar. Hidden when an admin turns search off.
export function SearchButton({ className, label }: { className?: string; label?: boolean }) {
  const enabled = useStore((s) => s.searchEnabled);
  const setSearchOpen = useStore((s) => s.setSearchOpen);
  const t = useT();
  if (!enabled) return null;
  if (label) {
    return (
      <button className={`flex items-center gap-2 w-full text-left border border-line rounded-lg px-2.5 py-1.5 text-[12px] text-txt3 hover:border-clay hover:text-txt ${className || ''}`}
        onClick={() => setSearchOpen(true)}>
        <IconSearch size={14} /><span className="flex-1 truncate">{t('search.button')}</span>
        <span className="text-[10px] font-mono shrink-0 max-md:hidden">{t('search.shortcut')}</span>
      </button>
    );
  }
  return (
    <button className={`toolbtn shrink-0 ${className || ''}`} title={t('search.button')} aria-label={t('search.button')}
      onClick={() => setSearchOpen(true)}><IconSearch /></button>
  );
}
