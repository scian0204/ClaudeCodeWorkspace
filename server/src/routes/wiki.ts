import path from 'node:path';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth, requireAdmin } from '../auth/index.js';
import { paths, ensure } from '../lib/paths.js';
import { newId } from '../lib/ids.js';
import { compileTopic } from '../wiki/compile.js';
import { applySeed, type Seed, type SeedType } from '../wiki/seed.js';
import { pendingProposals, decideProposal, getProposal } from '../wiki/learn.js';
import { canAccessProject, getProject } from './projects.js';
import * as rooms from '../rooms/manager.js';
import { cfg } from '../lib/config-registry.js';
import { listDir } from '../lib/filetree.js';

// Sanitize ONE path segment. Keep unicode filenames (Korean, Japanese, etc.); only strip path
// separators + control chars and normalize NFD->NFC. macOS sends decomposed Hangul (U+1100 jamo),
// which the old [가-힣]=U+AC00–D7A3 whitelist stripped entirely — collapsing Korean folder names
// to '' (files fell to the parent) or dropping the Korean part of mixed names.
function safeSeg(n: string): string {
  const s = String(n).normalize('NFC').replace(/[\x00-\x1f/\\]/g, '').trim();
  return /^\.+$/.test(s) ? '' : s;
}
export function isText(n: string) { return /\.(md|markdown|txt|json|ya?ml|csv|tsv)$/i.test(n); }
function validSid(sid: string) { return /^[A-Za-z0-9_-]{8,64}$/.test(String(sid)); }

// sanitize a client-supplied relative path (folder drops) segment-by-segment — blocks
// traversal (.., absolute, drive) and keeps the nested structure under the staging/topic root.
export function safeRelPath(rel: string): string {
  return String(rel).split(/[/\\]/).map(safeSeg).filter((s) => s && s !== '.' && s !== '..').join('/');
}

// recursively list every file under dir (all depths), returning root-relative paths + sizes
function walkFiles(dir: string, base = ''): { name: string; size: number }[] {
  if (!fs.existsSync(dir)) return [];
  const out: { name: string; size: number }[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(full, rel));
    else { let size = 0; try { size = fs.statSync(full).size; } catch { /* noop */ } out.push({ name: rel, size }); }
  }
  return out;
}
function listStaged(dir: string) { return walkFiles(dir); }

// Map staged relative paths to their destination when importing an ALREADY-COMPILED wiki
// (compile step skipped). Two source shapes are normalized to the topic's raw//wiki/ layout:
//   - a topic-export dir (has a top-level wiki/, optionally raw/) -> wiki/*->wiki, raw/*->raw
//   - a bare articles folder -> everything goes under wiki/
// A single wrapper dir shared by every path (the folder picker prepends the dropped folder's
// name) is stripped first, so `MyWiki/_index.md` lands at wiki/_index.md, not wiki/MyWiki/....
// Pure (no fs) so the path logic is testable in isolation. Stray top-level files (e.g. a
// bundled CLAUDE.md) are dropped — the grounding doc is regenerated per topic.
export function mapPrecompiled(rels: string[]): { rel: string; dir: 'raw' | 'wiki'; destRel: string }[] {
  if (!rels.length) return [];
  const first = rels[0].split('/')[0];
  const wrapper = first && rels.every((r) => r.split('/')[0] === first && r.includes('/')) ? first : null;
  const stripped = rels.map((r) => ({ orig: r, rel: wrapper ? r.slice(wrapper.length + 1) : r }));
  const hasWiki = stripped.some(({ rel }) => rel === 'wiki' || rel.startsWith('wiki/'));
  const out: { rel: string; dir: 'raw' | 'wiki'; destRel: string }[] = [];
  for (const { orig, rel } of stripped) {
    if (!hasWiki) { if (rel) out.push({ rel: orig, dir: 'wiki', destRel: rel }); continue; }
    if (rel.startsWith('wiki/')) out.push({ rel: orig, dir: 'wiki', destRel: rel.slice(5) });
    else if (rel.startsWith('raw/')) out.push({ rel: orig, dir: 'raw', destRel: rel.slice(4) });
    // else: stray top-level file -> dropped
  }
  return out.filter((x) => x.destRel);
}

