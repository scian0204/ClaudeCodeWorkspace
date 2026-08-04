import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import Docker from 'dockerode';
import { cfg, registerApply } from '../lib/config-registry.js';
import { getSetting, setSetting } from '../lib/settings.js';
import { pullImage } from '../lib/docker-images.js';

// Self-update: compare the running app version against the published image, then swap this very
// container for one built from the new image.
//
// A container cannot recreate itself (the process dies mid-swap), so the actual swap runs in a
// short-lived HELPER container started from the freshly pulled image (guaranteed present, has node +
// dockerode + the docker socket). The helper's order is deliberate and downtime-minimal:
//   1. create the replacement under a temp name  → validates the whole spec while we're still up
//   2. graceful stop + remove the old container  → lets SQLite checkpoint (no SIGKILL)
//   3. rename temp → real name, start it
//   4. watch it for healthWaitMs; if it crash-loops or exits, remove it and bring the OLD image back
// So a bad spec never causes downtime, and a bad image is rolled back automatically.
//
// The outcome is reconciled at the next boot (reconcileSelfUpdate) by comparing our own image id
// against the ids recorded before the swap — exact, and it needs nothing to survive in memory.

const docker = new Docker();

const STATE_KEY = 'self_update_state';
const HELPER_NAME = 'ccw-selfupdate';
const HELPER_LABEL = 'ccw.selfupdate';
// The image we were running before the last update, kept tagged so a rollback lands on a real ref.
const PREV_TAG = 'ccw-previous';
// ponytail: fixed grace so the old process can flush the HTTP response that triggered the update
// before the helper stops it. Raise only if slow clients ever see a truncated reply.
const SWAP_DELAY_MS = 1500;
// A recorded 'applying' phase older than this with no verdict = the helper never finished.
const APPLY_STALE_MS = 30 * 60_000;

export type UpdatePhase = 'applying' | 'done' | 'rolled-back' | 'failed' | 'unknown';
export interface UpdateRecord {
  phase: UpdatePhase;
  fromVersion: string;
  toImage: string;
  fromImageId?: string;
  toImageId?: string;
  startedAt: number;
  finishedAt?: number;
  version?: string;   // app version observed when the outcome was decided
  log?: string;       // helper container log tail (failures only)
}

// ── app version (root package.json ships in the image at /app/package.json) ──
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let versionCache: string | null = null;
export function appVersion(): string {
  if (versionCache) return versionCache;
  for (const p of [path.resolve(__dirname, '../../../package.json'), path.resolve(process.cwd(), 'package.json')]) {
    try {
      const v = JSON.parse(fs.readFileSync(p, 'utf8'))?.version;
      if (v && typeof v === 'string') { versionCache = v; return v; }
    } catch { /* try next */ }
  }
  versionCache = 'unknown';
  return versionCache;
}

// ── image ref parsing ──
// `[registry[:port]/]repo[:tag][@digest]`. Docker Hub is the only registry whose "what's published"
// API we speak; anything else can still be pulled by tag, only the version check is unavailable.
export interface ParsedRef { registry: string; repo: string; tag: string; hub: boolean }
const HUB_HOSTS = new Set(['docker.io', 'index.docker.io', 'registry-1.docker.io', 'registry.hub.docker.com']);
export function parseRef(ref: string): ParsedRef {
  // a bare image id (`docker run <sha>`, or a rollback that recreated by id) carries no repo at all
  if (/^(sha256:)?[0-9a-f]{12,}$/.test(ref)) return { registry: '', repo: '', tag: '', hub: false };
  const noDigest = ref.split('@')[0];
  const slash = noDigest.indexOf('/');
  const head = slash === -1 ? '' : noDigest.slice(0, slash);
  const hasRegistry = !!head && (head.includes('.') || head.includes(':') || head === 'localhost');
  const registry = hasRegistry ? head : '';
  let rest = hasRegistry ? noDigest.slice(slash + 1) : noDigest;
  // a colon after the last slash is the tag (a registry port colon is already in `registry`)
  const lastSlash = rest.lastIndexOf('/');
  const colon = rest.indexOf(':', lastSlash + 1);
  const tag = colon === -1 ? 'latest' : rest.slice(colon + 1);
  if (colon !== -1) rest = rest.slice(0, colon);
  const hub = !registry || HUB_HOSTS.has(registry);
  // Hub's API always wants a namespace; bare names are official images
  const repo = hub && !rest.includes('/') ? `library/${rest}` : rest;
  return { registry, repo, tag, hub };
}

