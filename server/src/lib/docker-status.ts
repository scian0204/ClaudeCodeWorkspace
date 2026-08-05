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

export type DockerReason = 'ok' | 'unconfigured' | 'socket-missing' | 'denied' | 'unreachable';

export interface DockerStatus {
  ok: boolean;          // the daemon answered a ping
  configured: boolean;  // DATA_VOLUME + CODE_SERVER_NETWORK are set (editors/sandboxes need both)
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
    cached = {
      ok: true, configured, reason: configured ? 'ok' : 'unconfigured',
      version: v?.Version ? String(v.Version) : null, error: null, checkedAt: Date.now(),
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
  else if (!st.configured) console.warn('[ccw] docker reachable but DATA_VOLUME/CODE_SERVER_NETWORK unset — editors and review sandboxes are disabled');
  else console.log(`[ccw] docker ${st.version || 'ok'}`);
  const ms = cfg.int('dockerProbeMs');
  if (ms <= 0) return;
  timer = setInterval(() => { void probeDocker().catch(() => {}); }, ms);
  timer.unref();
}
registerApply('dockerProbeMs', () => { void startDockerProbe(); });
