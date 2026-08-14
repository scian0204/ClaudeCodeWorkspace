import path from 'node:path';
import Docker from 'dockerode';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config.js';
import { cfg } from '../lib/config-registry.js';
import { db, schema } from '../db/index.js';

// Per-PR build sandbox. Review turns must not run untrusted PR build/test code in the app container
// (which has the Docker socket ≈ host root). Instead we spawn a locked-down sibling container with
// ONLY the PR worktree mounted, NO docker socket, all caps dropped, no-new-privileges, and memory/
// pid limits, and expose a single `run` MCP tool that execs inside it. Host `Bash` is denied for
// review turns (see session-manager), so PR code can only execute in here.
// Ceiling: network egress stays enabled (npm/pip/go need it) — documented in the security posture.

const docker = new Docker();

export function sandboxAvailable(): boolean {
  return !!config.codeServer.dataVolume && !!config.codeServer.network;
}

function nameFor(repoId: string, pr: number): string {
  return `ccw-rvsbx-${repoId}-${pr}`.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 60);
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

// Spawn (or reuse) the sandbox for a review's worktree. Returns the container name.
export async function ensureSandbox(repoId: string, pr: number, worktreePath: string): Promise<string> {
  const name = nameFor(repoId, pr);
  try {
    const info = await docker.getContainer(name).inspect();
    if (info?.State?.Running) return name;
    await docker.getContainer(name).remove({ force: true });
  } catch { /* not present → create */ }
  // per-repo image override; falls back to the global default when unset (blank → node/etc. per admin config)
  const repoRow = db.select().from(schema.reviewRepos).where(eq(schema.reviewRepos.id, repoId)).get();
  const image = repoRow?.sandboxImage?.trim() || cfg.str('reviewSandboxImage');
  await ensureImage(image);
  const vol = config.codeServer.dataVolume;
  // Mount the whole review repo dir (reviews/<id>) at its real absolute path so the git worktree's
  // `.git` file (which references the main clone's gitdir by absolute path) resolves and `git diff`
  // works. Subpath keeps it scoped to this repo only — no other users' data is exposed.
  const repoRootAbs = path.resolve(worktreePath, '..', '..'); // <data>/reviews/<id>
  const c = await docker.createContainer({
    name,
    Image: image,
    // stay alive a bit longer than a turn can, then self-exit; removed explicitly at turn end
    Cmd: ['sleep', String(Math.ceil(cfg.int('reviewTurnTimeoutMs') / 1000) + 300)],
    WorkingDir: worktreePath,
    Labels: { 'ccw.reviewsandbox': '1' },
    HostConfig: {
      NetworkMode: config.codeServer.network,
      AutoRemove: true,
      Mounts: [{ Type: 'volume', Source: vol, Target: repoRootAbs, VolumeOptions: { Subpath: subpathOf(repoRootAbs) } as any }],
      Memory: cfg.int('reviewSandboxMemMB') * 1024 * 1024,
      PidsLimit: cfg.int('reviewSandboxPidsLimit'),
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
    },
  });
  await c.start();
  return name;
}

export async function removeSandbox(repoId: string, pr: number): Promise<void> {
  await removeIfExists(nameFor(repoId, pr));
}

// Admin process panel: kill ONE sandbox container by id. Sandboxes hold no in-memory state, so a
// direct remove is fully consistent. Returns success.
export async function killSandbox(id: string): Promise<boolean> {
  if (!sandboxAvailable()) return false;
  try { await docker.getContainer(id).remove({ force: true }); return true; }
  catch { return false; }
}

// Boot cleanup: drop sandbox containers left over from a prior run (in-memory only otherwise).
export async function cleanupSandboxOrphans(): Promise<void> {
  await removeAllSandboxes();
}

// Same labeled sweep as boot cleanup, but returns the count removed (for the admin "clean sandboxes"
// action). Sandboxes hold no in-memory state, so the sweep alone is fully consistent.
export async function removeAllSandboxes(): Promise<number> {
  if (!sandboxAvailable()) return 0;
  let removed = 0;
  try {
    const list = await docker.listContainers({ all: true, filters: { label: ['ccw.reviewsandbox=1'] } });
    for (const c of list) { try { await docker.getContainer(c.Id).remove({ force: true }); removed++; } catch { /* ignore */ } }
  } catch { /* docker unavailable */ }
  return removed;
}

// Run a command inside the sandbox (TTY → raw combined stdout+stderr, no multiplex headers).
// On timeout we return the partial output + code 124 and move on; the lingering process dies when
// the container is removed at turn end.
export async function execInSandbox(name: string, cwd: string, command: string, timeoutMs: number, maxBytes?: number): Promise<{ code: number; output: string }> {
  const MAX = maxBytes ?? cfg.int('reviewSandboxMaxOutputBytes');
  const exec = await docker.getContainer(name).exec({
    Cmd: ['sh', '-lc', command], AttachStdout: true, AttachStderr: true, Tty: true, WorkingDir: cwd,
  });
  const stream: any = await exec.start({ hijack: true, stdin: false, Tty: true } as any);
  let out = '';
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (code: number) => { if (settled) return; settled = true; resolve({ code, output: out.slice(0, MAX) }); };
    const to = setTimeout(() => { out += `\n[sandbox: command exceeded ${Math.round(timeoutMs / 1000)}s — aborted]`; finish(124); }, timeoutMs);
    stream.on('data', (d: Buffer) => { if (out.length < MAX) out += d.toString('utf8'); });
    stream.on('end', async () => { clearTimeout(to); let code = 0; try { code = (await exec.inspect()).ExitCode ?? 0; } catch { /* keep 0 */ } finish(code); });
    stream.on('error', () => { clearTimeout(to); finish(1); });
  });
}

// In-process MCP server exposing the sandbox as a single `run` tool (agent-facing name:
// mcp__sandbox__run). Async because the SDK is dynamically imported (matches session-manager).
const REVIEW_RUN_DESC = 'Run a shell command inside the isolated review sandbox container (cwd = the merged PR worktree). This is the ONLY way to build/run/test the PR code; the host shell is unavailable. git works here too. Returns "exit=<code>" then combined stdout/stderr.';

export async function sandboxMcpServer(containerName: string, cwd: string, execTimeoutMs: number, opts?: { description?: string; maxBytes?: number }) {
  const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk');
  return createSdkMcpServer({
    name: 'sandbox',
    version: '1.0.0',
    tools: [
      tool(
        'run',
        opts?.description || REVIEW_RUN_DESC,
        { command: z.string().describe('shell command, e.g. "npm ci && npm run build && npm test"') },
        async (args: { command: string }) => {
          const r = await execInSandbox(containerName, cwd, String(args.command), execTimeoutMs, opts?.maxBytes);
          return { content: [{ type: 'text' as const, text: `exit=${r.code}\n${r.output}` }] };
        },
      ),
    ],
  });
}