// Plain X.Y.Z only — the release script publishes those plus `latest`/`sha-*`, which are not versions.
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;
export function isSemver(tag: string): boolean { return SEMVER.test(tag); }
export function cmpSemver(a: string, b: string): number {
  const pa = SEMVER.exec(a), pb = SEMVER.exec(b);
  if (!pa || !pb) return 0;
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}
export function newestSemver(tags: string[]): string | null {
  return tags.filter(isSemver).sort(cmpSemver).pop() || null;
}

// ── our own container ──
export interface SelfInfo { info: Docker.ContainerInspectInfo; id: string; name: string; image: string }
export async function inspectSelf(): Promise<SelfInfo | null> {
  // os.hostname() is this container's short id unless a deploy overrides it (same assumption as
  // codeserver/manager.ts#ensureNetwork). `selfUpdateContainer` is the escape hatch for those deploys.
  const refs = [cfg.str('selfUpdateContainer'), os.hostname(), process.env.HOSTNAME || ''].filter(Boolean);
  for (const ref of refs) {
    try {
      const info = await docker.getContainer(ref).inspect();
      return { info, id: info.Id, name: (info.Name || '').replace(/^\//, ''), image: info.Config?.Image || '' };
    } catch { /* try next ref */ }
  }
  return null;
}

async function localDigestOf(imageId: string, repo: string): Promise<string | null> {
  try {
    const im: any = await docker.getImage(imageId).inspect();
    const digests: string[] = im?.RepoDigests || [];
    const hit = digests.find((d) => d.split('@')[0].endsWith(repo)) || digests[0];
    return hit ? hit.split('@')[1] || null : null;
  } catch { return null; }
}

// ── registry check (Docker Hub) ──
interface HubTags { latest: string | null; tagDigest: string | null }
async function fetchHubTags(repo: string, trackedTag: string): Promise<HubTags> {
  const url = `https://hub.docker.com/v2/repositories/${repo}/tags?page_size=100&ordering=last_updated`;
  const res = await fetch(url, { signal: AbortSignal.timeout(cfg.int('selfUpdateCheckTimeoutMs')) });
  if (!res.ok) throw new Error(`docker hub ${res.status}`);
  const body: any = await res.json();
  const results: any[] = Array.isArray(body?.results) ? body.results : [];
  const names = results.map((r) => String(r?.name || '')).filter(Boolean);
  const tracked = results.find((r) => r?.name === trackedTag);
  return { latest: newestSemver(names), tagDigest: tracked?.digest ? String(tracked.digest) : null };
}

export interface UpdateStatus {
  enabled: boolean;
  current: string;
  image: string;
  repo: string;
  tag: string;
  registrySupported: boolean;
  latest: string | null;
  newerVersion: boolean;
  imageChanged: boolean;        // tracked tag's digest moved without a version bump
  updateAvailable: boolean;
  checkedAt: number | null;
  checkError: string | null;
  container: { id: string; name: string } | null;
  dockerUnavailable: boolean;
  applying: boolean;
  last: UpdateRecord | null;
}

let cached: UpdateStatus | null = null;
let applying = false;

export function cachedStatus(): UpdateStatus | null { return cached; }

export async function checkForUpdate(): Promise<UpdateStatus> {
  const current = appVersion();
  const self = await inspectSelf();
  const image = self?.image || '';
  const ref = parseRef(image || 'cian0204/claudecode-workspace:latest');
  const st: UpdateStatus = {
    enabled: cfg.bool('selfUpdateEnabled'),
    current, image, repo: ref.repo, tag: ref.tag, registrySupported: ref.hub,
    latest: null, newerVersion: false, imageChanged: false, updateAvailable: false,
    checkedAt: Date.now(), checkError: null,
    container: self ? { id: self.id.slice(0, 12), name: self.name } : null,
    dockerUnavailable: !self,
    applying,
    last: readState(),
  };
  if (!st.enabled) { cached = st; return st; }
  if (ref.hub) {
    try {
      const { latest, tagDigest } = await fetchHubTags(ref.repo, ref.tag);
      st.latest = latest;
      st.newerVersion = !!latest && current !== 'unknown' && cmpSemver(latest, current) > 0;
      const local = self ? await localDigestOf(self.info.Image, ref.repo) : null;
      st.imageChanged = !!tagDigest && !!local && tagDigest !== local;
    } catch (e: any) {
      st.checkError = String(e?.message || e).slice(0, 200);
    }
  }
  st.updateAvailable = st.newerVersion || st.imageChanged;
  cached = st;
  return st;
}

export async function updateStatus(): Promise<UpdateStatus> {
  if (cached) return { ...cached, applying, last: readState() };
  return checkForUpdate();
}

// ── state (survives the swap: it lives in the DB on the data volume) ──
function readState(): UpdateRecord | null {
  const raw = getSetting(STATE_KEY, '');
  if (!raw) return null;
  try { return JSON.parse(raw) as UpdateRecord; } catch { return null; }
}
function writeState(rec: UpdateRecord) { setSetting(STATE_KEY, JSON.stringify(rec)); }

// ── the swap ──
const TAG_RE = /^[\w][\w.-]{0,127}$/;

// Create-spec for the replacement container, rebuilt from our own inspect output so every mount,
// port, env var and label carries over untouched. Two fields are deliberately NOT copied verbatim:
//   * Hostname, when it is just the OLD container's short id (keeping it breaks the new instance's
//     own self-lookup — an explicitly set hostname is kept)
//   * Cmd / Entrypoint, when they merely mirror the OLD IMAGE's defaults. Inspect always reports
//     them as if they were set, so copying blindly would pin the new image to the old startup
//     command forever. Pass the old image's Config to tell "inherited" from "explicitly overridden".
export function recreateSpec(info: Docker.ContainerInspectInfo, oldImageConfig?: { Cmd?: string[] | null; Entrypoint?: string[] | null }): Record<string, any> {
  const c: any = info.Config || {};
  const shortId = info.Id.slice(0, 12);
  const nets = (info.NetworkSettings?.Networks || {}) as Record<string, any>;
  const same = (a?: string[] | null, b?: string[] | null) => JSON.stringify(a || null) === JSON.stringify(b || null);
  const spec: Record<string, any> = {
    Env: c.Env, Labels: c.Labels, WorkingDir: c.WorkingDir,
    User: c.User, ExposedPorts: c.ExposedPorts, Tty: !!c.Tty, OpenStdin: !!c.OpenStdin,
    StopSignal: c.StopSignal, StopTimeout: c.StopTimeout, Healthcheck: c.Healthcheck,
    HostConfig: info.HostConfig,
  };
  // no old-image Config available → fall back to copying (a working container beats a guess)
  if (!oldImageConfig || !same(c.Cmd, oldImageConfig.Cmd)) spec.Cmd = c.Cmd;
  if (!oldImageConfig || !same(c.Entrypoint, oldImageConfig.Entrypoint)) spec.Entrypoint = c.Entrypoint;
  if (c.Hostname && c.Hostname !== shortId) spec.Hostname = c.Hostname; // explicitly set → keep
  const endpoints = Object.entries(nets).map(([name, n]) => [name, {
    Aliases: (n?.Aliases || []).filter((a: string) => a !== shortId),
  }]);
  if (endpoints.length) spec.NetworkingConfig = { EndpointsConfig: Object.fromEntries(endpoints) };
  return spec;
}

// Runs inside the helper container (plain CommonJS via `node -e`, dockerode from the image's
// node_modules). Kept in one string so it has zero coupling to the new image's own source files —
// the only contract is "node + dockerode exist", plus the JSON payload in CCW_UPDATE.
const HELPER_JS = `
const Docker = require('dockerode');
const d = new Docker();
const p = JSON.parse(process.env.CCW_UPDATE);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log('[ccw-selfupdate] ' + m);
async function drop(ref, graceful) {
  const c = d.getContainer(ref);
  if (graceful) { try { await c.stop({ t: 15 }); } catch (e) {} }
  try { await c.remove({ force: true }); } catch (e) {}
}
function create(image, name) {
  return d.createContainer(Object.assign({}, p.spec, { Image: image, name: name }));
}
// must survive the whole window without exiting or being restarted
async function healthy() {
  const end = Date.now() + p.healthWaitMs;
  while (Date.now() < end) {
    await sleep(2000);
    let i;
    try { i = await d.getContainer(p.name).inspect(); } catch (e) { log('inspect failed: ' + e.message); return false; }
    if (i.State.Restarting || (i.RestartCount || 0) > 0) { log('restart detected (count=' + i.RestartCount + ')'); return false; }
    if (i.State.Status !== 'running') { log('status=' + i.State.Status + ' exit=' + i.State.ExitCode); return false; }
  }
  return true;
}
async function rollback() {
  await drop(p.name, false);
  try { const c = await create(p.prevImage, p.name); await c.start(); log('rolled back to ' + p.prevImage); }
  catch (e) { log('ROLLBACK FAILED: ' + e.message); }
}
(async () => {
  await sleep(p.delayMs);
  const tmp = p.name + '-ccwnew';
  await drop(tmp, false);
  // 1) validate the spec while the old container is still serving
  try { await create(p.newImage, tmp); } catch (e) { log('create failed, no swap: ' + e.message); process.exit(1); }
  // 2) stop the old one gracefully (SQLite checkpoint), then 3) take its name and start
  await drop(p.oldId, true);
  try {
    await d.getContainer(tmp).rename({ name: p.name });
    await d.getContainer(p.name).start();
  } catch (e) {
    log('start failed: ' + e.message);
    await drop(tmp, false);
    await rollback();
    process.exit(1);
  }
  if (await healthy()) { log('update ok: ' + p.newImage); return; }
  // 4) bad image → restore the previous one
  log('new container unhealthy, rolling back');
  await rollback();
  process.exit(1);
})().catch((e) => { log('fatal: ' + ((e && e.message) || e)); process.exit(1); });
`;

export interface ApplyResult { started: boolean; target: string; changed: boolean; note?: string }

// Pull the target image and hand the swap to a helper container. Resolves as soon as the helper is
// running — this process is killed a moment later, so the caller's reply must already be on the wire.
export async function applyUpdate(tag?: string): Promise<ApplyResult> {
  if (!cfg.bool('selfUpdateEnabled')) throw new Error('self-update is disabled');
  if (applying) throw new Error('an update is already in progress');
  const self = await inspectSelf();
  if (!self) throw new Error('self-update needs the Docker deployment (own container not found)');
  const ref = parseRef(self.image);
  if (!ref.repo) throw new Error(`cannot derive the image repo from '${self.image}' — recreate the container from a tagged image`);
  const targetTag = (tag || ref.tag || 'latest').trim();
  if (!TAG_RE.test(targetTag)) throw new Error(`invalid tag: ${targetTag}`);
  // Only ever our OWN repo — the mounted socket must never become an arbitrary-image pull.
  const base = self.image.split('@')[0].replace(/:[^:/]+$/, '');
  const target = `${base}:${targetTag}`;

  applying = true;
  try {
    // A pull failure is only fatal when the target isn't already on the host: a registry hiccup must
    // not block an admin who pre-pulled the image, and a locally-tagged image is how this gets tested.
    let pullError: string | undefined;
    try { await pullImage(target); }
    catch (e: any) {
      pullError = String(e?.message || e).slice(0, 200);
      await docker.getImage(target).inspect(); // absent → throws, and the update stops here
      console.warn(`[ccw] self-update pull failed, using the local image: ${pullError}`);
    }
    const newImage: any = await docker.getImage(target).inspect();
    const prevImageId = self.info.Image;
    if (newImage.Id === prevImageId) {
      applying = false;
      return { started: false, target, changed: false, note: pullError ? `pull failed: ${pullError}` : 'already running this image' };
    }

    // Roll back by a REF, not the bare id: recreating from an id leaves Config.Image = 'sha256:…',
    // which has no repo left to check or pull from next time. A dedicated tag also survives
    // `docker image prune` (it is not dangling), so the fallback image stays on the host.
    const prevRef = await docker.getImage(prevImageId).tag({ repo: base, tag: PREV_TAG })
      .then(() => `${base}:${PREV_TAG}`)
      .catch(() => prevImageId);
    const oldImageConfig = await docker.getImage(prevImageId).inspect()
      .then((im: any) => ({ Cmd: im?.Config?.Cmd, Entrypoint: im?.Config?.Entrypoint }))
      .catch(() => undefined);
    const payload = {
      name: self.name, oldId: self.id, newImage: target, prevImage: prevRef,
      spec: recreateSpec(self.info, oldImageConfig),
      delayMs: SWAP_DELAY_MS, healthWaitMs: cfg.int('selfUpdateHealthWaitMs'),
    };
    writeState({
      phase: 'applying', fromVersion: appVersion(), toImage: target,
      fromImageId: prevImageId, toImageId: newImage.Id, startedAt: Date.now(),
    });

    // leftover helper from a previous attempt (kept for its logs) — clear before reusing the name
    await removeHelper();
    const helper = await docker.createContainer({
      name: HELPER_NAME,
      Image: target,
      Cmd: ['node', '-e', HELPER_JS],
      WorkingDir: '/app',
      Env: [`CCW_UPDATE=${JSON.stringify(payload)}`],
      Labels: { [HELPER_LABEL]: '1' },
      HostConfig: {
        // socket only — no app volume, no network, and NOT auto-removed so its log survives a failure
        Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
        NetworkMode: 'none',
        RestartPolicy: { Name: 'no' },
      },
    });
    await helper.start();
    console.log(`[ccw] self-update handed to ${HELPER_NAME}: ${target}`);
    return { started: true, target, changed: true };
  } catch (e) {
    applying = false;
    const st = readState();
    if (st?.phase === 'applying') {
      writeState({ ...st, phase: 'failed', finishedAt: Date.now(), log: String((e as any)?.message || e).slice(0, 500) });
    }
    throw e;
  }
}

// ── boot reconciliation: decide how the last swap ended, from our own image id ──
export async function reconcileSelfUpdate(): Promise<void> {
  const st = readState();
  if (!st || st.phase !== 'applying') return;
  const self = await inspectSelf();
  const mine = self?.info.Image;
  let phase: UpdatePhase = 'unknown';
  if (mine && st.toImageId && mine === st.toImageId) phase = 'done';
  else if (mine && st.fromImageId && mine === st.fromImageId) phase = 'rolled-back';
  else if (!self && Date.now() - st.startedAt < APPLY_STALE_MS) return; // docker unreadable, decide later
  const log = phase === 'done' ? undefined : await helperLog();
  writeState({ ...st, phase, finishedAt: Date.now(), version: appVersion(), log });
  console.log(`[ccw] self-update ${phase}${phase === 'done' ? ` → v${appVersion()}` : ''}`);
  // The helper is deliberately LEFT ALONE here: we boot within seconds, while it is still watching us
  // for the rest of healthWaitMs — removing it would throw away the rollback net for a crash that
  // happens just after a successful listen. It exits on its own and the next apply reaps it (its log
  // is the only diagnostic for a failed swap). Cost: if that late rollback does fire, this 'done'
  // record is stale — the panel always shows the LIVE running version, so nothing misreports.
}

// Non-TTY container logs are framed: [stream byte, 0,0,0, big-endian length, payload]. Walk the
// frames instead of scrubbing control characters — a length byte can itself be printable ASCII.
export function demuxLogs(buf: Buffer): string {
  const parts: string[] = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    if (buf[i] > 2 || buf[i + 1] !== 0 || buf[i + 2] !== 0 || buf[i + 3] !== 0) return buf.toString('utf8'); // unframed (TTY)
    const len = buf.readUInt32BE(i + 4);
    parts.push(buf.subarray(i + 8, i + 8 + len).toString('utf8'));
    i += 8 + len;
  }
  return parts.length ? parts.join('') : buf.toString('utf8');
}

async function helperLog(): Promise<string | undefined> {
  try {
    const buf: any = await docker.getContainer(HELPER_NAME).logs({ stdout: true, stderr: true, tail: 40 });
    const text = Buffer.isBuffer(buf) ? demuxLogs(buf) : String(buf);
    return text.trim().slice(-2000) || undefined;
  } catch { return undefined; }
}
async function removeHelper(): Promise<void> {
  try { await docker.getContainer(HELPER_NAME).remove({ force: true }); } catch { /* none */ }
}

// ── periodic check (cache only — nothing is applied automatically) ──
let timer: ReturnType<typeof setInterval> | null = null;
export function scheduleUpdateCheck(): void {
  if (timer) { clearInterval(timer); timer = null; }
  if (!cfg.bool('selfUpdateEnabled')) return;
  const ms = cfg.int('selfUpdateAutoCheckMs');
  if (ms <= 0) return;
  void checkForUpdate().catch(() => {});
  timer = setInterval(() => { void checkForUpdate().catch(() => {}); }, ms);
  timer.unref();
}
registerApply('selfUpdateAutoCheckMs', () => scheduleUpdateCheck());
registerApply('selfUpdateEnabled', () => scheduleUpdateCheck());
