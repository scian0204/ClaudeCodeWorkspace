// Shared image-upload handling for the single-image multipart endpoints (user avatar, brand logo).
// One place decides which types are allowed, how the on-disk extension is derived (never from the
// client-supplied filename) and that the bytes really are that type.
const BASE_MIME_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const SVG_MIME_EXT: Record<string, string> = { 'image/svg+xml': 'svg' };

export const EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
};
export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
export const IMAGE_EXTS_SVG = [...IMAGE_EXTS, 'svg'];

// Verify the buffer's leading bytes match the claimed image type — defends against a spoofed mime
// on a non-image payload. No dependency; ext comes from the mime map so it's png/jpg/webp/gif/svg.
export function magicOk(ext: string, b: Buffer): boolean {
  if (ext === 'png') return b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (ext === 'jpg' || ext === 'jpeg') return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (ext === 'gif') return b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38;
  if (ext === 'webp') return b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  // svg is text: an xml prolog/comment may precede the root, so look for the tag in the head of the file.
  // Scripting inside it is neutralized at serve time (CSP default-src 'none' + nosniff), not here.
  if (ext === 'svg') return b.subarray(0, 2048).toString('utf8').includes('<svg');
  return false;
}

export type PickedImage =
  | { ok: true; ext: string; buf: Buffer }
  | { ok: false; code: number; error: string };

// Read the single uploaded image off a multipart request and validate it: mime → extension, size cap
// enforced at the streaming layer, magic-byte check. Never throws on bad input — the caller maps the
// returned code/error straight onto the reply.
export async function pickImage(req: any, maxMB: number, opts: { svg?: boolean } = {}): Promise<PickedImage> {
  const mimeExt = opts.svg ? { ...BASE_MIME_EXT, ...SVG_MIME_EXT } : BASE_MIME_EXT;
  const data = await req.file({ limits: { fileSize: maxMB * 1024 * 1024 } }); // cap at the streaming layer
  if (!data) return { ok: false, code: 400, error: 'no image uploaded' };
  const ext = mimeExt[data.mimetype];
  if (!ext) {
    data.file.resume(); // drain without buffering
    const list = Object.keys(mimeExt).map((m) => m.replace('image/', '').replace('+xml', '')).join('/');
    return { ok: false, code: 400, error: `unsupported image type (${list} only)` };
  }
  let buf: Buffer;
  try { buf = await data.toBuffer(); } // fileSize limit throws RequestFileTooLargeError on overflow
  catch { return { ok: false, code: 413, error: `image too large (max ${maxMB}MB)` }; }
  if (data.file.truncated) return { ok: false, code: 413, error: `image too large (max ${maxMB}MB)` }; // belt-and-suspenders
  if (!magicOk(ext, buf)) return { ok: false, code: 400, error: 'file content does not match an image type' };
  return { ok: true, ext, buf };
}
