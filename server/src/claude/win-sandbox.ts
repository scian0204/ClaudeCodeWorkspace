import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import tarFs from 'tar-fs';
import { config } from '../config.js';
import { cfg, registerApply } from '../lib/config-registry.js';
import { winDocker, winDockerConfigured, winDockerError, winDockerStatus, probeWinDocker } from '../lib/docker-hosts.js';

// ── Windows build container (.NET Framework) ──
//
// A session can send its builds to a container on a WINDOWS Docker host instead of the local Linux
// one. That is the only way to run MSBuild for .NET Framework: the compiler exists solely in a
// Windows container, and one daemon cannot run Linux and Windows containers together — hence the
// second daemon in lib/docker-hosts.ts.
//
// The remote daemon cannot see the data volume, so the project is COPIED IN as a tar archive before
// each command and the container keeps it at C:\project. What that means in practice:
//   • Edits made with the ordinary tools (Edit/Write/Bash on the host copy) reach the next command.
//   • Files the BUILD writes — bin\, obj\, NuGet packages — stay in the container. They persist
//     between commands (the container is kept alive and reaped on idle, so incremental builds and
//     `nuget restore` are not repeated), but they never come back to the project dir.
//   • A file deleted on the host is not deleted in the container: an archive extraction only adds
//     and overwrites. A stale file that keeps failing a build is cleared by turning the sandbox off
//     and on again, which recreates the container.
// Ceiling: whole-tree resend on any change (no per-file diff). It is skipped entirely when nothing
// under the project changed since the last copy, so a run of read-only commands costs nothing.
//
// Not used for PR review. Review sandboxes exist to run untrusted code, and the hardening they rely
// on (CapDrop, no-new-privileges) is Linux-only — a Windows container would silently drop it.

const LABEL = 'ccw.winsandbox';

interface Instance {
  sessionId: string; name: string; cwd: string; lastActive: number;
  syncedMtime: number;      // newest mtime already copied in — 0 until the first copy
  starting?: Promise<void>;
}
const instances = new Map<string, Instance>();

export function winSandboxAvailable(): boolean {
  return cfg.bool('winSandboxEnabled') && winDockerConfigured();
}

function nameFor(sessionId: string): string {
  return `ccw-winsbx-${sessionId}`.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 60);
}

// ── pure helpers (win-sandbox.test.ts) ──

