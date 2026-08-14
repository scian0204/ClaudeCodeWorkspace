import os from 'node:os';
import Docker from 'dockerode';
import { config } from '../config.js';
import { cfg, registerApply } from './config-registry.js';

// One source of truth for "can this deployment actually use Docker".
//
// Three of the workspace's features are Docker-backed — per-project code-server editors, PR review
// sandboxes, and self-update — and every one of them used to fail only at the moment of use, with a
// raw daemon error. Worse, the existing check (codeserver/manager.ts#dockerAvailable) only asks
// whether DATA_VOLUME/CODE_SERVER_NETWORK are set: a compose deploy whose socket is missing or whose
// daemon is down passes it and still breaks later.
//
// So we probe the daemon (ping + version) on boot and on an interval, cache the verdict, and let both
// the admin panel and the client read it: the panel warns with the actual reason, and the UI disables
// the editor views instead of offering a button that cannot work.

const docker = new Docker();

export type DockerReason = 'ok' | 'unconfigured' | 'volume-mismatch' | 'socket-missing' | 'denied' | 'unreachable';

export interface DockerStatus {
  ok: boolean;          // the daemon answered a ping
  configured: boolean;  // DATA_VOLUME + CODE_SERVER_NETWORK are set AND DATA_VOLUME really backs DATA_DIR
  reason: DockerReason; // worst finding, for the message shown to an admin
  version: string | null;
  error: string | null;
  checkedAt: number;
}

// Distinguish "no socket mounted" (the usual bare-metal/npm case) from "mounted but not allowed" and
// "daemon not answering" — an admin can only act on the difference.
export function classifyDockerError(e: any): DockerReason {
  const both = `${e?.code || e?.errno || ''} ${e?.message || e || ''}`;
  if (/ENOENT|no such file|cannot find the file/i.test(both)) return 'socket-missing';
  if (/EACCES|EPERM|permission denied|access is denied/i.test(both)) return 'denied';
  return 'unreachable';
}

function envConfigured(): boolean {
  return !!config.codeServer.dataVolume && !!config.codeServer.network;
}

// Editors and sandboxes mount DATA_VOLUME with a subpath computed against DATA_DIR, which assumes the
// volume named by DATA_VOLUME is exactly the one mounted at DATA_DIR. When it is not, the daemon
// rejects the mount with a bare "no such file or directory" — and worse, the workspace state is not on
// the volume at all, so it dies with the container. The usual cause is a `docker run -v vol:/data`
// without DATA_DIR=/data. A volume mounted at a *parent* of DATA_DIR counts as a mismatch too: the
// subpath would be relative to the wrong root.
export function dataDirOnVolume(mounts: any[], dataDir: string, volume: string): boolean {
  return (mounts || []).some((m) => m?.Destination === dataDir && m?.Type === 'volume' && m?.Name === volume);
}

// null = could not verify (not running inside Docker, or our own container is not inspectable), which
// must not be treated as a failure. Memoized on a definite answer: mounts cannot change without a restart.
let volumeOk: boolean | undefined;
async function checkDataVolume(): Promise<boolean | null> {
  if (volumeOk !== undefined) return volumeOk;
  const vol = config.codeServer.dataVolume;
  if (!vol) return null;
  try {
    // os.hostname() is this container's short id by default — the ref the daemon takes.
    const info: any = await docker.getContainer(os.hostname()).inspect();
    volumeOk = dataDirOnVolume(info?.Mounts || [], config.dataDir, vol);
    return volumeOk;
  } catch { return null; }
}

let cached: DockerStatus = {
  ok: false, configured: envConfigured(), reason: 'unreachable', version: null, error: null, checkedAt: 0,
};

/** Last probe result. Synchronous on purpose — publicConfig() and route guards read it per request. */
export function dockerStatus(): DockerStatus { return cached; }

/** True only when Docker-backed features can actually run (daemon up AND the env wired). */
export function dockerReady(): boolean { return cached.ok && cached.configured; }

export async function probeDocker(): Promise<DockerStatus> {
  const configured = envConfigured();
  const timeout = cfg.int('dockerProbeTimeoutMs');
  try {
    await Promise.race([
      docker.ping(),
      new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('docker ping timed out'), { code: 'ETIMEDOUT' })), timeout)),
    ]);
    const v: any = await docker.version().catch(() => null);
    const mismatch = configured && (await checkDataVolume()) === false;
    cached = {
      ok: true, configured: configured && !mismatch,
      reason: !configured ? 'unconfigured' : mismatch ? 'volume-mismatch' : 'ok',
      version: v?.Version ? String(v.Version) : null,
      error: mismatch ? `DATA_DIR ${config.dataDir} is not backed by volume ${config.codeServer.dataVolume}` : null,
      checkedAt: Date.now(),
    };
  } catch (e: any) {
    cached = {
      ok: false, configured, reason: classifyDockerError(e), version: null,
      error: String(e?.message || e).slice(0, 200), checkedAt: Date.now(),
    };
  }
  return cached;
}

let timer: ReturnType<typeof setInterval> | null = null;

// Probe once at boot with a loud log line (an operator reading container logs should not have to open
// the admin panel to find out that editors are dead), then keep the cache warm.
export async function startDockerProbe(): Promise<void> {
  if (timer) { clearInterval(timer); timer = null; }
  const st = await probeDocker();
  if (!st.ok) console.warn(`[ccw] docker unavailable (${st.reason}): ${st.error} — editors, review sandboxes and self-update are disabled`);
  else if (st.reason === 'volume-mismatch') console.warn(
    `[ccw] DATA_DIR (${config.dataDir}) is not the volume DATA_VOLUME names (${config.codeServer.dataVolume}) — ` +
    'editors and review sandboxes are disabled, and this data is NOT on the volume: it is lost when the container is recreated. ' +
    'Run with DATA_DIR set to the path the volume is mounted at (the images default to /data).');
  else if (!st.configured) console.warn('[ccw] docker reachable but DATA_VOLUME/CODE_SERVER_NETWORK unset — editors and review sandboxes are disabled');
  else console.log(`[ccw] docker ${st.version || 'ok'}`);
  const ms = cfg.int('dockerProbeMs');
  if (ms <= 0) return;
  timer = setInterval(() => { void probeDocker().catch(() => {}); }, ms);
  timer.unref();
}
registerApply('dockerProbeMs', () => { void startDockerProbe(); });
