import os from 'node:os';
import Docker from 'dockerode';
import { config } from '../config.js';
import { cfg, registerApply } from '../lib/config-registry.js';

// ── shared headless browser ──
// A chat that turns the browser on gets Playwright's MCP tools (navigate, click, type, snapshot the
// DOM, screenshot, read console/network) so it can look at web pages and drive its own dev server.
// The browser lives in ONE sibling container for the whole workspace, reached over the internal
// network as a streamable-HTTP MCP server. Isolation is per MCP connection, not per container: every
// turn opens its own connection and the server gives it its own browser context (own tabs, cookies,
// storage), so two sessions never see each other's pages — measured, not assumed. That is why one
// container is enough: an idle chromium is ~80MB and each open context adds ~40MB.
//
// Two things the image needs to be told: `--host 0.0.0.0` so it listens beyond loopback, and
// `--allowed-hosts *` because it refuses any Host header but its bind address (a request to
// `ccw-browser:8931` gets 403 without it). `--shared-browser-context` must NEVER be added: it would
// pool every session into one context and hand one user's logged-in cookies to the next.
//
// Ceiling: a turn that dies without closing its MCP session leaves that context open in the browser
// (the server does not time them out). The idle reaper below removes the container once nobody has
// used it for browserIdleMs, which is what reclaims those; browserMemMB bounds it in between.

const docker = new Docker();
const NAME = 'ccw-browser';
const PORT = 8931;

let lastActive = 0;
let inflight: Promise<boolean> | null = null;

export function browserAvailable(): boolean {
  return cfg.bool('browserEnabled') && !!config.codeServer.network;
}

// The MCP server entry for a turn's options.mcpServers (key 'browser' → tools mcp__browser__*).
export function browserMcp() {
  return { type: 'http' as const, url: `http://${NAME}:${PORT}/mcp` };
}

async function removeIfExists() {
  try { await docker.getContainer(NAME).remove({ force: true }); } catch { /* absent */ }
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

// The server answers any request on /mcp once it is up (a bare GET gets a 400 — that is fine, it
// means the listener exists). Connection refused = still starting.
async function waitReady(timeoutMs = 20000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try { await fetch(browserMcp().url, { signal: AbortSignal.timeout(2000) }); return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('browser container did not become ready');
}

// Start the browser container if it is not running. Single-flight: two turns arriving at once must not
// both try to create the same name. Returns false when the browser cannot be had (the turn then runs
// without it, exactly as if the flag were off).
export function ensureBrowser(): Promise<boolean> {
  if (!browserAvailable()) return Promise.resolve(false);
  lastActive = Date.now();
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const info = await docker.getContainer(NAME).inspect();
      if (info?.State?.Running) return true;
    } catch { /* absent → create below */ }
    const image = cfg.str('browserImage');
    await ensureImage(image);
    await removeIfExists();
    const c = await docker.createContainer({
      name: NAME,
      Image: image,
      // Appended to the image's own entrypoint (`node cli.js --headless --browser chromium --no-sandbox`).
      Cmd: ['--isolated', '--port', String(PORT), '--host', '0.0.0.0', '--allowed-hosts', '*'],
      Labels: { 'ccw.browser': '1' },
      HostConfig: {
        NetworkMode: config.codeServer.network,
        AutoRemove: true,
        Init: true,
        Memory: cfg.int('browserMemMB') * 1024 * 1024,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
      },
    });
    await c.start();
    await waitReady();
    return true;
  })().catch(() => false).finally(() => { inflight = null; });
  return inflight;
}

// Appended to the turn's system prompt when the browser is attached. The one thing an agent gets
// wrong on its own is the address: inside the browser container `localhost` is the browser itself.
// `appHost` is where a server started with plain Bash lives (this container); `sandboxHost` is the
// session's build container when one is on, and takes precedence because that is where the hint for
// the build container already sends every dev server.
export function browserHint(appHost: string, sandboxHost: string | null): string {
  const own = sandboxHost
    ? `this session's build container, so use http://${sandboxHost}:<port> for anything started with mcp__sandbox__run (and http://${appHost}:<port> for a server started with Bash)`
    : `this container, so use http://${appHost}:<port>`;
  return [
    'BROWSER: this session has a headless browser — the `mcp__browser__*` tools (browser_navigate,',
    'browser_snapshot, browser_click, browser_type, browser_fill_form, browser_take_screenshot,',
    'browser_console_messages, browser_network_requests, …). It runs in a separate container, so',
    '`localhost` there is the browser itself, never your server. Your own dev server runs in',
    `${own}. The server must listen on 0.0.0.0, not 127.0.0.1 (vite: \`--host 0.0.0.0\`, next: \`-H 0.0.0.0\`,`,
    'python: `--bind 0.0.0.0`), or the browser gets ERR_CONNECTION_REFUSED. Prefer browser_snapshot',
    '(the accessibility tree as text) for reading a page; take a screenshot when layout or a visual',
    'matters — screenshots are shown to the user as images. File paths a browser tool mentions',
    '(.playwright-mcp/…) are inside the browser container and cannot be read from here.',
  ].join(' ');
}

// Where a server started in the app container is reachable from the browser: this container's own
// hostname, which Docker's DNS resolves on the shared network (compose names it claudecode-app, a
// plain `docker run` may not, and the container id is what os.hostname() returns either way).
export function appHost(): string { return os.hostname(); }

export async function removeBrowser(): Promise<void> {
  await removeIfExists();
}

// Admin process panel: stop the browser container by docker id (it is recreated on the next turn that wants it).
export async function killBrowser(id: string): Promise<boolean> {
  try {
    const info = await docker.getContainer(id).inspect();
    if ((info.Name || '').replace(/^\//, '') !== NAME) return false;
    await docker.getContainer(id).remove({ force: true });
    return true;
  } catch { return false; }
}

// Boot cleanup: a container left from a previous run may hold contexts nobody can close any more.
export async function removeAllBrowsers(): Promise<number> {
  if (!config.codeServer.network) return 0;
  let removed = 0;
  try {
    const list = await docker.listContainers({ all: true, filters: { label: ['ccw.browser=1'] } });
    for (const c of list) { try { await docker.getContainer(c.Id).remove({ force: true }); removed++; } catch { /* ignore */ } }
  } catch { /* docker unavailable */ }
  return removed;
}

let reaperTimer: ReturnType<typeof setInterval> | null = null;
function sweep() {
  if (lastActive && Date.now() - lastActive > cfg.int('browserIdleMs')) {
    lastActive = 0;
    removeIfExists().catch(() => {});
  }
}
export function startBrowserReaper() { scheduleReaper(); }
function scheduleReaper() {
  if (reaperTimer) { clearInterval(reaperTimer); reaperTimer = null; }
  reaperTimer = setInterval(sweep, cfg.int('browserReaperMs'));
  reaperTimer.unref();
}
registerApply('browserReaperMs', () => scheduleReaper());
