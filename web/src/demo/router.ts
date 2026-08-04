// Routes every /api/* request to canned data / in-memory mutations for the static demo.
// Called by the fetch + XHR interceptors in ./install. Returns a plain {status, data}.
import {
  db, ADMIN, ATTACHMENTS, GIT, PROVIDERS, COMMANDS, USAGE, TREE_PROJECT, TREE_PLUGIN, WIKI_ARTICLES, WIKI_RAW, WIKI_TREE_ARTICLES,
  REQUEST_ACTIONS, IMPORT_SESSIONS, fileContent, wikiFileContent, WIKI_RAW_EDITS, pluginDetail, EDITOR_URL, genId,
} from './data';

type Res = { status: number; data: any };
const ok = (data: any = {}): Res => ({ status: 200, data });
// A canned answer returns instantly, which hides whatever the UI shows while it waits. The few
// routes that are a model call on the real server keep their round-trip so the wait stays visible.
const slow = (r: Res, ms = 1400): Promise<Res> => new Promise((res) => setTimeout(() => res(r), ms));

// mirror the server's provider status shape + minimal per-type validation (so the demo shows errors)
function providerStatus(type: string, c: any) {
  return {
    type,
    fields: {
      baseUrl: c.baseUrl || '', region: c.region || '', projectId: c.projectId || '', model: c.model || '',
      hasAuthToken: !!c.authToken, hasApiKey: !!c.apiKey, hasAccessKeyId: !!c.accessKeyId,
      hasSecretKey: !!c.secretKey, hasSessionToken: !!c.sessionToken, hasBearerToken: !!c.bearerToken,
    },
  };
}
function providerError(type: string, c: any): string | null {
  if (type === 'custom' && !(c.baseUrl || '').trim()) return 'custom: base URL required (Anthropic-compatible endpoint)';
  if (type === 'bedrock') {
    if (!(c.region || '').trim()) return 'bedrock: AWS region required';
    if (!(c.bearerToken || '').trim() && !((c.accessKeyId || '').trim() && (c.secretKey || '').trim())) return 'bedrock: provide a bearer token, or an access key id + secret key';
  }
  if (type === 'vertex' && (!(c.region || '').trim() || !(c.projectId || '').trim())) return 'vertex: region + project id required';
  return null;
}

function sessionFor(id: string) {
  const s = db.sessions.find((x) => x.id === id);
  if (s) return { id: s.id, title: s.title, projectId: s.projectId, model: s.model, effort: s.effort || 'high', permissionMode: s.permissionMode };
  const room = db.rooms.find((r) => r.chatSessionId === id);
  if (room) return { id, title: room.name, projectId: null, model: 'claude-opus-4-8', effort: 'high', permissionMode: room.permissionMode };
  const w = db.wikiTopics.find((t) => `cs_${t.id}` === id);
  if (w) return { id, title: w.name, projectId: null, model: 'claude-opus-4-8', effort: 'high', permissionMode: 'default' };
  const rv = db.reviewSessions.find((x: any) => x.chatSessionId === id);
  if (rv) return { id, title: `#${rv.prNumber} ${rv.prTitle}`, projectId: null, model: 'claude-opus-4-8', effort: 'high', permissionMode: 'default' };
  return { id, title: 'New chat', projectId: null, model: 'claude-opus-4-8', effort: 'high', permissionMode: 'default' };
}
const msgs = (id: string) => (db.messages[id] || (db.messages[id] = []));

