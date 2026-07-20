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
};

export function ensure(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export function ensureBaseLayout() {
  [paths.common, paths.commonClaude, paths.commonPlugins, paths.commonProjects,
   path.join(D, 'users'), path.join(D, 'rooms')].forEach(ensure);
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
