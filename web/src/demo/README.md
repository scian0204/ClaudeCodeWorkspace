# Static demo layer (`web/src/demo`)

This folder is the **backend for the GitHub Pages demo**. It only loads when the app is
built with `VITE_DEMO` on:

```bash
npm run build:demo -w web        # vite build --mode demo --base=/ClaudeCodeWorkspace/
npx vite preview --base=/ClaudeCodeWorkspace/   # then open http://localhost:4173/ClaudeCodeWorkspace/
```

Deployed automatically to GitHub Pages by `.github/workflows/deploy-demo.yml` on every push
to `main` that touches `web/**`. (One-time: repo **Settings → Pages → Source: GitHub Actions**.)

## How it works

The demo reuses the **real app** — every component, the store, styling, i18n. Only the
network layer is swapped, so the demo looks identical and **new UI automatically shows up**.
Three tiny hooks make that happen:

| File | Role |
|---|---|
| `install.ts` | `installDemo()` — patches `window.fetch` + `XMLHttpRequest` to route `/api/*` to the mock, drops the `DEMO` badge, auto-opens the first chat. Called from `main.tsx` (guarded by `VITE_DEMO`). |
| `router.ts` | `route(method, path, body)` → canned JSON / in-memory mutations for every REST endpoint. |
| `socket.ts` | `getDemoSocket()` — a fake socket.io `Socket`. `.emit()` interprets outbound events and synthesizes the inbound stream (`message → turn:start → assistant:delta → tool:use/result → turn:end`), with one permission prompt on the first turn of each chat. Returned by `lib/socket.ts` under `VITE_DEMO`. |
| `data.ts` | Seed data + a mutable in-memory `db` (chats, rooms, wiki, projects, plugins, users, messages). Mutations persist for the tab and reset on reload. |

Only two source files outside this folder know about the demo:
`lib/socket.ts` (`if (import.meta.env.VITE_DEMO) return getDemoSocket()`) and
`main.tsx` (`import('./demo/install')`). Everything is tree-shaken out of the normal build.

## Adding a feature? Keep the demo working

UI/store changes need nothing — they're the real code. You only touch the mock when a
feature calls the backend:

1. **New REST endpoint** (`api.get/post/put/patch/del`, `api.upload`, or a raw `fetch('/api/…')`):
   add a branch in `router.ts`. Return the same shape the component/store destructures.
   Add any seed rows to `db` / constants in `data.ts`.

2. **New socket event**:
   - the store **emits** a new outbound event → handle it in the `emit()` switch in `socket.ts`.
   - the store **listens** for a new inbound event → have the sim `deliver(...)` it at the right time.

3. **Verify**: `npm run build:demo -w web`, then `vite preview` and click the feature.
   `npm run typecheck -w web` should stay green. Check the browser console — the mock router
   returns `{}` for unmatched routes, so a broken flow usually shows up as a missing field.

Rule of thumb: if a new flow throws or shows an error toast in the demo, an endpoint or event
is unmocked. Grep the component for `api.` and `getSocket()` to find what to add.
