// Lane layout for the Git panel's history graph. Kept out of the component so it is testable with
// plain `npx tsx` (see gitgraph.test.ts) — it is the one part with real logic in it.

export interface Commit {
  hash: string; short: string; parents: string[];
  author: string; email: string; date: string; subject: string; refs: string[];
}

export interface GraphRow {
  c: Commit;
  lane: number;      // which lane the dot sits in
  merges: number[];  // lanes this commit's extra parents leave in, drawn downward from the dot
  joins: number[];   // lanes collapsing into this commit, drawn as diagonals coming in from above
  up: number[];      // lanes with a vertical line above the dot's row-centre
  down: number[];    // lanes with a vertical line below it
}

// Walks the (topo-ordered) list newest-first. Each commit takes the lane a child already reserved
// for it, or the leftmost free one; its first parent inherits that lane and every further parent (a
// merge) claims one of its own. Lanes hold the hash they are waiting for, so a commit reached from
// two lanes collapses them — without that the extra lane would never retire and the graph would
// creep rightwards forever.
export function layout(commits: Commit[]): GraphRow[] {
  const active: (string | null)[] = [];
  const rows: GraphRow[] = [];
  const free = () => { const i = active.indexOf(null); return i < 0 ? active.length : i; };
  for (const c of commits) {
    const before = active.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
    let lane = active.indexOf(c.hash);
    if (lane < 0) lane = free();
    const joins: number[] = [];
    for (let i = 0; i < active.length; i++) if (i !== lane && active[i] === c.hash) { active[i] = null; joins.push(i); }
    active[lane] = c.parents[0] || null; // first parent keeps the lane
    const merges: number[] = [];
    for (const p of c.parents.slice(1)) {
      let l = active.indexOf(p);
      if (l < 0) { l = free(); active[l] = p; }
      merges.push(l);
    }
    while (active.length && active[active.length - 1] === null) active.pop(); // retire trailing lanes
    rows.push({
      c, lane, merges, joins,
      up: (before.includes(lane) ? before : [...before, lane].sort((a, b) => a - b)).filter((i) => !joins.includes(i)),
      down: active.map((x, i) => (x ? i : -1)).filter((i) => i >= 0),
    });
  }
  return rows;
}

// Widest lane any row touches — the SVG column width every row shares.
export function laneCount(rows: GraphRow[]): number {
  return rows.reduce((m, r) => Math.max(m, r.lane, ...r.down, ...r.merges, ...r.joins), 0) + 1;
}
