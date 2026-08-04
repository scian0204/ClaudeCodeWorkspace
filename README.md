<div align="center">

**English** · [한국어](README.ko.md)

<img src="docs/icon.svg" width="104" alt="ClaudeCode Workspace" />

# ClaudeCode Workspace

**The server-resident Claude Code, shared by your whole team through the browser.**

Per-session isolated Claude Code · shared team rooms · VS Code in the browser — all from a single `docker compose up`.

[![live demo](https://img.shields.io/badge/▶_live_demo-GitHub_Pages-c8613a)](https://scian0204.github.io/ClaudeCodeWorkspace/)

![status](https://img.shields.io/badge/status-P0--P5%20complete-4f8a52)
![stack](https://img.shields.io/badge/stack-Fastify%20%2B%20React%20%2B%20SQLite-c8613a)
![realtime](https://img.shields.io/badge/realtime-Socket.IO-6b5b8c)
![editor](https://img.shields.io/badge/editor-code--server-2b7de9)
![license](https://img.shields.io/badge/license-MIT-black)
![node](https://img.shields.io/badge/node-%E2%89%A520-339933)
![docker](https://img.shields.io/badge/docker-%E2%89%A526-2496ED)

<br/>

<img src="docs/ccw-demo.gif" alt="ClaudeCode Workspace demo — room chat, web tool approval, code-server split view" width="92%" />

<sub>Log in → room → send a message → approve the tool in the browser → tool runs → split into VS Code in the browser (MOCK-mode demo)</sub>

<br/><br/>

**▶ [Try the live demo](https://scian0204.github.io/ClaudeCodeWorkspace/)** — no install, no login. It's the real UI with a mocked backend, so streaming, tool cards, web permission prompts, rooms, the LLM Wiki and the admin panel are all clickable. Data resets on reload.

</div>

---

## Contents

- [At a glance](#at-a-glance)
- [📸 Feature tour](#-feature-tour)
- [✨ Strengths](#-strengths)
- [🚀 Quick start](#-quick-start)
- [🧭 Architecture](#-architecture)
- [🧩 Features in detail](#-features-in-detail)
- [⚙️ Configuration (.env)](#️-configuration-env)
- [🗂 Structure](#-structure)
- [🔐 Security posture](#-security-posture)
- [🛣 Roadmap](#-roadmap)
- [🤝 Contributing · License](#-contributing--license)

---

## At a glance

The Claude Code CLI is powerful, but it's tied to **one terminal — yours**. ClaudeCode Workspace lifts that CLI **onto a server and turns it into a team asset**.

- Everyone connects via browser → **their own isolated Claude Code session**
- Gather in a **shared room** to drive one Claude together (like a group chat)
- **DM a teammate or spin up a group chat** — plain person-to-person text (no Claude); an admin can promote a group to a common project room
- Risky actions that need approval → **approve/deny live, in the browser**
- Open **VS Code (code-server)** right there for editing, terminal, and git
- **Commit & push** a cloned repo from the chat header (or let Claude do it) with encrypted per-user git credentials
- Build a team **LLM Wiki** — upload docs, Claude compiles them into a queryable knowledge base
- **Import a local session** — upload a project folder plus its `~/.claude` session files to clone the conversation as a resumable private session. Transcripts the CLI never named show a snippet of their first message instead of a raw uuid, and you can tick a box on the import screen to have their conversation read and named properly (`importAutoTitleEnabled`). Anything you already have — the project and each individual session — is flagged in the picker, with a choice to overwrite it or add a copy
- **Auto-review pull requests** — each open PR auto-runs a pipeline (merge → build/run → bug + code review → a merge-safe verdict); one click merges it on the remote
- **Search the whole workspace** (`Ctrl/Cmd+K`) — one palette over your private chats, the shared rooms you belong to, DM/group messages, projects, LLM Wiki topics + documents, PR reviews and people; a hit jumps straight to the message (or opens the file). Sorted **newest / oldest**, narrowed by per-feature tabs (all · personal · rooms · DM · projects · wiki · PR reviews · people). **Nobody — admins included — can search someone else's private chats, wiki threads, personal projects or DMs**; shared surfaces (your rooms, PR reviews, the wiki knowledge base) work as usual
- **Live usage meter** in the chat header — per-session **context-window** fill plus your **claude.ai plan limits** (5-hour, weekly, per-model) with reset countdowns, straight from the CLI
- **Per-session model effort** — pick the reasoning effort (low → max) from a header pill; unsupported models silently downgrade
- **Auto-fetched model list** — frontier model ids change often, so the server periodically pulls the live list from the configured provider's `/v1/models` (Anthropic, or a custom base URL) and refreshes the model dropdown. Admins can hit [Fetch now] for an instant refresh, or turn it off and edit the list by hand
- **Automatic session names** — once the first reply lands, a private chat nobody renamed gets named after its topic (one cheap model call, falling back to the first message). Per-user on/off on My Page; admins can disable it workspace-wide (`autoTitleEnabled`)
- **Auto-resume when the 5-hour limit resets** (Claude subscription only) — a turn that dies because your claude.ai plan window (5-hour / weekly) is spent isn't lost: the server parks the prompt, shows the scheduled retry time under the composer (cancellable), and re-sends it once the window reopens — surviving a restart. Opt-in per user on My Page; admins can disable it workspace-wide (`autoResumeEnabled`). API keys and Bedrock/Vertex/custom providers have no such window and are never parked
- **Keep the 5-hour window open** (Claude subscription only) — the claude.ai window starts at your *first* message, not on a wall clock, so idling after a reset silently burns it. Turn this on and the server fires one tiny throwaway query (cheap model, no chat session, nothing in the sidebar) as soon as no window is running, so the full 5 hours are still there when you sit down. Opt-in per user on My Page, with the last prime time shown; tunable and disableable workspace-wide (`windowPrimer*`)
- Each user runs on **their own Claude token** (admin-common token + env as fallback); admins see everything via a **usage dashboard**
- **Keyboard shortcuts** for the core moves — search (`Ctrl/Cmd+K`), new chat (`Ctrl/Cmd+Shift+O`), sidebar (`Ctrl/Cmd+B`), home (`Ctrl/Cmd+Shift+H`), theme (`Ctrl/Cmd+Shift+L`), `Esc` to interrupt a running turn; press `?` for the cheat sheet, which prints the keys the way your platform writes them (⇧⌘O on a Mac, Ctrl+Shift+O on Windows/Linux)
- **Its own right-click menu** — right-clicking gives workspace actions instead of the browser's page menu: new chat, search, sidebar, theme, reload, clipboard actions in text fields, and per-row items where they make sense (rename/delete a chat, delete a room or wiki topic, copy/edit/delete a message). Hold `Shift` while right-clicking for the browser's own menu; admins can turn the whole thing off (`customContextMenu`)
- **Collapsible sidebar** — hide the left column on desktop for a full-width chat; the hamburger in any header brings it back (remembered per browser)
- **Works on a phone** — responsive layout: the sidebar collapses into a slide-in drawer and the chat goes full-width (installable as a PWA)

> Works as a personal remote setup too — solo, it becomes a single-account "remote Claude Code".

---

## 📸 Feature tour

<sub>All shots below are the **real UI** captured from the [live demo](https://scian0204.github.io/ClaudeCodeWorkspace/) (MOCK mode) — click the badge above to try any of them yourself.</sub>

### 💬 Talk to Claude — per-session, streaming, with tool cards

<img src="docs/screenshots/02-chat.png" alt="Private Claude Code session: streamed answer, collapsible tool cards, folded /clear history" width="100%" />

Every user gets their **own isolated Claude Code session** (a separate CLI subprocess). Answers stream token-by-token in a serif transcript, each tool call is a **collapsible card** (command + output), and every `/clear` or `/compact` **folds the history above it** into a stacked, timestamped toggle so the thread never scrolls forever.

### 🛡 Web permission prompts — approve tools live in the browser

<img src="docs/screenshots/03-permission.png" alt="Tool approval request card with Allow / Deny / Always allow" width="100%" />

Claude pauses right before a risky tool and asks the browser: **Allow / Deny / Always allow**. The isolation deny-fence (other users' paths, `~/.claude`, key paths) always applies regardless of permission mode.

### 📊 Live usage meter · ⚡ per-session effort · 🎛 model & mode

<table>
<tr>
<td width="50%"><img src="docs/screenshots/09-usage.png" alt="Usage popover: context window fill + claude.ai plan rate limits with reset countdowns" width="100%" /></td>
<td width="50%"><img src="docs/screenshots/11-slash.png" alt="Slash command palette" width="100%" /></td>
</tr>
<tr>
<td valign="top"><b>Usage meter</b> in the chat header — per-session <b>context-window</b> fill plus your <b>claude.ai plan limits</b> (5-hour, weekly, per-model) with live reset countdowns, straight from the CLI. Header pills also switch the <b>model</b>, the <b>reasoning effort</b> (low → max) and the <b>permission mode</b>.</td>
<td valign="top"><b>Slash command palette</b> — type <code>/</code> for built-in, plugin and skill commands (and client-side view actions like <code>/split</code>). Fuzzy-searchable, same feel as the <code>@</code> menu.</td>
</tr>
</table>

### 📎 `@` file references · 🖇 attach & paste

<img src="docs/screenshots/12-at.png" alt="@ file and folder reference menu over the composer" width="100%" />

Type `@` in any project chat to fuzzy-search **files and folders** and drop an `@path` reference into your message — point Claude at a file without leaving the composer. You can also attach any file or **paste/drag a clipboard screenshot**; images render visually to Claude.

### 👥 Shared rooms + fine-grained delegation

<table>
<tr>
<td width="55%"><img src="docs/screenshots/04-room.png" alt="Shared room chat with member avatars and per-message Claude badge" width="100%" /></td>
<td width="45%"><img src="docs/screenshots/05-members.png" alt="Members dialog with per-member delegation toggles" width="100%" /></td>
</tr>
</table>

Gather in a **shared room** to drive one Claude together (like a group chat). A FIFO queue orders multi-party turns; a composer toggle separates **team chat** from **instructions to Claude** (`@claude` to summon). The owner **delegates per right**: approve · interrupt · invite · kick · transfer ownership · delete room.

### 💬 DM & group chat — plain human messaging, no Claude

<img src="docs/screenshots/08-dm.png" alt="Direct message thread and group channel, separate from Claude rooms" width="100%" />

A lightweight messaging layer for **every** user, fully separate from the Claude rooms — 1:1 DMs and named group channels over WebSocket, with unread badges. An admin can **promote a group channel to a common project room**.

### ⑂ Git commit & push · 🧑‍💻 VS Code in the browser

<table>
<tr>
<td width="50%"><img src="docs/screenshots/10-git.png" alt="Git panel: file-level staging, commit, push, branch switch" width="100%" /></td>
<td width="50%"><img src="docs/screenshots/13-split.png" alt="Split view: chat beside the code-server editor pane" width="100%" /></td>
</tr>
<tr>
<td valign="top"><b>Git commit &amp; push</b> from the chat header — file-level staging, push, branch switch (local/remote), with encrypted per-user PAT credentials (admin-common fallback). The panel shows exactly which credential and commit identity are in effect.</td>
<td valign="top"><b>VS Code (code-server)</b> spins up per user/room as a sibling container — editor, terminal and git in the browser, side-by-side with chat (<i>the demo shows a placeholder; the editor needs the Docker deployment</i>).</td>
</tr>
</table>

### 📚 LLM Wiki · 🔀 Automatic PR review

<table>
<tr>
<td width="50%"><img src="docs/screenshots/06-wiki.png" alt="LLM Wiki read-only query thread with a cited-sources panel" width="100%" /></td>
<td width="50%"><img src="docs/screenshots/07-review.png" alt="PR review session with an auto MERGE_SAFE verdict and remote-merge control" width="100%" /></td>
</tr>
<tr>
<td valign="top"><b>LLM Wiki</b> — upload a folder of docs/images, Claude compiles them into a queryable knowledge base. Every answer lists the files it drew on in a <b>cited-sources panel</b>; hover to highlight mentions inline.</td>
<td valign="top"><b>Automatic PR review</b> — each open PR auto-runs a pipeline (merge → build/run in a locked-down sandbox → bug + code review → a <b>MERGE_SAFE / DO_NOT_MERGE verdict</b>). One admin click merges it on the remote.</td>
</tr>
</table>

### 👤 My Page — one place for your settings

<img src="docs/screenshots/14-mypage.png" alt="My Page: profile image, Claude token, LLM provider override, git credentials, personal projects" width="100%" />

A per-user settings page consolidating **profile image**, **Claude token**, **LLM provider override** (Bedrock / Vertex / custom base URL), **git credentials**, and **personal-project** management. Admin-only actions (create a common project, new wiki topic, request the admin role) can be **requested from here using the real feature form**.

### 🎛 Everything configurable — the admin panel

<table>
<tr>
<td width="33%"><img src="docs/screenshots/16-admin-overview.png" alt="Admin overview" width="100%" /><br/><sub><b>Overview</b> — users, rooms, sessions, throttle, common token.</sub></td>
<td width="33%"><img src="docs/screenshots/17-admin-usage.png" alt="Admin usage dashboard" width="100%" /><br/><sub><b>Usage dashboard</b> — per-user turns, tokens and cost.</sub></td>
<td width="33%"><img src="docs/screenshots/18-admin-config.png" alt="Admin live config registry" width="100%" /><br/><sub><b>Configuration</b> — every operational knob, live-editable.</sub></td>
</tr>
<tr>
<td width="33%"><img src="docs/screenshots/19-admin-resources.png" alt="Admin resource cleanup" width="100%" /><br/><sub><b>Resources</b> — scan &amp; clean spawned containers, images, orphans.</sub></td>
<td width="33%"><img src="docs/screenshots/20-admin-activity.png" alt="Admin activity / process manager" width="100%" /><br/><sub><b>Activity</b> — live task-manager over turns, queues, containers.</sub></td>
<td width="33%"><img src="docs/screenshots/21-admin-requests.png" alt="Admin member-request approval queue" width="100%" /><br/><sub><b>Requests</b> — approve/reject member requests.</sub></td>
</tr>
</table>

### 🔌 Plugins · 🌐 Multilingual · 📱 Responsive (PWA)

<table>
<tr>
<td width="40%"><img src="docs/screenshots/15-plugins.png" alt="Plugins panel: common and personal tiers" width="100%" /></td>
<td width="40%"><img src="docs/screenshots/22-i18n-ko.png" alt="The same UI in Korean" width="100%" /></td>
<td width="20%"><img src="docs/screenshots/23-mobile.png" alt="Mobile layout with the sidebar as a slide-in drawer" width="100%" /></td>
</tr>
<tr>
<td valign="top"><b>Two-class plugins</b> — common (admin) and personal (user) tiers; install via git or upload, per-plugin detail + one-click update.</td>
<td valign="top"><b>Multilingual UI</b> — instant Korean / English switch from the sidebar, persisted and browser-language auto-detected.</td>
<td valign="top"><b>Works on a phone</b> — the sidebar collapses into a drawer and chat goes full-width; installable as a PWA.</td>
</tr>
</table>

---

## ✨ Strengths

|  | Strength | Description |
|---|---|---|
| 🧬 | **True session isolation** | "One deployment," but the runtime is a separate process per session. The Agent SDK injects `HOME`/`cwd`/plugins every turn, fully separating users and rooms. |
| 👥 | **Shared rooms + fine-grained delegation** | The owner toggles per-member rights: approve, interrupt, invite, kick, transfer ownership, delete room. A FIFO queue orders multi-party turns; speaker prefixes let the model track who's talking. A composer toggle separates **team chat** from **instructions to Claude** (`@claude` to summon) so casual talk never triggers a turn. |
| 🛡 | **Web permission prompts** | Claude pauses right before using a tool and asks the browser: allow / deny / always. The isolation deny-fence always applies, regardless of mode. |
| 🧑‍💻 | **VS Code in the browser** | Spin up a project in a code-server container instantly. Mounts only your volume + the shared one (isolated); auto-reaped when idle. |
| 🔌 | **Two-class plugins** | Common (admin) and personal (user) tiers. Install via git or local upload, admin-forced plugins, per-user on/off. Per-plugin detail view + one-click update. |
| 🪪 | **Per-user Claude tokens** | Each member registers their own token (encrypted at rest); usage and cost are attributed per person. Falls back to an admin-set common token, then env. |
| 🔀 | **LLM provider override** | Optionally run turns against a non-default LLM backend instead of the Claude token, per-user or admin-common (encrypted at rest). **Amazon Bedrock** and **Google Vertex AI** Claude models are supported natively; **OpenAI/ChatGPT/local LLMs** connect through an Anthropic-compatible proxy base URL (e.g. LiteLLM, claude-code-router, an Ollama shim). Resolution: user provider → user token → common provider → common token → MOCK. Leave it unset and the default Claude-token path is unchanged. Gated by `llmProvidersEnabled`. |
| 👤 | **My Page** | One per-user settings page consolidating profile image (upload/remove, shown in your own sidebar and My Page), Claude token, LLM provider override, git credentials, and personal-project management (create / delete / open in a new chat). |
| ⑂ | **Git commit & push** | Commit (with file-level staging), push, and switch branches (local/remote) for a cloned project right from the chat header — Claude can also commit/push itself. Clones fetch full history (all branches) and can target a specific branch. HTTPS PAT credentials for GitHub/GitLab/Bitbucket are encrypted per-user (admin-common fallback), picked at clone time, resolved by host. The panel shows exactly which credential (yours vs. shared) and commit identity are in effect for the repo, so auth failures are easy to diagnose. |
| 📚 | **LLM Wiki knowledge base** | Upload a folder of docs/images; Claude compiles them into cross-linked articles users can query in read-only threads. Import an already-compiled wiki to skip compilation. |
| 🔀 | **Automatic PR review** | Admin registers a remote (merge-capable credential required); the server polls GitHub/GitLab/Bitbucket and each open PR becomes a review session — visible to admins and the PR's author (read-only). Each new PR **auto-runs the whole pipeline**: local merge → build/run → bug detection + code review → a **MERGE_SAFE / DO_NOT_MERGE verdict**. On the admin's word, one click **merges the PR on the remote** using the credential. |
| 🎛 | **Everything configurable in the admin panel** | A single config registry surfaces every operational knob — turn cap, model list & default, the whole review pipeline (poll interval, auto/comment toggles, sandbox image/limits/timeouts), code-server image/idle, git timeouts, session lifetime, upload/body/socket limits — in one grouped, **live-editable** admin page (most apply instantly; a few flag *restart required*). Env vars just seed the defaults; infrastructure and secrets are shown read-only. |
| 🧹 | **Resource cleanup (host Docker included)** | An admin **Resources** tab scans app-spawned containers (code-server editors + review sandboxes, with orphan detection), referenced + dangling images, and orphaned dirs/DB rows — then cleans them per-resource or via a double-confirmed **full reset**. Only ever removes spawned containers, dangling images, and genuine orphans; user/room projects, accounts, and chat sessions are never touched. Gated by `resourceCleanupEnabled`. |
| 🎛 | **Activity / process manager** | An admin **Activity** tab is a live task-manager over everything the server runs: in-flight Claude turns, queued messages, code-server editor + review-sandbox containers, and running review pipelines — each with a per-row control (interrupt / cancel / kill). Auto-polls while open (`processPollMs`). |
| 🙋 | **Member requests → admin approval** | Members request admin-only actions (create a common project, create an LLM Wiki topic, request the admin role) with a reason; admins approve/reject from a **Requests** tab (pending badge included). Requests reuse the **real feature form** — a common-project request carries the same git clone URL / branch / credential picker the admin create form has, so approval runs the actual clone (credential re-validated as the requester). On approval the server runs the action and stores the result — a small action registry, so new requestable actions are a one-place add. A role upgrade only ever promotes the requester, never a payload-named user. Gated by `approvalsEnabled`. |
| 💬 | **DM & group chat** | A lightweight human messaging layer for **every** user, fully separate from the Claude rooms — plain 1:1 DMs and named group channels over WebSocket, with unread badges. No Claude, no queue. A DM between the same two people is deduped; every read/post is membership-gated server-side. An admin can **promote a group channel to a common project room** (seeded with its members). Gated by `dmEnabled`. |
| 🔑 | **Fully functional without a key** | With no token anywhere, it runs in **MOCK mode** — streaming, permissions, and tool-card UX all demoable. Ideal for evaluation, demos, CI. |
| 🐳 | **One-shot deploy** | Multi-stage single image + `docker compose up`. code-server spawns dynamically as sibling containers (no orchestrator needed). |
| 🗂 | **Folded context history** | Each `/clear` or `/compact` collapses the conversation above it into a stacked, timestamped toggle — history stays one click away instead of scrolling forever. |
| 📎 | **`@` file & folder references** | Type `@` in any project chat to fuzzy-search files and folders in an instant preview menu — the same feel as the `/` command palette. Picking one drops an `@path` reference into your message, so you point Claude at a file without leaving the composer. |
| 🖇 | **Attach files & paste screenshots** | Attach any file — or just paste (or drag-drop) a clipboard screenshot — into the composer. Uploads stage under the session's workspace and their paths ride the prompt, so Claude reads them (images render visually). Thumbnails/chips show inline in the composer and the transcript (**click an image thumbnail to view it full-size** in a lightbox); per-file size and count limits are admin-configurable. |
| 🎨 | **Desktop-app-grade UI** | Clay theme following the Claude Code desktop app, light/dark, collapsible tool cards, serif responses, member avatars and presence. |

---

## 🚀 Quick start

### Development

```bash
npm install
cp .env.example .env      # add a key for real Claude, leave empty for MOCK mode
npm run dev               # server :3000  +  Vite :5173 (proxy)
```

→ open http://localhost:5173 · initial admin **admin / admin** (change it after deploy)

### Production (Docker)

```bash
cp .env.example .env      # set SESSION_SECRET, ANTHROPIC_API_KEY
docker compose up -d --build
```

→ http://localhost:3000 · a single image serves the API, WebSocket, static SPA, and code-server proxy

**No clone, no files — one `docker run`** (pick your shell, all copy-paste ready):

<details open><summary>Linux / macOS — bash / zsh</summary>

```bash
docker run -d --name claudecode-app \
  -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v claudecode-workspace_data:/data \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e CODE_SERVER_NETWORK=claudecode_internal \
  -e DATA_VOLUME=claudecode-workspace_data \
  cian0204/claudecode-workspace:latest
```
</details>

<details><summary>Windows — PowerShell</summary>

```powershell
docker run -d --name claudecode-app `
  -p 3000:3000 `
  -v /var/run/docker.sock:/var/run/docker.sock `
  -v claudecode-workspace_data:/data `
  -e SESSION_SECRET=$([guid]::NewGuid().Guid + [guid]::NewGuid().Guid) `
  -e ANTHROPIC_API_KEY=sk-ant-... `
  -e CODE_SERVER_NETWORK=claudecode_internal `
  -e DATA_VOLUME=claudecode-workspace_data `
  cian0204/claudecode-workspace:latest
```
</details>

<details><summary>Windows — CMD</summary>

```bat
docker run -d --name claudecode-app ^
  -p 3000:3000 ^
  -v /var/run/docker.sock:/var/run/docker.sock ^
  -v claudecode-workspace_data:/data ^
  -e SESSION_SECRET=replace-with-a-long-random-string ^
  -e ANTHROPIC_API_KEY=sk-ant-... ^
  -e CODE_SERVER_NETWORK=claudecode_internal ^
  -e DATA_VOLUME=claudecode-workspace_data ^
  cian0204/claudecode-workspace:latest
```
</details>

→ http://localhost:3000 · initial admin **admin / admin**. The app self-creates the `claudecode_internal` network on boot (needed for the in-browser VS Code); drop the last two `-e` lines to run without the editor. Pin a version with `:1.1.0` instead of `:latest`.

Prefer a compose file? A build-free [`docker-compose.hub.yml`](docker-compose.hub.yml) is also published — `curl -O` it and `docker compose -f docker-compose.hub.yml up -d`.

> **Requirement:** the code-server editor works only in the Docker deployment, and needs **Docker Engine ≥ 26** for volume-subpath mounts.

### Fully local — no data leaves your network

Every session runs the Claude Code CLI as a subprocess, so it honours **`ANTHROPIC_BASE_URL`**. Point the built-in **LLM Provider → `custom`** setting (My Page per-user, or the Admin panel for everyone) at a local Anthropic-compatible gateway and *no request ever hits `api.anthropic.com`*:

**Ollama** (≥ 0.14), **vLLM**, **LM Studio**, and **llama.cpp** now serve a *native* Anthropic `/v1/messages` endpoint, so Claude Code talks to them **directly — no proxy**. Minimal stack = model runtime + app:

```yaml
# docker-compose.local.yml  ·  docker compose -f docker-compose.local.yml up -d
services:
  ollama:            # native Anthropic endpoint — after up: docker compose -f docker-compose.local.yml exec ollama ollama pull qwen3-coder
    image: ollama/ollama
    volumes: [ollama:/root/.ollama]
    networks: [internal]

  app:
    image: cian0204/claudecode-workspace:latest
    pull_policy: always
    ports: ["3000:3000"]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - data:/data
    environment:
      SESSION_SECRET: change-me-to-a-long-random-string
      CODE_SERVER_NETWORK: claudecode_internal
      DATA_VOLUME: claudecode-workspace_data
    networks: [internal]

networks: { internal: { name: claudecode_internal } }
volumes: { data: { name: claudecode-workspace_data }, ollama: {} }
```

<details><summary>Prefer plain <code>docker run</code>?</summary>

```bash
docker network create claudecode_internal
docker run -d --name ollama --network claudecode_internal -v ollama:/root/.ollama ollama/ollama
docker exec ollama ollama pull qwen3-coder
docker run -d --name claudecode-app --network claudecode_internal \
  -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v claudecode-workspace_data:/data \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  -e CODE_SERVER_NETWORK=claudecode_internal \
  -e DATA_VOLUME=claudecode-workspace_data \
  cian0204/claudecode-workspace:latest
```
</details>

Then, **in the app** → **LLM Provider → type `custom`**, base URL `http://ollama:11434`, auth token `ollama` (any value), model = your pulled model (e.g. `qwen3-coder`). No `ANTHROPIC_API_KEY` needed — the provider setting drives it. A proxy like **LiteLLM** is only needed if your backend has *no* native Anthropic endpoint (an OpenAI-only server) or you want to route across several providers.

Pre-pull the app + `codercom/code-server` images once and the whole stack — app, data, editors, **and inference** — runs offline. App state (sessions, rooms, uploads, SQLite) always lives in the local data volume; only the LLM call is external by default, and this removes even that.

#### Non-essential traffic — blocked by default

Even on the hosted API, the workspace ships with **`BLOCK_NONESSENTIAL_TRAFFIC=1`**, so the inference request is the *only* thing the agent's CLI sends to Anthropic. Switched off for every session — and injected into every newly started editor container — are: usage telemetry, error reports, `/feedback` · `/bug` · `/share` (these upload the whole transcript, code included), the session-quality survey and its transcript-upload follow-up, non-essential model calls, auto-updater pings, the WebFetch domain preflight (which sends the hostname to `api.anthropic.com`), Artifact publishing, official-marketplace auto-install, and OpenTelemetry export. **Admin → Config → Privacy** has a master switch plus one described toggle per channel — checked always means *blocked*. The master is an override: while it is on everything is blocked and the per-channel rows are locked. Turn it off to pick channel by channel, e.g. let telemetry through to your own OTel collector while the rest stay blocked. In that mode the umbrella `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` var is only set while *every* channel it covers is still blocked, so a channel you deliberately opened can't be silently closed again.

### Recommended specs

Resource use scales with concurrent sessions and open editors (each code-server is its own sibling container). These figures are for the **app/workspace itself** — a local LLM (above) needs its own GPU/VRAM on top.

| | Minimum | Recommended |
|---|---|---|
| CPU | 2 cores | 4+ cores |
| RAM | 2 GB | 4–8 GB (≈256–512 MB per open editor) |
| Disk | 5 GB SSD | 20 GB+ SSD (data volume grows with projects) |
| OS · Docker | Linux · Docker Engine ≥ 26 | Linux · Docker Engine ≥ 26 |
| Arch | amd64 or arm64 (multi-arch image) | — |
| Network | outbound HTTPS to `api.anthropic.com` | **none** with a local LLM (see above) |

> Running a **local model** is a separate cost from the table above — its GPU/VRAM/RAM depends entirely on the model you pick (a 7–8B model wants ~8–16 GB VRAM; larger models more).

### PWA over HTTPS

Browsers only offer **Install as app** (PWA) on a *secure context*. `http://localhost` is exempt, so PWA works locally — but over `http://<server-ip>:3000` it never appears. To install on a real host, serve HTTPS with a **browser-trusted** cert (a self-signed cert with a click-through is not enough — Chrome still blocks it):

```bash
# on the server — generate a locally-trusted cert for the host's IP/hostname
mkcert -install                                   # once: trust the local CA on each client device too
mkcert -key-file certs/key.pem -cert-file certs/cert.pem 192.168.1.50 myhost.local

# point the app at it and redeploy
TLS_KEY=/certs/key.pem TLS_CERT=/certs/cert.pem docker compose up -d --build
```

`./certs` is mounted read-only into the container. With a public domain, use a real cert (Let's Encrypt) instead of mkcert. Leave `TLS_KEY`/`TLS_CERT` empty to stay on plain HTTP.

### Releasing to Docker Hub

Version the app and publish the image in one step. Requires a one-time `docker login`.

```bash
npm run release:patch   # bug fixes    → bumps 1.0.0 → 1.0.1, tags, builds, pushes
npm run release:minor   # new features → 1.1.0
npm run release         # re-push the current version without bumping
```

`release:*` runs `npm version` (bumps `package.json` + git tag `vX.Y.Z`), then `scripts/release.mjs` builds and pushes three tags: `:X.Y.Z` (immutable), `:latest` (moving), `:sha-<short>` (traceable to a commit). Builds are **amd64 by default** (fast); add `-- --arm` (e.g. `npm run release:patch -- --arm`) to also publish `linux/arm64` — emulated, so slower and used occasionally. Dry-run with `node scripts/release.mjs --dry-run`. Override the repo with `DOCKER_REPO=you/app`.

---

## 🧭 Architecture

```mermaid
flowchart TB
  subgraph B["🌐 Browser · React SPA"]
    UI["Chat · Rooms · Editor · Admin"]
  end
  subgraph A["🐳 app container · Fastify"]
    API["REST API"]
    WS["Socket.IO streaming/fanout"]
    SM["Session manager + FIFO queue"]
    PX["/cs reverse proxy"]
  end
  SDK["Claude CLI subprocess<br/>(per-session · HOME/cwd)"]
  subgraph C["🐳 code-server sibling containers<br/>(per user/room · scoped mounts)"]
    VS["VS Code"]
  end
  DB[("SQLite / Drizzle")]
  VOL[["📦 named volume /data"]]

  UI <-->|WebSocket| WS
  UI -->|HTTP| API
  UI -->|iframe| PX
  WS --> SM
  SM -->|query · per turn| SDK
  API --> DB
  A -->|docker.sock| C
  PX -->|internal net| VS
  SDK --> VOL
  VS -->|subpath mount| VOL
```

**How it works (4 keys)**

1. **Session = subprocess** — The Agent SDK `query()` spawns a Claude CLI per session. `env.HOME` resolves personal/room settings naturally; common plugins/MCP/agents are injected explicitly.
2. **Shared room = one long-lived session** — Context continues via resume; a FIFO queue processes members' turns in order; results fan out to everyone over WebSocket.
3. **Permissions = `canUseTool` bridge** — The callback blocks for the approver's (owner/delegate) web response. Path-escaping tools are always blocked by policy.
4. **Editor = sibling container** — The app launches code-server over the Docker socket, mounts only your volume subpath + the shared one, and exposes it solely through the in-app proxy (no published port).

---

## 🧩 Features in detail

<details>
<summary><b>Shared rooms & delegation</b></summary>

- Room = a workspace entity (its own `HOME`/projects), parallel to personal sessions
- Owner holds approval by default → delegate per right from the member list
- **Delegable:** approve · interrupt · invite · kick · transfer ownership · delete room
- **Owner-only (non-delegable):** changing the room's permission mode
- Cancel queued messages, interrupt a running turn, presence indicators
- **Chat vs. instruct:** composer toggle (💬 chat / 🤖 Claude, default chat, sticky per room). Chat is broadcast-only; type `@claude` to flip to instruct mode; optional "include chat" sends recent team talk as context
</details>

<details>
<summary><b>Permission model (2-class override)</b></summary>

- **Class 1 (locked):** blocks other users' paths, `~/.claude`, key paths; `additionalDirectories` fence; permission-mode ceiling — always enforced regardless of mode
- **Class 2 (convenience):** common plugins/MCP/agents — on by default; users can turn them off in their session or add personal ones (personal wins on name clash)
- Modes: default (approve) · accept-edits · bypass · plan; admin caps the bypass ceiling
</details>

<details>
<summary><b>code-server integration</b></summary>

- on-demand spawn + idle reaper (default 30 min) + removal on logout + orphan cleanup on boot
- routing `/cs/<uid>/<projectId>/<random-token>` — blocks others' access; code-server auth delegated to the proxy
- the shared API key stays backend-only → editor terminals can't read it
</details>

<details>
<summary><b>Plugin management</b></summary>

- Common tier = admin-only (register marketplaces · git/local upload · force-required)
- Personal tier = user-controlled (add marketplaces · install · toggle common class-2)
- Per-plugin detail view (manifest · skills · file tree) with one-click update for git-sourced plugins
</details>

<details>
<summary><b>Per-user Claude tokens</b></summary>

- Each user registers a personal Claude token (`sk-ant-oat…` / `sk-ant-api…`), encrypted at rest; a login nag reminds those who haven't
- Turn precedence: user's own token → admin-set common token → env key → MOCK
- In shared rooms each author's turn runs on that author's token; usage is tracked per user for the admin dashboard
</details>

<details>
<summary><b>LLM provider override (Bedrock / Vertex / custom base URL)</b></summary>

- The runtime is the Claude CLI (Anthropic wire format). A provider profile (per-user, or admin-common as fallback) builds the right env for the turn — an **additive override** on top of the default Claude-token path
- **anthropic** — pin/keep a Claude token (`ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`); leave the token blank to just use your saved Claude token
- **bedrock** — native: `CLAUDE_CODE_USE_BEDROCK=1` + region + a credential (`AWS_BEARER_TOKEN_BEDROCK`, or an access key id/secret (+session token)) + model id
- **vertex** — native but minimal: `CLAUDE_CODE_USE_VERTEX=1` + region + project id, using the host's GCP Application Default Credentials (ADC)
- **custom** — `ANTHROPIC_BASE_URL` (+ optional bearer token + model). **This is the path for OpenAI/ChatGPT/local LLMs**: point it at a proxy that translates Anthropic↔OpenAI (LiteLLM, claude-code-router, an Ollama Anthropic-compat shim). The app cannot speak OpenAI's wire format directly
- Resolution order: user provider → user Claude token → common provider → common Claude token/env → MOCK. **When no provider is configured, auth resolves exactly as before** — the default token path does not regress
- Config (base URL, tokens, keys) is encrypted at rest; the API never returns secrets (only which fields are set). Gated by the `llmProvidersEnabled` flag
</details>

<details>
<summary><b>LLM Wiki (team knowledge base)</b></summary>

- Admin uploads a folder of docs/images → Claude reads the `raw/` sources and **auto-compiles** them into `wiki/` articles + `_index.md` (multimodal — images transcribed too)
- **Import an already-compiled wiki:** on topic creation, the "already-compiled wiki" option skips compilation and uses the finished wiki as-is (reuse a topic export)
- Each user gets a **private thread** for read-only queries scoped to the wiki; browse raw/wiki via the file explorer
- **Cited-sources panel:** every answer lists the files it drew on in a right-side panel (grouped wiki / raw); hovering a source highlights its mentions inline (and vice-versa), and clicking one previews the file right there
</details>

<details>
<summary><b>Automatic PR review</b></summary>

- **Admin-only** creation, parallel to personal sessions / rooms / the LLM Wiki: register a remote repo (full clone) with a **merge-capable** git credential
- The server **polls** the host (GitHub / GitLab / Bitbucket Cloud) for open PRs on an interval (`REVIEW_POLL_MS`, default 60s) + a manual "refresh now" — each open PR becomes a review session
- **Visibility:** admins see every session; the PR author (matched to a local account by username) sees only their own, **read-only**. No matching account → no extra viewer
- **Fully automatic pipeline** (no chat needed; `REVIEW_AUTO`, default on): on each new PR the server does the **local merge** (`--no-ff` into a per-PR git worktree; conflict → stop + flag), then runs an **unattended agent turn** that **builds & runs**, **detects bugs**, **reviews the diff**, and emits a **`VERDICT: MERGE_SAFE` / `DO_NOT_MERGE`** + one-line summary. The verdict shows on the session and the sidebar badge. A **new push to the PR** (changed head SHA, seen on the next poll) auto-re-runs the pipeline and resets the verdict; re-run manually anytime
- **Docs-only PRs skip the heavy work:** the pipeline reads the PR's changed files first, and if they're all non-source (Markdown, text, images, `LICENSE`, …) it skips the merge/build/run entirely and marks the PR `MERGE_SAFE` with a note. Anything unrecognized counts as source, so real code PRs always get the full pipeline
- Unattended turns **auto-approve tools** (isolated worktree; the class-1 path fence still applies) so build/run never blocks on a prompt
- **Per-repo build image:** the PR's build/run only ever runs in a locked-down sibling container (no Docker socket, all caps dropped); its image is **selectable per repo** to match the language (Python, Rust, Go, …). Leave it blank to use the global default (`REVIEW_SANDBOX_IMAGE`, default `node:20-bookworm`, editable in the admin panel). If a tool isn't in the image, the review agent can also install it inside the container (slow; for polyglot or one-off cases)
- **Result posted back to the PR** (`REVIEW_COMMENT`, default on): when a review finishes, the verdict + summary + full review body is published as a comment on the PR itself (GitHub issue comment / GitLab MR note / Bitbucket PR comment), so re-reviews on new pushes each drop their own comment. Set `REVIEW_COMMENT=0` to keep reviews internal
- **On instruction, approve the PR:** one admin click **merges the PR on the remote** (GitHub/GitLab/Bitbucket API) using the merge-capable credential — the only step that touches the remote, gated behind a confirm
- **Self-healing:** a review turn has a watchdog wall-clock cap (`REVIEW_TURN_TIMEOUT_MS`, default 30 min). If it trips, the review is **automatically retried** up to `reviewMaxRetries` (default 2) before giving up, so a transient hang doesn't strand the PR. And if the server restarts while a review is running, it is **re-queued on boot** instead of hanging on ⏳ forever
</details>

<details>
<summary><b>Multilingual UI (Korean / English)</b></summary>

- Instant switch from the **language list** in the sidebar footer, persisted to `localStorage` + browser-language auto-detect (a newly added language shows up in the list on its own)
- Managed from a single dictionary (`web/src/lib/i18n.ts`); new UI strings always go through i18n
</details>

---

## ⚙️ Configuration (.env)

| Variable | Description | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Env-level shared fallback token (per-user & admin-common tokens take precedence). None set anywhere → MOCK mode | — |
| `SESSION_SECRET` | Cookie signing secret (**must change**) | — |
| `MAX_CONCURRENT_TURNS` | Global concurrent-turn cap for the shared key + queueing + 429 backoff | `3` |
| `REVIEW_POLL_MS` | How often to poll each watched review repo for open PRs (0 disables) | `60000` |
| `REVIEW_AUTO` | Auto-run the review pipeline (merge→build/run→review→verdict) on each new PR; `0` = manual trigger only | `1` |
| `REVIEW_COMMENT` | Post the finished review (verdict + summary + body) back as a comment on the PR; `0` = keep internal | `1` |
| `BOOTSTRAP_ADMIN_USER` / `_PASSWORD` | First-boot admin (only when there are zero users) | `admin` |
| `CODE_SERVER_IMAGE` | Editor image | `codercom/code-server:latest` |
| `CODE_SERVER_IDLE_MS` | Idle-container reclaim time | `1800000` |

> Every variable above is only the **default**. All operational settings — plus many that were previously hardcoded (git/provider timeouts, sandbox limits, session lifetime, retry/backoff, …) — are live-editable in the **admin panel → Configuration**, stored as DB overrides that apply without a restart. Infrastructure (`PORT`, `DATA_DIR`, TLS, docker network/volume) and secrets are shown read-only there; edit `.env` and restart to change those.

---

## 🗂 Structure

```
server/                Fastify · Socket.IO · Agent SDK · SQLite/Drizzle · dockerode
  src/claude/          session manager · config layering · permission bridge · throttle
  src/rooms/           room manager (delegation) · FIFO queue
  src/codeserver/      spawn/reap · /cs proxy (http+ws)
  src/wiki/            LLM Wiki compile (raw/ sources → wiki/ articles)
  src/auth/            login · per-user/common Claude token resolution
  src/usage/           per-user token & cost tracking
  src/routes/          sessions · rooms · projects · plugins · wiki · admin
web/                   React · Vite · Tailwind · Radix · zustand
  src/lib/i18n.ts      ko/en dictionary + language switch
DESIGN.md              finalized design spec (19 decisions, Korean)
Dockerfile · docker-compose.yml
```

---

## 🔐 Security posture

A **lightweight posture** that assumes a mutually trusted team/individual. App login + revocable session cookies gate access; agent file access is a soft fence; a human's editor terminal is isolated behind a hard container boundary with the shared key kept out. The Docker socket mount grants the app host-root-level power, so **this is not a zero-trust multi-tenant SaaS.** An auth-adapter seam is left for SSO / proxy-header extension.

> **Auto-review runs PR code — in a sandbox.** The automatic PR-review pipeline builds & runs each PR's own scripts unattended. On the Docker deployment this happens in a **locked-down sibling container** (only the PR worktree mounted, **no Docker socket**, caps dropped, `no-new-privileges`, memory/pid limits); the host shell is denied to the review agent, so PR build/test code can't reach the app container or the host. Residual: the sandbox keeps **network egress** (npm/pip/etc. need it), so a hostile PR could still exfiltrate over the network — keep watched repos to ones you trust, or set `REVIEW_AUTO=0`. Stacks the sandbox image can't build (e.g. **.NET Framework / Windows-only**) are **reviewed statically** (no local build; the verdict says so). Without the Docker deployment it falls back to host execution (trusted-team posture).

---

## 🛣 Roadmap

- [x] Per-user Claude tokens (personal + admin-common + env fallback)
- [x] LLM provider override (Bedrock / Vertex native · OpenAI/local via Anthropic-compatible proxy)
- [ ] SSO / proxy-header auth adapter
- [ ] Postgres · Redis promotion (multi-process scale)
- [ ] CRDT real-time collaborative editing

---

## 🤝 Contributing · License

Issues and PRs welcome. Keep commits feature-scoped (`feat`/`fix`/`chore`). [MIT License](LICENSE).

<div align="center"><sub>Built with Claude Code · see <a href="DESIGN.md">DESIGN.md</a> for design → implementation → QA</sub></div>
