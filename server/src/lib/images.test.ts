import { describe, it, expect } from 'vitest';
import { magicOk, EXT_MIME, IMAGE_EXTS, IMAGE_EXTS_SVG } from './images.js';

const png = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpg = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const gif = () => Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const webp = () => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);

describe('magicOk', () => {
  it('accepts the real leading bytes of each supported type', () => {
    expect(magicOk('png', png())).toBe(true);
    expect(magicOk('jpg', jpg())).toBe(true);
    expect(magicOk('jpeg', jpg())).toBe(true);
    expect(magicOk('gif', gif())).toBe(true);
    expect(magicOk('webp', webp())).toBe(true);
  });

  it('rejects a payload whose mime was spoofed as another image type', () => {
    expect(magicOk('png', jpg())).toBe(false);
    expect(magicOk('webp', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('AVI ')]))).toBe(false);
    expect(magicOk('png', Buffer.from('<?php system($_GET["c"]); ?>'))).toBe(false);
  });

  it('rejects truncated headers instead of reading past the buffer', () => {
    expect(magicOk('png', Buffer.from([0x89, 0x50]))).toBe(false);
    expect(magicOk('webp', Buffer.from('RIFF'))).toBe(false);
    expect(magicOk('gif', Buffer.alloc(0))).toBe(false);
  });

  it('accepts an svg root after an xml prolog, and rejects non-svg text', () => {
    expect(magicOk('svg', Buffer.from('<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(true);
    expect(magicOk('svg', Buffer.from('<html><body>hi</body></html>'))).toBe(false);
    // beyond the sniffed window → not treated as an svg
    expect(magicOk('svg', Buffer.concat([Buffer.alloc(4096, 0x20), Buffer.from('<svg/>')]))).toBe(false);
  });

  it('rejects an extension outside the allowed sets', () => {
    expect(magicOk('exe', png())).toBe(false);
    expect(IMAGE_EXTS).not.toContain('svg');   // avatars stay raster-only
    expect(IMAGE_EXTS_SVG).toContain('svg');   // the brand logo may be vector
    for (const ext of IMAGE_EXTS_SVG) expect(EXT_MIME[ext]).toBeTruthy();
  });
});
