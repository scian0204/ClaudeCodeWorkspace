// Routes every /api/* request to canned data / in-memory mutations for the static demo.
// Called by the fetch + XHR interceptors in ./install. Returns a plain {status, data}.
import {
  db, ADMIN, GIT, COMMANDS, TREE_PROJECT, TREE_PLUGIN, WIKI_ARTICLES, WIKI_RAW, WIKI_TREE_ARTICLES,
  fileContent, wikiFileContent, pluginDetail, EDITOR_URL, genId,
} from './data';

type Res = { status: number; data: any };
const ok = (data: any = {}): Res => ({ status: 200, data });

function sessionFor(id: string) {
  const s = db.sessions.find((x) => x.id === id);
  if (s) return { id: s.id, title: s.title, projectId: s.projectId, model: s.model, permissionMode: s.permissionMode };
  const room = db.rooms.find((r) => r.chatSessionId === id);
  if (room) return { id, title: room.name, projectId: null, model: 'claude-opus-4-8', permissionMode: room.permissionMode };
  const w = db.wikiTopics.find((t) => `cs_${t.id}` === id);
  if (w) return { id, title: w.name, projectId: null, model: 'claude-opus-4-8', permissionMode: 'default' };
  return { id, title: 'New chat', projectId: null, model: 'claude-opus-4-8', permissionMode: 'default' };
}
const msgs = (id: string) => (db.messages[id] || (db.messages[id] = []));

export function route(method: string, rawPath: string, body?: any): Res {
  const P = rawPath.split('?')[0];
  const query = new URLSearchParams(rawPath.split('?')[1] || '');
  const b = (() => { try { return typeof body === 'string' ? JSON.parse(body || '{}') : (body || {}); } catch { return {}; } })();
  const M = method.toUpperCase();
  const seg = P.split('/').filter(Boolean); // ['api', ...]
  const idAt = (i: number) => seg[i];

  // ---- auth ----
  if (P === '/api/auth/me') return ok({ user: db.me });
  if (P === '/api/auth/login') return ok({ user: db.me });
  if (P === '/api/auth/logout') return ok({});
  if (P === '/api/auth/me/claude-token') { db.me.hasClaudeToken = M !== 'DELETE'; db.me.claudeTokenSetAt = M !== 'DELETE' ? Date.now() : null; return ok({ user: db.me }); }

  // ---- sessions ----
  if (P === '/api/sessions' && M === 'GET') return ok({ sessions: db.sessions });
  if (P === '/api/sessions' && M === 'POST') {
    const s = { id: genId('s'), title: 'New chat', updatedAt: Date.now(), projectId: null, model: 'claude-opus-4-8', permissionMode: 'default' };
    db.sessions.unshift(s); db.messages[s.id] = []; return ok({ session: s });
  }
  if (seg[1] === 'sessions' && seg[3] === 'commands') return ok({ commands: COMMANDS });
  if (seg[1] === 'sessions' && seg[3] === 'messages' && seg[5] === 'edit') {
    const list = msgs(idAt(2)); const i = list.findIndex((m) => m.id === idAt(4));
    if (i >= 0) list.splice(i); // drop the edited message and everything after (regenerate)
    return ok({ messages: list });
  }
  if (seg[1] === 'sessions' && seg[3] === 'messages' && M === 'DELETE') {
    const list = msgs(idAt(2)); const i = list.findIndex((m) => m.id === idAt(4)); if (i >= 0) list.splice(i, 1); return ok({});
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
  if (seg[1] === 'projects' && seg[3] === 'tree') return ok({ files: TREE_PROJECT });
  if (seg[1] === 'projects' && seg[3] === 'open-editor') return ok({ url: EDITOR_URL });
  if (seg[1] === 'projects' && seg[3] === 'file') { const path = query.get('path') || ''; return ok({ name: path.split('/').pop(), content: fileContent(path) }); }
  if (seg[1] === 'projects' && seg[3] === 'git' && seg[4] === 'status') return ok(GIT.status());
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
  if (seg[1] === 'wiki' && seg[2] === 'topics' && seg[4] === 'file') { const dir = query.get('dir') || 'wiki'; const path = query.get('path') || ''; return ok({ name: path.split('/').pop(), content: wikiFileContent(dir, path) }); }
  if (seg[1] === 'wiki' && seg[2] === 'topics' && seg[4] === 'recompile') return ok({});
  if (seg[1] === 'wiki' && seg[2] === 'topics' && seg[3] && M === 'DELETE') { db.wikiTopics = db.wikiTopics.filter((x) => x.id !== idAt(3)); return ok({}); }
  if (seg[1] === 'wiki' && seg[2] === 'staging') return ok({ files: [] });

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

  // ---- admin ----
  if (P === '/api/admin/overview') return ok(ADMIN.overview());
  if (P === '/api/admin/usage') return ok(ADMIN.usage);
  if (P === '/api/admin/settings' && M === 'GET') return ok(ADMIN.settings);
  if (P === '/api/admin/settings' && M === 'POST') { Object.assign(ADMIN.settings, b); return ok({}); }
  if (P === '/api/admin/claude-token') return ok({});

  return ok({}); // unknown → harmless empty object
}
