// Demo bootstrap (VITE_DEMO build only): route /api/* to the mock router by patching fetch +
// XHR, drop a small DEMO badge, and auto-open the first chat so the app lands populated.
import { route } from './router';
import { ATTACHMENTS, WIKI_RAW } from './data';
import { useStore } from '../lib/store';

function patchFetch() {
  const real = window.fetch.bind(window);
  window.fetch = ((input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);
    const path = url.replace(location.origin, '');
    if (!path.startsWith('/api/')) return real(input, init);
    const method = init?.method || (typeof input === 'object' && !(input instanceof URL) ? input.method : 'GET') || 'GET';
    let body: any = init?.body;
    const respond = (r: { status: number; data: any }) =>
      new Response(JSON.stringify(r.data), { status: r.status, headers: { 'Content-Type': 'application/json' } });
    if (body instanceof FormData) {
      // single-image uploads (avatar, brand logo): read the picked file into a data URL so the demo can
      // render it inline — there is no GET stream here.
      const inline: [string, string] | undefined =
        path.startsWith('/api/auth/me/avatar') ? ['avatar', 'avatarDataUrl']
        : path.startsWith('/api/admin/brand/logo') ? ['logo', 'brandLogoDataUrl']
        : undefined;
      const picked = inline && body.get(inline[0]);
      if (inline && picked instanceof File) {
        return new Promise<Response>((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(Promise.resolve(route(method, path, { [inline[1]]: fr.result })).then(respond));
          fr.onerror = () => resolve(Promise.resolve(route(method, path, {})).then(respond));
          fr.readAsDataURL(picked);
        });
      }
      const o: any = {}; body.forEach((v, k) => { o[k] = v instanceof File ? v.name : v; }); body = o;
    }
    // a route may answer late on purpose (a real model call is not instant) — await either shape
    return Promise.resolve(route(method, path, body)).then(respond);
  }) as typeof fetch;
}

function patchXHR() {
  const proto = XMLHttpRequest.prototype as any;
  const realOpen = proto.open, realSend = proto.send;
  proto.open = function (method: string, url: string, ...rest: any[]) { this.__demo = String(url).includes('/api/'); this.__url = String(url); this.__m = method; return realOpen.call(this, method, url, ...rest); };
  proto.send = function (body: any) {
    if (!this.__demo) return realSend.call(this, body);
    const isAttach = String(this.__url || '').includes('/attachments');
    // adding sources to an existing wiki topic: keep them so the explorer tree shows the new files
    const isWikiSource = /\/api\/wiki\/topics\/[^/]+\/files/.test(String(this.__url || ''));
    const raw: File[] = [];
    const rels: string[] = [];
    if (body instanceof FormData) body.forEach((v, k) => { if (v instanceof File) { raw.push(v); rels.push(k); } }); // rel carried in field NAME
    const files = raw.map((f) => ({ name: f.name, size: f.size, isImage: /^image\/(png|jpe?g|webp|gif)$/.test(f.type) }));
    const total = files.reduce((s, f) => s + f.size, 0) || 1000;
    const finish = () => {
      let payload: any = { files };
      if (isWikiSource) {
        raw.forEach((f, i) => {
          const name = rels[i] || f.name;
          const at = WIKI_RAW.findIndex((x) => x.name === name);
          if (at >= 0) WIKI_RAW[at] = { name, size: f.size }; else WIKI_RAW.push({ name, size: f.size });
        });
        payload = { sources: WIKI_RAW.map((f) => f.name) };
      }
      this.upload && this.upload.onprogress && this.upload.onprogress({ lengthComputable: true, loaded: total, total });
      Object.defineProperty(this, 'status', { value: 200, configurable: true });
      Object.defineProperty(this, 'responseText', { value: JSON.stringify(payload), configurable: true });
      if (this.onload) this.onload();
    };
    setTimeout(() => this.upload && this.upload.onprogress && this.upload.onprogress({ lengthComputable: true, loaded: total * 0.5, total }), 60);
    if (isAttach && raw.length) {
      // read image attachments into data URLs so the demo can render thumbnails inline (name → dataUrl)
      let pending = raw.length;
      const done = () => { if (--pending === 0) setTimeout(finish, 240); };
      raw.forEach((f, i) => {
        if (!files[i].isImage) return done();
        const fr = new FileReader();
        fr.onloadend = () => { ATTACHMENTS.set(f.name, { url: String(fr.result || ''), isImage: true }); done(); };
        fr.onerror = done;
        fr.readAsDataURL(f);
      });
    } else {
      setTimeout(finish, 240);
    }
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
  // a deep link (/room/…, /chat/…) owns the landing view — don't stomp it with the first session
  if ((location.pathname.slice(import.meta.env.BASE_URL.length - 1) || '/') !== '/') return;
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
