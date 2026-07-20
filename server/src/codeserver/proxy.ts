import httpProxy from 'http-proxy';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { resolve } from './manager.js';

const proxy = httpProxy.createProxyServer({ ws: true, xfwd: true });
proxy.on('error', (_err, _req, res) => {
  try {
    if (res && 'writeHead' in res) { (res as ServerResponse).writeHead(502); (res as ServerResponse).end('code-server unavailable'); }
    else (res as Duplex)?.end?.();
  } catch { /* ignore */ }
});

const RE = /^\/cs\/([^/]+)\/([^/]+)\/([^/]+)(\/.*)?$/;

export function isCsPath(url: string | undefined): boolean {
  return !!url && url.startsWith('/cs/');
}

// returns true if handled
export function handleHttp(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url || '';
  const m = url.match(RE);
  if (!m) { res.writeHead(404); res.end('bad code-server route'); return true; }
  const [, ownerId, projectId, token, rest] = m;
  if (rest === undefined) { // ensure trailing slash so code-server relative assets resolve
    res.writeHead(302, { Location: url + '/' }); res.end(); return true;
  }
  const r = resolve(ownerId, projectId, token);
  if (!r) { res.writeHead(403); res.end('invalid or expired editor session'); return true; }
  req.url = rest || '/';
  proxy.web(req, res, { target: r.target });
  return true;
}

export function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const url = req.url || '';
  const m = url.match(RE);
  if (!m) return false;
  const [, ownerId, projectId, token, rest] = m;
  const r = resolve(ownerId, projectId, token);
  if (!r) { socket.destroy(); return true; }
  req.url = rest || '/';
  proxy.ws(req, socket, head, { target: r.target });
  return true;
}
