// A tool result from the CLI is either a string or an array of content blocks. MCP tools that take
// screenshots (the shared browser) answer with `image` blocks carrying base64 — stringifying those
// into the transcript buries a 30KB blob in the message row and shows the user nothing. Split them
// off here: the text stays as the tool's output, the images go to disk and come back as URLs.

export interface ToolImage { mime: string; data: Buffer }

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp', 'image/gif': 'gif' };

export function imageExt(mime: string): string | null { return EXT[mime] || null; }

// Text of a tool result plus every raster image block it carried (unknown mime types are left in the
// text as a stub so nothing is silently dropped).
export function splitToolResult(content: unknown): { text: string; images: ToolImage[] } {
  if (typeof content === 'string') return { text: content, images: [] };
  if (!Array.isArray(content)) return { text: content == null ? '' : JSON.stringify(content), images: [] };
  const text: string[] = [];
  const images: ToolImage[] = [];
  for (const b of content as any[]) {
    if (b?.type === 'text' && typeof b.text === 'string') text.push(b.text);
    else if (b?.type === 'image' && typeof b.source?.data === 'string' && EXT[b.source?.media_type]) {
      images.push({ mime: b.source.media_type, data: Buffer.from(b.source.data, 'base64') });
    } else if (b?.type === 'image' && typeof b.data === 'string' && EXT[b.mimeType]) {
      // MCP's own block shape ({type:'image', data, mimeType}) in case it reaches us un-normalised
      images.push({ mime: b.mimeType, data: Buffer.from(b.data, 'base64') });
    } else text.push(JSON.stringify(b));
  }
  return { text: text.join('\n'), images };
}
