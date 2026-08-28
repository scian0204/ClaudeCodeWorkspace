import { Client } from 'ldapts';
import { cfg, registerApply } from '../lib/config-registry.js';
import {
  getDirectoryConfig, setDirectoryConfig, clearDirectoryConfig,
  resolveDirectoryUser, normalizeUsername, type DirectoryIdentity,
} from './directory.js';

// Active Directory / LDAP sign-in + user provisioning.
//
// Two binds per login, which is the standard "search then bind" dance:
//   1. bind as the service account and SEARCH for the person's entry (their DN is not derivable from
//      a login name in any general way — AD nests people in OUs);
//   2. bind AGAIN as that entry's own DN with the password the user typed. That second bind is the
//      actual password check; we never read or compare a password ourselves.
//
// The workspace never stores an AD password. A provisioned local row gets an unusable random hash,
// so the local login form can never sign a directory account in (see directory.ts).

export interface LdapConfig {
  url: string;                    // ldap://dc.corp.local:389  or  ldaps://dc.corp.local:636
  bindDn: string;                 // service account DN ('' = anonymous bind, rare)
  bindPassword: string;
  baseDn: string;                 // where to search from, e.g. DC=corp,DC=local
  userFilter: string;             // {username} is substituted (escaped) — one entry must match
  importFilter: string;           // which entries a bulk import walks
  attrUsername: string;
  attrDisplayName: string;
  attrEmail: string;
  attrMemberOf: string;
  adminGroup: string;             // group DN whose members become workspace admins ('' = none)
  startTls: boolean;              // upgrade a plain ldap:// connection to TLS before binding
  tlsRejectUnauthorized: boolean; // verify the server certificate (leave on unless self-signed)
}

export const LDAP_DEFAULTS: LdapConfig = {
  url: '', bindDn: '', bindPassword: '', baseDn: '',
  userFilter: '(&(objectClass=user)(sAMAccountName={username}))',
  importFilter: '(&(objectClass=user)(objectCategory=person))',
  attrUsername: 'sAMAccountName', attrDisplayName: 'displayName', attrEmail: 'mail',
  attrMemberOf: 'memberOf', adminGroup: '',
  startTls: false, tlsRejectUnauthorized: true,
};

// Non-secret view for the admin UI: everything except the bind password, which is reported as a
// boolean the way every other stored secret in this codebase is.
export interface LdapStatus extends Omit<LdapConfig, 'bindPassword'> { hasBindPassword: boolean }

export function ldapConfig(): LdapConfig | null {
  const c = getDirectoryConfig<Partial<LdapConfig>>('ldap');
  return c ? { ...LDAP_DEFAULTS, ...c } : null;
}

export function ldapStatus(): LdapStatus | null {
  const c = ldapConfig();
  if (!c) return null;
  const { bindPassword, ...rest } = c;
  return { ...rest, hasBindPassword: !!bindPassword };
}

export function ldapReady(): boolean {
  const c = ldapConfig();
  return cfg.bool('ldapEnabled') && !!c && !!c.url && !!c.baseDn;
}

