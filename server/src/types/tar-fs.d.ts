// tar-fs v2 ships no types and @types/tar-fs pulls in the whole tar-stream typing tree for one call.
// Only `pack` is used (claude/win-sandbox.ts), so declare just that.
declare module 'tar-fs' {
  import type { Readable } from 'node:stream';
  export function pack(cwd: string, opts?: {
    ignore?: (name: string) => boolean;
    entries?: string[];
    dereference?: boolean;
    map?: (header: { name: string; size: number; type: string }) => any;
  }): Readable;
}
