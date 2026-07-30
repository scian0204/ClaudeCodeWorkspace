// Shared helpers for prompt attachments (uploaded files / pasted screenshots). Attachments live under
// <ownerProjectsDir>/.attachments/<sessionId>/ — always inside the session's allowed roots, so the
// agent can Read them by absolute path (images render visually via the Read tool).
//
// Trust boundary: the on-disk name is NEVER built from an unsanitized client string. safeBase collapses
// any client filename to a bare basename; isBareBasename re-validates names coming back from the client.

// Raster image mimes we render inline as a thumbnail; everything else is a generic file chip.
export const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

const EXT_CT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8',
  json: 'application/json', csv: 'text/csv; charset=utf-8',
};

// Content-Type for a stored attachment, keyed by extension. Unknown → octet-stream (served with nosniff).
export function contentTypeFor(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return EXT_CT[ext] || 'application/octet-stream';
}

// Windows reserved device names (case-insensitive, with or without extension): opening/writing these
// hits a device, not a file. Rejected so uploads can't target CON/PRN/AUX/NUL/COMn/LPTn on Windows dev.
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

// Collapse any client-supplied filename to a safe on-disk BASENAME: last path segment only (defeats
// `a/b`, `../x`, `C:\x`), control chars + Unicode format chars (\p{Cf}: bidi/RLO/zero-width) + separators
// + colons (NTFS alternate data streams) stripped, pure-dot and Windows reserved-device names rejected.
// The result never contains a path separator nor equals '.'/'..'. Empty string ⇒ caller supplies a fallback.
export function safeBase(name: string): string {
  const tail = String(name).normalize('NFC').split(/[/\\]/).pop() || '';
  let s = tail.replace(/[\x00-\x1f]/g, '').replace(/\p{Cf}/gu, '').replace(/[/\\:]/g, '').trim();
  if (/^\.+$/.test(s) || WIN_RESERVED.test(s)) s = '';
  return s.slice(0, 200);
}

// True iff `name` is ALREADY a safe bare basename (round-trips through safeBase unchanged). Used to
// re-validate names the client hands back (turn attachments, GET/DELETE) before they touch disk.
export function isBareBasename(name: string): boolean {
  const s = String(name);
  return s.length > 0 && safeBase(s) === s;
}

// Reasoning check: the sanitizer MUST neutralize traversal, bidi overrides, ADS colons and reserved
// device names. Fail fast at boot if it ever regresses.
for (const bad of ['..', 'a/b', '../x', 'a\\b', '.', '\x00x', 'C:\\x', 'a\u202eb', 'a:b', 'CON', 'con.txt']) {
  if (isBareBasename(bad)) throw new Error(`attachments.safeBase regression: accepted "${bad}"`);
}
