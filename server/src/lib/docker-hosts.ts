import fs from 'node:fs';
import path from 'node:path';
import Docker from 'dockerode';
import { cfg, registerApply } from './config-registry.js';

// ── second Docker daemon: a Windows build host ──
//
// Everything else in the app talks to ONE daemon through the mounted socket, and that daemon is the
// Linux one the app itself runs on. A .NET Framework build cannot run there: MSBuild for Framework
// only exists in a Windows container, and a single daemon cannot run Linux and Windows containers at
// the same time. So a second daemon — on a Windows machine, reached over TCP — is the only way in.
//
// Two things follow from it being remote, and they shape claude/win-sandbox.ts:
//   • No shared volume. The Linux data volume cannot be mounted into a Windows container, so the
//     project is COPIED in as a tar archive instead of mounted.
//   • No shared network. The remote containers are not on CODE_SERVER_NETWORK, so nothing reaches
//     them by name; only this exec channel talks to them.
//
// Security: `tcp://…:2375` with no certificates gives every machine that can reach that port full
// control of the Windows host. Point winDockerHost at a TLS endpoint (2376) and set winDockerCertDir
// unless the host is on a network you fully trust. The cert dir is read from disk (the same
// ca.pem/cert.pem/key.pem layout the docker CLI uses) rather than stored in the database, so the
// client key never lives in the app's own state.

export interface DockerEndpoint { host: string; port: number; protocol: 'http' | 'https' }

// `tcp://win-build:2376` | `https://10.0.0.5` | `win-build:2375` | `[::1]:2376` → parts.
// `tls` (the operator configured a cert dir) decides the scheme and default port when the value
// carries no scheme of its own. Returns null for anything that is not a reachable TCP endpoint —
// a unix socket or a named pipe cannot be another host, so it is a configuration mistake, not a
// second daemon.
export function parseDockerHost(raw: string, tls: boolean): DockerEndpoint | null {
  const s = (raw || '').trim();
  if (!s) return null;
  const m = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(s);
  let scheme = m ? m[1].toLowerCase() : '';
  let rest = m ? m[2] : s;
  if (scheme && !['tcp', 'http', 'https'].includes(scheme)) return null; // unix:// npipe:// ssh://
  rest = rest.replace(/\/+$/, '');
  if (rest.includes('/')) return null; // a path is not part of a daemon address
  let host = rest;
  let port = 0;
  const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(rest);
  if (v6) { host = v6[1]; port = Number(v6[2] || 0); }
  else {
    const i = rest.lastIndexOf(':');
    if (i > 0 && !rest.slice(i + 1).includes(':')) { host = rest.slice(0, i); port = Number(rest.slice(i + 1)); }
  }
  // A leftover ':' means the address carried no hostname (':2376') or is an unbracketed IPv6 —
  // bracketed IPv6 is exempt, its colons are the address.
  if (!host || /[\s@]/.test(host) || (!v6 && host.includes(':'))) return null;
  if (port && (!Number.isInteger(port) || port < 1 || port > 65535)) return null;
  const secure = scheme === 'https' || (scheme !== 'http' && tls);
  return { host, port: port || (secure ? 2376 : 2375), protocol: secure ? 'https' : 'http' };
}

// ca.pem / cert.pem / key.pem, the layout `docker --tlsverify` expects. A dir that is set but
// unreadable is reported rather than silently downgraded to plain HTTP — a silent downgrade would
// expose the daemon while the admin panel still said TLS.
export interface DockerCerts { ca?: Buffer; cert?: Buffer; key?: Buffer }
export function readCertDir(dir: string): DockerCerts {
  const d = (dir || '').trim();
  if (!d) return {};
  const out: DockerCerts = {};
  for (const [field, file] of [['ca', 'ca.pem'], ['cert', 'cert.pem'], ['key', 'key.pem']] as const) {
    const p = path.join(d, file);
    try { (out as any)[field] = fs.readFileSync(p); }
    catch (e: any) { throw new Error(`winDockerCertDir: cannot read ${p} (${e?.code || e?.message || e})`); }
  }
  return out;
}

export function winDockerConfigured(): boolean {
  return !!parseDockerHost(cfg.str('winDockerHost'), !!cfg.str('winDockerCertDir').trim());
}

// The remote client, built from live config and memoized until one of those keys is edited.
let client: Docker | null = null;
let clientError: string | null = null;
let clientKey = '';

export function winDocker(): Docker | null {
  const key = `${cfg.str('winDockerHost')}|${cfg.str('winDockerCertDir')}|${cfg.int('winDockerTimeoutMs')}`;
  if (client && key === clientKey) return client;
  client = null; clientError = null; clientKey = key;
  const certDir = cfg.str('winDockerCertDir').trim();
  const ep = parseDockerHost(cfg.str('winDockerHost'), !!certDir);
  if (!ep) { if (cfg.str('winDockerHost').trim()) clientError = 'winDockerHost must be a tcp:// host[:port]'; return null; }
  try {
    const certs = ep.protocol === 'https' ? readCertDir(certDir) : {};
    client = new Docker({ host: ep.host, port: ep.port, protocol: ep.protocol, timeout: cfg.int('winDockerTimeoutMs'), ...certs } as any);
  } catch (e: any) { clientError = String(e?.message || e); return null; }
  return client;
}
export function winDockerError(): string | null { winDocker(); return clientError; }
registerApply('winDockerHost', () => { client = null; });
registerApply('winDockerCertDir', () => { client = null; });
registerApply('winDockerTimeoutMs', () => { client = null; });

// ── reachability ──
// Probed on demand (the admin panel's test button) and cached, so the build path can refuse fast
// with the real reason instead of stalling a turn on a dead endpoint. `os` matters as much as
// reachability: pointing this at another LINUX daemon by mistake would start containers that cannot
// build anything, and the error would surface as a confusing MSBuild-not-found much later.
export interface WinDockerStatus {
  configured: boolean; ok: boolean; os: string | null; version: string | null;
  error: string | null; checkedAt: number;
}
let cached: WinDockerStatus = { configured: false, ok: false, os: null, version: null, error: null, checkedAt: 0 };
export function winDockerStatus(): WinDockerStatus { return cached; }

export async function probeWinDocker(): Promise<WinDockerStatus> {
  const configured = winDockerConfigured();
  if (!configured) {
    cached = { configured: false, ok: false, os: null, version: null, error: winDockerError(), checkedAt: Date.now() };
    return cached;
  }
  const d = winDocker();
  try {
    if (!d) throw new Error(clientError || 'no client');
    const v: any = await d.version();
    const os = String(v?.Os || '').toLowerCase() || null;
    cached = {
      configured: true, ok: os === 'windows', os, version: v?.Version ? String(v.Version) : null,
      error: os === 'windows' ? null : `daemon reports Os="${os}" — a Windows daemon is required for .NET Framework builds`,
      checkedAt: Date.now(),
    };
  } catch (e: any) {
    cached = { configured: true, ok: false, os: null, version: null, error: String(e?.message || e).slice(0, 300), checkedAt: Date.now() };
  }
  return cached;
}
