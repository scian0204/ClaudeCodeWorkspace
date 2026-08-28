import crypto from 'node:crypto';
import { cfg } from '../lib/config-registry.js';
import {
  getDirectoryConfig, setDirectoryConfig, clearDirectoryConfig,
  normalizeUsername, type DirectoryIdentity,
} from './directory.js';

// OpenID Connect single sign-on — Authorization Code flow with PKCE.
//
// Deliberately OIDC only: SAML would mean an XML-signature stack, which is a project of its own.
// Deliberately no dependency either: discovery is one fetch, the code exchange is one POST, and the
// id_token check is a signature verify node's own crypto already does (JWK → KeyObject).
//
// The security-relevant parts, in one place so they are easy to audit:
//   - `state` is a random value stored server-side with the PKCE verifier and the nonce, single use,
//     TTL-bounded. A callback with an unknown state is refused, which is the CSRF guard.
//   - PKCE (S256) means a stolen authorization code is useless without the verifier.
//   - the id_token is verified against the issuer's JWKS (or the client secret for HS*), and iss,
//     aud, exp, iat and nonce are all checked.
//   - `sub` — never the email — is the identity we key the local account by.
//   - an existing LOCAL account with the same username is NOT taken over unless an admin turns
//     oidcLinkExisting on (see resolveDirectoryUser). Same-email ≠ same person.

export interface OidcConfig {
  issuer: string;            // https://login.microsoftonline.com/<tenant>/v2.0
  clientId: string;
  clientSecret: string;      // '' = public client (PKCE only)
  scopes: string;            // space-separated; must include openid
  redirectUri: string;       // '' = derived from the request's own origin
  usernameClaim: string;
  displayNameClaim: string;
  emailClaim: string;
  groupsClaim: string;
  adminGroup: string;        // group name/id that grants admin ('' = none)
  allowedDomains: string;    // comma-separated email domains that may sign in ('' = any)
  buttonLabel: string;       // what the login page's SSO button says
}

export const OIDC_DEFAULTS: OidcConfig = {
  issuer: '', clientId: '', clientSecret: '', scopes: 'openid profile email', redirectUri: '',
  usernameClaim: 'preferred_username', displayNameClaim: 'name', emailClaim: 'email',
  groupsClaim: 'groups', adminGroup: '', allowedDomains: '', buttonLabel: 'SSO',
};

export interface OidcStatus extends Omit<OidcConfig, 'clientSecret'> { hasClientSecret: boolean }

export function oidcConfig(): OidcConfig | null {
  const c = getDirectoryConfig<Partial<OidcConfig>>('oidc');
  return c ? { ...OIDC_DEFAULTS, ...c } : null;
}

export function oidcStatus(): OidcStatus | null {
  const c = oidcConfig();
  if (!c) return null;
  const { clientSecret, ...rest } = c;
  return { ...rest, hasClientSecret: !!clientSecret };
}

export function oidcReady(): boolean {
  const c = oidcConfig();
  return cfg.bool('oidcEnabled') && !!c && !!c.issuer && !!c.clientId;
}

export function oidcButtonLabel(): string {
  return (oidcConfig()?.buttonLabel || OIDC_DEFAULTS.buttonLabel).slice(0, 40);
}

