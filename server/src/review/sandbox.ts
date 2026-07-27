import path from 'node:path';
import Docker from 'dockerode';
import { z } from 'zod';
import { config } from '../config.js';

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
  await ensureImage(config.reviewSandbox.image);
  const vol = config.codeServer.dataVolume;
  const c = await docker.createContainer({
    name,
    Image: config.reviewSandbox.image,
    // stay alive a bit longer than a turn can, then self-exit; removed explicitly at turn end
    Cmd: ['sleep', String(Math.ceil(config.reviewTurnTimeoutMs / 1000) + 300)],
    WorkingDir: '/work',
    Labels: { 'ccw.reviewsandbox': '1' },
    HostConfig: {
      NetworkMode: config.codeServer.network,
      AutoRemove: true,
      Mounts: [{ Type: 'volume', Source: vol, Target: '/work', VolumeOptions: { Subpath: subpathOf(worktreePath) } as any }],
      Memory: config.reviewSandbox.memBytes,
      PidsLimit: 1024,
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

// Boot cleanup: drop sandbox containers left over from a prior run (in-memory only otherwise).
export async function cleanupSandboxOrphans(): Promise<void> {
  if (!sandboxAvailable()) return;
  try {
    const list = await docker.listContainers({ all: true, filters: { label: ['ccw.reviewsandbox=1'] } });
    for (const c of list) { try { await docker.getContainer(c.Id).remove({ force: true }); } catch { /* ignore */ } }
  } catch { /* docker unavailable */ }
}

// Run a command inside the sandbox (TTY → raw combined stdout+stderr, no multiplex headers).
// On timeout we return the partial output + code 124 and move on; the lingering process dies when
// the container is removed at turn end.
async function execInSandbox(name: string, command: string, timeoutMs: number): Promise<{ code: number; output: string }> {
  const MAX = 60_000;
  const exec = await docker.getContainer(name).exec({
    Cmd: ['sh', '-lc', command], AttachStdout: true, AttachStderr: true, Tty: true, WorkingDir: '/work',
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
export async function sandboxMcpServer(containerName: string, execTimeoutMs: number) {
  const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk');
  return createSdkMcpServer({
    name: 'sandbox',
    version: '1.0.0',
    tools: [
      tool(
        'run',
        'Run a shell command inside the isolated review sandbox container (cwd = the merged PR worktree at /work). This is the ONLY way to build/run/test the PR code; the host shell is unavailable. Returns "exit=<code>" then combined stdout/stderr.',
        { command: z.string().describe('shell command, e.g. "npm ci && npm run build && npm test"') },
        async (args: { command: string }) => {
          const r = await execInSandbox(containerName, String(args.command), execTimeoutMs);
          return { content: [{ type: 'text' as const, text: `exit=${r.code}\n${r.output}` }] };
        },
      ),
    ],
  });
}
