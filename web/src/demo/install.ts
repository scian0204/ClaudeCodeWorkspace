// Demo bootstrap (VITE_DEMO build only): route /api/* to the mock router by patching fetch +
// XHR, drop a small DEMO badge, and auto-open the first chat so the app lands populated.
import { route } from './router';
import { useStore } from '../lib/store';

function patchFetch() {
  const real = window.fetch.bind(window);
  window.fetch = ((input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);
    const path = url.replace(location.origin, '');
    if (!path.startsWith('/api/')) return real(input, init);
    const method = init?.method || (typeof input === 'object' && !(input instanceof URL) ? input.method : 'GET') || 'GET';
    let body: any = init?.body;
    if (body instanceof FormData) { const o: any = {}; body.forEach((v, k) => { o[k] = v instanceof File ? v.name : v; }); body = o; }
    const { status, data } = route(method, path, body);
    return Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }));
  }) as typeof fetch;
}

function patchXHR() {
  const proto = XMLHttpRequest.prototype as any;
  const realOpen = proto.open, realSend = proto.send;
  proto.open = function (method: string, url: string, ...rest: any[]) { this.__demo = String(url).includes('/api/'); this.__m = method; return realOpen.call(this, method, url, ...rest); };
  proto.send = function (body: any) {
    if (!this.__demo) return realSend.call(this, body);
    const files: { name: string; size: number }[] = [];
    if (body instanceof FormData) body.forEach((v) => { if (v instanceof File) files.push({ name: v.name, size: v.size }); });
    const total = files.reduce((s, f) => s + f.size, 0) || 1000;
    setTimeout(() => this.upload && this.upload.onprogress && this.upload.onprogress({ lengthComputable: true, loaded: total * 0.5, total }), 60);
    setTimeout(() => {
      this.upload && this.upload.onprogress && this.upload.onprogress({ lengthComputable: true, loaded: total, total });
      Object.defineProperty(this, 'status', { value: 200, configurable: true });
      Object.defineProperty(this, 'responseText', { value: JSON.stringify({ files }), configurable: true });
      if (this.onload) this.onload();
    }, 240);
  };
}

function badge() {
  const a = document.createElement('a');
  a.href = 'https://github.com/scian0204/ClaudeCodeWorkspace';
  a.target = '_blank'; a.rel = 'noreferrer'; a.textContent = 'DEMO';
  a.title = 'Static demo — data is mocked. Source on GitHub.';
  a.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:80;font:600 11px ui-sans-serif,system-ui;letter-spacing:.08em;color:#fff;background:#c8613a;padding:3px 9px;border-radius:9999px;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,.2);opacity:.85';
  document.body.appendChild(a);
}

function autoOpenFirst() {
  const unsub = useStore.subscribe((s) => {
    if (s.user && s.sessions.length && !s.current) { unsub(); useStore.getState().openPrivate(s.sessions[0].id); }
  });
}

export function installDemo() {
  patchFetch();
  patchXHR();
  autoOpenFirst();
  if (document.body) badge();
  else document.addEventListener('DOMContentLoaded', badge);
}
