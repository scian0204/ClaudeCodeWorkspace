import fs from 'node:fs';
import path from 'node:path';

// Encode an absolute path into the CLI's ~/.claude/projects/<slug> dir name.
// Rule verified from the CLI bundle: replace every non-alphanumeric char with '-'.
export function encodeSlug(absPath: string): string {
  return absPath.replace(/[^a-zA-Z0-9]/g, '-');
}

// Rewrite the top-level `cwd` field of one jsonl transcript line to the server-side project path,
// so `resume` finds a transcript whose cwd matches the runtime cwd. Everything else is preserved.
// Unparseable lines are returned verbatim (be lenient — never corrupt the transcript).
export function rewriteCwd(line: string, newCwd: string): string {
  const s = line.trim();
  if (!s) return line;
  try {
    const obj = JSON.parse(s);
    if (obj && typeof obj === 'object' && 'cwd' in obj && typeof obj.cwd === 'string') {
      obj.cwd = newCwd;
      return JSON.stringify(obj);
    }
    return line;
  } catch { return line; }
}

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: any; output?: string; isError?: boolean };

const META_TYPES = new Set(['custom-title', 'mode', 'attachment', 'summary', 'system', 'file-history-snapshot']);

function textFrom(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((b) => b?.type === 'text').map((b) => b.text).join('');
  return '';
}

// Walk transcript lines in order, rebuilding the workspace message rows the chat UI renders.
// Mirrors session-manager.runReal's block mapping: a turn's assistant text/tool_use blocks accumulate
// into one assistant message; tool_result lines merge output into the matching tool_use block; a real
// human user line flushes the pending assistant message then emits a user message.
export function jsonlToMessages(
  lines: string[], _sessionId: string, baseTs = 0,
): Array<{ role: 'user' | 'assistant'; content: any; createdAt: number }> {
  const out: Array<{ role: 'user' | 'assistant'; content: any; createdAt: number }> = [];
  let buf: Block[] = [];
  const toolIndex = new Map<string, number>();
  let seq = 0;
  const nextTs = (ts?: string) => {
    const t = ts ? Date.parse(ts) : NaN;
    return Number.isFinite(t) ? t : baseTs + (seq++);
  };
  const flush = (ts: number) => {
    if (buf.length) { out.push({ role: 'assistant', content: { blocks: buf }, createdAt: ts }); buf = []; toolIndex.clear(); }
  };

  for (const raw of lines) {
    const s = raw.trim(); if (!s) continue;
    let m: any; try { m = JSON.parse(s); } catch { continue; }
    if (!m || m.isSidechain === true || META_TYPES.has(m.type)) continue;
    const ts = nextTs(m.timestamp);
    if (m.type === 'assistant') {
      for (const b of m.message?.content || []) {
        if (b.type === 'text') buf.push({ type: 'text', text: b.text });
        else if (b.type === 'tool_use') { toolIndex.set(b.id, buf.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input }) - 1); }
      }
    } else if (m.type === 'user') {
      const content = m.message?.content;
      let mergedOnly = false;
      if (Array.isArray(content)) {
        const results = content.filter((b) => b?.type === 'tool_result');
        for (const r of results) {
          const idx = toolIndex.get(r.tool_use_id);
          if (idx != null) { (buf[idx] as any).output = typeof r.content === 'string' ? r.content : JSON.stringify(r.content); (buf[idx] as any).isError = !!r.is_error; }
        }
        mergedOnly = results.length > 0 && !content.some((b) => b?.type === 'text');
      }
      if (mergedOnly) continue; // tool_result-only line: merged, no message
      const text = textFrom(content);
      if (!text) continue;
      flush(ts);
      out.push({ role: 'user', content: { text }, createdAt: ts });
    }
  }
  flush(baseTs + (seq++));
  return out;
}

// A claude/ slot holds exactly one <slug>/ dir (the ~/.claude/projects/<slug> the user picked).
// The browser folder picker prepends the picked folder's name, so the jsonl may sit one level
// deeper — probe the slot, its direct children, and grandchildren for the dir holding *.jsonl.
export function findSlugDir(claudeSlot: string): string | null {
  if (!fs.existsSync(claudeSlot)) return null;
  const hasJsonl = (d: string) => fs.readdirSync(d).some((f) => f.endsWith('.jsonl'));
  if (hasJsonl(claudeSlot)) return claudeSlot;
  for (const e of fs.readdirSync(claudeSlot, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const inner = path.join(claudeSlot, e.name);
    if (hasJsonl(inner)) return inner;
    for (const e2 of fs.readdirSync(inner, { withFileTypes: true })) {
      if (!e2.isDirectory()) continue;
      const g = path.join(inner, e2.name);
      if (hasJsonl(g)) return g;
    }
  }
  return null;
}

export function originalCwdFromSlug(slugDir: string): string | null {
  for (const f of fs.readdirSync(slugDir)) {
    if (!f.endsWith('.jsonl')) continue;
    for (const line of fs.readFileSync(path.join(slugDir, f), 'utf8').split('\n')) {
      try { const o = JSON.parse(line); if (typeof o?.cwd === 'string') return o.cwd; } catch { /* skip */ }
    }
  }
  return null;
}

export function listSessions(slugDir: string): Array<{ uuid: string; title: string; mtime: number; msgCount: number }> {
  const out: Array<{ uuid: string; title: string; mtime: number; msgCount: number }> = [];
  for (const f of fs.readdirSync(slugDir)) {
    if (!f.endsWith('.jsonl')) continue;
    const uuid = f.replace(/\.jsonl$/, '');
    const full = path.join(slugDir, f);
    const lines = fs.readFileSync(full, 'utf8').split('\n').filter(Boolean);
    let title = uuid;
    for (const line of lines) { try { const o = JSON.parse(line); if (o?.type === 'custom-title' && o.customTitle) { title = String(o.customTitle); break; } } catch { /* skip */ } }
    out.push({ uuid, title, mtime: fs.statSync(full).mtimeMs, msgCount: jsonlToMessages(lines, uuid).length });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}