export function saveOidcConfig(raw: any): OidcStatus {
  const prev = oidcConfig();
  const s = (v: any) => (typeof v === 'string' ? v.trim() : '');
  const c: OidcConfig = {
    issuer: s(raw?.issuer).replace(/\/+$/, ''),
    clientId: s(raw?.clientId),
    clientSecret: s(raw?.clientSecret) || prev?.clientSecret || '',
    scopes: s(raw?.scopes) || OIDC_DEFAULTS.scopes,
    redirectUri: s(raw?.redirectUri),
    usernameClaim: s(raw?.usernameClaim) || OIDC_DEFAULTS.usernameClaim,
    displayNameClaim: s(raw?.displayNameClaim) || OIDC_DEFAULTS.displayNameClaim,
    emailClaim: s(raw?.emailClaim) || OIDC_DEFAULTS.emailClaim,
    groupsClaim: s(raw?.groupsClaim) || OIDC_DEFAULTS.groupsClaim,
    adminGroup: s(raw?.adminGroup),
    allowedDomains: s(raw?.allowedDomains).toLowerCase(),
    buttonLabel: s(raw?.buttonLabel) || OIDC_DEFAULTS.buttonLabel,
  };
  if (!c.issuer) throw new Error('oidc: issuer URL required');
  if (!/^https?:\/\//i.test(c.issuer)) throw new Error('oidc: issuer must start with http(s)://');
  if (!c.clientId) throw new Error('oidc: client id required');
  if (!c.scopes.split(/\s+/).includes('openid')) throw new Error('oidc: scopes must include openid');
  if (c.redirectUri && !/^https?:\/\//i.test(c.redirectUri)) throw new Error('oidc: redirect URI must start with http(s)://');
  setDirectoryConfig('oidc', c);
  return oidcStatus()!;
}

export function clearOidcConfig(): void { clearDirectoryConfig('oidc'); discovery = null; jwks = null; }

// ── discovery + JWKS (cached; both are static per issuer) ──
interface Discovery {
  issuer: string; authorization_endpoint: string; token_endpoint: string;
  jwks_uri?: string; userinfo_endpoint?: string; end_session_endpoint?: string;
  code_challenge_methods_supported?: string[];
}
let discovery: { issuer: string; at: number; doc: Discovery } | null = null;
let jwks: { uri: string; at: number; keys: any[] } | null = null;

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(cfg.int('oidcTimeoutMs')) });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const detail = body?.error_description || body?.error || text.slice(0, 200);
    throw new Error(`${new URL(url).pathname} → ${res.status} ${detail}`);
  }
  if (!body) throw new Error(`${new URL(url).pathname} → empty response`);
  return body;
}

export async function getDiscovery(force = false): Promise<Discovery> {
  const c = oidcConfig();
  if (!c?.issuer) throw new Error('oidc: not configured');
  const ttl = cfg.int('oidcDiscoveryTtlMs');
  if (!force && discovery && discovery.issuer === c.issuer && Date.now() - discovery.at < ttl) return discovery.doc;
  const url = `${c.issuer}/.well-known/openid-configuration`;
  const doc = (await fetchJson(url)) as Discovery;
  if (!doc.authorization_endpoint || !doc.token_endpoint) throw new Error('oidc: discovery document is missing endpoints');
  discovery = { issuer: c.issuer, at: Date.now(), doc };
  return doc;
}

async function getKeys(uri: string, force = false): Promise<any[]> {
  const ttl = cfg.int('oidcDiscoveryTtlMs');
  if (!force && jwks && jwks.uri === uri && Date.now() - jwks.at < ttl) return jwks.keys;
  const doc = await fetchJson(uri);
  const keys = Array.isArray(doc?.keys) ? doc.keys : [];
  jwks = { uri, at: Date.now(), keys };
  return keys;
}

// ── JWT verification (no library: JWK → KeyObject is built into node) ──
const b64u = (b: Buffer) => b.toString('base64url');
const unb64u = (s: string) => Buffer.from(String(s), 'base64url');

const NODE_HASH: Record<string, string> = {
  RS256: 'sha256', RS384: 'sha384', RS512: 'sha512',
  PS256: 'sha256', PS384: 'sha384', PS512: 'sha512',
  ES256: 'sha256', ES384: 'sha384', ES512: 'sha512',
  HS256: 'sha256', HS384: 'sha384', HS512: 'sha512',
};

export function decodeJwt(token: string): { header: any; payload: any; signed: string; sig: Buffer } {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('id_token: not a JWS');
  const header = JSON.parse(unb64u(parts[0]).toString('utf8'));
  const payload = JSON.parse(unb64u(parts[1]).toString('utf8'));
  return { header, payload, signed: `${parts[0]}.${parts[1]}`, sig: unb64u(parts[2]) };
}

export function verifySignature(header: any, signed: string, sig: Buffer, key: any, secret: string): boolean {
  const alg = String(header?.alg || '');
  const hash = NODE_HASH[alg];
  if (!hash) throw new Error(`id_token: unsupported algorithm ${alg || '(none)'}`);
  const data = Buffer.from(signed, 'utf8');
  if (alg.startsWith('HS')) {
    if (!secret) throw new Error('id_token: HMAC-signed token but no client secret is stored');
    const mac = crypto.createHmac(hash, secret).update(data).digest();
    return mac.length === sig.length && crypto.timingSafeEqual(mac, sig);
  }
  if (!key) throw new Error('id_token: no matching key in the JWKS');
  const pub = crypto.createPublicKey({ key, format: 'jwk' });
  if (alg.startsWith('PS')) {
    return crypto.verify(hash, data, {
      key: pub, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    }, sig);
  }
  if (alg.startsWith('ES')) return crypto.verify(hash, data, { key: pub, dsaEncoding: 'ieee-p1363' }, sig);
  return crypto.verify(hash, data, pub, sig);
}