// Save. An empty bindPassword field means "keep the stored one" — the UI never receives the secret
// back, so a blank box must not wipe it.
export function saveLdapConfig(raw: any): LdapStatus {
  const prev = ldapConfig();
  const s = (v: any, d = '') => (typeof v === 'string' ? v.trim() : d);
  const c: LdapConfig = {
    url: s(raw?.url),
    bindDn: s(raw?.bindDn),
    bindPassword: s(raw?.bindPassword) || prev?.bindPassword || '',
    baseDn: s(raw?.baseDn),
    userFilter: s(raw?.userFilter) || LDAP_DEFAULTS.userFilter,
    importFilter: s(raw?.importFilter) || LDAP_DEFAULTS.importFilter,
    attrUsername: s(raw?.attrUsername) || LDAP_DEFAULTS.attrUsername,
    attrDisplayName: s(raw?.attrDisplayName) || LDAP_DEFAULTS.attrDisplayName,
    attrEmail: s(raw?.attrEmail) || LDAP_DEFAULTS.attrEmail,
    attrMemberOf: s(raw?.attrMemberOf) || LDAP_DEFAULTS.attrMemberOf,
    adminGroup: s(raw?.adminGroup),
    startTls: !!raw?.startTls,
    tlsRejectUnauthorized: raw?.tlsRejectUnauthorized !== false,
  };
  if (!c.url) throw new Error('ldap: server URL required (ldap://host:389 or ldaps://host:636)');
  if (!/^ldaps?:\/\//i.test(c.url)) throw new Error('ldap: URL must start with ldap:// or ldaps://');
  if (!c.baseDn) throw new Error('ldap: base DN required');
  if (!c.userFilter.includes('{username}')) throw new Error('ldap: user filter must contain {username}');
  setDirectoryConfig('ldap', c);
  return ldapStatus()!;
}

export function clearLdapConfig(): void { clearDirectoryConfig('ldap'); }

// ── filter building (pure — covered by sso.test.ts) ──

// RFC 4515 §3: these characters end an assertion value, so a login name carrying one would
// otherwise rewrite the filter (`*)(uid=admin` → match everything, then match the admin).
export function escapeFilterValue(v: string): string {
  let out = '';
  for (const ch of String(v)) {
    if (ch === '\\') out += '\\5c';
    else if (ch === '*') out += '\\2a';
    else if (ch === '(') out += '\\28';
    else if (ch === ')') out += '\\29';
    else if (ch === '\0') out += '\\00';
    else if (ch === '/') out += '\\2f';
    else out += ch;
  }
  return out;
}

export function buildUserFilter(template: string, username: string): string {
  return template.split('{username}').join(escapeFilterValue(username));
}

// ldapts hands attributes back as string | string[] | Buffer depending on the entry.
export function attrValue(entry: any, name: string): string {
  if (!name) return '';
  const v = entry?.[name];
  if (v == null) return '';
  if (Array.isArray(v)) return String(v[0] ?? '');
  if (Buffer.isBuffer(v)) return v.toString('utf8');
  return String(v);
}
export function attrList(entry: any, name: string): string[] {
  if (!name) return [];
  const v = entry?.[name];
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => (Buffer.isBuffer(x) ? x.toString('utf8') : String(x)));
}

// Group membership is compared case-insensitively with whitespace around the commas removed: AD
// hands back `CN=Admins,OU=Groups,DC=corp,DC=local` and an operator types it with spaces as often as not.
export function normalizeDn(dn: string): string {
  return String(dn || '').trim().toLowerCase().split(',').map((p) => p.trim()).join(',');
}
export function inAdminGroup(entry: any, attr: string, adminGroup: string): boolean {
  if (!adminGroup) return false;
  const want = normalizeDn(adminGroup);
  return attrList(entry, attr).some((g) => normalizeDn(g) === want);
}

// One directory entry → the identity shape the provisioning code understands.
export function identityFromEntry(entry: any, c: LdapConfig): DirectoryIdentity {
  return {
    source: 'ldap',
    externalId: String(entry?.dn || ''),
    username: normalizeUsername(attrValue(entry, c.attrUsername)),
    displayName: attrValue(entry, c.attrDisplayName),
    email: attrValue(entry, c.attrEmail) || undefined,
    admin: c.adminGroup ? inAdminGroup(entry, c.attrMemberOf, c.adminGroup) : undefined,
  };
}

// ── the wire ──

async function connect(c: LdapConfig): Promise<Client> {
  const timeout = cfg.int('ldapTimeoutMs');
  const tlsOptions = { rejectUnauthorized: c.tlsRejectUnauthorized };
  const secure = /^ldaps:\/\//i.test(c.url);
  // ldapts turns TLS on when EITHER the URL is ldaps:// or `tlsOptions` is present at all, so
  // passing the options unconditionally makes a plain ldap:// connection attempt a TLS handshake and
  // fail with "socket disconnected before secure TLS connection was established". They go to
  // startTLS() instead on a plain connection, which is where they belong.
  const client = new Client({ url: c.url, timeout, connectTimeout: timeout, ...(secure ? { tlsOptions } : {}) });
  if (!secure && c.startTls) await client.startTLS(tlsOptions);
  return client;
}

async function withClient<T>(c: LdapConfig, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await connect(c);
  try { return await fn(client); }
  finally { await client.unbind().catch(() => {}); }
}

const attrsOf = (c: LdapConfig) => [c.attrUsername, c.attrDisplayName, c.attrEmail, c.attrMemberOf].filter(Boolean);

async function searchEntries(client: Client, c: LdapConfig, filter: string, sizeLimit: number) {
  await client.bind(c.bindDn, c.bindPassword); // '' / '' = anonymous bind, which some directories allow
  const { searchEntries: entries } = await client.search(c.baseDn, {
    scope: 'sub', filter, attributes: attrsOf(c), sizeLimit,
    timeLimit: Math.ceil(cfg.int('ldapTimeoutMs') / 1000),
  });
  return entries;
}