/** `.git, node_modules ,bin` → ['.git','node_modules','bin']; blanks dropped. */
export function parseExcludes(csv: string): string[] {
  return (csv || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Should this path be left out of the copy? Matches a pattern against the path's own name, not the
 * whole path, so `bin` excludes every bin dir at any depth — which is what a build tree needs.
 * `*.suffix` and `prefix*` are honoured; matching is case-insensitive because the destination is
 * Windows. Symlinks are always skipped: a Windows container mostly cannot create them, and following
 * one could walk out of the project (or in a circle).
 */
export function makeSkip(excludes: string[], lstat: (p: string) => { isSymbolicLink(): boolean } = (p) => fs.lstatSync(p)) {
  const pats = excludes.map((e) => e.toLowerCase());
  return (absPath: string): boolean => {
    const base = path.basename(absPath).toLowerCase();
    for (const p of pats) {
      if (p.startsWith('*') ? base.endsWith(p.slice(1)) : p.endsWith('*') ? base.startsWith(p.slice(0, -1)) : base === p) return true;
    }
    try { if (lstat(absPath).isSymbolicLink()) return true; } catch { return true; } // vanished mid-walk
    return false;
  };
}

export interface TreeScan { bytes: number; files: number; newestMtime: number; over: boolean }

/**
 * Walk the project once to answer two questions before anything is sent: is it small enough to copy,
 * and has anything changed since the last copy. Stops as soon as the byte cap is passed (`over`), so
 * an accidentally huge tree costs a partial walk instead of a multi-GB upload.
 */
export function scanTree(root: string, skip: (p: string) => boolean, capBytes: number): TreeScan {
  let bytes = 0, files = 0, newestMtime = 0;
  const queue: string[] = [root];
  while (queue.length) {
    const dir = queue.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (skip(abs)) continue;
      if (e.isDirectory()) { queue.push(abs); continue; }
      if (!e.isFile()) continue;
      let st: fs.Stats;
      try { st = fs.statSync(abs); } catch { continue; }
      bytes += st.size; files++;
      if (st.mtimeMs > newestMtime) newestMtime = st.mtimeMs;
      if (bytes > capBytes) return { bytes, files, newestMtime, over: true };
    }
  }
  return { bytes, files, newestMtime, over: false };
}

/** How a command is handed to Windows. cmd is the default: MSBuild/NuGet docs are written for it. */
export function shellArgv(shell: string, command: string): string[] {
  return shell === 'powershell'
    ? ['powershell', '-NoProfile', '-NonInteractive', '-Command', command]
    : ['cmd', '/S', '/C', command];
}

// ── container lifecycle ──

async function removeIfExists(name: string) {
  const d = winDocker(); if (!d) return;
  try { await d.getContainer(name).remove({ force: true }); } catch { /* absent */ }
}

async function ensureImage(image: string) {
  const d = winDocker(); if (!d) throw new Error(winDockerError() || 'windows docker not configured');
  try { await d.getImage(image).inspect(); return; } catch { /* pull below */ }
  await new Promise<void>((resolve, reject) => {
    d.pull(image, (err: any, stream: any) => {
      if (err) return reject(err);
      d.modem.followProgress(stream, (e: any) => (e ? reject(e) : resolve()));
    });
  });
}

/**
 * Spawn (or reuse) this session's Windows build container. Returns its name, or null when the remote
 * host cannot serve it — the caller then runs without a sandbox, exactly as before the feature.
 * The multi-GB Framework SDK image is NOT pulled on demand here if it is missing and the admin never
 * pulled it: the first pull can take tens of minutes, which would look like a hung turn. It is
 * attempted anyway, but only after the daemon answered, so the failure is a clear error.
 */
export async function ensureWinSandbox(sessionId: string, cwd: string): Promise<string | null> {
  if (!winSandboxAvailable()) return null;
  const rel = path.relative(config.dataDir, cwd);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null; // outside the workspace's own data
  if (!fs.existsSync(cwd)) return null;

  const st = winDockerStatus();
  if (!st.ok && Date.now() - st.checkedAt > cfg.int('winDockerProbeTtlMs')) await probeWinDocker().catch(() => {});
  if (!winDockerStatus().ok) return null;

  const existing = instances.get(sessionId);
  if (existing && existing.cwd === cwd) {
    existing.lastActive = Date.now();
    if (existing.starting) await existing.starting.catch(() => {});
    try {
      const d = winDocker();
      if (d && (await d.getContainer(existing.name).inspect())?.State?.Running) return existing.name;
    } catch { /* died between turns → recreate below */ }
    instances.delete(sessionId);
  } else if (existing) {
    await stop(existing).catch(() => {}); // the session switched project → the copy inside is the wrong tree
  }

  const name = nameFor(sessionId);
  const inst: Instance = { sessionId, name, cwd, lastActive: Date.now(), syncedMtime: 0 };
  instances.set(sessionId, inst);
  inst.starting = (async () => {
    const d = winDocker(); if (!d) throw new Error('windows docker not configured');
    const image = cfg.str('winSandboxImage');
    const workdir = cfg.str('winSandboxWorkdir');
    const isolation = cfg.str('winSandboxIsolation');
    await ensureImage(image);
    await removeIfExists(name);
    const c = await d.createContainer({
      name,
      Image: image,
      // Kept alive between turns so bin\, obj\ and restored packages survive; the reaper below
      // removes it once the session goes idle. `ping -t` is the one idle loop present in every
      // Windows base image (Server Core and Nano Server alike).
      Cmd: ['cmd', '/S', '/C', 'ping -t localhost > NUL'],
      WorkingDir: workdir, // Docker creates it, which is also what the archive extraction needs
      Labels: { [LABEL]: '1', 'ccw.session': sessionId },
      HostConfig: {
        AutoRemove: true,
        Memory: cfg.int('winSandboxMemMB') * 1024 * 1024,
        // Windows has no CapDrop / no-new-privileges / PidsLimit — sending them errors on the daemon.
        ...(isolation === 'default' ? {} : { Isolation: isolation }),
      },
    });
    await c.start();
  })();
  try { await inst.starting; }
  catch (e) { instances.delete(sessionId); console.warn(`[ccw] windows sandbox failed: ${String((e as any)?.message || e).slice(0, 200)}`); return null; }
  return name;
}

/**
 * Copy the project into the container, unless nothing changed since the last copy. Returns a short
 * line for the command output when it did something or refused, so the agent can see why a build ran
 * against an unchanged tree. Throws only when the tree is too big to send — a refusal the agent must
 * not mistake for a build failure.
 */
export async function syncProject(sessionId: string): Promise<string | null> {
  const inst = instances.get(sessionId);
  const d = winDocker();
  if (!inst || !d) return null;
  const skip = makeSkip(parseExcludes(cfg.str('winSandboxSyncExclude')));
  const cap = cfg.int('winSandboxSyncMaxMB') * 1024 * 1024;
  const scan = scanTree(inst.cwd, skip, cap);
  if (scan.over) {
    throw new Error(
      `project is larger than winSandboxSyncMaxMB (${cfg.int('winSandboxSyncMaxMB')}MB) after exclusions — ` +
      'raise that setting or add build/output dirs to winSandboxSyncExclude',
    );
  }
  if (scan.newestMtime && scan.newestMtime <= inst.syncedMtime) return null; // nothing to send
  const workdir = cfg.str('winSandboxWorkdir');
  const stream = tarFs.pack(inst.cwd, { ignore: skip });
  await d.getContainer(inst.name).putArchive(stream as any, { path: workdir });
  inst.syncedMtime = Math.max(scan.newestMtime, inst.syncedMtime);
  return `[copied ${scan.files} files (${Math.round(scan.bytes / 1e6)}MB) to ${workdir}]`;
}

/** Run one command in the container. TTY → raw combined stdout+stderr, no multiplex headers. */
export async function execInWinSandbox(name: string, command: string, timeoutMs: number, maxBytes: number): Promise<{ code: number; output: string }> {
  const d = winDocker();
  if (!d) return { code: 1, output: 'windows docker not configured' };
  const exec = await d.getContainer(name).exec({
    Cmd: shellArgv(cfg.str('winSandboxShell'), command),
    AttachStdout: true, AttachStderr: true, Tty: true, WorkingDir: cfg.str('winSandboxWorkdir'),
  });
  const stream: any = await exec.start({ hijack: true, stdin: false, Tty: true } as any);
  let out = '';
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (code: number) => { if (settled) return; settled = true; resolve({ code, output: out.slice(0, maxBytes) }); };
    const to = setTimeout(() => { out += `\n[windows sandbox: command exceeded ${Math.round(timeoutMs / 1000)}s — aborted]`; finish(124); }, timeoutMs);
    stream.on('data', (b: Buffer) => { if (out.length < maxBytes) out += b.toString('utf8'); });
    stream.on('end', async () => { clearTimeout(to); let code = 0; try { code = (await exec.inspect()).ExitCode ?? 0; } catch { /* keep 0 */ } finish(code); });
    stream.on('error', () => { clearTimeout(to); finish(1); });
  });
}