// ── unified search (demo) ──────────────────────────────────────────────────
// Same hit shape + group order as the real endpoint; visibility is trivial here (the demo user is
// an admin and every seed row belongs to them), so this only re-implements the matching + snippet.
const MIN_Q = 2;
const PER_TYPE = 8;
const hasText = (s: any, n: string) => typeof s === 'string' && s.toLowerCase().includes(n);
// flatten a message's content the way the server does: prose + tool name/input/output
function msgText(content: any): string {
  if (!content || typeof content !== 'object') return '';
  const parts: string[] = [];
  if (typeof content.text === 'string') parts.push(content.text);
  for (const b of Array.isArray(content.blocks) ? content.blocks : []) {
    if (b?.type === 'text') parts.push(String(b.text || ''));
    else if (b?.type === 'tool_use') parts.push(`${b.name || ''} ${JSON.stringify(b.input ?? '')} ${b.output || ''}`);
  }
  return parts.join('\n');
}
function snip(text: string, n: string, width = 180): string {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  const i = flat.toLowerCase().indexOf(n);
  if (i < 0) return flat.slice(0, width) + (flat.length > width ? '…' : '');
  const start = Math.max(0, i - Math.floor(width / 3));
  const end = Math.min(flat.length, start + width);
  return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '');
}
// which surface a chat-session id belongs to → the nav the client dispatches on
function chatNav(sessionId: string): { nav: any; label: string } | null {
  const s = db.sessions.find((x) => x.id === sessionId);
  if (s) return { nav: { kind: 'private', sessionId }, label: s.title };
  const r = db.rooms.find((x) => x.chatSessionId === sessionId);
  if (r) return { nav: { kind: 'room', roomId: r.id }, label: r.name };
  const w = db.wikiTopics.find((x) => `cs_${x.id}` === sessionId);
  if (w) return { nav: { kind: 'wiki', topicId: w.id }, label: w.name };
  const rv = db.reviewSessions.find((x: any) => x.chatSessionId === sessionId);
  if (rv) return { nav: { kind: 'review', reviewId: rv.id }, label: `#${rv.prNumber} ${rv.prTitle}` };
  return null;
}
function searchDemo(raw: string) {
  const q = raw.trim();
  if (q.length < MIN_Q) return { q, hits: [], minChars: MIN_Q };
  const n = q.toLowerCase();
  const hits: any[] = [];
  const cap = (type: string) => hits.reduce((a, h) => a + (h.type === type ? 1 : 0), 0) < PER_TYPE;

  for (const [sid, list] of Object.entries(db.messages)) {
    const ctx = chatNav(sid); if (!ctx) continue;
    for (const m of list as any[]) {
      if (!cap('chat')) break;
      const text = msgText(m.content);
      if (!hasText(text, n)) continue;
      hits.push({ type: 'chat', id: `chat:${m.id}`, title: ctx.label, subtitle: m.authorName || 'Claude',
        snippet: snip(text, n), ts: m.createdAt, nav: { ...ctx.nav, messageId: m.id } });
    }
  }
  for (const s of db.sessions) {
    if (!cap('session') || !hasText(s.title, n)) continue;
    hits.push({ type: 'session', id: `session:${s.id}`, title: s.title, ts: s.updatedAt, nav: { kind: 'private', sessionId: s.id } });
  }
  for (const r of db.rooms) {
    if (!cap('room') || !hasText(r.name, n)) continue;
    hits.push({ type: 'room', id: `room:${r.id}`, title: r.name, subtitle: r.members.map((m: any) => m.displayName).join(', '), nav: { kind: 'room', roomId: r.id } });
  }
  const chLabel = (c: any) => (c.kind === 'group' ? c.name || 'Group' : c.members.find((m: any) => m.userId !== db.me.id)?.displayName || 'DM');
  for (const [cid, list] of Object.entries(db.dmMessages)) {
    const c = db.dmChannels.find((x: any) => x.id === cid); if (!c) continue;
    for (const m of list as any[]) {
      if (!cap('dm') || !hasText(m.text, n)) continue;
      hits.push({ type: 'dm', id: `dm:${m.id}`, title: chLabel(c), subtitle: db.users.find((u: any) => u.id === m.userId)?.displayName || '',
        snippet: snip(m.text, n), ts: m.createdAt, nav: { kind: 'channel', channelId: cid } });
    }
  }
  for (const c of db.dmChannels) {
    if (!cap('channel') || !hasText(c.name, n)) continue;
    hits.push({ type: 'channel', id: `channel:${c.id}`, title: chLabel(c), subtitle: c.members.map((m: any) => m.displayName).join(', '), nav: { kind: 'channel', channelId: c.id } });
  }
  for (const p of [...db.projects.common, ...db.projects.mine, ...Object.values(db.roomProjects).flat()]) {
    if (!cap('project') || (!hasText(p.name, n) && !hasText(p.path, n))) continue;
    hits.push({ type: 'project', id: `project:${p.id}`, title: p.name, subtitle: p.path, nav: { kind: 'project', projectId: p.id } });
  }
  for (const w of db.wikiTopics) {
    if (!cap('wiki') || (!hasText(w.name, n) && !hasText(w.description, n))) continue;
    hits.push({ type: 'wiki', id: `wiki:${w.id}`, title: w.name, snippet: hasText(w.description, n) ? snip(w.description, n) : undefined,
      ts: w.createdAt, nav: { kind: 'wiki', topicId: w.id } });
  }
  for (const w of db.wikiTopics) {
    for (const [dir, files] of [['wiki', WIKI_ARTICLES], ['raw', WIKI_RAW]] as const) {
      for (const f of files as any[]) {
        if (!cap('wikiFile')) break;
        const body = dir === 'wiki' ? f.content : wikiFileContent('raw', f.name);
        if (!hasText(body, n) && !hasText(f.name, n)) continue;
        hits.push({ type: 'wikiFile', id: `wikiFile:${w.id}:${dir}:${f.name}`, title: f.name, subtitle: `${w.name} · ${dir}/`,
          snippet: hasText(body, n) ? snip(body, n) : undefined, nav: { kind: 'wikiFile', topicId: w.id, dir, filePath: f.name } });
      }
    }
  }
  for (const s of db.reviewSessions as any[]) {
    const blob = `#${s.prNumber} ${s.prTitle} ${s.repoName} ${s.authorLogin} ${s.verdictSummary || ''}`;
    if (!cap('review') || !hasText(blob, n)) continue;
    hits.push({ type: 'review', id: `review:${s.id}`, title: `#${s.prNumber} ${s.prTitle}`, subtitle: `${s.repoName} · ${s.authorLogin}`,
      snippet: hasText(s.verdictSummary, n) ? snip(s.verdictSummary, n) : undefined, ts: s.updatedAt, nav: { kind: 'review', reviewId: s.id } });
  }
  for (const u of db.users as any[]) {
    if (!cap('user') || u.id === db.me.id) continue;
    if (!hasText(u.displayName, n) && !hasText(u.username, n)) continue;
    hits.push({ type: 'user', id: `user:${u.id}`, title: u.displayName, subtitle: `@${u.username}`, nav: { kind: 'user', userId: u.id } });
  }
  return { q, hits, minChars: MIN_Q };
}

