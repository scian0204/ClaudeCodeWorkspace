import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';

const D = config.dataDir;

export const paths = {
  root: D,
  db: path.join(D, 'app.db'),
  common: path.join(D, 'common'),
  commonClaude: path.join(D, 'common', '.claude'),
  commonPlugins: path.join(D, 'common', 'plugins'),
  commonProjects: path.join(D, 'common', 'projects'),
  userHome: (uid: string) => path.join(D, 'users', uid),
  userClaude: (uid: string) => path.join(D, 'users', uid, '.claude'),
  userProjects: (uid: string) => path.join(D, 'users', uid, 'projects'),
  roomHome: (roomId: string) => path.join(D, 'rooms', roomId),
  roomClaude: (roomId: string) => path.join(D, 'rooms', roomId, '.claude'),
  roomProjects: (roomId: string) => path.join(D, 'rooms', roomId, 'projects'),
  brand: path.join(D, 'brand'),   // admin-uploaded custom logo: logo.<ext>
  wiki: path.join(D, 'wiki'),
  wikiTopic: (id: string) => path.join(D, 'wiki', id),
  wikiStagingRoot: path.join(D, 'wiki', '.staging'),
  wikiStaging: (sid: string) => path.join(D, 'wiki', '.staging', sid),
  importStagingRoot: path.join(D, '.import-staging'),
  importStaging: (sid: string) => path.join(D, '.import-staging', sid),
  backupStaging: path.join(D, '.backup-staging'),   // transient: DB snapshot + meta while a backup streams
  restoreStaging: path.join(D, '.restore-staging'), // transient: uploaded archive + extraction until applied/discarded
  preRestore: path.join(D, '.pre-restore'),         // one-shot rollback: the previous state, kept after a restore
  // per-project plugin installs. Deliberately NOT inside the project's working tree — a plugin is
  // workspace state, not something to commit into the user's repository.
  projectPlugins: (projectId: string) => path.join(D, 'project-plugins', projectId),
  // marketplace clones: read-only source of truth for what a marketplace offers (.claude-plugin/marketplace.json)
  marketplaces: path.join(D, '.marketplaces'),
  marketplaceDir: (id: string) => path.join(D, '.marketplaces', id),
  reviews: path.join(D, 'reviews'),
  reviewRepo: (id: string) => path.join(D, 'reviews', id, 'repo'),      // the full clone
  reviewWorktrees: (id: string) => path.join(D, 'reviews', id, 'wt'),   // per-PR worktrees root
  reviewWorktree: (id: string, prNumber: number) => path.join(D, 'reviews', id, 'wt', String(prNumber)),
  reviewRoot: (id: string) => path.join(D, 'reviews', id),
  // prompt attachments: <ownerProjectsDir>/.attachments/<sessionId> — inside an allowed root so the agent can Read them
  attachments: (kind: 'user' | 'room', ownerId: string, sessionId: string) =>
    path.join(D, kind === 'room' ? 'rooms' : 'users', ownerId, 'projects', '.attachments', sessionId),
  // images a TOOL returned (browser screenshots): a sibling of the attachment dir, not inside it, so
  // they never count against the attachment limit or show up as pending prompt attachments
  toolImages: (kind: 'user' | 'room', ownerId: string, sessionId: string) =>
    path.join(D, kind === 'room' ? 'rooms' : 'users', ownerId, 'projects', '.attachments', `${sessionId}.shots`),
};

export function ensure(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export function ensureBaseLayout() {
  [paths.common, paths.commonClaude, paths.commonPlugins, paths.commonProjects,
   path.join(D, 'users'), path.join(D, 'rooms'), paths.wiki, paths.brand].forEach(ensure);
}

export function ensureUserLayout(uid: string) {
  [paths.userHome(uid), paths.userClaude(uid), paths.userProjects(uid)].forEach(ensure);
}

export function ensureRoomLayout(roomId: string) {
  [paths.roomHome(roomId), paths.roomClaude(roomId), paths.roomProjects(roomId)].forEach(ensure);
}

// Roots an agent session is allowed to touch (soft fence, class-1). project cwd + common projects.
export function allowedRootsFor(kind: 'user' | 'room', ownerId: string, cwd: string): string[] {
  const roots = [cwd, paths.commonProjects];
  roots.push(kind === 'user' ? paths.userProjects(ownerId) : paths.roomProjects(ownerId));
  return roots.map((r) => path.resolve(r));
}

export function isInsideRoots(target: string, roots: string[]): boolean {
  const t = path.resolve(target);
  return roots.some((r) => t === r || t.startsWith(r + path.sep));
}