// The MCP `run` tool for one session's Windows container: copy the project in, then exec.
export async function winSandboxMcp(sessionId: string, containerName: string) {
  const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk');
  const workdir = cfg.str('winSandboxWorkdir');
  return createSdkMcpServer({
    name: 'sandbox',
    version: '1.0.0',
    tools: [
      tool(
        'run',
        `Run a command inside THIS session's own WINDOWS build container (cwd = ${workdir}, a copy of the project). ` +
        'Use it for anything that builds, restores or tests .NET Framework code — msbuild, nuget, dotnet, vstest.console, ' +
        'and any Windows-only tool. The project files are copied in fresh before every command, so edits made with the ' +
        'ordinary file tools are picked up; build output stays inside the container between commands. ' +
        'Returns "exit=<code>" then combined stdout/stderr.',
        { command: z.string().describe('Windows shell command, e.g. "nuget restore Foo.sln && msbuild Foo.sln /p:Configuration=Release"') },
        async (args: { command: string }) => {
          const inst = instances.get(sessionId);
          if (inst) inst.lastActive = Date.now();
          let note: string | null = null;
          try { note = await syncProject(sessionId); }
          catch (e: any) { return { content: [{ type: 'text' as const, text: `exit=1\n${String(e?.message || e)}` }] }; }
          const r = await execInWinSandbox(containerName, String(args.command), cfg.int('winSandboxExecTimeoutMs'), cfg.int('winSandboxMaxOutputBytes'));
          return { content: [{ type: 'text' as const, text: `exit=${r.code}\n${note ? note + '\n' : ''}${r.output}` }] };
        },
      ),
    ],
  });
}