// Claim checks, split out so the test can drive them without a network.
export function checkClaims(p: any, opts: { issuer: string; clientId: string; nonce: string; now: number; skewMs: number }): void {
  if (!p || typeof p !== 'object') throw new Error('id_token: no claims');
  if (String(p.iss || '').replace(/\/+$/, '') !== opts.issuer.replace(/\/+$/, '')) throw new Error('id_token: issuer mismatch');
  const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
  if (!aud.includes(opts.clientId)) throw new Error('id_token: audience mismatch');
  // Several audiences means the token was minted for someone else too — `azp` must then name us.
  if (aud.length > 1 && p.azp && p.azp !== opts.clientId) throw new Error('id_token: azp mismatch');
  if (typeof p.exp !== 'number' || p.exp * 1000 + opts.skewMs < opts.now) throw new Error('id_token: expired');
  if (typeof p.iat === 'number' && p.iat * 1000 - opts.skewMs > opts.now) throw new Error('id_token: issued in the future');
  if (opts.nonce && p.nonce !== opts.nonce) throw new Error('id_token: nonce mismatch');
  if (!p.sub) throw new Error('id_token: no sub claim');
}

async function verifyIdToken(token: string, nonce: string): Promise<any> {
  const c = oidcConfig()!;
  const { header, payload, signed, sig } = decodeJwt(token);
  const alg = String(header?.alg || '');
  if (alg === 'none') throw new Error('id_token: unsigned tokens are refused');
  let key: any = null;
  if (!alg.startsWith('HS')) {
    const doc = await getDiscovery();
    if (!doc.jwks_uri) throw new Error('oidc: issuer publishes no JWKS');
    const pick = (keys: any[]) => keys.find((k) => (header.kid ? k.kid === header.kid : true) && (!k.alg || k.alg === alg)) || null;
    key = pick(await getKeys(doc.jwks_uri));
    if (!key) key = pick(await getKeys(doc.jwks_uri, true)); // key rotation → refetch once before failing
  }
  if (!verifySignature(header, signed, sig, key, c.clientSecret)) throw new Error('id_token: signature check failed');
  checkClaims(payload, {
    issuer: c.issuer, clientId: c.clientId, nonce, now: Date.now(), skewMs: cfg.int('oidcClockSkewMs'),
  });
  return payload;
}

// ── the flow ──

interface Pending { verifier: string; nonce: string; redirectUri: string; next: string; at: number }
const pending = new Map<string, Pending>();

function sweep(): void {
  const ttl = cfg.int('oidcStateTtlMs');
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.at > ttl) pending.delete(k);
}

// Where the browser goes after a successful sign-in. Only a same-site path is honoured — an absolute
// URL (or a protocol-relative `//evil.example`) would turn this endpoint into an open redirect.
export function safeNext(raw: unknown): string {
  const s = String(raw || '');
  if (!s.startsWith('/') || s.startsWith('//') || s.includes('\\')) return '/';
  return s.slice(0, 512);
}

// The callback URL. An explicit setting wins (it must match what is registered at the IdP); with
// none, it is derived from the origin the browser actually reached us on.
export function callbackUrl(origin: string): string {
  const c = oidcConfig();
  return c?.redirectUri || `${origin.replace(/\/+$/, '')}/api/auth/oidc/callback`;
}

