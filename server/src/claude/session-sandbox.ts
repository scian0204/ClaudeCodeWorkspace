import path from 'node:path';
import Docker from 'dockerode';
import { config } from '../config.js';
import { cfg, registerApply } from '../lib/config-registry.js';
import { sandboxMcpServer } from '../review/sandbox.js';

// ── per-session build container ──
// Every chat session shares the app container, so two people who both run `npm run dev`, `pytest` or
// a docker build in their own project collide: same ports, same caches, same process table. With
// this on, a session gets its OWN sibling container with only its project dir mounted, and an
// `mcp__sandbox__run` tool that execs inside it. The host shell stays available for cheap things
// (git, grep, file edits); the turn's system prompt is what steers builds/runs into the container.
//
// Difference from the review sandbox (review/sandbox.ts): that one is torn down at the end of every
// turn because it runs untrusted PR code. This one is kept ALIVE between turns — otherwise every
// turn would reinstall node_modules — and reaped once the session goes idle.
//
// Ceiling: same as review — network egress stays on (npm/pip/go need it), and the mount is the
// session's own project dir only.

const docker = new Docker();

interface Instance { sessionId: string; name: string; cwd: string; lastActive: number; starting?: Promise<void> }
const instances = new Map<string, Instance>();

export function sessionSandboxAvailable(): boolean {
  return cfg.bool('sessionSandboxEnabled') && !!config.codeServer.dataVolume && !!config.codeServer.network;
}

function nameFor(sessionId: string): string {
  return `ccw-sesbx-${sessionId}`.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 60);
}
function subpathOf(absPath: string): string {
  return path.relative(config.dataDir, absPath).split(path.sep).join('/');
}
async function removeIfExists(name: string) {
  try { await docker.getContainer(name).remove({ force: true }); } catch { /* absent */ }
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

// Spawn (or reuse) this session's build container. `cwd` must be the session's project dir under the
// data volume; it is mounted at its own absolute path so a path the agent sees on the host resolves
// identically inside. Returns the container name, or null when it can't be started.
export async function ensureSessionSandbox(sessionId: string, cwd: string): Promise<string | null> {
  if (!sessionSandboxAvailable()) return null;
  const sub = subpathOf(cwd);
  if (!sub || sub.startsWith('..')) return null; // outside the data volume → nothing safe to mount

  const existing = instances.get(sessionId);
  if (existing && existing.cwd === cwd) {
    existing.lastActive = Date.now();
    if (existing.starting) await existing.starting.catch(() => {});
    try {
      if ((await docker.getContainer(existing.name).inspect())?.State?.Running) return existing.name;
    } catch { /* died between turns → recreate below */ }
    instances.delete(sessionId);
  } else if (existing) {
    await stop(existing).catch(() => {}); // the session switched project → old container mounts the wrong dir
  }

  const name = nameFor(sessionId);
  const inst: Instance = { sessionId, name, cwd, lastActive: Date.now() };
  instances.set(sessionId, inst);
  inst.starting = (async () => {
    const image = cfg.str('sessionSandboxImage');
    await ensureImage(image);
    await removeIfExists(name);
    const c = await docker.createContainer({
      name,
      Image: image,
      Cmd: ['sleep', 'infinity'], // kept alive between turns; the reaper below removes it when idle
      WorkingDir: cwd,
      Labels: { 'ccw.sessionsandbox': '1', 'ccw.session': sessionId },
      HostConfig: {
        NetworkMode: config.codeServer.network,
        AutoRemove: true,
        Mounts: [{ Type: 'volume', Source: config.codeServer.dataVolume, Target: cwd, VolumeOptions: { Subpath: sub } as any }],
        Memory: cfg.int('sessionSandboxMemMB') * 1024 * 1024,
        PidsLimit: cfg.int('sessionSandboxPidsLimit'),
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
      },
    });
    await c.start();
  })();
  try { await inst.starting; }
  catch { instances.delete(sessionId); return null; } // image pull / daemon failure → host exec, as before
  return name;
}

// The MCP `run` tool for one session's container.
export function sandboxMcp(containerName: string, cwd: string) {
  return sandboxMcpServer(containerName, cwd, cfg.int('sessionSandboxExecTimeoutMs'), {
    description: "Run a shell command inside THIS session's own build container (cwd = the project dir, same absolute path as on the host). Use it for anything that installs, builds, serves or tests — npm/pnpm/yarn, pip, go, cargo, make, dev servers, test suites. The container is private to this session and survives between turns, so installed dependencies persist. Returns \"exit=<code>\" then combined stdout/stderr.",
    maxBytes: cfg.int('sessionSandboxMaxOutputBytes'),
  });
}

// Appended to the turn's system prompt (never shown in the transcript) so the agent reaches for the
// container instead of the shared app container. Bash stays available on purpose — git, grep and
// file work have no reason to pay for a container round-trip.
export function sandboxHint(cwd: string): string {
  return [
    'BUILD ISOLATION: this session has its own build container. Run ANY command that installs,',
    'builds, serves or tests code with the `mcp__sandbox__run` tool, never with `Bash` —',
    'package managers (npm/pnpm/yarn/pip/poetry/go/cargo), build tools (make/gradle/maven/tsc),',
    'test runners, dev servers and long-running processes all belong there.',
    `Its working directory is ${cwd}, the same absolute path Bash sees, and installed dependencies`,
    'persist between turns. Keep using `Bash` for cheap local work: git, file inspection, search.',
    'Reason: every session shares the app container, so a build started there collides with other',
    "members' work.",
  ].join(' ');
}

async function stop(inst: Instance) {
  instances.delete(inst.sessionId);
  await removeIfExists(inst.name);
}

export async function removeSessionSandbox(sessionId: string): Promise<void> {
  const inst = instances.get(sessionId);
  if (inst) await stop(inst).catch(() => {});
  else await removeIfExists(nameFor(sessionId));
}

// Admin process panel: kill ONE session container by docker id.
export async function killSessionSandbox(id: string): Promise<boolean> {
  try {
    const info = await docker.getContainer(id).inspect();
    const name = (info.Name || '').replace(/^\//, '');
    const inst = [...instances.values()].find((i) => i.name === name);
    if (inst) { await stop(inst); return true; }
    await docker.getContainer(id).remove({ force: true });
    return true;
  } catch { return false; }
}

// Labeled sweep — boot cleanup (the registry is in-memory, so survivors would never be reaped) and
// the admin "clean sandboxes" action share it. Returns how many were removed.
export async function removeAllSessionSandboxes(): Promise<number> {
  instances.clear();
  if (!config.codeServer.dataVolume || !config.codeServer.network) return 0;
  let removed = 0;
  try {
    const list = await docker.listContainers({ all: true, filters: { label: ['ccw.sessionsandbox=1'] } });
    for (const c of list) { try { await docker.getContainer(c.Id).remove({ force: true }); removed++; } catch { /* ignore */ } }
  } catch { /* docker unavailable */ }
  return removed;
}

let reaperTimer: ReturnType<typeof setInterval> | null = null;
function sweep() {
  const now = Date.now();
  const idleMs = cfg.int('sessionSandboxIdleMs');
  for (const inst of [...instances.values()]) {
    if (now - inst.lastActive > idleMs) stop(inst).catch(() => {});
  }
}
export function startReaper() { scheduleReaper(); }
export function scheduleReaper() {
  if (reaperTimer) { clearInterval(reaperTimer); reaperTimer = null; }
  reaperTimer = setInterval(sweep, cfg.int('sessionSandboxReaperMs'));
  reaperTimer.unref();
}
registerApply('sessionSandboxReaperMs', () => scheduleReaper());