// Move a staged tree into a topic as a precompiled wiki (see mapPrecompiled), then drop staging.
function placePrecompiled(stagedDir: string, topicDir: string) {
  for (const { rel, dir, destRel } of mapPrecompiled(walkFiles(stagedDir).map((f) => f.name))) {
    const dest = path.join(topicDir, dir, destRel);
    ensure(path.dirname(dest));
    fs.renameSync(path.join(stagedDir, rel), dest);
  }
  try { fs.rmSync(stagedDir, { recursive: true, force: true }); } catch { /* noop */ }
}

// staged uploads that never got confirmed (crash between upload and create) are transient —
// wipe the whole staging area at startup. Nothing in it survives a restart anyway.
export function reapWikiStaging() {
  try { fs.rmSync(paths.wikiStagingRoot, { recursive: true, force: true }); } catch { /* noop */ }
}

// remove topic dirs on disk with no matching DB row (leftovers from deletes before dirs were
// removed, or a crash between mkdir and insert). Runs at boot.
export function reapWikiOrphans() {
  try {
    if (!fs.existsSync(paths.wiki)) return;
    const ids = new Set(db.select({ id: schema.wikiTopics.id }).from(schema.wikiTopics).all().map((r) => r.id));
    for (const name of fs.readdirSync(paths.wiki)) {
      if (name === '.staging' || ids.has(name)) continue;
      try { fs.rmSync(path.join(paths.wiki, name), { recursive: true, force: true }); } catch { /* noop */ }
    }
  } catch { /* noop */ }
}

function getTopic(id: string) {
  return db.select().from(schema.wikiTopics).where(eq(schema.wikiTopics.id, id)).get();
}
const LEARN_MODES = ['off', 'ask', 'auto'];
function learnMode(v: unknown): string { return LEARN_MODES.includes(String(v)) ? String(v) : 'off'; }

// May this user hand THIS chat's transcript to a wiki (which every member can then read)?
// Deliberately stricter than routes/sessions canViewChat, for the same reason search.ts is: an
// admin being able to open one private thread is not the same permission as copying it into a
// shared knowledge base. Own private chats, or a room the caller belongs to.
function canSeedFromChat(u: { id: string; role: string }, s: typeof schema.chatSessions.$inferSelect): boolean {
  if (s.kind === 'room') return u.role === 'admin' || rooms.isMember(s.roomId!, u.id);
  if (s.kind === 'private') return s.ownerId === u.id;
  return false; // review threads carry PR content — not a knowledge source
}
function loadMessages(sessionId: string) {
  return db.select().from(schema.messages).where(eq(schema.messages.sessionId, sessionId))
    .orderBy(schema.messages.createdAt).all().map((m) => ({ ...m, content: JSON.parse(m.content) }));
}

// Written into the topic dir as CLAUDE.md. Claude Code auto-loads it as project memory
// (settingSources includes 'project'), which is how the "LLM Wiki skill" is applied here:
// answers are grounded in the compiled knowledge base, read-only.
function groundingDoc(name: string, description: string) {
  return `# LLM Wiki — ${name}\n\n${description ? description + '\n\n' : ''}` +
    `이 디렉터리는 "${name}" 주제의 지식 기반(knowledge base)입니다.\n\n` +
    `## 구조\n` +
    `- \`./wiki/\` — 컴파일된 합성 아티클 + \`_index.md\`(진입점 인덱스). **답변의 1차 근거.**\n` +
    `- \`./raw/\` — 원본 소스(불변). wiki가 부족할 때만 보조로 참고.\n` +
    `- \`./wiki/conversations/\` — 이 위키를 두고 오간 대화에서 추려 넣은 지식(원본은 \`./raw/conversations/\`).\n\n` +
    `## 답변 규칙 (LLM-Wiki query mode)\n` +
    `- 먼저 \`./wiki/_index.md\`를 읽고, 관련 아티클로 이동해라.\n` +
    `- 그 내용에 **근거해서만** 답하고, 근거가 된 아티클/파일명(+신뢰도 표기가 있으면 함께)을 밝혀라.\n` +
    `- 근거에 없는 내용은 추측하지 말고 "이 위키에는 해당 내용이 없습니다"라고 답하라.\n` +
    `- 도표·스크린샷 등 시각 자료가 관련되면, 아티클이 인용한 \`raw/\`의 이미지(.png/.jpg 등)를 Read로 직접 열어(너는 멀티모달) 확인해서 답하라.\n` +
    `- 사용자가 명시적으로 요청하지 않는 한 파일을 수정/생성하지 마라 (읽기 전용 질의).\n` +
    `- 사용자가 지식 추가를 명시적으로 요청하면 \`llm-wiki\` 스킬을 읽고 거기 적힌 절차대로만 파일을 써라.\n` +
    `  (이 스레드에는 워크스페이스 공통 플러그인이 적용되지 않는다 — 그 스킬 하나가 전부다.)\n`;
}

