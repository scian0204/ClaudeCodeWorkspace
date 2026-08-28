// Runnable check (no framework): npx tsx server/src/auth/sso.test.ts
//
// Covers the parts of AD/LDAP + OIDC sign-in where a mistake is a security hole rather than a bug:
// filter injection, group matching, id_token signature + claim validation, the open-redirect guard,
// and the email-domain allowlist. Everything here is pure — no directory, no identity provider.
import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  escapeFilterValue, buildUserFilter, attrValue, attrList, normalizeDn, inAdminGroup,
  identityFromEntry, LDAP_DEFAULTS,
} from './ldap.js';
import { decodeJwt, verifySignature, checkClaims, safeNext, domainAllowed } from './oidc.js';
import { normalizeUsername } from './directory.js';

// ── LDAP filter injection ──
assert.equal(escapeFilterValue('a*b'), 'a\\2ab');
assert.equal(escapeFilterValue('x)(y'), 'x\\29\\28y');
assert.equal(escapeFilterValue('back\\slash'), 'back\\5cslash');
// the attack: a login name that closes the assertion and adds one of its own
const injected = buildUserFilter(LDAP_DEFAULTS.userFilter, '*)(sAMAccountName=admin');
assert.ok(!injected.includes('*)('), 'injected filter syntax is escaped away');
assert.ok(injected.includes('\\2a\\29\\28'), 'the metacharacters survive as escapes, not syntax');
assert.equal(buildUserFilter('(uid={username})', 'jane'), '(uid=jane)', 'a plain name is untouched');
assert.ok(buildUserFilter('(|(uid={username})(mail={username}))', 'jo').split('jo').length === 3,
  'every {username} occurrence is substituted');

// ── attribute reading (ldapts hands back string | string[] | Buffer) ──
assert.equal(attrValue({ cn: 'Jane' }, 'cn'), 'Jane');
assert.equal(attrValue({ cn: ['Jane', 'J'] }, 'cn'), 'Jane');
assert.equal(attrValue({ cn: Buffer.from('Jane') }, 'cn'), 'Jane');
assert.equal(attrValue({}, 'cn'), '');
assert.equal(attrValue({ cn: 'Jane' }, ''), '', 'an unset attribute name reads as empty, never as undefined');
assert.deepEqual(attrList({ memberOf: 'CN=A,DC=x' }, 'memberOf'), ['CN=A,DC=x'], 'a single value still lists');

// ── admin group membership ──
assert.equal(normalizeDn(' CN=Admins, OU=Groups , DC=corp '), 'cn=admins,ou=groups,dc=corp');
const entry = { dn: 'CN=Jane,OU=Staff,DC=corp,DC=local', sAMAccountName: 'jane', displayName: 'Jane R', mail: 'jane@corp.local', memberOf: ['CN=Devs,DC=corp,DC=local', 'CN=Admins,OU=Groups,DC=corp,DC=local'] };
assert.equal(inAdminGroup(entry, 'memberOf', 'cn=admins, ou=groups, dc=corp, dc=local'), true, 'case + spacing do not matter');
assert.equal(inAdminGroup(entry, 'memberOf', 'CN=Others,DC=corp,DC=local'), false);
assert.equal(inAdminGroup(entry, 'memberOf', ''), false, 'no admin group configured → nobody is promoted');

const idn = identityFromEntry(entry, { ...LDAP_DEFAULTS, adminGroup: 'CN=Admins,OU=Groups,DC=corp,DC=local' });
assert.equal(idn.externalId, entry.dn, 'the DN is the stable key, not the login name');
assert.equal(idn.username, 'jane');
assert.equal(idn.admin, true);
assert.equal(identityFromEntry(entry, LDAP_DEFAULTS).admin, undefined, 'no admin group → the role is left alone');

// ── username normalization (these strings come from someone else's directory) ──
assert.equal(normalizeUsername('  JANE.Doe  '), 'jane.doe');
assert.equal(normalizeUsername('jane<script>'), 'janescript');
assert.equal(normalizeUsername('CORP\\jane'), 'corpjane');
assert.equal(normalizeUsername('日본'), '', 'a name with nothing usable left is refused upstream');

// ── OIDC: id_token signature ──
const sign = (alg: string, header: any, payload: any, key: any, opts: any = {}) => {
  const h = Buffer.from(JSON.stringify({ alg, ...header })).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = Buffer.from(`${h}.${p}`);
  const sig = alg.startsWith('HS')
    ? crypto.createHmac('sha256', key).update(data).digest()
    : crypto.sign('sha256', data, Object.keys(opts).length ? { key, ...opts } : key);
  return `${h}.${p}.${sig.toString('base64url')}`;
};