export async function startOidc(origin: string, next: string): Promise<string> {
  const c = oidcConfig();
  if (!c || !oidcReady()) throw new Error('oidc: not configured');
  sweep();
  if (pending.size > 500) pending.clear(); // a flood of abandoned sign-ins must not grow without bound
  const doc = await getDiscovery();
  const state = crypto.randomBytes(24).toString('base64url');
  const nonce = crypto.randomBytes(24).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  const redirectUri = callbackUrl(origin);
  pending.set(state, { verifier, nonce, redirectUri, next: safeNext(next), at: Date.now() });
  const u = new URL(doc.authorization_endpoint);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', c.clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('scope', c.scopes);
  u.searchParams.set('state', state);
  u.searchParams.set('nonce', nonce);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

// Pull one claim out of the id_token, falling back to the userinfo endpoint — plenty of IdPs keep
// `email` out of the id_token unless asked, and the username claim differs per vendor.
function claim(src: any, name: string): string {
  const v = src?.[name];
  return v == null ? '' : String(v);
}

function groupsOf(src: any, name: string): string[] {
  const v = src?.[name];
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String);
  return String(v).split(/[\s,]+/).filter(Boolean);
}

export function domainAllowed(email: string, allowed: string): boolean {
  const list = allowed.split(',').map((s) => s.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  if (!list.length) return true;
  const dom = String(email || '').toLowerCase().split('@')[1] || '';
  return !!dom && list.includes(dom);
}

// Exchange the code, verify the token, and hand back the identity. Consumes the state (single use).
export async function completeOidc(query: any): Promise<{ identity: DirectoryIdentity; next: string }> {
  const c = oidcConfig();
  if (!c || !oidcReady()) throw new Error('oidc: not configured');
  if (query?.error) throw new Error(`oidc: ${String(query.error_description || query.error).slice(0, 200)}`);
  const state = String(query?.state || '');
  const code = String(query?.code || '');
  if (!state || !code) throw new Error('oidc: callback is missing code/state');
  sweep();
  const p = pending.get(state);
  if (!p) throw new Error('oidc: unknown or expired sign-in attempt — start again');
  pending.delete(state); // single use, whatever happens next

  const doc = await getDiscovery();
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: p.redirectUri,
    client_id: c.clientId, code_verifier: p.verifier,
  });
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  // client_secret_basic is what most IdPs prefer; a public client sends none at all.
  if (c.clientSecret) headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(c.clientId)}:${encodeURIComponent(c.clientSecret)}`).toString('base64')}`;
  const tok = await fetchJson(doc.token_endpoint, { method: 'POST', headers, body: body.toString() });
  if (!tok.id_token) throw new Error('oidc: token response carried no id_token');
  const claims = await verifyIdToken(String(tok.id_token), p.nonce);

  // userinfo is only consulted when the id_token left something out — one extra round trip, skipped
  // whenever the token already carries what we need.
  let info: any = null;
  const need = () => !claim(claims, c.usernameClaim) || !claim(claims, c.emailClaim);
  if (doc.userinfo_endpoint && tok.access_token && need()) {
    try { info = await fetchJson(doc.userinfo_endpoint, { headers: { Authorization: `Bearer ${tok.access_token}` } }); }
    catch { /* optional — the id_token stays the source of truth */ }
  }
  const pick = (name: string) => claim(claims, name) || claim(info, name);

  const email = pick(c.emailClaim);
  if (c.allowedDomains && !domainAllowed(email, c.allowedDomains)) {
    throw new Error('oidc: this email domain is not allowed to sign in');
  }
  const username = normalizeUsername(pick(c.usernameClaim) || email.split('@')[0] || claims.sub);
  const groups = c.adminGroup ? [...groupsOf(claims, c.groupsClaim), ...groupsOf(info, c.groupsClaim)] : [];
  return {
    next: p.next,
    identity: {
      source: 'oidc',
      externalId: String(claims.sub),
      username,
      displayName: pick(c.displayNameClaim) || username,
      email: email || undefined,
      admin: c.adminGroup ? groups.some((g) => g.toLowerCase() === c.adminGroup.toLowerCase()) : undefined,
    },
  };
}

// Admin "test" button: pulls the discovery document fresh and reports what it found.
export async function testOidc(): Promise<{ ok: true; issuer: string; authorize: string; token: string; jwks: boolean; userinfo: boolean }> {
  const doc = await getDiscovery(true);
  if (doc.jwks_uri) await getKeys(doc.jwks_uri, true);
  return {
    ok: true, issuer: doc.issuer || '', authorize: doc.authorization_endpoint, token: doc.token_endpoint,
    jwks: !!doc.jwks_uri, userinfo: !!doc.userinfo_endpoint,
  };
}
