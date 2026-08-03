import path from 'node:path';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../auth/index.js';
import { paths, ensure, ensureUserLayout } from '../lib/paths.js';
import { newId } from '../lib/ids.js';
import { cfg } from '../lib/config-registry.js';
import {
  encodeSlug, rewriteCwd, jsonlToMessages, findSlugDir, listSessions, originalCwdFromSlug, userTexts,
} from '../lib/session-import.js';
import { autoTitleImported } from '../claude/auto-title.js';
import { emitToUser } from '../realtime/io.js';

// ── path sanitizers (deliberately duplicated from wiki.ts — small, keeps routes decoupled) ──
function safeSeg(n: string): string {
  const s = String(n).normalize('NFC').replace(/[\x00-\x1f/\\]/g, '').trim();
  return /^\.+$/.test(s) ? '' : s;
}
function validSid(sid: string) { return /^[A-Za-z0-9_-]{8,64}$/.test(String(sid)); }
function safeRelPath(rel: string): string {
  return String(rel).split(/[/\\]/).map(safeSeg).filter((s) => s && s !== '.' && s !== '..').join('/');
}
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

// project name sanitizer — same regex as projects.ts
function safeName(n: string) { return String(n).replace(/[^a-zA-Z0-9._ -]/g, '').trim() || 'project'; }
// tail segment of an absolute path (the folder name), separator-agnostic
function tailOf(cwd: string | null): string {
  if (!cwd) return '';
  return cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
}
// pick a not-yet-existing dir name under root (name, name-2, name-3, …)
function uniqueDir(root: string, name: string): { dir: string; name: string } {
  let n = name, i = 2;
  while (fs.existsSync(path.join(root, n))) { n = `${name}-${i++}`; }
  return { dir: path.join(root, n), name: n };
}
// whitelist the slot segment — never trust the client to name a staging subdir (traversal)
function slotOf(q: any): 'claude' | 'project' { return q?.slot === 'claude' ? 'claude' : 'project'; }

// feature flag gate — admins can disable local session import entirely (admin panel: features).
// Returns true (and sends 403) when disabled, so callers can `if (importOff(reply)) return;`.
function importOff(reply: any): boolean {
  if (cfg.bool('sessionImportEnabled')) return false;
  reply.code(403).send({ error: 'session import is disabled' });
  return true;
}

// staged import uploads that never got confirmed (crash between upload and confirm) are transient —
// wipe the whole staging area at startup. Nothing in it survives a restart anyway.
export function reapImportStaging() {
  try { fs.rmSync(paths.importStagingRoot, { recursive: true, force: true }); } catch { /* noop */ }
}

