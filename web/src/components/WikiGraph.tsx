import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { useT } from '../lib/i18n';
import { useIsMobile } from '../lib/ui';
import { layout, bounds, scaleFor, type GraphEdge, type GraphNode } from '../lib/wikigraph';
import { IconFolder, IconRefresh } from '../lib/icons';
import { Modal } from './Modal';

// The compiled articles of a wiki topic drawn as a link graph (the Obsidian view): one dot per
// article, a line for every cross-link the compile wrote. Clicking a dot hands the path back to the
// explorer, which opens that article in its file viewer — so this is a way IN to the wiki, not a
// separate reader. Nothing is stored: the server re-reads the links out of wiki/ on each open.
export function WikiGraph({ topicId, onClose, onFiles, onOpenFile }: {
  topicId: string; onClose: () => void; onFiles: () => void; onOpenFile: (path: string) => void;
}) {
  const t = useT();
  const isMobile = useIsMobile();
  const [data, setData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 }); // zoom + pan of the whole drawing
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const panned = useRef(false); // a pan that ended on a dot must not also open that article
  const svgRef = useRef<SVGSVGElement>(null);

  const load = async () => {
    setLoading(true);
    try { setData(await api.get(`/api/wiki/topics/${topicId}/graph`)); }
    catch (e: any) { useStore.getState().setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [topicId]);

  // the layout is the expensive part (see wikigraph.ts) — run it once per fetched graph
  const placed = useMemo(() => (data ? layout(data.nodes, data.edges) : []), [data]);
  const pos = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);
  const box = useMemo(() => bounds(placed), [placed]);
  // articles one link away from the hovered one — everything else fades so a dense wiki stays readable
  const near = useMemo(() => {
    if (!hover || !data) return null;
    const s = new Set<string>([hover]);
    for (const e of data.edges) { if (e.source === hover) s.add(e.target); else if (e.target === hover) s.add(e.source); }
    return s;
  }, [hover, data]);

  // Zoom about the middle of the drawing, so repeated zooming does not walk off toward one corner.
  const zoomBy = (f: number) => setView((v) => {
    const k = Math.min(6, Math.max(0.3, v.k * f));
    return { k, x: v.x + (box.w / 2) * (1 / v.k - 1 / k), y: v.y + (box.h / 2) * (1 / v.k - 1 / k) };
  });
  // A phone screen fits the same drawing into a third of the width, which leaves the labels too
  // small to read — start it zoomed in and let the reader drag around instead.
  useEffect(() => { if (placed.length && isMobile) zoomBy(1.6); }, [placed]);

  const dim = (id: string) => (near && !near.has(id) ? 0.12 : 1);
  const scale = scaleFor(placed.length);                     // dots/labels sized to the spacing
  const radius = (deg: number) => scale * (1 + Math.min(7, deg) * 0.12);

  // px the pointer moved -> viewBox units, so a drag tracks the cursor at any zoom
  const unitsPerPx = () => (svgRef.current ? box.w / view.k / Math.max(1, svgRef.current.clientWidth) : 1);

  return (
    <Modal
      open fullscreen onOpenChange={(o) => { if (!o) onClose(); }}
      title={t('wikiGraph.title')}
      titleExtra={
        <div className="flex items-center gap-2">
          <button className="pill !px-2.5" title={t('wikiGraph.zoomOut')} onClick={() => zoomBy(1 / 1.3)}>−</button>
          <button className="pill !px-2.5" title={t('wikiGraph.zoomIn')} onClick={() => zoomBy(1.3)}>+</button>
          <button className="pill inline-flex items-center gap-1" onClick={() => setView({ k: 1, x: 0, y: 0 })}>
            <IconRefresh size={12} /><span className="hidden md:inline">{t('wikiGraph.reset')}</span>
          </button>
          <button className="pill inline-flex items-center gap-1" onClick={onFiles}>
            <IconFolder size={13} />{t('wikiGraph.filesTab')}
          </button>
        </div>
      }>
      <div className="flex items-center gap-2 mb-2 text-[11px] text-txt3 flex-wrap">
        {data && <span>{t('wikiGraph.stat', { nodes: String(data.nodes.length), edges: String(data.edges.length) })}</span>}
        <span>{t(isMobile ? 'wikiGraph.hintTouch' : 'wikiGraph.hint')}</span>
        {data?.truncated && <span className="text-warn">{t('wikiGraph.truncated')}</span>}
      </div>
      <div className="border border-line rounded bg-bg h-[78vh] overflow-hidden touch-none">
        {loading && <div className="text-txt3 text-xs p-3">{t('fileExplorer.loading')}</div>}
        {!loading && !placed.length && <div className="text-txt3 text-xs p-3">{t('wikiGraph.empty')}</div>}
        {!loading && !!placed.length && (
          <svg
            ref={svgRef}
            className="w-full h-full select-none"
            viewBox={`${box.x + view.x} ${box.y + view.y} ${box.w / view.k} ${box.h / view.k}`}
            preserveAspectRatio="xMidYMid meet"
            onWheel={(e) => zoomBy(e.deltaY < 0 ? 1.15 : 0.87)}
            onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; panned.current = false; (e.target as Element).setPointerCapture?.(e.pointerId); }}
            onPointerMove={(e) => {
              const d = drag.current; if (!d) return;
              if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) panned.current = true;
              const u = unitsPerPx();
              setView((v) => ({ ...v, x: d.vx - (e.clientX - d.x) * u, y: d.vy - (e.clientY - d.y) * u }));
            }}
            onPointerUp={() => { drag.current = null; }}
            onPointerLeave={() => { drag.current = null; setHover(null); }}>
            {data!.edges.map((e, i) => {
              const a = pos.get(e.source), b = pos.get(e.target);
              if (!a || !b) return null;
              const lit = !near || (near.has(e.source) && near.has(e.target));
              const w = Math.max(1, scale * 0.12);
              return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--line-2)" strokeWidth={lit ? w : w * 0.7} opacity={lit ? 0.9 : 0.12} />;
            })}
            {placed.map((p) => (
              <g key={p.id} opacity={dim(p.id)} className="cursor-pointer"
                onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)}
                onClick={() => { if (!panned.current) onOpenFile(p.id); }}>
                <title>{p.id}</title>
                <circle cx={p.x} cy={p.y} r={radius(p.deg)} fill={p.deg ? 'var(--clay)' : 'var(--txt-3)'}
                  stroke="var(--panel)" strokeWidth={scale * 0.15} />
                <text x={p.x} y={p.y + radius(p.deg) + scale * 1.4} textAnchor="middle" fontSize={scale * 1.15}
                  fill={hover === p.id ? 'var(--clay)' : 'var(--txt-2)'}>{p.label}</text>
              </g>
            ))}
          </svg>
        )}
      </div>
    </Modal>
  );
}
