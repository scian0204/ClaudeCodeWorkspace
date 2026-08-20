import { create } from 'zustand';
import { api } from './api';
import type { Block } from './store';

// LLM-Wiki citations: which knowledge files an assistant turn actually consulted (via Read),
// resolved to a topic-relative {dir,path}. Used to (a) list sources in the right panel and
// (b) highlight/preview the same files where they're mentioned in the answer text.

export type CiteDir = 'wiki' | 'raw';
export interface WikiSource { dir: CiteDir; path: string }

export const citeId = (s: WikiSource) => `${s.dir}::${s.path}`;
export const parseCiteId = (id: string): WikiSource => {
  const i = id.indexOf('::');
  return { dir: id.slice(0, i) as CiteDir, path: id.slice(i + 2) };
};
export const citeBase = (p: string) => p.split('/').pop() || p;

// Resolve a Read `file_path` (absolute under the topic cwd, or cwd-relative) to a topic
// source. The topic dir is named by topicId, so we split on `/<topicId>/`; that avoids
// hardcoding the data-root prefix. Anything not under wiki//raw/ (e.g. CLAUDE.md) is not a source.
export function resolveSource(filePath: string, topicId: string): WikiSource | null {
  if (!filePath) return null;
  let rest = String(filePath).replace(/\\/g, '/');
  const marker = `/${topicId}/`;
  const i = rest.indexOf(marker);
  if (i >= 0) rest = rest.slice(i + marker.length);
  rest = rest.replace(/^\.?\//, '');
  if (rest.startsWith('wiki/')) return { dir: 'wiki', path: rest.slice(5) };
  if (rest.startsWith('raw/')) return { dir: 'raw', path: rest.slice(4) };
  return null;
}

// wiki//raw/ file paths the model wrote in prose. Filenames may carry spaces/unicode, so we
// anchor non-greedily on a known text/doc/image extension. Fenced code is stripped first (yml
// examples reference build paths, not knowledge sources).
const CITE_PATH_RE = /\b(wiki|raw)\/[^\n]{1,200}?\.(?:md|markdown|txt|json|ya?ml|csv|tsv|png|jpe?g|gif|webp|bmp|svg)\b/gi;
function textSources(text: string): WikiSource[] {
  const body = text.replace(/```[\s\S]*?```/g, '');
  const out: WikiSource[] = [];
  for (const m of body.matchAll(CITE_PATH_RE)) {
    const dir = m[1].toLowerCase() as CiteDir;
    out.push({ dir, path: m[0].slice(dir.length + 1) });
  }
  return out;
}

// Sources an assistant turn cited: files it opened via Read (reliable) plus wiki//raw/ paths it
// named in the answer text (deduped, Read-first order).
export function extractSources(blocks: Block[], topicId: string, tree: TopicTree | null = null): WikiSource[] {
  const seen = new Set<string>();
  const out: WikiSource[] = [];
  const push = (found: WikiSource | null) => {
    if (!found) return;
    const s = realPath(tree, found); // snapped to the real path, or dropped when no file backs it
    if (!s) return;
    const id = citeId(s);
    if (seen.has(id)) return;
    seen.add(id); out.push(s);
  };
  for (const b of blocks) {
    if (b.type === 'tool_use' && b.name === 'Read' && !b.isError) push(resolveSource(String(b.input?.file_path || ''), topicId));
    else if (b.type === 'text') for (const s of textSources(b.text)) push(s);
  }
  return out;
}

// Paths the model wrote in prose are approximate — it normalizes whitespace, so a filename with a
// double space won't match on disk, and it can name a file that does not exist at all. Both are
// resolved against the topic's real file list: an approximate path is snapped to the real one, and
// anything with no file behind it is dropped rather than listed as a source nobody can open.
export interface TopicTree { raw: string[]; wiki: string[] }
const normPath = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

export function realPath(tree: TopicTree | null, src: WikiSource): WikiSource | null {
  if (!tree) return src; // list not loaded yet — show it; the filter re-runs when it lands
  const list = src.dir === 'wiki' ? tree.wiki : tree.raw;
  if (list.includes(src.path)) return src;
  const nP = normPath(src.path);
  const nB = normPath(citeBase(src.path));
  const hit = list.find((x) => normPath(x) === nP) || list.find((x) => normPath(citeBase(x)) === nB);
  return hit ? { dir: src.dir, path: hit } : null;
}

// Shared UI state: which citation is highlighted (hover sync) and which is previewed (click).
interface CiteUI {
  hovered: string | null;
  preview: WikiSource | null;
  trees: Record<string, TopicTree>;   // topicId -> every file the topic actually has
  setHovered: (id: string | null) => void;
  openPreview: (s: WikiSource | null) => void;
  loadTree: (topicId: string) => void;
}
const loading = new Set<string>();
export const useCite = create<CiteUI>((set, get) => ({
  hovered: null, preview: null, trees: {},
  setHovered: (id) => set({ hovered: id }),
  openPreview: (s) => set({ preview: s }),
  // Fetched once per topic per page load, and again whenever the sources panel mounts — a compile
  // or a captured note changes the list rarely enough that this is plenty.
  loadTree: (topicId) => {
    if (!topicId || loading.has(topicId)) return;
    loading.add(topicId);
    api.get(`/api/wiki/topics/${topicId}/paths`)
      .then((r: any) => set({ trees: { ...get().trees, [topicId]: { raw: r.raw || [], wiki: r.wiki || [] } } }))
      .catch(() => { /* leave it unset — sources render unfiltered rather than vanishing */ })
      .finally(() => loading.delete(topicId));
  },
}));

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Wrap textual mentions of each source (full `dir/path`, bare path, or basename) in the rendered
// markdown with a hoverable/clickable <mark data-src=id>. Skips fenced code (<pre>) and text
// already wrapped, so it's safe to re-run. Longest candidate wins at each position.
export function markCitations(root: HTMLElement, sources: WikiSource[]): void {
  if (!sources.length) return;
  const lookup = new Map<string, string>();
  for (const s of sources) {
    const id = citeId(s);
    for (const cand of [`${s.dir}/${s.path}`, s.path, citeBase(s.path)]) {
      if (cand.length >= 3 && !lookup.has(cand)) lookup.set(cand, id);
    }
  }
  const cands = [...lookup.keys()].sort((a, b) => b.length - a.length);
  if (!cands.length) return;
  const re = new RegExp(cands.map(esc).join('|'), 'g');

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
      re.lastIndex = 0;
      if (!re.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
      const p = (n.parentElement as HTMLElement | null)?.closest('pre, mark.wiki-cite');
      return p ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  const targets: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) targets.push(n as Text);

  for (const node of targets) {
    const text = node.nodeValue!;
    const frag = document.createDocumentFragment();
    let last = 0; re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const mark = document.createElement('mark');
      mark.className = 'wiki-cite';
      mark.dataset.src = lookup.get(m[0]) || '';
      mark.textContent = m[0];
      frag.appendChild(mark);
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode!.replaceChild(frag, node);
  }
}

// One delegated set of listeners for every in-text citation mark (marks are injected via
// innerHTML, so they can't carry React handlers). Hover syncs highlight; click opens the preview.
if (typeof document !== 'undefined' && !(window as any).__wikiCiteBound) {
  (window as any).__wikiCiteBound = true;
  const src = (e: Event) => (e.target as HTMLElement)?.closest?.('mark.wiki-cite') as HTMLElement | null;
  document.addEventListener('mouseover', (e) => { const m = src(e); if (m) useCite.getState().setHovered(m.dataset.src || null); });
  document.addEventListener('mouseout', (e) => { if (src(e)) useCite.getState().setHovered(null); });
  document.addEventListener('click', (e) => {
    const m = src(e); if (!m?.dataset.src) return;
    useCite.getState().openPreview(parseCiteId(m.dataset.src));
  });
}