export async function importRoutes(app: FastifyInstance) {
  // upload files into a staging slot (project | claude). Each file's relative path rides the part
  // field name (folder drops), so nested trees at any depth are recreated. Per-user (requireAuth).
  app.post('/api/import/staging/:sid/files', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (importOff(reply)) return;
    const { sid } = req.params as any;
    if (!validSid(sid)) return reply.code(400).send({ error: 'bad staging id' });
    const slot = slotOf(req.query);
    const dir = path.join(paths.importStaging(sid), slot); ensure(dir);
    for await (const part of (req as any).parts()) {
      if (part.type !== 'file') continue;
      const buf = await part.toBuffer();
      const rel = safeRelPath(part.fieldname || part.filename);
      if (!rel) continue;
      const dest = path.join(dir, rel);
      ensure(path.dirname(dest));
      fs.writeFileSync(dest, buf);
    }
    return { files: walkFiles(dir) };
  });

  // remove one staged file by relative path — path in ?path= so nested paths survive
  app.delete('/api/import/staging/:sid/file', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (importOff(reply)) return;
    const { sid } = req.params as any;
    if (!validSid(sid)) return reply.code(400).send({ error: 'bad staging id' });
    const slot = slotOf(req.query);
    const dir = path.join(paths.importStaging(sid), slot);
    const rel = safeRelPath(String((req.query as any).path || ''));
    if (rel) { try { fs.rmSync(path.join(dir, rel), { force: true }); } catch { /* noop */ } }
    return { files: walkFiles(dir) };
  });

  // discard the whole staging area — cancel
  app.delete('/api/import/staging/:sid', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (importOff(reply)) return;
    const { sid } = req.params as any;
    if (!validSid(sid)) return reply.code(400).send({ error: 'bad staging id' });
    try { fs.rmSync(paths.importStaging(sid), { recursive: true, force: true }); } catch { /* noop */ }
    return { ok: true };
  });

  // list the discovered Claude sessions in the uploaded .claude slot (before confirm)
  app.get('/api/import/staging/:sid/sessions', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (importOff(reply)) return;
    const { sid } = req.params as any;
    if (!validSid(sid)) return reply.code(400).send({ error: 'bad staging id' });
    const claudeSlot = path.join(paths.importStaging(sid), 'claude');
    const slugDir = findSlugDir(claudeSlot);
    if (!slugDir) return { found: false };
    const originalCwd = originalCwdFromSlug(slugDir);
    return {
      found: true, originalCwd, projectTail: tailOf(originalCwd),
      sessions: listSessions(slugDir, cfg.int('autoTitleMaxChars')),
    };
  });

  // confirm import — place project dir, place cwd-rewritten jsonl into the user's slug dir,
  // create chat_sessions rows + backfill messages. Server computes the slug from the resolved
  // destination path; client paths are never trusted.
  app.post('/api/import/sessions', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (importOff(reply)) return;
    const body = (req.body || {}) as any;
    const sid = String(body.sid || '');
    if (!validSid(sid)) return reply.code(400).send({ error: 'bad staging id' });
    ensureUserLayout(u.id);
    const now = Date.now();

    const claudeSlot = path.join(paths.importStaging(sid), 'claude');
    const projectSlot = path.join(paths.importStaging(sid), 'project');
    const slugDir = findSlugDir(claudeSlot);
    const orig = slugDir ? originalCwdFromSlug(slugDir) : null;
    const tail = tailOf(orig) || 'imported';
    const name0 = safeName(String(body.projectName || tail));

    // place the project working dir
    const { dir: dest, name } = uniqueDir(paths.userProjects(u.id), name0);
    ensure(path.dirname(dest));
    if (fs.existsSync(projectSlot) && fs.readdirSync(projectSlot).length) fs.renameSync(projectSlot, dest);
    else ensure(dest);
    const project = { id: newId(), scope: 'user', ownerId: u.id, name, path: dest, createdAt: now };
    db.insert(schema.projects).values(project).run();

    // server-side slug dir where the CLI will look for this project's transcripts on resume
    const serverCwd = path.resolve(dest);
    const serverSlug = encodeSlug(serverCwd);
    const projDir = path.join(paths.userClaude(u.id), 'projects', serverSlug);
    ensure(projDir);

    // copy shared side-material (project-level memory) once
    if (slugDir && fs.existsSync(path.join(slugDir, 'memory'))) {
      fs.cpSync(path.join(slugDir, 'memory'), path.join(projDir, 'memory'), { recursive: true });
    }

    const metaByUuid = new Map((slugDir ? listSessions(slugDir, cfg.int('autoTitleMaxChars')) : []).map((m) => [m.uuid, m]));
    const sessionUuids: string[] = Array.isArray(body.sessionUuids) ? body.sessionUuids.map(String) : [];
    const sessions: { id: string; title: string }[] = [];
    // transcripts the CLI never named: queue a model pass over their conversation once the response
    // is out, so the first-message snippet we store now gets upgraded to a real title
    const digestMax = cfg.int('importAutoTitleMessages');
    const toTitle: { sessionId: string; text: string; prevTitle: string }[] = [];
    for (const uuid of sessionUuids) {
      const src = slugDir ? path.join(slugDir, uuid + '.jsonl') : '';
      if (!slugDir || !fs.existsSync(src)) continue;
      const lines = fs.readFileSync(src, 'utf8').split('\n');
      // rewrite each line's cwd to the server project path so resume finds a matching transcript
      fs.writeFileSync(path.join(projDir, uuid + '.jsonl'), lines.map((l) => rewriteCwd(l, serverCwd)).join('\n'));
      // per-session side dir (e.g. tool state) if present
      const sub = path.join(slugDir, uuid);
      if (fs.existsSync(sub)) fs.cpSync(sub, path.join(projDir, uuid), { recursive: true });

      const meta = metaByUuid.get(uuid);
      const title = meta?.title || uuid;
      const chatId = newId();
      db.insert(schema.chatSessions).values({
        id: chatId, ownerId: u.id, kind: 'private', roomId: null, title,
        projectId: project.id, wikiTopicId: null, claudeSessionId: uuid,
        model: cfg.str('defaultModel'), effort: cfg.str('defaultEffort'), permissionMode: 'default', createdAt: now, updatedAt: now,
      }).run();
      const msgs = jsonlToMessages(lines, chatId, now);
      for (const msg of msgs) {
        db.insert(schema.messages).values({
          id: newId(), sessionId: chatId, role: msg.role,
          authorId: msg.role === 'user' ? u.id : null,
          authorName: msg.role === 'user' ? u.displayName : 'Claude',
          content: JSON.stringify(msg.content), chat: 0, createdAt: msg.createdAt,
        }).run();
      }
      // a title the user set in the CLI is theirs — only the snippet-named ones get re-titled
      if (!meta?.custom) {
        const text = userTexts(msgs, digestMax).join('\n---\n');
        if (text) toTitle.push({ sessionId: chatId, text, prevTitle: title });
      }
      sessions.push({ id: chatId, title });
    }

    try { fs.rmSync(paths.importStaging(sid), { recursive: true, force: true }); } catch { /* noop */ }

    // Off the response path — the import must not wait on N model calls. Sequential on purpose: a
    // big import would otherwise fan out one Claude subprocess per session at once. Each finished
    // title reaches the importer's tabs over `session:title`.
    if (toTitle.length) void (async () => {
      for (const p of toTitle) {
        await autoTitleImported({
          ...p, ownerId: u.id, cwd: serverCwd,
          emit: (event, payload) => emitToUser(u.id, event, payload),
        }).catch(() => { /* titling is cosmetic — the snippet title stands */ });
      }
    })();

    return { project, sessions };
  });
}
