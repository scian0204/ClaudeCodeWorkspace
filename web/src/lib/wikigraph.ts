// Placement for the LLM Wiki link graph (WikiGraph.tsx). Kept out of the component so it is
// testable with plain `npx tsx` (see wikigraph.test.ts) — it is the one part with real logic in it.
//
// Force-directed (Fruchterman-Reingold): linked articles pull together, everything pushes apart,
// and a weak pull to the middle keeps articles nothing links to from drifting into the corners.
// Deterministic — the start positions are a fixed spiral, so the same wiki always draws the same
// way instead of jumping around on every open.

export interface GraphNode { id: string; label: string; deg: number }
export interface GraphEdge { source: string; target: string }
export interface PlacedNode extends GraphNode { x: number; y: number }

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// ponytail: every pair pushes every pair, so a tick is O(nodes^2) — fine to a few hundred articles,
// which is what `wikiGraphMaxNodes` caps the endpoint at. Past that it wants a quadtree (Barnes-Hut).
export function layout(nodes: GraphNode[], edges: GraphEdge[], size = 1000): PlacedNode[] {
  const n = nodes.length;
  if (!n) return [];
  const at = new Map(nodes.map((nd, i) => [nd.id, i]));
  const links: [number, number][] = [];
  for (const e of edges) {
    const a = at.get(e.source), b = at.get(e.target);
    if (a !== undefined && b !== undefined && a !== b) links.push([a, b]);
  }
  const mid = size / 2;
  const x = new Float64Array(n), y = new Float64Array(n);
  for (let i = 0; i < n; i++) {                       // sunflower spiral: spread out, no randomness
    const r = mid * Math.sqrt((i + 0.5) / n), a = i * GOLDEN_ANGLE;
    x[i] = mid + r * Math.cos(a); y[i] = mid + r * Math.sin(a);
  }
  const k = Math.sqrt((size * size) / n);             // the distance the layout aims for per node
  const iters = n <= 120 ? 300 : n <= 250 ? 180 : 120; // fewer passes as the per-pass cost grows
  const dx = new Float64Array(n), dy = new Float64Array(n);
  for (let it = 0; it < iters; it++) {
    dx.fill(0); dy.fill(0);
    for (let i = 0; i < n; i++) {                     // repulsion between every pair
      for (let j = i + 1; j < n; j++) {
        let ex = x[i] - x[j], ey = y[i] - y[j];
        let d = Math.hypot(ex, ey);
        if (d < 0.01) { ex = ((i % 7) + 1) * 0.01; ey = ((j % 5) + 1) * 0.01; d = Math.hypot(ex, ey); }
        const f = (k * k) / d;
        dx[i] += (ex / d) * f; dy[i] += (ey / d) * f;
        dx[j] -= (ex / d) * f; dy[j] -= (ey / d) * f;
      }
    }
    for (const [a, b] of links) {                     // attraction along the links
      const ex = x[a] - x[b], ey = y[a] - y[b];
      const d = Math.max(0.01, Math.hypot(ex, ey));
      const f = (d * d) / k;
      dx[a] -= (ex / d) * f; dy[a] -= (ey / d) * f;
      dx[b] += (ex / d) * f; dy[b] += (ey / d) * f;
    }
    const temp = (size / 10) * (1 - it / iters);      // cooling: big moves first, fine ones last
    for (let i = 0; i < n; i++) {
      dx[i] += (mid - x[i]) * 0.08;                   // gravity, so islands stay on screen
      dy[i] += (mid - y[i]) * 0.08;
      const d = Math.max(0.01, Math.hypot(dx[i], dy[i]));
      const step = Math.min(d, temp);
      x[i] = Math.min(size, Math.max(0, x[i] + (dx[i] / d) * step));
      y[i] = Math.min(size, Math.max(0, y[i] + (dy[i] / d) * step));
    }
  }
  return nodes.map((nd, i) => ({ ...nd, x: x[i], y: y[i] }));
}

// Dot / label size in layout units. The frame is the same 1000 units whatever the wiki holds, so a
// fixed radius draws pinheads on a five-article topic and a solid blob on a four-hundred-article one
// — this tracks the spacing the layout aims for instead, clamped to what stays readable on screen.
export function scaleFor(n: number): number {
  const k = Math.sqrt((1000 * 1000) / Math.max(1, n));
  return Math.min(18, Math.max(6, k * 0.06));
}

// Drawing box of a placed graph, padded so labels and circles are not clipped by the viewBox.
export function bounds(placed: PlacedNode[], pad = 60): { x: number; y: number; w: number; h: number } {
  if (!placed.length) return { x: 0, y: 0, w: 1, h: 1 };
  const xs = placed.map((p) => p.x), ys = placed.map((p) => p.y);
  const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
  return { x: x0, y: y0, w: Math.max(1, Math.max(...xs) + pad - x0), h: Math.max(1, Math.max(...ys) + pad - y0) };
}
