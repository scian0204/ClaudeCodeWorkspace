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

// CLI plumbing the transcript files under a "user" line: the local-command caveat, slash-command
// wrappers, captured stdout, injected reminders. Nobody typed any of it into the chat, so it is not
// conversation — importing it verbatim leaves XML noise in the thread and can even become the
// generated title. A line is dropped only when NOTHING but these tags is left.
const CLI_TAGS = 'local-command-caveat|local-command-stdout|local-command-stderr|command-name|command-message|command-args|system-reminder';
function isCliPlumbing(text: string): boolean {
  return !text.replace(new RegExp(`<(${CLI_TAGS})>[\\s\\S]*?</\\1>`, 'g'), '').trim();
}

// One kind of plumbing IS worth keeping: a slash command the user ran. The CLI files it as tag soup,
// while the workspace stores the plain `/name args` its own composer sent — and the chat folds the
// history above an imported /clear or /compact only if it sees that plain form (Chat.tsx boundaryCmd).
// Rewrite it so the fold works and other commands read as commands instead of markup.
function slashCommand(text: string): string | null {
  const name = text.match(/<command-name>\s*(\/[^<\s]+)\s*<\/command-name>/);
  if (!name) return null;
  const args = (text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1] || '').trim();
  return args ? `${name[1]} ${args}` : name[1];
}

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
    // isMeta marks a line the CLI injected on the user's behalf (caveat, skill preamble, image
    // dimensions, "Continue from where you left off") — never something the user wrote.
    if (!m || m.isSidechain === true || m.isMeta === true || META_TYPES.has(m.type)) continue;
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
      // only a pure-plumbing line is rewritten or dropped — a real message that quotes a tag stands
      const plumbing = isCliPlumbing(text);
      const cmd = plumbing ? slashCommand(text) : null;
      if (plumbing && !cmd) continue;
      flush(ts);
      out.push({ role: 'user', content: { text: cmd ?? text }, createdAt: ts });
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

// The user's side of a transcript, oldest first — what the chat was actually about, with Claude's
// replies and tool noise left out. Feeds both the picker snippet and the model titling prompt.
export function userTexts(msgs: ReturnType<typeof jsonlToMessages>, limit: number): string[] {
  const out: string[] = [];
  for (const m of msgs) {
    if (m.role !== 'user') continue;
    const t = String((m.content as any)?.text || '').trim();
    if (/^\/[a-z][\w:-]*(\s|$)/i.test(t)) continue; // a slash command is never what the chat is about
    if (t) out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

// Shared title sanitizer: first non-empty line, stripped of the wrappers a model (or a markdown
// first message) leads with, capped at maxChars. Also used by claude/auto-title.ts.
export function cleanTitle(raw: string, maxChars: number): string {
  const line = String(raw || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  return line
    .replace(/^[#>*\-\s]+/, '')            // markdown heading / bullet lead-in
    .replace(/^["'`“”「『]+/, '')
    .replace(/["'`“”」』.。!?！？]+$/, '')
    .trim()
    .slice(0, maxChars)
    .trim();
}

export type ImportSessionMeta = { uuid: string; title: string; custom: boolean; mtime: number; msgCount: number };

// `custom` marks a title the user set in the CLI (a `custom-title` line) — those are never re-titled
// on import. Everything else is named after its own conversation instead of showing a raw uuid.
export function listSessions(slugDir: string, maxChars: number): ImportSessionMeta[] {
  const out: ImportSessionMeta[] = [];
  for (const f of fs.readdirSync(slugDir)) {
    if (!f.endsWith('.jsonl')) continue;
    const uuid = f.replace(/\.jsonl$/, '');
    const full = path.join(slugDir, f);
    const lines = fs.readFileSync(full, 'utf8').split('\n').filter(Boolean);
    let title = '';
    for (const line of lines) { try { const o = JSON.parse(line); if (o?.type === 'custom-title' && o.customTitle) { title = String(o.customTitle); break; } } catch { /* skip */ } }
    const custom = !!title;
    const msgs = jsonlToMessages(lines, uuid);
    if (!title) title = cleanTitle(userTexts(msgs, 1)[0] || '', maxChars);
    out.push({ uuid, title: title || uuid, custom, mtime: fs.statSync(full).mtimeMs, msgCount: msgs.length });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}