// Verify a password against the directory and return who it belongs to. Null = not an LDAP account
// (so the caller can fall back); a thrown error = the directory is misconfigured or unreachable.
export async function ldapAuthenticate(username: string, password: string): Promise<DirectoryIdentity | null> {
  const c = ldapConfig();
  if (!c || !ldapReady()) return null;
  // An empty password is the classic LDAP trap: RFC 4513 turns bind(dn, '') into an ANONYMOUS bind,
  // which succeeds and would let anyone in as anyone. Refuse before we ever reach the wire.
  if (!password) return null;

  return withClient(c, async (client) => {
    const entries = await searchEntries(client, c, buildUserFilter(c.userFilter, username), 2);
    if (entries.length !== 1) return null; // unknown, or an ambiguous filter — either way, no login
    const entry = entries[0] as any;
    const dn = String(entry.dn || '');
    if (!dn) return null;
    // Second connection on purpose: rebinding `client` as the user would leave the service-account
    // session authenticated as them if anything later reused it.
    const asUser = await connect(c);
    try { await asUser.bind(dn, password); }
    catch { return null; }              // wrong password (an unreachable server threw above instead)
    finally { await asUser.unbind().catch(() => {}); }
    return identityFromEntry(entry, c);
  });
}

// Admin "test connection" button: binds with the service account and reports what it can see.
export async function testLdap(sampleUser?: string): Promise<{ ok: true; entries: number; sample: string[] }> {
  const c = ldapConfig();
  if (!c) throw new Error('ldap: not configured');
  if (!c.url || !c.baseDn) throw new Error('ldap: server URL and base DN required');
  return withClient(c, async (client) => {
    const filter = sampleUser ? buildUserFilter(c.userFilter, sampleUser) : c.importFilter;
    const entries = await searchEntries(client, c, filter, 5);
    return {
      ok: true as const,
      entries: entries.length,
      sample: entries.slice(0, 5).map((e: any) => `${attrValue(e, c.attrUsername) || '?'} — ${e.dn}`),
    };
  });
}

export interface ImportSummary {
  found: number; created: number; updated: number; skipped: number; errors: string[];
}

// Bulk provisioning: walk the directory and make sure every person there has a local row. Existing
// rows are refreshed (name, admin group), never deleted — a person removed from AD keeps their chats
// and simply stops being able to sign in.
export async function importLdapUsers(): Promise<ImportSummary> {
  const c = ldapConfig();
  if (!c) throw new Error('ldap: not configured');
  const max = cfg.int('ldapImportMax');
  const out: ImportSummary = { found: 0, created: 0, updated: 0, skipped: 0, errors: [] };
  const entries = await withClient(c, (client) => searchEntries(client, c, c.importFilter, max));
  out.found = entries.length;
  for (const e of entries) {
    const idn = identityFromEntry(e as any, c);
    if (!idn.username || !idn.externalId) { out.skipped++; continue; }
    try {
      const r = resolveDirectoryUser(idn, {
        jit: true, // an import IS the explicit act of creating these accounts
        linkExisting: cfg.bool('ldapLinkExisting'),
        roleSync: cfg.bool('ldapRoleSync'),
      });
      if (r.created) out.created++;
      else if (r.updated) out.updated++;
      else out.skipped++;
    } catch (err: any) {
      out.skipped++;
      if (out.errors.length < 20) out.errors.push(`${idn.username}: ${String(err?.message || err)}`);
    }
  }
  return out;
}

// ── periodic sync ──
let timer: NodeJS.Timeout | null = null;

// ponytail: one global interval, re-armed on each tick from the live setting — no cron, no backoff.
// If an import ever gets slow enough to overlap, give it a running flag then.
export function startLdapSync(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  const every = cfg.int('ldapSyncMs');
  if (!every) return; // 0 = off
  timer = setTimeout(async () => {
    if (ldapReady()) {
      try {
        const r = await importLdapUsers();
        console.log(`[ldap] sync: found=${r.found} created=${r.created} updated=${r.updated}`);
      } catch (e: any) { console.warn('[ldap] sync failed:', String(e?.message || e)); }
    }
    startLdapSync(); // re-read the interval each time so an admin edit takes effect without a restart
  }, every);
  timer.unref?.();
}

registerApply('ldapSyncMs', () => startLdapSync());
registerApply('ldapEnabled', () => startLdapSync());
