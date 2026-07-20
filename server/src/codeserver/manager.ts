import path from 'node:path';
import http from 'node:http';
import Docker from 'dockerode';
import { config } from '../config.js';
import { newToken } from '../lib/ids.js';

const docker = new Docker();

interface Instance {
  key: string;            // `${scope}:${ownerId}:${projectId}`
  containerName: string;
  token: string;
  subpath: string;        // project path relative to /data
  lastActive: number;
  starting?: Promise<void>;
}

const instances = new Map<string, Instance>();
const byRoute = new Map<string, Instance>(); // `${ownerId}/${projectId}` -> instance

function keyOf(ownerId: string, projectId: string) { return `${ownerId}:${projectId}`; }
function routeOf(ownerId: string, projectId: string) { return `${ownerId}/${projectId}`; }

export function dockerAvailable(): boolean {
  return !!config.codeServer.dataVolume && !!config.codeServer.network;
}

async function ensureImage(image: string) {
  try { await docker.getImage(image).inspect(); return; } catch { /* pull below */ }
  await new Promise<void>((resolve, reject) => {
    docker.pull(image, (err: any, stream: any) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (e: any) => (e ? reject(e) : resolve()));
    });
  });
}

// project.path is absolute under /data; subpath is relative to the data root.
function subpathOf(absProjectPath: string): string {
  return path.relative(config.dataDir, absProjectPath).split(path.sep).join('/');
}

export async function open(ownerId: string, projectId: string, absProjectPath: string): Promise<{ token: string; url: string }> {
  if (!dockerAvailable()) throw new Error('code-server requires Docker deployment (DATA_VOLUME/CODE_SERVER_NETWORK unset)');
  const key = keyOf(ownerId, projectId);
  let inst = instances.get(key);
  if (inst) { inst.lastActive = Date.now(); return { token: inst.token, url: routeUrl(ownerId, projectId, inst.token) }; }

  const token = newToken();
  const containerName = `ccw-cs-${ownerId}-${projectId}`.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 60);
  inst = { key, containerName, token, subpath: subpathOf(absProjectPath), lastActive: Date.now() };
  instances.set(key, inst);
  byRoute.set(routeOf(ownerId, projectId), inst);

  inst.starting = (async () => {
    await ensureImage(config.codeServer.image);
    await removeIfExists(containerName);
    const vol = config.codeServer.dataVolume;
    const container = await docker.createContainer({
      name: containerName,
      Image: config.codeServer.image,
      Cmd: ['--auth', 'none', '--bind-addr', '0.0.0.0:8080', '/home/coder/project'],
      User: '0:0',
      Labels: { 'ccw.codeserver': '1', 'ccw.owner': ownerId, 'ccw.project': projectId },
      HostConfig: {
        NetworkMode: config.codeServer.network,
        AutoRemove: true,
        Mounts: [
          // own project (rw) — scoped via volume subpath (isolation safety net)
          { Type: 'volume', Source: vol, Target: '/home/coder/project', VolumeOptions: { Subpath: inst!.subpath } as any },
          // common projects (rw)
          { Type: 'volume', Source: vol, Target: '/home/coder/common', VolumeOptions: { Subpath: 'common/projects' } as any },
        ],
      },
    });
    await container.start();
    await waitReady(containerName); // code-server needs a moment to bind :8080
  })();
  await inst.starting;
  return { token, url: routeUrl(ownerId, projectId, token) };
}

function routeUrl(ownerId: string, projectId: string, token: string) {
  return `/cs/${ownerId}/${projectId}/${token}/`;
}

// proxy resolution: validate token, return container base + touch activity
export function resolve(ownerId: string, projectId: string, token: string): { target: string } | null {
  const inst = byRoute.get(routeOf(ownerId, projectId));
  if (!inst || inst.token !== token) return null;
  inst.lastActive = Date.now();
  return { target: `http://${inst.containerName}:8080` };
}

async function removeIfExists(name: string) {
  try {
    const c = docker.getContainer(name);
    await c.remove({ force: true });
  } catch { /* not present */ }
}

async function stop(inst: Instance) {
  instances.delete(inst.key);
  byRoute.delete(inst.key.replace(':', '/'));
  await removeIfExists(inst.containerName);
}

export async function killForOwner(ownerId: string) {
  for (const inst of [...instances.values()]) {
    if (inst.key.startsWith(ownerId + ':')) await stop(inst).catch(() => {});
  }
}


// poll code-server until it answers on :8080 (avoids iframe 502 race)
function waitReady(name: string, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tryOnce = () => {
      const req = http.get({ host: name, port: 8080, path: '/' , timeout: 2000 }, (res) => { res.resume(); resolve(); });
      req.on('error', () => { if (Date.now() > deadline) resolve(); else setTimeout(tryOnce, 400); });
      req.on('timeout', () => { req.destroy(); if (Date.now() > deadline) resolve(); else setTimeout(tryOnce, 400); });
    };
    tryOnce();
  });
}


// remove leftover code-server containers on boot (registry is in-memory; survivors would never be reaped)
export async function cleanupOrphans() {
  if (!dockerAvailable()) return;
  try {
    const list = await docker.listContainers({ all: true, filters: { label: ['ccw.codeserver=1'] } });
    for (const c of list) { try { await docker.getContainer(c.Id).remove({ force: true }); } catch { /* ignore */ } }
  } catch { /* docker unavailable */ }
}

export function startReaper() {
  if (!dockerAvailable()) return;
  setInterval(() => {
    const now = Date.now();
    for (const inst of [...instances.values()]) {
      if (now - inst.lastActive > config.codeServer.idleMs) {
        stop(inst).catch(() => {});
      }
    }
  }, 60_000).unref();
}
