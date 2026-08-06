<div align="center">

**English** · [한국어](CHANGELOG.ko.md)

# Update notes

Everything that changed between the spec being frozen in [DESIGN.md](DESIGN.md) (2026-07-20) and **v1.11.0** (2026-08-06).

</div>

---

## Contents

- [Timeline](#timeline)
- [v1.11.0 · v1.10.0 · v1.9.1 · v1.9.0](#v1110--2026-08-06)
- [v1.8.0 · v1.7.0 · v1.6.0 · v1.5.0 · v1.4.0](#v180--2026-08-04)
- [v1.3.1 · v1.3.0 · v1.2.0 · v1.1.1 · v1.1.0](#v131--2026-08-03)
- [Early development (2026-07-20 → 07-31)](#early-development--2026-07-20--07-31)
- [Where it diverged from the original design](#where-it-diverged-from-the-original-design)

---

## Timeline

| Version | Date | Headline |
|---|---|---|
| [v1.11.0](#v1110--2026-08-06) | 2026-08-06 | Live thinking/token meter, growing composer with markdown |
| [v1.10.0](#v1100--2026-08-05) | 2026-08-05 | Tasks panel — subagents, background shells, workflows |
| [v1.9.1](#v191--2026-08-05) | 2026-08-05 | Bypass-mode and resume-id fixes |
| [v1.9.0](#v190--2026-08-05) | 2026-08-05 | Admin self-update, Git diffs + history graph, My Page tabs |
| [v1.8.0](#v180--2026-08-04) | 2026-08-04 | Floating guide agent that explains *and* does the thing |
| [v1.7.0](#v170--2026-08-04) | 2026-08-04 | Signature waiting animation, chats grouped by project, webhook PR review, custom branding |
| [v1.6.0](#v160--2026-08-04) | 2026-08-04 | Import overwrite/clone choices, git init & publish, manual naming |
| [v1.5.0](#v150--2026-08-04) | 2026-08-04 | Auto-fetched model list, 5-hour auto-resume & window primer |
| [v1.4.0](#v140--2026-08-03) | 2026-08-03 | Workspace-wide search (Ctrl/Cmd+K), shortcuts, own context menu, auto session names |
| [v1.3.1](#v131--2026-08-03) | 2026-08-03 | Privacy master switch overrides and locks the per-channel toggles |
| [v1.3.0](#v130--2026-07-31) | 2026-07-31 | Per-channel toggles for non-essential egress |
| [v1.2.0](#v120--2026-07-31) | 2026-07-31 | Non-essential Anthropic egress blocked by default, README overhaul |
| [v1.1.1](#v111--2026-07-31) | 2026-07-31 | Multi-arch (amd64/arm64) build, Docker Hub overview page |
| [v1.1.0](#v110--2026-07-31) | 2026-07-31 | Release pipeline + Docker Hub image publishing |
| [Early development](#early-development--2026-07-20--07-31) | 07-20 → 07-31 | From the P0–P5 skeleton to the LLM Wiki, PR review and the admin config registry |

---

## v1.11.0 — 2026-08-06

- **Live thinking / token meter** — extended-thinking progress and token spend shown while the turn runs. The **composer grows with its content** and renders markdown as you type, and answers are handled as a **working copy** (`d0aaf40`)
- Per-turn slot / TTFT / total timing logged (`acc2336`)

## v1.10.0 — 2026-08-05

- **Tasks panel** — a panel beside the conversation listing every **subagent, backgrounded shell, workflow and MCP monitor** the turn spawned, with status, elapsed time and token/tool-call counts. Subagent tool calls are badged as such in the transcript; full-screen on a phone. Admin flag `taskPanelEnabled` (`f1051b3`, `bf5598d`)

## v1.9.1 — 2026-08-05

- fix: bypass mode no longer kills the turn under root (`67b4ff8`)
- fix: keep the resume id when a turn dies mid-stream (`2b8b24b`)

## v1.9.0 — 2026-08-05

- **Admin self-update** — check the published image and swap this running container in place (`e2506cd`, `80db2c6`)
- **Git panel, expanded** — per-file diffs, a commit history graph with branches and merges drawn as coloured lanes, and a full-screen toggle for the dialog (`ab118bc`, `dea68b3`)
- **Project pull** — pull from origin (`--all`, so branches created upstream come along), and open the Git panel from My Page (`dcf5013`, `56ec8ac`)
- **My Page split into tabs**, like the admin panel (`c240899`)
- Probe the Docker daemon and surface its state instead of failing at point of use (`29422de`)
- fix: composer reserving dead space, guide input centring (`cd0df76`); missing vitest dependency breaking typecheck (`68b2906`)

## v1.8.0 — 2026-08-04

- **Floating guide agent** — a round button in the bottom-right corner opens an assistant that explains features *and* **carries them out by calling the workspace API through your own session** (create a session, add a skill, switch language…). Members can never reach an admin action (it files a request instead), credentials are never touched, and it cannot delete anything. `guideEnabled` / `guideWriteEnabled` (`ff4cd1f`, `8e170e2`)

## v1.7.0 — 2026-08-04

- **Signature waiting animation** — every model-wait spot wears the app's own logo-derived mark (a turning clay ring plus a title glint while a chat is being named); `prefers-reduced-motion` freezes it into a static badge (`f8b645b`)
- **Sidebar chats grouped by project**, with collapsible headers (`5567ec4`)
- **The right-click menu builds itself from the clicked element** — panels added later get a working menu with no extra wiring (`366a986`)
- **Webhook-triggered PR review** — per-repo secret, per-repo polling toggle, both decided when registering the repo (`2130a27`, `226aef7`, `716a1f7`)
- **Custom branding** — admin-set logo and workspace title (`ba7ebb6`)
- LLM Wiki: add and edit raw sources on an existing topic, open the source manager from the sidebar topic row (`0cfb7bf`, `675111f`)
- Per-user skill usage counters in the skill detail (`4861dae`)

## v1.6.0 — 2026-08-04

- **Import collision handling** — already-imported projects and sessions are flagged, with **overwrite vs clone** per item; overwriting a project folder also asks whether to keep or delete the files already there (`b74f044`, `1376bd7`, `335fa6b`, `fc6b082`)
- **Imported sessions named after their own conversation**, offered as a choice on the import screen (`cb9cb5e`, `b93c07d`)
- **git init & publish** — take a project that is not a repository yet through init, first commit, remote repository creation and push (`9519395`); **manual remote management** per project (`7dd4e90`)
- **Manual "name this chat" button**, on demand rather than only on the first turn (`67ee010`)
- fix: drop CLI plumbing lines from imported transcripts (`d105d33`); an imported `/clear` or `/compact` folds the history above it (`0c06e3f`)

## v1.5.0 — 2026-08-04

- **Auto-fetched model list** — periodically pull the live list from the configured provider's `/v1/models` and refresh the dropdown; [Fetch now] plus manual editing (`c5c5f5d`)
- **Auto-resume when the 5-hour window resets** — a turn killed by the plan limit is parked and re-sent once the window reopens, surviving a restart; per-user opt-in plus `autoResumeEnabled` (`7bc5495`)
- **Keep the 5-hour window open** — one tiny throwaway query whenever no window is running, so the full 5 hours are still there when you sit down; `windowPrimer*` (`7db52ae`)

## v1.4.0 — 2026-08-03

- **Workspace-wide search (`Ctrl/Cmd+K`)** — one palette over private chats, rooms, DMs, projects, the wiki, PR reviews and people, sorted by type or time, narrowed by per-feature tabs (`37033e9`, `0b71232`, `e5f86ed`)
  - **Security fixes:** never let an admin search another user's personal space (`87ccb9b`); scope candidate rows to the caller *before* the per-type cap (`1a976f9`)
- **Keyboard shortcuts** — search, new chat, sidebar, home, theme, `Esc` to interrupt; `?` prints the cheat sheet in the platform's own notation (`bd9b76a`)
- **The app owns right-click** — its own context menu, `Shift` for the browser's, `customContextMenu` to disable (`733c583`)
- **Automatic session names** — a chat nobody renamed is named after its topic once the first reply lands, per-user toggle (`663b859`, `bca1272`)
- **Collapsible desktop sidebar** (`607e460`); the logo returns to the landing screen with search in its centre (`a943777`)
- Language picked from a list instead of a two-way toggle, moved to the sidebar footer (`965f4be`, `a35a08d`, `f2fb154`)
- Local compose rebuilds clean up their dangling images (`94ce165`)

## v1.3.1 — 2026-08-03

- fix: the privacy master switch now overrides and locks the per-channel toggles (`f1cfd57`)

## v1.3.0 — 2026-07-31

- **Per-channel toggles** for non-essential Anthropic egress (`1e62f66`)

## v1.2.0 — 2026-07-31

- **All non-essential Anthropic egress blocked by default** (`1e8f69f`)
- README: recommended specs, a **fully-local stack** (Ollama + LiteLLM + app), a demo GIF re-recorded against the current UI, table of contents and badges (`7d123d5` … `2d3526a`)

## v1.1.1 — 2026-07-31

- **Multi-arch build** (linux/amd64 + linux/arm64 via buildx) (`d5b1956`), later defaulted to amd64 with an opt-in `--arm` (`0a97718`)
- Docker Hub repository overview page + per-shell run commands (`5ea9258`)

## v1.1.0 — 2026-07-31

- **Release pipeline** — version tagging plus Docker Hub image publishing (`:version`, `:latest`, `:sha-…`) (`8102e6a`)
- **`docker-compose.hub.yml`** — a standalone deploy file for clone-free runs (`ecfe492`)
- code-server self-provisions its network so a single `docker run` works (`7ee811c`)

---

## Early development — 2026-07-20 → 07-31

Everything before the first version tag. The build followed the **P0–P5 stages** in section 14 of [DESIGN.md](DESIGN.md); features the design never mentioned arrived after that.

### 07-20 — the P0–P5 skeleton (straight from the spec)

- **P0** monorepo scaffold · Docker deploy · SQLite/Drizzle schema · scrypt auth with revocable DB sessions · account provisioning (`b536aac`, `f043752`, `6c155d3`)
- **P1** per-session Agent SDK subprocess, streaming, the `canUseTool` web permission bridge, a global concurrency cap with 429 backoff, usage tracking (`545efb6`)
- **P2** code-server spawn/reap via dockerode, scoped volume-subpath mounts, in-app http+ws proxy (`6d8dcdf`) · remove a user's editor containers on logout (`b611365`) · reap orphans on boot (`0dcc963`) · wait for the `:8080` bind to kill the iframe 502 race (`f6a0e5c`)
- **P3** two-class plugin manager (common/personal, git + tarball, forced/preferred) (`f7c1a44`)
- **P4** shared rooms (owner/delegation), FIFO queue + cancel, Socket.IO fanout/presence (`47153ef`)
- **P0–P5** the full REST surface + Fastify entrypoint (`6e6e220`), and the React SPA — chat, tool cards, permission prompts, rooms, editor split, admin and plugin panels (`4fc95f4`)
- Open-sourcing: README + MIT LICENSE (`219f1d1`), demo GIF (`85207d9`), app icon and PWA manifest (`5642b85`, `bfb51ba`), English/Korean README split (`96a98c6`)

### 07-21 — the LLM Wiki (a fourth entity the design never had)

- OAuth tokens routed apart from API keys, local plugins wrapped, permission answer channel (`2b7d42a`)
- **Create a project by git clone** (`8f5324e`)
- **LLM Wiki** — admin topics, per-user query threads, bulk + folder upload (`af18dd4`), the raw → synthesized compile pipeline with `_index` (`9bc2159`), the immutable `raw/` fence (`3c742b7`), a tree file explorer (`1367783`, `a89e08e`), multimodal compile including images plus grounded answers (`2e315ce`), on-disk deletion with an orphan sweep at boot (`91460d1`)
- A proper block-level markdown renderer shared by chat and wiki (`03bae9a`), copy buttons for answers and code blocks (`1e143de`), the project file explorer in the chat header (`dfb89f1`)

### 07-22 — per-user tokens · i18n · static demo · git commit/push

- **Per-user Claude tokens** — encrypted storage plus a per-author resolution layer, each turn running on its author's token, admin common token (`d06bde9`, `8310b93`, `37cddf9`, `ee0a3d8`)
- **i18n (Korean + English)** with a global language toggle (`a42a7b1`, `fbf6c2d`)
- **Static GitHub Pages demo** — the real UI on a mocked backend (`d300b00`)
- Plugin detail: manifest, skills, file tree, update (`bb43660`, `4cc47f7`)
- Wiki: import an already-compiled wiki (`432ec46`), cited-sources panel, resizable (`0e6d4e7`, `b0f9a4b`)
- Fold the conversation history at `/clear` and `/compact` (`d075c12`)
- **git commit & push from chat, with encrypted remote credentials** — design spec first, then the implementation (`304bbad`, `a7418b8`)
- Working rules written down: CLAUDE.md (`aed6b6e`), the i18n + README upkeep rules (`b05471d`)

### 07-23 — sanding down the git workflow

- Branch list (local/remote) + switch (`f6a5b99`), **full clone instead of depth-1** so every remote branch shows (`895ac7d`, `4a0cd5f`), optional branch when cloning (`bf2d2aa`)
- Delete a project including its files (`f47160e`), rename a private session (`532fba8`)
- Show which credential a repo's push/commit resolves to (`8a159b1`)
- **Optional TLS** so the PWA installs off-localhost (`64e4d0e`)

### 07-24 → 07-27 — PR review sessions and the automatic pipeline

- **PR review backend** — clone, poll, local merge (`b6a84fb`), sidebar/header UI with read-only access (`6572ba3`), demo mirror (`88630ac`), docs (`48e061e`)
- **Automatic pipeline** — merge → build/run → review → verdict, plus remote-merge UI (`96c38b9`, `c91e30e`)
- Hardening: withhold the git PAT from auto-turns and guard re-entrancy (`1aa4d54`), re-review on new PR commits (`78c7f2c`, `308c676`), always run fresh rather than resuming (`1601682`), a watchdog so a hung review self-heals (`3c630de`, `8028893`)
- **Build/test in an isolated sandbox container** (`768121e`, `033afd6`, `0dedf93`)
- **Post the finished review back as a PR comment** (`60df2ce`)
- **Live usage meter** — session context window + claude.ai plan limits (`123312f`, `e40b0ce`)
- **Responsive layout across the whole UI**, then made a standing rule for every later UI change (`b6e8e22`, `6ed6f9d`)

### 07-28 — room chat split out · the admin config registry

- **Team chat separated from Claude instructions** — design spec first (`83bba34`, `422ef8c`, `f7f5368`)
- Stop/interrupt actually halts the running turn (`6ec7012`, `daf99ab`)
- **`@` file/folder autocomplete** in the composer (`6bc9a74`, `c3e950c`)
- Skip merge/build/run for docs-only PRs (`0010237`)
- **Admin-managed config registry** for all runtime settings — friendly labels, object editor, image pull, restart, collapsible groups (`b56e82b`, `0ed0ba8`, `bea431f`)

### 07-29 — local session import, plus ten feature groups

- **Local session import** — design and implementation plan first, then the pure module (encode/rewrite/backfill) → staging + confirm endpoints → the modal → demo mocks → docs (`0eae20a` … `35e5497`), collapsible tree rows, expand/collapse all, per-file upload progress (`f18bef8`, `0f899dc`, `f44daa8`), behind a feature flag (`c675112`)
- **My Page** (avatar, token, git credentials, projects) (`9b00a83`)
- **Admin panel split into tabs** (overview/users/providers/usage/config) (`063e0eb`), a **live activity/process manager** (`561e470`), **host-Docker resource cleanup** (`6cd1ddd`)
- **Per-session reasoning effort** (`b36bc11`), **file attachments + clipboard screenshot paste** (`d8301b3`)
- **LLM provider override** (bedrock/vertex/custom base URL) (`11cec38`)
- **Member request → admin approval workflow** (`b962d99`)
- **DM and group chat**, promotable to a room (`74bb92b`)
- A unified hand-made SVG icon set replacing standalone emoji (`ec5d444`, `21dc2af`)
- Review: per-repo sandbox build image with a global fallback (`1aba1cd`), editable registered repos (`2dbfb3a`), self-healing interrupted auto-reviews (`0eeba85`)
- New rule: no automatic merge to `main` from a branch without an explicit instruction (`9a27d4c`)

### 07-30 → 07-31 — closing the request flow, preparing the first release

- **Common-project creation is request-gated too**, with real-form parity (`dfbc5ae`, `9397a48`)
- A captured feature-tour gallery of 23 screenshots in the README (`c4c2f0f`)
- Click an image attachment for a full-size lightbox (`fe30ac2`)
- fix: the language toggle firing on Enter-to-submit at login (`f182546`); **Enter-to-send while the IME was composing duplicated the last Korean character** (`90954fd`)

---

## Where it diverged from the original design

[DESIGN.md](DESIGN.md) covers P0–P5 plus PR review. Everything below is what actually got built on top of it.

| Axis | Status |
|---|---|
| Per-user API keys (§15 "extension seam") | **Built** — per-user encrypted tokens with per-author resolution (07-22) |
| Webhook intake (§16 "not implemented") | **Built** — per-repo secret with a polling toggle (v1.7.0) |
| Full git GUI (§15 "out of scope") | **Partly built** — commit, push, pull, branches, remotes, diffs, history graph (through v1.9.0) |
| LLM Wiki | Added after the design — the **fourth workspace entity** (07-21) |
| DM and group chat | Added after the design (07-29) |
| Admin config registry | The design's "global settings tuning" (P5) grown into a runtime-editable registry (07-28) |
| Local session import | Added after the design (07-29) |
| Unified search · shortcuts · context menu | Added after the design (v1.4.0) |
| Guide agent | Added after the design — calls the workspace's own API with your permissions (v1.8.0) |
| SSO / proxy-header auth (§15) | Not implemented |
| Postgres · Redis promotion (§15) | Not implemented |
| CRDT live collaborative editing (§15) | Still out of scope |