// Create an empty wiki topic (no staged sources) and kick off compilation. Reused by the
// member-request approval framework (admin/requests.ts `wiki_topic` action) — createdBy is the
// requesting member, so an approved topic is attributed to whoever asked for it.
export function createWikiTopic(opts: { name: string; description?: string; createdBy: string; autoLearn?: string }) {
  const name = String(opts.name || '').trim() || '새 주제';
  const description = String(opts.description || '');
  const id = newId();
  const dir = paths.wikiTopic(id);
  const rawDir = path.join(dir, 'raw');
  ensure(dir); ensure(rawDir);
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), groundingDoc(name, description));
  const row = {
    id, name, description, path: dir, createdBy: opts.createdBy, createdAt: Date.now(),
    compileStatus: 'idle' as const, compiledAt: null, compileError: null,
    autoLearn: learnMode(opts.autoLearn),
  };
  db.insert(schema.wikiTopics).values(row).run();
  void compileTopic(id); // async; status via 'wiki:status' socket
  return row;
}

export async function wikiRoutes(app: FastifyInstance) {
  // list topics (any authenticated user)
  app.get('/api/wiki/topics', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const topics = db.select().from(schema.wikiTopics).orderBy(desc(schema.wikiTopics.createdAt)).all();
    return { topics };
  });

  // upload files into a staging area (admin) — before the topic is confirmed.
  // Client carries each file's relative path in the part filename (folder drops), so nested
  // trees at any depth are recreated. No type filter — every file in the tree is kept.
  // ponytail: one request per drop, per-file 50MB cap; a giant drop is one big streamed request.
  app.post('/api/wiki/staging/:sid/files', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!requireAdmin(req, reply)) return;
    const { sid } = req.params as any;
    if (!validSid(sid)) return reply.code(400).send({ error: 'bad staging id' });
    const dir = paths.wikiStaging(sid); ensure(dir);
    for await (const part of (req as any).parts()) {
      if (part.type !== 'file') continue;
      const buf = await part.toBuffer();
      const rel = safeRelPath(part.fieldname || part.filename); // rel path carried in field name (not basenamed)
      if (!rel) continue;
      const dest = path.join(dir, rel);
      ensure(path.dirname(dest));
      fs.writeFileSync(dest, buf);
    }
    return { files: listStaged(dir) };
  });

  // remove one staged file by relative path (admin) — path in ?path= so nested paths survive
  app.delete('/api/wiki/staging/:sid/file', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!requireAdmin(req, reply)) return;
    const { sid } = req.params as any;
    if (!validSid(sid)) return reply.code(400).send({ error: 'bad staging id' });
    const rel = safeRelPath(String((req.query as any).path || ''));
    if (rel) { try { fs.rmSync(path.join(paths.wikiStaging(sid), rel), { force: true }); } catch { /* noop */ } }
    return { files: listStaged(paths.wikiStaging(sid)) };
  });

  // discard the whole staging area (admin) — cancel
  app.delete('/api/wiki/staging/:sid', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!requireAdmin(req, reply)) return;
    const { sid } = req.params as any;
    if (!validSid(sid)) return reply.code(400).send({ error: 'bad staging id' });
    try { fs.rmSync(paths.wikiStaging(sid), { recursive: true, force: true }); } catch { /* noop */ }
    return { ok: true };
  });

  // create topic (admin) — JSON { name, description, stagingId }; moves staged files in
  app.post('/api/wiki/topics', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!requireAdmin(req, reply)) return;
    const b = (req.body || {}) as any;
    const name = String(b.name || '').trim() || '새 주제';
    const description = String(b.description || '');
    const sid = b.stagingId ? String(b.stagingId) : '';
    // precompiled: the upload IS an already-compiled wiki — skip Claude compile, use it as-is
    const precompiled = b.precompiled === true || b.precompiled === 'true';
    // Where the first sources come from: an upload (staging, the original flow), an existing chat
    // or project already in the workspace, or nothing at all (제로베이스).
    const seed: Seed = { type: (String(b.seedType || 'upload') as SeedType), sessionId: b.seedSessionId, projectId: b.seedProjectId };
    if (!['upload', 'session', 'project', 'blank'].includes(seed.type)) return reply.code(400).send({ error: 'bad seed type' });
    if (seed.type === 'session') {
      const src = seed.sessionId
        ? db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, String(seed.sessionId))).get() : undefined;
      if (!src) return reply.code(404).send({ error: 'seed session not found' });
      if (!canSeedFromChat(u, src)) return reply.code(403).send({ error: 'forbidden' });
    }
    if (seed.type === 'project') {
      const src = seed.projectId ? getProject(String(seed.projectId)) : undefined;
      if (!src) return reply.code(404).send({ error: 'seed project not found' });
      if (!canAccessProject(u, src)) return reply.code(403).send({ error: 'forbidden' });
    }
    const id = newId();
    const dir = paths.wikiTopic(id);
    const rawDir = path.join(dir, 'raw');
    ensure(dir);
    const staged = sid && validSid(sid) ? paths.wikiStaging(sid) : '';
    if (staged && fs.existsSync(staged)) {
      if (precompiled) {
        ensure(rawDir); // may stay empty (import may carry only wiki/)
        placePrecompiled(staged, dir); // staged tree -> wiki/ (+ raw/ if it's a topic export)
      } else {
        fs.renameSync(staged, rawDir); // staged tree becomes the immutable raw/ sources
      }
    } else {
      ensure(rawDir);
    }
    // seeding from a chat/project writes into the same raw/ the upload path fills, so the compile
    // below is unchanged — it just has sources it did not have to be uploaded
    if (seed.type === 'session' || seed.type === 'project') applySeed(dir, seed);
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), groundingDoc(name, description));
    const compileStatus: 'done' | 'idle' = precompiled ? 'done' : 'idle';
    const row = {
      id, name, description, path: dir, createdBy: u.id, createdAt: Date.now(),
      compileStatus, compiledAt: precompiled ? Date.now() : null, compileError: null,
      autoLearn: learnMode(b.autoLearn),
    };
    db.insert(schema.wikiTopics).values(row).run();
    if (!precompiled) void compileTopic(id); // auto-compile raw/ -> wiki/ (async; status via 'wiki:status' socket)
    return { topic: row };
  });

  // edit a topic's own settings (admin) — JSON { name?, description?, autoLearn? }. autoLearn is the
  // only one with behaviour behind it: it decides what a finished turn does with new knowledge.
  app.patch('/api/wiki/topics/:id', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as any;
    const t = getTopic(id); if (!t) return reply.code(404).send({ error: 'not found' });
    const b = (req.body || {}) as any;
    const patch: any = {};
    if ('name' in b) { const n = String(b.name || '').trim(); if (n) patch.name = n; }
    if ('description' in b) patch.description = String(b.description || '');
    if ('autoLearn' in b) patch.autoLearn = learnMode(b.autoLearn);
    if (!Object.keys(patch).length) return { topic: t };
    db.update(schema.wikiTopics).set(patch).where(eq(schema.wikiTopics.id, id)).run();
    // the grounding doc carries the name/description, so keep it in step with the row
    if (patch.name || 'description' in patch) {
      const next = { ...t, ...patch };
      try { fs.writeFileSync(path.join(t.path, 'CLAUDE.md'), groundingDoc(next.name, next.description)); } catch { /* noop */ }
    }
    return { topic: { ...t, ...patch } };
  });

  // knowledge additions the learner parked for this session ('ask' mode) — the chat shows a card
  // per pending one. Scoped to a session the caller may actually read.
  app.get('/api/wiki/proposals', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const sessionId = String((req.query as any)?.sessionId || '');
    if (!sessionId) return { proposals: [] };
    const s = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, sessionId)).get();
    if (!s) return { proposals: [] };
    if (!(s.kind === 'room' ? (u.role === 'admin' || rooms.isMember(s.roomId!, u.id)) : (s.ownerId === u.id || u.role === 'admin'))) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    return { proposals: pendingProposals(sessionId) };
  });

  // accept / discard one parked addition — JSON { accept: boolean }. Whoever can send a turn in the
  // originating session can decide it: they are the person who was just told about it.
  app.post('/api/wiki/proposals/:pid/decide', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { pid } = req.params as any;
    const row = getProposal(String(pid));
    if (!row) return reply.code(404).send({ error: 'not found' });
    const s = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, row.sessionId)).get();
    const allowed = !!s && (s.kind === 'room' ? (u.role === 'admin' || rooms.isMember(s.roomId!, u.id)) : (s.ownerId === u.id || u.role === 'admin'));
    if (!allowed) return reply.code(403).send({ error: 'forbidden' });
    const accept = (req.body as any)?.accept !== false;
    const r = decideProposal(String(pid), accept);
    if (!r.ok) return reply.code(409).send({ error: 'already decided' });
    return { ok: true, accepted: accept };
  });

  // knowledge files of a topic (any user) — compiled wiki/ articles (fallback to raw/ sources)
  app.get('/api/wiki/topics/:id/files', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const t = getTopic(id); if (!t) return reply.code(404).send({ error: 'not found' });
    const wikiDir = path.join(t.path, 'wiki');
    const rawDir = path.join(t.path, 'raw');
    const useWiki = walkFiles(wikiDir).length > 0;
    const baseDir = useWiki ? wikiDir : rawDir;
    const files = walkFiles(baseDir).map(({ name }) => {
      const full = path.join(baseDir, name);
      let content = '';
      if (isText(name)) {
        try {
          const st = fs.statSync(full);
          content = st.size <= 200_000 ? fs.readFileSync(full, 'utf8') : `(파일이 큽니다: ${st.size} bytes — 생략)`;
        } catch { /* unreadable */ }
      } else content = '(비텍스트 파일)';
      return { name, content };
    });
    return {
      files, source: useWiki ? 'wiki' : 'raw',
      status: t.compileStatus, compiledAt: t.compiledAt, compileError: t.compileError,
      sources: walkFiles(rawDir).map((f) => f.name),
    };
  });

  // ONE directory level of a topic (any user) — ?dir=raw|wiki & ?path=<relative>. The explorer walks
  // down folder by folder instead of pulling a whole tree it may never show.
  app.get('/api/wiki/topics/:id/tree', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const t = getTopic(id); if (!t) return reply.code(404).send({ error: 'not found' });
    const q = req.query as any;
    const dir = q?.dir === 'wiki' ? 'wiki' : 'raw';
    const rel = String(q?.path || '').trim();
    if (rel.split('/').includes('..')) return reply.code(400).send({ error: 'bad path' });
    return { ...listDir(path.join(t.path, dir), rel, { limit: cfg.int('fileTreeMaxEntries') }), status: t.compileStatus, compiledAt: t.compiledAt };
  });

  // one file's content (any user) — ?dir=raw|wiki & ?path=<relative>, text only
  app.get('/api/wiki/topics/:id/file', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const t = getTopic(id); if (!t) return reply.code(404).send({ error: 'not found' });
    const q = req.query as any;
    const dir = q.dir === 'wiki' ? 'wiki' : 'raw';
    const rel = safeRelPath(String(q.path || ''));
    if (!rel) return reply.code(400).send({ error: 'bad path' });
    const full = path.join(t.path, dir, rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return reply.code(404).send({ error: 'not found' });
    const st = fs.statSync(full);
    if (!isText(rel)) return { name: rel, size: st.size, content: '(비텍스트 파일 — 미리보기 없음)' };
    const content = st.size <= 500_000 ? fs.readFileSync(full, 'utf8') : `(파일이 큽니다: ${st.size} bytes — 생략)`;
    return { name: rel, size: st.size, content };
  });

  // raw file bytes (any user) — for <img> preview; ?dir=raw|wiki & ?path=<relative>
  app.get('/api/wiki/topics/:id/blob', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const t = getTopic(id); if (!t) return reply.code(404).send({ error: 'not found' });
    const q = req.query as any;
    const dir = q.dir === 'wiki' ? 'wiki' : 'raw';
    const rel = safeRelPath(String(q.path || ''));
    if (!rel) return reply.code(400).send({ error: 'bad path' });
    const full = path.join(t.path, dir, rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return reply.code(404).send({ error: 'not found' });
    const ext = (rel.split('.').pop() || '').toLowerCase();
    const CT: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
    };
    reply.header('Content-Type', CT[ext] || 'application/octet-stream');
    reply.header('Cache-Control', 'private, max-age=60');
    return reply.send(fs.createReadStream(full));
  });

  // add more source files to an existing topic (admin) — into raw/, overwriting same-path files.
  // No auto-recompile: the client uploads ONE request per file (api.uploadFiles), so recompiling
  // here would fire N times — the inflight guard drops all but the first, which may have started
  // before the later files landed (stale wiki/). The client recompiles once after the batch.
  app.post('/api/wiki/topics/:id/files', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!requireAdmin(req, reply)) return;
    if (!cfg.bool('wikiSourceEditEnabled')) return reply.code(403).send({ error: 'wiki source editing is disabled' });
    const { id } = req.params as any;
    const t = getTopic(id); if (!t) return reply.code(404).send({ error: 'not found' });
    const rawDir = path.join(t.path, 'raw'); ensure(rawDir);
    for await (const part of (req as any).parts()) {
      if (part.type !== 'file') continue;
      const buf = await part.toBuffer();
      const rel = safeRelPath(part.fieldname || part.filename);
      if (!rel) continue;
      const dest = path.join(rawDir, rel);
      ensure(path.dirname(dest));
      fs.writeFileSync(dest, buf);
    }
    return { sources: walkFiles(rawDir).map((f) => f.name) };
  });

  // edit one existing source file in place (admin) — JSON { path, content }, raw/ text files only.
  // wiki/ is NOT editable: every compile wipes and regenerates it, so an edit there would vanish.
  // Like upload, this does not recompile — the client does it once when the admin is done editing.
  app.put('/api/wiki/topics/:id/file', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!requireAdmin(req, reply)) return;
    if (!cfg.bool('wikiSourceEditEnabled')) return reply.code(403).send({ error: 'wiki source editing is disabled' });
    const { id } = req.params as any;
    const t = getTopic(id); if (!t) return reply.code(404).send({ error: 'not found' });
    const b = (req.body || {}) as any;
    const rel = safeRelPath(String(b.path || ''));
    if (!rel) return reply.code(400).send({ error: 'bad path' });
    if (!isText(rel)) return reply.code(400).send({ error: 'not a text file' });
    if (typeof b.content !== 'string') return reply.code(400).send({ error: 'content required' });
    const max = cfg.int('wikiEditMaxKB') * 1024;
    if (Buffer.byteLength(b.content, 'utf8') > max) return reply.code(413).send({ error: `too large (max ${cfg.int('wikiEditMaxKB')}KB)` });
    const full = path.join(t.path, 'raw', rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return reply.code(404).send({ error: 'not found' });
    fs.writeFileSync(full, b.content, 'utf8');
    return { name: rel, size: fs.statSync(full).size };
  });

  // recompile a topic (admin) — regenerate wiki/ from raw/
  app.post('/api/wiki/topics/:id/recompile', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as any;
    const t = getTopic(id); if (!t) return reply.code(404).send({ error: 'not found' });
    void compileTopic(id);
    return { ok: true };
  });

  // delete topic (admin) — drops topic + every user's thread + messages + the topic dir on disk
  app.delete('/api/wiki/topics/:id', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as any;
    const t = getTopic(id); if (!t) return reply.code(404).send({ error: 'not found' });
    const threads = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.wikiTopicId, id)).all();
    for (const th of threads) {
      db.delete(schema.messages).where(eq(schema.messages.sessionId, th.id)).run();
      db.delete(schema.chatSessions).where(eq(schema.chatSessions.id, th.id)).run();
    }
    // ordinary sessions that had linked this topic lose the link (a dangling id would silently
    // resolve to nothing on every later turn), and its parked additions go with it
    db.update(schema.chatSessions).set({ wikiRefId: null }).where(eq(schema.chatSessions.wikiRefId, id)).run();
    db.delete(schema.wikiProposals).where(eq(schema.wikiProposals.topicId, id)).run();
    db.delete(schema.wikiTopics).where(eq(schema.wikiTopics.id, id)).run();
    try { fs.rmSync(t.path, { recursive: true, force: true }); } catch { /* noop */ } // remove raw/ + wiki/ from disk
    return { ok: true };
  });

  // get-or-create the caller's own private query thread under this topic
  app.get('/api/wiki/topics/:id/thread', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const t = getTopic(id); if (!t) return reply.code(404).send({ error: 'not found' });
    let s = db.select().from(schema.chatSessions)
      .where(and(eq(schema.chatSessions.wikiTopicId, id), eq(schema.chatSessions.ownerId, u.id))).get();
    if (!s) {
      const now = Date.now();
      const row = {
        id: newId(), ownerId: u.id, kind: 'private', roomId: null, title: t.name,
        projectId: null, wikiTopicId: id, claudeSessionId: null, model: cfg.str('defaultModel'),
        effort: cfg.str('defaultEffort'), permissionMode: 'default', createdAt: now, updatedAt: now,
      };
      db.insert(schema.chatSessions).values(row).run();
      s = row as any;
    }
    return { session: s, messages: loadMessages(s!.id) };
  });
}