// Appended to the turn's system prompt (never shown in the transcript). The path difference is the
// part the agent gets wrong on its own: it edits /data/... and then tries to build there.
export function winSandboxHint(cwd: string): string {
  const workdir = cfg.str('winSandboxWorkdir');
  return [
    'WINDOWS BUILD CONTAINER: this session builds on a Windows Docker host, so .NET Framework work is',
    'possible here. Run ANY build/restore/test command with the `mcp__sandbox__run` tool — msbuild,',
    'nuget, dotnet, vstest.console, powershell — never with `Bash`; the host shell is Linux and has no',
    `MSBuild. Inside the container the project is at ${workdir} (Windows paths, backslashes); on the`,
    `host shell the same project is at ${cwd}. Edit files with the ordinary tools on the host path —`,
    'they are copied into the container before each command. Build output (bin, obj, packages) stays in',
    'the container and persists between commands, so incremental builds work; it never appears on the',
    'host path, so do not look for it there. Keep using `Bash` for git, search and file inspection.',
  ].join(' ');
}

// ── teardown / admin ──

async function stop(inst: Instance) {
  instances.delete(inst.sessionId);
  await removeIfExists(inst.name);
}

export async function removeWinSandbox(sessionId: string): Promise<void> {
  const inst = instances.get(sessionId);
  if (inst) await stop(inst).catch(() => {});
  else if (winDockerConfigured()) await removeIfExists(nameFor(sessionId));
}

/** Admin process panel: the Windows containers this app spawned, on the remote daemon. */
export async function listWinSandboxes(): Promise<{ id: string; name: string; state: string; createdAt: number }[]> {
  const d = winDocker();
  if (!d || !cfg.bool('winSandboxEnabled')) return [];
  const list = await d.listContainers({ all: true, filters: { label: [`${LABEL}=1`] } });
  return list.map((c) => ({
    id: c.Id.slice(0, 12), name: (c.Names?.[0] || '').replace(/^\//, ''),
    state: c.State, createdAt: (c.Created || 0) * 1000,
  }));
}

/** Admin process panel: kill ONE Windows container by docker id. */
export async function killWinSandbox(id: string): Promise<boolean> {
  const d = winDocker();
  if (!d) return false;
  try {
    const info = await d.getContainer(id).inspect();
    const name = (info.Name || '').replace(/^\//, '');
    const inst = [...instances.values()].find((i) => i.name === name);
    if (inst) { await stop(inst); return true; }
    await d.getContainer(id).remove({ force: true });
    return true;
  } catch { return false; }
}

/** Labeled sweep — boot cleanup (the registry is in-memory) and the admin "clean sandboxes" action. */
export async function removeAllWinSandboxes(): Promise<number> {
  instances.clear();
  const d = winDocker();
  if (!d) return 0;
  let removed = 0;
  try {
    const list = await d.listContainers({ all: true, filters: { label: [`${LABEL}=1`] } });
    for (const c of list) { try { await d.getContainer(c.Id).remove({ force: true }); removed++; } catch { /* ignore */ } }
  } catch { /* remote unreachable */ }
  return removed;
}

let reaperTimer: ReturnType<typeof setInterval> | null = null;
function sweep() {
  const now = Date.now();
  const idleMs = cfg.int('winSandboxIdleMs');
  for (const inst of [...instances.values()]) {
    if (now - inst.lastActive > idleMs) stop(inst).catch(() => {});
  }
}
export function startWinReaper() { scheduleWinReaper(); }
export function scheduleWinReaper() {
  if (reaperTimer) { clearInterval(reaperTimer); reaperTimer = null; }
  reaperTimer = setInterval(sweep, cfg.int('winSandboxReaperMs'));
  reaperTimer.unref();
}
registerApply('winSandboxReaperMs', () => scheduleWinReaper());
