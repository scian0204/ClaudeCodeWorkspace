// Workspace branding: a custom title + logo an admin sets once for everyone.
// The title is a plain config key (brandTitle); the logo is a file at <dataDir>/brand/logo.<ext> whose
// mtime doubles as the cache-bust version token — no DB column needed.
//
// GET /api/brand and GET /api/brand/logo are deliberately UNAUTHENTICATED: the login card shows the
// branding before anyone is signed in, and a workspace name/logo is not a secret.
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../auth/index.js';
import { cfg, setConfigValue } from '../lib/config-registry.js';
import { paths, ensure } from '../lib/paths.js';
import { EXT_MIME, IMAGE_EXTS_SVG, pickImage } from '../lib/images.js';

function logoFile(): string | null {
  for (const ext of IMAGE_EXTS_SVG) {
    const f = path.join(paths.brand, `logo.${ext}`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

// mtime millis — changes on every upload, so a cached <img> is replaced the moment the logo changes
function logoVersion(): string | null {
  const f = logoFile();
  if (!f) return null;
  try { return String(Math.floor(fs.statSync(f).mtimeMs)); } catch { return null; }
}

function removeLogoFiles() {
  for (const ext of IMAGE_EXTS_SVG) {
    try { fs.rmSync(path.join(paths.brand, `logo.${ext}`), { force: true }); } catch { /* noop */ }
  }
}

export function brandDto(): { title: string; logo: string | null } {
  return { title: cfg.str('brandTitle'), logo: logoVersion() };
}

export async function brandRoutes(app: FastifyInstance) {
  // public: the client reads this before login to render the title/logo everywhere
  app.get('/api/brand', async () => brandDto());

  app.get('/api/brand/logo', async (req, reply) => {
    const f = logoFile();
    if (!f) return reply.code(404).send({ error: 'no logo' });
    const ext = f.split('.').pop()!.toLowerCase();
    reply.header('Content-Type', EXT_MIME[ext] || 'application/octet-stream');
    reply.header('X-Content-Type-Options', 'nosniff');
    // An SVG opened as a top-level document could otherwise run its own inline script on this origin.
    reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    reply.header('Cache-Control', 'public, max-age=300');
    return reply.send(fs.createReadStream(f));
  });

  app.post('/api/admin/brand/logo', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const maxMB = cfg.int('brandLogoMaxMB'); // must stay ≤ httpBodyLimitMB (global body cap) to take effect
    const picked = await pickImage(req, maxMB, { svg: true });
    if (!picked.ok) return reply.code(picked.code).send({ error: picked.error });
    ensure(paths.brand);
    // Write the new file FIRST, then drop any *other-extension* logo (never the one just written), so a
    // failed write can never leave the workspace with no logo at all.
    fs.writeFileSync(path.join(paths.brand, `logo.${picked.ext}`), picked.buf);
    for (const old of IMAGE_EXTS_SVG) {
      if (old === picked.ext) continue;
      try { fs.rmSync(path.join(paths.brand, `logo.${old}`), { force: true }); } catch { /* noop */ }
    }
    return brandDto();
  });

  app.delete('/api/admin/brand/logo', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    removeLogoFiles();
    return brandDto();
  });

  // The title lives in the config registry, but the brand card edits it through here so one call both
  // saves it and returns the fresh brand (the admin UI never has to read two endpoints).
  app.put('/api/admin/brand', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { title } = (req.body || {}) as any;
    try { setConfigValue('brandTitle', title == null ? '' : String(title)); }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
    return brandDto();
  });
}