export function route(method: string, rawPath: string, body?: any): Res | Promise<Res> {
  const P = rawPath.split('?')[0];
  const query = new URLSearchParams(rawPath.split('?')[1] || '');
  const b = (() => { try { return typeof body === 'string' ? JSON.parse(body || '{}') : (body || {}); } catch { return {}; } })();
  const M = method.toUpperCase();
  const seg = P.split('/').filter(Boolean); // ['api', ...]
  const idAt = (i: number) => seg[i];

  // ---- auth ----
  if (P === '/api/auth/me' && M === 'PATCH') { if ('autoTitle' in b) db.me.autoTitle = !!b.autoTitle; if ('autoResume' in b) db.me.autoResume = !!b.autoResume; if ('primeWindow' in b) { db.me.primeWindow = !!b.primeWindow; if (b.primeWindow) db.me.primedAt = Date.now(); } return ok({ user: db.me }); }
  if (P === '/api/auth/me') return ok({ user: db.me });
  if (P === '/api/auth/login') return ok({ user: db.me });
  if (P === '/api/auth/logout') return ok({});
  if (P === '/api/auth/me/claude-token') { db.me.hasClaudeToken = M !== 'DELETE'; db.me.claudeTokenSetAt = M !== 'DELETE' ? Date.now() : null; return ok({ user: db.me }); }
  // avatar: store the picked image inline as a data URL (install.ts reads the File → b.avatarDataUrl);
  // avatarUrl() renders a data: URL directly, so no GET stream is needed in the demo.
  if (P === '/api/auth/me/avatar') { db.me.avatar = M === 'DELETE' ? null : (b.avatarDataUrl || db.me.avatar); return ok({ user: db.me }); }

  // ---- branding (custom logo + title) ----
  // Same inline-data-URL trick as the avatar: brandLogoUrl() renders a data: URL directly, so the demo
  // needs no GET stream. The title also lands in its config row so the registry list stays in step.
  if (P === '/api/brand') return ok(db.brand);
  if (P === '/api/admin/brand/logo') {
    db.brand.logo = M === 'DELETE' ? null : (b.brandLogoDataUrl || db.brand.logo);
    return ok(db.brand);
  }
  if (P === '/api/admin/brand' && M === 'PUT') {
    db.brand.title = String(b.title ?? '').trim();
    const it = ADMIN.config.find((x: any) => x.key === 'brandTitle');
    if (it) { it.value = db.brand.title; it.overridden = !!db.brand.title; }
    return ok(db.brand);
  }

  // ---- client-facing config (model dropdown) ----
  if (P === '/api/config') return ok({ models: ADMIN.models, defaultModel: ADMIN.defaultModel, defaultEffort: ADMIN.defaultEffort, sessionImportEnabled: true, llmProvidersEnabled: true, approvalsEnabled: true, dmEnabled: true, searchEnabled: true, customContextMenu: true, autoTitleEnabled: true, autoResumeEnabled: true, windowPrimerEnabled: true, gitPublishEnabled: true, wikiSourceEditEnabled: true, reviewWebhookEnabled: true, processPollMs: 5000 });

  // ---- unified search (mirrors server/src/routes/search.ts over the seed data) ----
  // `sort` is ignored on purpose: the seed data never hits the per-type cap for dated surfaces, so
  // returning every match is equivalent — the palette does the newest/oldest ordering client-side.
  if (P === '/api/search') return ok(searchDemo(String(query.get('q') || '')));

  // ---- member requests (approval workflow) ----
  if (P === '/api/requests/actions') return ok({ actions: REQUEST_ACTIONS });
  if (P === '/api/requests' && M === 'GET') return ok({ requests: db.requests }); // demo me is admin → all
  if (P === '/api/requests' && M === 'POST') {
    const req = { id: genId('req'), requesterId: db.me.id, type: String(b.type || ''), payload: JSON.stringify(b.payload || {}), reason: String(b.reason || ''), status: 'pending', reviewerId: null, decidedAt: null, result: null, createdAt: Date.now(), updatedAt: Date.now() };
    db.requests.unshift(req); return ok({ request: req });
  }
  if (seg[1] === 'requests' && seg[3] === 'decide' && M === 'POST') {
    const r: any = db.requests.find((x: any) => x.id === idAt(2));
    if (!r) return { status: 404, data: { error: 'not found' } };
    if (r.status !== 'pending') return { status: 400, data: { error: 'already decided' } };
    const approve = !!b.approve;
    r.status = approve ? 'approved' : 'rejected'; r.reviewerId = db.me.id; r.decidedAt = Date.now(); r.updatedAt = Date.now();
    if (approve) {
      const payload = (() => { try { return JSON.parse(r.payload || '{}'); } catch { return {}; } })();
      r.result = r.type === 'common_project' ? `공통 프로젝트 생성됨: ${payload.name || ''}`
        : r.type === 'wiki_topic' ? `위키 주제 생성됨: ${payload.name || ''}`
        : r.type === 'role_upgrade' ? `${db.me.username} 권한을 admin으로 승격`
        : '완료 (demo)';
    } else { r.result = b.note ? String(b.note) : null; }
    return ok({ request: r });
  }

  // ---- llm provider override (user self-service + admin common) ----
  if (P === '/api/auth/me/provider' || P === '/api/admin/provider') {
    const scope: 'user' | 'common' = P.includes('/admin/') ? 'common' : 'user';
    if (M === 'DELETE') { PROVIDERS[scope] = null; return ok({ provider: null }); }
    if (M === 'PUT') {
      const type = String(b.type || ''); const c = b.config || {};
      const err = providerError(type, c);
      if (err) return { status: 400, data: { error: err } };
      PROVIDERS[scope] = providerStatus(type, c);
      return ok({ provider: PROVIDERS[scope] });
    }
    return ok({ provider: PROVIDERS[scope] }); // GET
  }

  // ---- sessions ----
  if (P === '/api/sessions' && M === 'GET') return ok({ sessions: db.sessions });
  if (P === '/api/sessions' && M === 'POST') {
    const s = { id: genId('s'), title: 'New chat', updatedAt: Date.now(), projectId: null, model: 'claude-opus-4-8', effort: 'high', permissionMode: 'default' };
    db.sessions.unshift(s); db.messages[s.id] = []; return ok({ session: s });
  }
  if (seg[1] === 'sessions' && seg[3] === 'commands') return ok({ commands: COMMANDS });
  if (seg[1] === 'sessions' && seg[3] === 'usage') return ok({ usage: USAGE });
  if (seg[1] === 'sessions' && seg[3] === 'messages' && seg[5] === 'edit') {
    const list = msgs(idAt(2)); const i = list.findIndex((m) => m.id === idAt(4));
    if (i >= 0) list.splice(i); // drop the edited message and everything after (regenerate)
    return ok({ messages: list });
  }
  if (seg[1] === 'sessions' && seg[3] === 'messages' && M === 'DELETE') {
    const list = msgs(idAt(2)); const i = list.findIndex((m) => m.id === idAt(4)); if (i >= 0) list.splice(i, 1); return ok({});
  }
  // attachments: POST is really handled by the XHR interceptor (install.ts); GET/DELETE come through here
  if (seg[1] === 'sessions' && seg[3] === 'attachments') {
    const name = decodeURIComponent(idAt(4) || '');
    if (M === 'DELETE' && name) { ATTACHMENTS.delete(name); return ok({ ok: true }); }
    if (M === 'GET' && name) { const a = ATTACHMENTS.get(name); return a ? ok({ name, url: a.url, isImage: a.isImage }) : { status: 404, data: { error: 'not found' } }; }
    return ok({ files: [] });
  }
  // manual LLM naming — canned, but exercises the real store action, error path and socket handler.
  // Mirrors the server: a chat with nothing said in it yet is a 400, not a silent no-op.
  if (seg[1] === 'sessions' && seg[3] === 'retitle' && M === 'POST') {
    const s = db.sessions.find((x: any) => x.id === idAt(2));
    const first = String(msgs(idAt(2)).find((m: any) => m.role === 'user')?.content?.text || '').split('\n')[0].trim();
    if (!first) return { status: 400, data: { error: 'nothing to read yet — send a message first' } };
    const title = first.replace(/[?.!]+$/, '').slice(0, 40).trim();
    if (s) s.title = title;
    return slow(ok({ ok: true, title })); // one model round-trip on the real server → keep the wait
  }
  if (seg[1] === 'sessions' && seg[2] && M === 'GET') return ok({ session: sessionFor(idAt(2)), messages: msgs(idAt(2)) });
  if (seg[1] === 'sessions' && seg[2] && M === 'PATCH') {
    const s = db.sessions.find((x) => x.id === idAt(2)); if (s) Object.assign(s, b); return ok({});
  }
  if (seg[1] === 'sessions' && seg[2] && M === 'DELETE') {
    db.sessions = db.sessions.filter((x) => x.id !== idAt(2)); delete db.messages[idAt(2)]; return ok({});
  }

  // ---- rooms ----
  if (P === '/api/rooms' && M === 'GET') return ok({ rooms: db.rooms });
  if (P === '/api/rooms' && M === 'POST') {
    const cs = genId('cs');
    const r = { id: genId('r'), name: b.name || 'New room', ownerId: db.me.id, chatSessionId: cs, permissionMode: 'default',
      members: [{ userId: db.me.id, displayName: db.me.displayName, avatarColor: db.me.avatarColor, username: db.me.username, isOwner: true, delegations: [], joinedAt: Date.now() }] };
    db.rooms.unshift(r); db.messages[cs] = []; return ok({ room: r });
  }
  if (seg[1] === 'rooms' && seg[2] && seg.length === 3 && M === 'GET') {
    const r = db.rooms.find((x) => x.id === idAt(2)); return ok({ room: r, messages: r ? msgs(r.chatSessionId) : [] });
  }
  if (seg[1] === 'rooms' && seg[2] && seg.length === 3 && M === 'DELETE') { db.rooms = db.rooms.filter((x) => x.id !== idAt(2)); return ok({}); }
  if (seg[1] === 'rooms') return ok({}); // members / mode / project / transfer / delegation mutations

  // ---- projects ----
  if (P === '/api/projects' && M === 'GET') return ok({ common: db.projects.common, mine: db.projects.mine });
  if (P === '/api/projects' && M === 'POST') {
    const p = { id: genId('p'), scope: b.scope || 'user', ownerId: db.me.id, name: b.name || (b.gitUrl ? String(b.gitUrl).split('/').pop() : 'project'), path: `/workspace/${b.name || 'project'}` };
    if (b.scope === 'room' && b.roomId) (db.roomProjects[b.roomId] ||= []).push(p);
    else if (b.scope === 'common') db.projects.common.push(p); else db.projects.mine.push(p);
    return ok({ project: p });
  }
  if (seg[1] === 'projects' && seg[2] === 'room') return ok({ projects: db.roomProjects[idAt(3)] || [] });
  if (seg[1] === 'projects' && seg[2] && seg.length === 3 && M === 'DELETE') {
    const id = idAt(2);
    db.projects.common = db.projects.common.filter((p: any) => p.id !== id);
    db.projects.mine = db.projects.mine.filter((p: any) => p.id !== id);
    for (const k of Object.keys(db.roomProjects)) db.roomProjects[k] = db.roomProjects[k].filter((p: any) => p.id !== id);
    return ok({ ok: true });
  }
  if (seg[1] === 'projects' && seg[3] === 'tree') return ok({ files: TREE_PROJECT });
  if (seg[1] === 'projects' && seg[3] === 'open-editor') return ok({ url: EDITOR_URL });
  if (seg[1] === 'projects' && seg[3] === 'file') { const path = query.get('path') || ''; return ok({ name: path.split('/').pop(), content: fileContent(path) }); }
  if (seg[1] === 'projects' && seg[3] === 'git' && seg[4] === 'status') return ok(GIT.status(idAt(2)));
  if (seg[1] === 'projects' && seg[3] === 'git' && seg[4] === 'remotes') {
    const name = seg[5] ? decodeURIComponent(idAt(5)) : String(b.name || '');
    if (M === 'POST') GIT.remotes.push({ name, url: String(b.url || '') });
    if (M === 'PUT') { const r = GIT.remotes.find((x) => x.name === name); if (r) r.url = String(b.url || ''); }
    if (M === 'DELETE') GIT.remotes = GIT.remotes.filter((x) => x.name !== name);
    return ok({ ok: true, remotes: GIT.remotes });
  }
  if (seg[1] === 'projects' && seg[3] === 'git' && seg[4] === 'init' && M === 'POST') {
    GIT.untracked = GIT.untracked.filter((p) => p !== idAt(2));
    return ok({ ok: true, ...GIT.status(idAt(2)) });
  }
  if (seg[1] === 'projects' && seg[3] === 'git' && seg[4] === 'publish' && M === 'POST') {
    GIT.untracked = GIT.untracked.filter((p) => p !== idAt(2));
    const cred = [...GIT.creds.mine, ...GIT.creds.common].find((c: any) => c.id === b.credentialId);
    const url = b.remoteUrl || `https://${cred?.host || 'github.com'}/${cred?.username || 'demo'}/${b.name || 'demo'}.git`;
    return ok({ ok: true, url, output: `To ${url}\n * [new branch] main -> main (demo)`, ...GIT.status(idAt(2)) });
  }
  if (seg[1] === 'projects' && seg[3] === 'git' && seg[4] === 'commit') {
    const picked: string[] = Array.isArray(b.files) ? b.files : [];
    GIT.files = picked.length ? GIT.files.filter((f: any) => !picked.includes(f.path)) : [];
    GIT.ahead += 1;
    return ok({ ok: true, commit: genId('c').slice(2, 9) });
  }
  if (seg[1] === 'projects' && seg[3] === 'git' && seg[4] === 'push') { GIT.ahead = 0; GIT.behind = 0; return ok({ ok: true, output: 'Everything up-to-date (demo)' }); }
  if (seg[1] === 'projects' && seg[3] === 'git' && seg[4] === 'branches') return ok({ repo: true, ...GIT.branches });
  if (seg[1] === 'projects' && seg[3] === 'git' && seg[4] === 'checkout') {
    const name = String(b.branch || '').trim();
    if (name) { GIT.branches.current = name; if (!GIT.branches.local.includes(name)) GIT.branches.local.push(name); }
    return ok({ ok: true, branch: name });
  }

  // ---- git credentials ----
  if (P === '/api/git-credentials' && M === 'GET') return ok({ mine: GIT.creds.mine, common: GIT.creds.common });
  if (P === '/api/git-credentials' && M === 'POST') {
    const scope = b.scope === 'common' ? 'common' : 'user';
    const cred = { id: genId('gc'), scope, provider: b.provider || 'other', host: b.host, username: b.username, authorEmail: b.authorEmail || null, setAt: Date.now() };
    GIT.creds[scope].push(cred);
    return ok({ credential: cred });
  }
  if (seg[1] === 'git-credentials' && seg[2] && M === 'DELETE') {
    GIT.creds.mine = GIT.creds.mine.filter((c: any) => c.id !== idAt(2));
    GIT.creds.common = GIT.creds.common.filter((c: any) => c.id !== idAt(2));
    return ok({ ok: true });
  }

  // ---- wiki ----
  if (P === '/api/wiki/topics' && M === 'GET') return ok({ topics: db.wikiTopics });
  if (P === '/api/wiki/topics' && M === 'POST') {
    const t = { id: genId('w'), name: b.name || 'New topic', description: b.description || '', path: String(b.name || 'topic').toLowerCase(), createdBy: db.me.id, createdAt: Date.now(), compileStatus: 'done', compiledAt: Date.now(), compileError: null };
    db.wikiTopics.push(t); db.messages[`cs_${t.id}`] = []; return ok({ topic: t });
  }
  if (seg[1] === 'wiki' && seg[2] === 'topics' && seg[4] === 'thread') {
    const w = db.wikiTopics.find((x) => x.id === idAt(3)); const cs = `cs_${idAt(3)}`;
    return ok({ session: { id: cs, title: w?.name || 'Wiki', model: 'claude-opus-4-8', permissionMode: 'default' }, messages: msgs(cs) });
  }
  if (seg[1] === 'wiki' && seg[2] === 'topics' && seg[4] === 'files') return ok({ files: WIKI_ARTICLES, source: 'compiled' });
  if (seg[1] === 'wiki' && seg[2] === 'topics' && seg[4] === 'tree') return ok({ raw: WIKI_RAW, wiki: WIKI_TREE_ARTICLES });
  // in-place source edit (admin) — mirrors the real PUT: raw/ text files only, no auto-recompile
  if (seg[1] === 'wiki' && seg[2] === 'topics' && seg[4] === 'file' && M === 'PUT') {
    const rel = String(b.path || '');
    if (!rel) return { status: 400, data: { error: 'bad path' } };
    WIKI_RAW_EDITS[rel] = String(b.content ?? '');
    const at = WIKI_RAW.findIndex((f) => f.name === rel);
    const size = WIKI_RAW_EDITS[rel].length;
    if (at >= 0) WIKI_RAW[at] = { name: rel, size }; else WIKI_RAW.push({ name: rel, size });
    return ok({ name: rel, size });
  }
  if (seg[1] === 'wiki' && seg[2] === 'topics' && seg[4] === 'file') { const dir = query.get('dir') || 'wiki'; const path = query.get('path') || ''; return ok({ name: path.split('/').pop(), content: wikiFileContent(dir, path) }); }
  if (seg[1] === 'wiki' && seg[2] === 'topics' && seg[4] === 'recompile') return ok({});
  if (seg[1] === 'wiki' && seg[2] === 'topics' && seg[3] && M === 'DELETE') { db.wikiTopics = db.wikiTopics.filter((x) => x.id !== idAt(3)); return ok({}); }
  if (seg[1] === 'wiki' && seg[2] === 'staging') return ok({ files: [] });

  // ---- local session import ----
  if (seg[1] === 'import' && seg[2] === 'staging' && seg[4] === 'files' && M === 'POST') return ok({ files: [{ name: 'src/index.ts', size: 100 }] });
  if (seg[1] === 'import' && seg[2] === 'staging' && seg[4] === 'file' && M === 'DELETE') return ok({ files: [] });
  if (seg[1] === 'import' && seg[2] === 'staging' && seg[4] === 'sessions' && M === 'GET') return ok({ found: true, originalCwd: 'C:\\dev\\api-server', projectTail: 'api-server', sessions: IMPORT_SESSIONS });
  if (seg[1] === 'import' && seg[2] === 'staging' && seg[3] && seg.length === 4 && M === 'DELETE') return ok({ ok: true });
  if (seg[1] === 'import' && seg[2] === 'sessions' && M === 'POST') {
    // overwrite reuses the chat row the user already has, so only the cloned ones come back as new
    const overwritten = new Set<string>(Array.isArray(b.overwrite) ? b.overwrite : []);
    const picked: string[] = (Array.isArray(b.sessionUuids) ? b.sessionUuids : []).filter((u: string) => !overwritten.has(u));
    return ok({
      // overwrite reuses the project the user already has; clone would get a numbered sibling
      project: b.projectOverwrite
        ? (db.projects.mine.find((p: any) => p.name === b.projectName) || db.projects.mine[0])
        : { id: genId('prj'), name: `${b.projectName || 'Demo'}-2` },
      sessions: picked.map((u) => ({ id: genId('ses'), title: IMPORT_SESSIONS.find((s) => s.uuid === u)?.title || u })),
    });
  }

  // ---- plugins / marketplaces ----
  if (P === '/api/plugins' && M === 'GET') return ok({ common: db.plugins.common, mine: db.plugins.mine, prefs: db.plugins.prefs });
  if (P === '/api/marketplaces' && M === 'GET') return ok({ common: db.marketplaces.common, mine: db.marketplaces.mine });
  if (P === '/api/marketplaces' && M === 'POST') { const arr = b.scope === 'common' ? db.marketplaces.common : db.marketplaces.mine; arr.push({ name: b.name }); return ok({}); }
  if (P === '/api/plugins/install' && M === 'POST') { const arr = b.scope === 'common' ? db.plugins.common : db.plugins.mine; arr.push({ id: genId('pl'), name: b.name, source: 'marketplace', enabled: 1, forced: 0, repo: b.repo || null }); return ok({}); }
  if (P === '/api/plugins/upload' && M === 'POST') { const arr = (b.scope === 'common') ? db.plugins.common : db.plugins.mine; arr.push({ id: genId('pl'), name: b.name || 'uploaded', source: 'local', enabled: 1, forced: 0, repo: null }); return ok({}); }
  if (seg[1] === 'plugins' && seg[3] === 'detail') return ok(pluginDetail(idAt(2)));
  if (seg[1] === 'plugins' && seg[3] === 'tree') return ok({ files: TREE_PLUGIN });
  if (seg[1] === 'plugins' && seg[3] === 'file') { const path = query.get('path') || ''; return ok({ name: path.split('/').pop(), content: fileContent(path) }); }
  if (seg[1] === 'plugins' && seg[3] === 'update') return ok({});
  if (seg[1] === 'plugins' && (seg[3] === 'enabled' || seg[3] === 'forced' || seg[3] === 'pref')) {
    const all = [...db.plugins.common, ...db.plugins.mine]; const p: any = all.find((x) => x.id === idAt(2));
    if (p && seg[3] === 'enabled') p.enabled = b.enabled ? 1 : 0;
    if (p && seg[3] === 'forced') p.forced = b.forced ? 1 : 0;
    if (seg[3] === 'pref') { db.plugins.prefs = db.plugins.prefs.filter((x) => x.pluginId !== idAt(2)); db.plugins.prefs.push({ pluginId: idAt(2), enabled: b.enabled ? 1 : 0 }); }
    return ok({});
  }
  if (seg[1] === 'plugins' && seg[2] && seg.length === 3 && M === 'DELETE') {
    db.plugins.common = db.plugins.common.filter((x) => x.id !== idAt(2)); db.plugins.mine = db.plugins.mine.filter((x) => x.id !== idAt(2)); return ok({});
  }

  // ---- users ----
  if (P === '/api/users' && M === 'GET') return ok({ users: db.users });
  if (P === '/api/users' && M === 'POST') { db.users.push({ id: genId('u'), username: b.username, role: b.role || 'member', displayName: b.displayName || b.username, avatarColor: '#5b6b8c' }); return ok({}); }
  if (P === '/api/users/directory') return ok({ users: db.users });
  if (seg[1] === 'users' && seg[3] === 'password') return ok({});
  if (seg[1] === 'users' && seg[2] && M === 'DELETE') { db.users = db.users.filter((x) => x.id !== idAt(2)); return ok({}); }

  // ---- review (PR review) ----
  if (P === '/api/review/repos' && M === 'GET') return ok({ repos: db.reviewRepos });
  if (P === '/api/review/repos' && M === 'POST') {
    const slug = String(b.gitUrl || '').replace(/\.git$/, '').split('/').slice(-2).join('/') || 'repo/x';
    const repo = { id: genId('rr'), name: b.name || slug, provider: b.provider || 'github', host: 'github.com', slug, gitUrl: b.gitUrl, baseBranch: b.baseBranch || 'main', sandboxImage: b.sandboxImage || null, webhookSecret: b.webhook ? `demo-${Math.random().toString(36).slice(2, 10)}-webhook-secret` : null, pollEnabled: b.pollEnabled !== false, polledAt: Date.now(), pollError: null, openCount: 0, createdAt: Date.now() };
    db.reviewRepos.unshift(repo); return ok({ repo });
  }
  if (seg[1] === 'review' && seg[2] === 'repos' && seg[3] && M === 'PATCH') {
    const r = db.reviewRepos.find((x: any) => x.id === idAt(3));
    if (!r) return { status: 404, data: { error: 'not found' } };
    if (b.name !== undefined) r.name = String(b.name).trim() || r.name;
    if (b.baseBranch !== undefined) r.baseBranch = String(b.baseBranch).trim() || null;
    if (b.sandboxImage !== undefined) r.sandboxImage = String(b.sandboxImage).trim() || null;
    if (b.pollEnabled !== undefined) r.pollEnabled = !!b.pollEnabled;
    return ok({ repo: r });
  }
  if (seg[1] === 'review' && seg[2] === 'repos' && seg[4] === 'poll') return ok({ ok: true, opened: 0, closed: 0 });
  if (seg[1] === 'review' && seg[2] === 'repos' && seg[4] === 'webhook' && M === 'POST') {
    const r: any = db.reviewRepos.find((x: any) => x.id === idAt(3));
    if (!r) return { status: 404, data: { error: 'not found' } };
    // demo secret: regenerated per click so "rotate" visibly changes the value
    r.webhookSecret = b.enabled ? `demo-${Math.random().toString(36).slice(2, 10)}-webhook-secret` : null;
    return ok({ ok: true, secret: r.webhookSecret });
  }
  if (seg[1] === 'review' && seg[2] === 'repos' && seg[3] && M === 'DELETE') {
    db.reviewSessions = db.reviewSessions.filter((s: any) => s.repoId !== idAt(3));
    db.reviewRepos = db.reviewRepos.filter((r: any) => r.id !== idAt(3));
    return ok({ ok: true });
  }
  if (P === '/api/review/sessions' && M === 'GET') return ok({ sessions: db.reviewSessions });
  if (seg[1] === 'review' && seg[2] === 'sessions' && seg[4] === 'merge') {
    const rv = db.reviewSessions.find((s: any) => s.id === idAt(3)); if (rv) rv.mergeState = 'merged';
    return ok({ ok: true, mergeState: 'merged', output: "Merge made by the 'ort' strategy. (demo)" });
  }
  if (seg[1] === 'review' && seg[2] === 'sessions' && seg[4] === 'auto') {
    const rv = db.reviewSessions.find((s: any) => s.id === idAt(3));
    if (rv) { rv.mergeState = 'merged'; rv.verdict = 'merge_safe'; rv.verdictSummary = '테스트 통과, 회귀 없음. 병합 가능. (demo)'; }
    return ok({ ok: true });
  }
  if (seg[1] === 'review' && seg[2] === 'sessions' && seg[4] === 'approve') {
    const rv = db.reviewSessions.find((s: any) => s.id === idAt(3)); if (rv) rv.prState = 'closed';
    return ok({ ok: true, output: 'Pull Request successfully merged (demo)' });
  }
  if (seg[1] === 'review' && seg[2] === 'sessions' && seg[3] && M === 'DELETE') {
    db.reviewSessions = db.reviewSessions.filter((s: any) => s.id !== idAt(3)); return ok({ ok: true });
  }
  if (seg[1] === 'review' && seg[2] === 'sessions' && seg[3] && M === 'GET') {
    const rv = db.reviewSessions.find((s: any) => s.id === idAt(3));
    if (!rv) return { status: 404, data: { error: 'not found' } };
    const repo = db.reviewRepos.find((r: any) => r.id === rv.repoId);
    return ok({
      review: { id: rv.id, chatSessionId: rv.chatSessionId, prNumber: rv.prNumber, prTitle: rv.prTitle, prUrl: rv.prUrl, prState: rv.prState, authorLogin: rv.authorLogin, baseRef: repo?.baseBranch || 'main', headRef: `pr-${rv.prNumber}`, mergeState: rv.mergeState, mergedAt: null, verdict: rv.verdict, verdictSummary: rv.verdictSummary },
      repo: repo ? { id: repo.id, name: repo.name, provider: repo.provider, host: repo.host, slug: repo.slug } : null,
      role: 'admin',
    });
  }

  // ---- DM / group chat ----
  if (P === '/api/dm/channels' && M === 'GET') return ok({ channels: db.dmChannels });
  if (P === '/api/dm/channels' && M === 'POST') {
    const memberInfo = (u: any) => ({ userId: u.id, displayName: u.displayName, avatarColor: u.avatarColor, avatar: u.avatar ?? null, username: u.username });
    if (b.kind === 'dm') {
      const other = db.users.find((u: any) => u.id === b.userId);
      let ch = db.dmChannels.find((c: any) => c.kind === 'dm'
        && c.members.some((m: any) => m.userId === b.userId) && c.members.some((m: any) => m.userId === db.me.id));
      if (!ch) {
        ch = { id: genId('dm'), kind: 'dm', name: null, createdBy: db.me.id, createdAt: Date.now(),
          members: [memberInfo(db.me), other && memberInfo(other)].filter(Boolean), lastMessage: null, unread: 0 };
        db.dmChannels.unshift(ch); db.dmMessages[ch.id] = [];
      }
      return ok({ channel: ch });
    }
    const picked = (Array.isArray(b.memberIds) ? b.memberIds : []).map((id: string) => db.users.find((u: any) => u.id === id)).filter(Boolean);
    const members = [memberInfo(db.me), ...picked.map(memberInfo)].filter((m: any, i: number, a: any[]) => a.findIndex((x) => x.userId === m.userId) === i);
    const ch = { id: genId('dm'), kind: 'group', name: b.name || 'Group', createdBy: db.me.id, createdAt: Date.now(), members, lastMessage: null, unread: 0 };
    db.dmChannels.unshift(ch); db.dmMessages[ch.id] = [];
    return ok({ channel: ch });
  }
  if (seg[1] === 'dm' && seg[2] === 'channels' && seg[4] === 'messages' && M === 'GET') return ok({ messages: db.dmMessages[idAt(3)] || [] });
  if (seg[1] === 'dm' && seg[2] === 'channels' && seg[4] === 'read' && M === 'POST') {
    const c = db.dmChannels.find((x: any) => x.id === idAt(3)); if (c) c.unread = 0; return ok({ ok: true });
  }
  if (seg[1] === 'dm' && seg[2] === 'channels' && seg[4] === 'promote' && M === 'POST') {
    const c = db.dmChannels.find((x: any) => x.id === idAt(3));
    const cs = genId('cs');
    const room = { id: genId('r'), name: c?.name || 'Group', ownerId: db.me.id, chatSessionId: cs, permissionMode: 'default',
      members: (c?.members || []).map((m: any) => ({ userId: m.userId, displayName: m.displayName, avatarColor: m.avatarColor, username: m.username, isOwner: m.userId === db.me.id, delegations: [], joinedAt: Date.now() })) };
    db.rooms.unshift(room); db.messages[cs] = [];
    return ok({ roomId: room.id });
  }

  // ---- admin ----
  if (P === '/api/admin/overview') return ok(ADMIN.overview());
  if (P === '/api/admin/usage') return ok(ADMIN.usage);
  if (P === '/api/admin/settings' && M === 'GET') return ok(ADMIN.settings);
  if (P === '/api/admin/settings' && M === 'POST') { Object.assign(ADMIN.settings, b); return ok({}); }
  if (P === '/api/admin/config' && M === 'GET') return ok({ items: ADMIN.config });
  if (P === '/api/admin/config' && M === 'PUT') {
    const it = ADMIN.config.find((x: any) => x.key === b.key);
    if (it && !it.readonly) { it.value = it.type === 'bool' ? (b.value ? '1' : '0') : String(b.value); it.overridden = true; }
    if (b.key === 'brandTitle') db.brand.title = String(b.value ?? '').trim(); // same key, either editor
    return ok({ items: ADMIN.config });
  }
  // model auto-fetch: stand in for the provider's /v1/models and overwrite the map + defaultModel choices
  if (P === '/api/admin/models/refresh' && M === 'POST') {
    ADMIN.models = { ...ADMIN.fetchedModels };
    const it = ADMIN.config.find((x: any) => x.key === 'models');
    if (it) { it.value = JSON.stringify(ADMIN.models); it.overridden = true; }
    const dm = ADMIN.config.find((x: any) => x.key === 'defaultModel');
    if (dm) dm.options = [...new Set([...Object.keys(ADMIN.models), ...(dm.options || [])])];
    return ok({ models: ADMIN.models, items: ADMIN.config });
  }
  if (seg[1] === 'admin' && seg[2] === 'config' && seg[3] && M === 'DELETE') {
    const it = ADMIN.config.find((x: any) => x.key === decodeURIComponent(idAt(3)));
    if (it) { it.value = it.default; it.overridden = false; }
    return ok({ items: ADMIN.config });
  }
  if (P === '/api/admin/image/inspect' && M === 'POST') return ok(ADMIN.images[b.image] || { present: false });
  if (P === '/api/admin/image/pull' && M === 'POST') {
    const s = (ADMIN.images[b.image] ||= { present: false }); s.present = true; s.size = s.size || 402_000_000; return ok(s);
  }
  if (P === '/api/admin/cleanup' && M === 'GET') return ok(ADMIN.cleanup);
  if (P === '/api/admin/cleanup' && M === 'POST') return ok(ADMIN.runCleanup(b.action));
  if (P === '/api/admin/processes' && M === 'GET') return ok(ADMIN.processes);
  if (P === '/api/admin/processes' && M === 'POST') return ok(ADMIN.runProcess(b));
  if (P === '/api/admin/restart' && M === 'POST') return ok({ ok: true });
  if (P === '/api/admin/claude-token') return ok({});

  return ok({}); // unknown → harmless empty object
}