const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const rsaJwk = rsa.publicKey.export({ format: 'jwk' });
const rsToken = sign('RS256', { kid: 'k1' }, { sub: 'u1' }, rsa.privateKey);
{
  const { header, signed, sig } = decodeJwt(rsToken);
  assert.equal(verifySignature(header, signed, sig, rsaJwk, ''), true, 'RS256 verifies against the JWKS key');
  // one flipped byte in the payload must fail
  const tampered = decodeJwt(sign('RS256', { kid: 'k1' }, { sub: 'attacker' }, rsa.privateKey));
  assert.equal(verifySignature(header, tampered.signed, sig, rsaJwk, ''), false, 'a swapped payload fails');
}

const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
{
  const t = sign('ES256', { kid: 'e1' }, { sub: 'u1' }, ec.privateKey, { dsaEncoding: 'ieee-p1363' });
  const { header, signed, sig } = decodeJwt(t);
  assert.equal(verifySignature(header, signed, sig, ec.publicKey.export({ format: 'jwk' }), ''), true, 'ES256 verifies');
}
{
  const t = sign('HS256', {}, { sub: 'u1' }, 'sekret');
  const { header, signed, sig } = decodeJwt(t);
  assert.equal(verifySignature(header, signed, sig, null, 'sekret'), true, 'HS256 verifies against the client secret');
  assert.equal(verifySignature(header, signed, sig, null, 'wrong'), false, 'a wrong client secret fails');
}
// unsupported / absent algorithms are refused rather than skipped
assert.throws(() => verifySignature({ alg: 'none' }, 'a.b', Buffer.alloc(0), null, ''), /unsupported algorithm/);
assert.throws(() => verifySignature({}, 'a.b', Buffer.alloc(0), null, ''), /unsupported algorithm/);
assert.throws(() => decodeJwt('not-a-jwt'), /not a JWS/);

// ── OIDC: claim validation ──
const now = Date.now();
const base = { iss: 'https://idp.example', aud: 'client-1', exp: Math.floor(now / 1000) + 300, iat: Math.floor(now / 1000), nonce: 'N1', sub: 'u1' };
const opts = { issuer: 'https://idp.example', clientId: 'client-1', nonce: 'N1', now, skewMs: 60_000 };
checkClaims(base, opts); // the happy path throws nothing
checkClaims({ ...base, iss: 'https://idp.example/' }, opts); // a trailing slash is not a mismatch
assert.throws(() => checkClaims({ ...base, iss: 'https://evil.example' }, opts), /issuer mismatch/);
assert.throws(() => checkClaims({ ...base, aud: 'other-client' }, opts), /audience mismatch/);
checkClaims({ ...base, aud: ['client-1', 'other'], azp: 'client-1' }, opts);
assert.throws(() => checkClaims({ ...base, aud: ['client-1', 'other'], azp: 'other' }, opts), /azp mismatch/);
assert.throws(() => checkClaims({ ...base, exp: Math.floor(now / 1000) - 3600 }, opts), /expired/);
assert.throws(() => checkClaims({ ...base, nonce: 'N2' }, opts), /nonce mismatch/);
assert.throws(() => checkClaims({ ...base, sub: undefined }, opts), /no sub claim/);
assert.throws(() => checkClaims(null, opts), /no claims/);

// ── open-redirect guard on ?next= ──
assert.equal(safeNext('/rooms/abc'), '/rooms/abc');
assert.equal(safeNext('//evil.example/x'), '/', 'protocol-relative URLs are refused');
assert.equal(safeNext('https://evil.example'), '/');
assert.equal(safeNext('/x\\y'), '/', 'a backslash cannot smuggle a host past the check');
assert.equal(safeNext(undefined), '/');

// ── email domain allowlist ──
assert.equal(domainAllowed('jane@corp.com', ''), true, 'empty list = no restriction');
assert.equal(domainAllowed('jane@corp.com', 'corp.com, other.com'), true);
assert.equal(domainAllowed('jane@CORP.com', '@corp.com'), true, 'case and a leading @ are tolerated');
assert.equal(domainAllowed('jane@evil.com', 'corp.com'), false);
assert.equal(domainAllowed('', 'corp.com'), false, 'no email at all cannot pass a restricted list');

// eslint-disable-next-line no-console
console.log('auth/sso.test.ts ok');
