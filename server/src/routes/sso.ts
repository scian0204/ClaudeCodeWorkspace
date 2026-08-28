import type { FastifyInstance, FastifyRequest } from 'fastify';
import { COOKIE, issueSession, requireAdmin } from '../auth/index.js';
import { cfg } from '../lib/config-registry.js';
import { resolveDirectoryUser } from '../auth/directory.js';
import { ldapStatus, saveLdapConfig, clearLdapConfig, testLdap, importLdapUsers, ldapReady } from '../auth/ldap.js';
import {
  oidcStatus, saveOidcConfig, clearOidcConfig, testOidc, startOidc, completeOidc,
  oidcReady, oidcButtonLabel, safeNext,
} from '../auth/oidc.js';

// External sign-in: AD/LDAP and OIDC single sign-on.
//
// Three kinds of route live here:
//   - GET /api/auth/methods — UNAUTHENTICATED, like /api/brand: the login card has to know whether to
//     draw an SSO button before anyone is signed in. It reports switches and a label, never settings.
//   - /api/auth/oidc/start + /callback — also unauthenticated (that is the point of them), and both
//     redirect rather than return JSON because a browser is walking through them.
//   - /api/admin/ldap|oidc — admin-only settings, test and import. GET never returns the bind
//     password or the client secret, and an empty field on PUT keeps whatever is stored.

// The origin the browser actually reached us on, used to build the OIDC redirect URI when an admin
// has not pinned one. Header values are attacker-shaped, so the host is filtered down to the
// characters a host:port can contain before it is ever put in a URL.
function originOf(req: FastifyRequest): string {
  const fwdProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = /^https?$/.test(fwdProto) ? fwdProto : req.protocol;
  const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const host = /^[A-Za-z0-9.\-:[\]]+$/.test(rawHost) ? rawHost : '';
  return host ? `${proto}://${host}` : '';
}

// Errors reach the login card as a query parameter, so they must not carry newlines or run long.
const redirectWithError = (reply: any, msg: string) =>
  reply.redirect(`/?ssoError=${encodeURIComponent(String(msg).replace(/\s+/g, ' ').slice(0, 200))}`);

export async function ssoRoutes(app: FastifyInstance) {
  // ── what the login card should offer (public) ──
  app.get('/api/auth/methods', async () => ({
    // The local form is always drawn: with localLoginEnabled off it still works for admins, which is
    // the escape hatch when a directory is down. `localRestricted` only changes the wording.
    localRestricted: !cfg.bool('localLoginEnabled'),
    ldap: ldapReady(),
    oidc: oidcReady(),
    oidcLabel: oidcButtonLabel(),
  }));

  // ── OIDC browser flow (public) ──
  app.get('/api/auth/oidc/start', async (req, reply) => {
    if (!oidcReady()) return reply.code(404).send({ error: 'oidc disabled' });
    try { return reply.redirect(await startOidc(originOf(req), safeNext((req.query as any)?.next))); }
    catch (e: any) { return redirectWithError(reply, e?.message || 'sign-in could not start'); }
  });

  app.get('/api/auth/oidc/callback', async (req, reply) => {
    if (!oidcReady()) return reply.code(404).send({ error: 'oidc disabled' });
    try {
      const { identity, next } = await completeOidc(req.query || {});
      const r = resolveDirectoryUser(identity, {
        jit: cfg.bool('oidcJitEnabled'),
        linkExisting: cfg.bool('oidcLinkExisting'),
        roleSync: cfg.bool('oidcRoleSync'),
      });
      const s = issueSession(r.user);
      reply.setCookie(COOKIE, s.token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: cfg.int('sessionTtlDays') * 86_400 });
      return reply.redirect(next || '/');
    } catch (e: any) {
      console.warn('[oidc] callback failed:', String(e?.message || e));
      return redirectWithError(reply, e?.message || 'sign-in failed');
    }
  });

  // ── LDAP settings (admin) ──
  app.get('/api/admin/ldap', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { ldap: ldapStatus(), enabled: cfg.bool('ldapEnabled') };
  });

  app.put('/api/admin/ldap', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try { return { ldap: saveLdapConfig(req.body || {}), enabled: cfg.bool('ldapEnabled') }; }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  app.delete('/api/admin/ldap', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    clearLdapConfig();
    return { ldap: null, enabled: cfg.bool('ldapEnabled') };
  });

  // Bind with the service account and report what it can see. `username` (optional) runs the real
  // user filter for one person, which is how a wrong attribute name gets caught before go-live.
  app.post('/api/admin/ldap/test', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const username = String((req.body as any)?.username || '').trim();
    try { return await testLdap(username || undefined); }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e).slice(0, 300) }); }
  });

  // Bulk provisioning. Creates/refreshes local rows; never deletes one — a person removed upstream
  // keeps their chats and simply stops being able to sign in.
  app.post('/api/admin/ldap/import', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try { return { summary: await importLdapUsers() }; }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e).slice(0, 300) }); }
  });

  // ── OIDC settings (admin) ──
  app.get('/api/admin/oidc', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { oidc: oidcStatus(), enabled: cfg.bool('oidcEnabled'), callbackUrl: `${originOf(req)}/api/auth/oidc/callback` };
  });

  app.put('/api/admin/oidc', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try { return { oidc: saveOidcConfig(req.body || {}), enabled: cfg.bool('oidcEnabled') }; }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  app.delete('/api/admin/oidc', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    clearOidcConfig();
    return { oidc: null, enabled: cfg.bool('oidcEnabled') };
  });

  // Pull the discovery document (and the JWKS) fresh, so a typo in the issuer shows up here.
  app.post('/api/admin/oidc/test', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try { return await testOidc(); }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e).slice(0, 300) }); }
  });
}
