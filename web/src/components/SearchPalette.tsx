// Workspace-wide search palette (Ctrl/Cmd+K). One input over GET /api/search, results grouped by
// surface — chats, room chats, DM/group messages, projects, wiki topics + files, PR reviews, people.
// Kept mounted by Shell (not conditionally rendered) so a project / wiki-file hit can hand off to a
// FileExplorer modal after the palette itself closes.
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

// Group order = how the results read top-down: my own threads first, shared next, reference last.
const ORDER: HitType[] = ['chat', 'session', 'room', 'dm', 'channel', 'project', 'wiki', 'wikiFile', 'review', 'user'];
const ICONS: Record<HitType, (p: { size?: number; className?: string }) => React.ReactElement> = {
  chat: IconMessage, session: IconMessage, room: IconUsers, dm: IconMessage, channel: IconUsers,
  project: IconFolder, wiki: IconBook, wikiFile: IconFile, review: IconGitBranch, user: IconUser,
};

type Explorer =
  | { kind: 'project'; projectId: string; title: string }
  | { kind: 'wiki'; topicId: string; title: string; dir: 'raw' | 'wiki'; filePath: string };

// 'group' = the default, one section per surface. The other two flatten every surface into a single
// timeline. Undated hits (people, wiki documents) have nothing to sort by, so they trail the list in
// both directions instead of pretending to be the oldest.
type SortMode = 'group' | 'newest' | 'oldest';
const SORTS: SortMode[] = ['group', 'newest', 'oldest'];
function byTime(list: SearchHit[], dir: 'newest' | 'oldest'): SearchHit[] {
  const dated = list.filter((h) => h.ts).sort((a, b) => (dir === 'newest' ? b.ts! - a.ts! : a.ts! - b.ts!));
  return [...dated, ...list.filter((h) => !h.ts)];
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
    return saved && SORTS.includes(saved) ? saved : 'group';
  });
  const [explorer, setExplorer] = useState<Explorer | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const t = useT();

  const term = q.trim();
  // The server caps hits per surface, so it must know which end to keep: "oldest first" needs the
  // oldest candidates, not the newest ones re-sorted. Grouped/newest both want the newest.
  const sortParam = sort === 'oldest' ? 'oldest' : 'newest';
  useEffect(() => {
    if (!searchOpen) return;
    if (term.length < MIN_CHARS) { setHits([]); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    const timer = setTimeout(() => {
      api.get(`/api/search?q=${encodeURIComponent(term)}&sort=${sortParam}`)
        .then((r) => { if (alive) { setHits(r.hits || []); setSel(0); } })
        .catch(() => { if (alive) setHits([]); })
        .finally(() => { if (alive) setLoading(false); });
    }, DEBOUNCE_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [term, searchOpen, sortParam]);

  // Grouped view: one section per surface in ORDER, newest-first inside each section.
  const grouped = useMemo(() => ORDER
    .map((type) => ({ type, items: byTime(hits.filter((h) => h.type === type), 'newest') }))
    .filter((g) => g.items.length > 0), [hits]);
  // Flat order for keyboard nav must match what's rendered, in either mode.
  const flat = useMemo(() => (sort === 'group' ? grouped.flatMap((g) => g.items) : byTime(hits, sort)),
    [grouped, hits, sort]);

  const pickSort = (mode: SortMode) => { localStorage.setItem('searchSort', mode); setSort(mode); setSel(0); };

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
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) { // IME: Enter commits the composition first
      e.preventDefault();
      if (flat[sel]) activate(flat[sel]);
    }
  };

  let idx = -1; // running index across groups → matches `flat`
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

        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-[11px] text-txt3">{t('search.sortLabel')}</span>
          <div className="seg">
            {SORTS.map((m) => (
              <button key={m} className={sort === m ? 'on' : ''} onClick={() => pickSort(m)}>{t(`search.sort.${m}`)}</button>
            ))}
          </div>
          {flat.length > 0 && <span className="text-[11px] text-txt3 ml-auto">{t('search.resultCount', { count: flat.length })}</span>}
        </div>

        <div ref={listRef} className="max-h-[54vh] overflow-auto scrolly -mx-1 px-1">
          {term.length < MIN_CHARS && <div className="text-[11px] text-txt3 px-1 py-2">{t('search.minChars', { n: MIN_CHARS })}</div>}
          {term.length >= MIN_CHARS && !loading && flat.length === 0 && (
            <div className="text-[11px] text-txt3 px-1 py-2">{t('search.empty', { q: term })}</div>
          )}
          {sort === 'group'
            ? grouped.map((g) => {
              const Icon = ICONS[g.type];
              return (
                <div key={g.type} className="mb-1">
                  <div className="text-[11px] tracking-wider uppercase text-txt3 px-1.5 pt-2 pb-1 font-semibold flex items-center gap-1.5">
                    <Icon size={12} />{t(`search.group.${g.type}`)}
                    <span className="text-txt3 font-normal">{g.items.length}</span>
                  </div>
                  {g.items.map((h) => {
                    idx += 1;
                    return <Row key={h.id} hit={h} index={idx} active={idx === sel} onHover={setSel} onPick={activate} />;
                  })}
                </div>
              );
            })
            // flat timeline: no section headers, so each row carries its own surface badge
            : flat.map((h, i) => <Row key={h.id} hit={h} index={i} active={i === sel} onHover={setSel} onPick={activate} showType />)}
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

// One result row. `showType` adds the surface badge the flat (time-sorted) view needs, since it has
// no section header above it.
function Row({ hit, index, active, showType, onHover, onPick }: {
  hit: SearchHit; index: number; active: boolean; showType?: boolean;
  onHover: (i: number) => void; onPick: (h: SearchHit) => void;
}) {
  const t = useT();
  const Icon = ICONS[hit.type];
  return (
    <button data-sel={active ? '1' : '0'} onMouseEnter={() => onHover(index)} onClick={() => onPick(hit)}
      className={`flex flex-col items-start gap-0.5 w-full text-left px-2 py-1.5 rounded-md ${active ? 'bg-claysoft' : 'hover:bg-line'}`}>
      <span className="flex items-center gap-2 w-full min-w-0">
        {showType && (
          <span className="text-[10px] text-txt3 shrink-0 inline-flex items-center gap-1 border border-line rounded px-1 py-px">
            <Icon size={10} />{t(`search.group.${hit.type}`)}
          </span>
        )}
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
