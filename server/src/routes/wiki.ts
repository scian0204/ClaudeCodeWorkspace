import path from 'node:path';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth, requireAdmin } from '../auth/index.js';
import { paths, ensure } from '../lib/paths.js';
import { newId } from '../lib/ids.js';
import { compileTopic } from '../wiki/compile.js';

// Sanitize ONE path segment. Keep unicode filenames (Korean, Japanese, etc.); only strip path
// separators + control chars and normalize NFD->NFC. macOS sends decomposed Hangul (U+1100 jamo),
// which the old [가-힣]=U+AC00–D7A3 whitelist stripped entirely — collapsing Korean folder names
// to '' (files fell to the parent) or dropping the Korean part of mixed names.
function safeSeg(n: string): string {
  const s = String(n).normalize('NFC').replace(/[\x00-\x1f/\\]/g, '').trim();
  return /^\.+$/.test(s) ? '' : s;
}
function isText(n: string) { return /\.(md|markdown|txt|json|ya?ml|csv|tsv)$/i.test(n); }
function validSid(sid: string) { return /^[A-Za-z0-9_-]{8,64}$/.test(String(sid)); }

// sanitize a client-supplied relative path (folder drops) segment-by-segment — blocks
// traversal (.., absolute, drive) and keeps the nested structure under the staging/topic root.
function safeRelPath(rel: string): string {
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
    `- \`./raw/\` — 원본 소스(불변). wiki가 부족할 때만 보조로 참고.\n\n` +
    `## 답변 규칙 (LLM-Wiki query mode)\n` +
    `- 먼저 \`./wiki/_index.md\`를 읽고, 관련 아티클로 이동해라.\n` +
    `- 그 내용에 **근거해서만** 답하고, 근거가 된 아티클/파일명(+신뢰도 표기가 있으면 함께)을 밝혀라.\n` +
    `- 근거에 없는 내용은 추측하지 말고 "이 위키에는 해당 내용이 없습니다"라고 답하라.\n` +
    `- 사용자가 명시적으로 요청하지 않는 한 파일을 수정/생성하지 마라 (읽기 전용 질의).\n`;
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
    const id = newId();
    const dir = paths.wikiTopic(id);
    const rawDir = path.join(dir, 'raw');
    ensure(dir);
    const staged = sid && validSid(sid) ? paths.wikiStaging(sid) : '';
    if (staged && fs.existsSync(staged)) {
      fs.renameSync(staged, rawDir); // staged tree becomes the immutable raw/ sources
    } else {
      ensure(rawDir);
    }
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), groundingDoc(name, description));
    const row = {
      id, name, description, path: dir, createdBy: u.id, createdAt: Date.now(),
      compileStatus: 'idle' as const, compiledAt: null, compileError: null,
    };
    db.insert(schema.wikiTopics).values(row).run();
    void compileTopic(id); // auto-compile raw/ -> wiki/ (async; status via 'wiki:status' socket)
    return { topic: row };
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

  // full file tree of a topic (any user) — paths + sizes only (no content), for the explorer
  app.get('/api/wiki/topics/:id/tree', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const t = getTopic(id); if (!t) return reply.code(404).send({ error: 'not found' });
    return {
      raw: walkFiles(path.join(t.path, 'raw')),
      wiki: walkFiles(path.join(t.path, 'wiki')),
      status: t.compileStatus, compiledAt: t.compiledAt,
    };
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

  // add more source files to a topic (admin) — into raw/, then recompile
  app.post('/api/wiki/topics/:id/files', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!requireAdmin(req, reply)) return;
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
    void compileTopic(id); // sources changed -> recompile
    return { sources: walkFiles(rawDir).map((f) => f.name) };
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
        projectId: null, wikiTopicId: id, claudeSessionId: null, model: 'claude-opus-4-8',
        permissionMode: 'default', createdAt: now, updatedAt: now,
      };
      db.insert(schema.chatSessions).values(row).run();
      s = row as any;
    }
    return { session: s, messages: loadMessages(s!.id) };
  });
}
