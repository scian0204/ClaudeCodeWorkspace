# ClaudeCode Workspace

**A server-resident [Claude Code](https://claude.com/claude-code) team workspace** — per-session isolation, shared team rooms, and VS Code in the browser, all from one image.

📦 **Source & docs:** https://github.com/scian0204/ClaudeCodeWorkspace

---

## Run it — one command, no clone

Pick your shell (each is copy-paste ready — just drop in your `ANTHROPIC_API_KEY`):

**Linux / macOS — bash / zsh**
```bash
docker run -d --name claudecode-app \
  -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v claudecode-workspace_data:/data \
  -e DATA_DIR=/data \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e CODE_SERVER_NETWORK=claudecode_internal \
  -e DATA_VOLUME=claudecode-workspace_data \
  cian0204/claudecode-workspace:latest
```

**Windows — PowerShell**
```powershell
docker run -d --name claudecode-app `
  -p 3000:3000 `
  -v /var/run/docker.sock:/var/run/docker.sock `
  -v claudecode-workspace_data:/data `
  -e DATA_DIR=/data `
  -e SESSION_SECRET=$([guid]::NewGuid().Guid + [guid]::NewGuid().Guid) `
  -e ANTHROPIC_API_KEY=sk-ant-... `
  -e CODE_SERVER_NETWORK=claudecode_internal `
  -e DATA_VOLUME=claudecode-workspace_data `
  cian0204/claudecode-workspace:latest
```

**Windows — CMD**
```bat
docker run -d --name claudecode-app ^
  -p 3000:3000 ^
  -v /var/run/docker.sock:/var/run/docker.sock ^
  -v claudecode-workspace_data:/data ^
  -e DATA_DIR=/data ^
  -e SESSION_SECRET=replace-with-a-long-random-string ^
  -e ANTHROPIC_API_KEY=sk-ant-... ^
  -e CODE_SERVER_NETWORK=claudecode_internal ^
  -e DATA_VOLUME=claudecode-workspace_data ^
  cian0204/claudecode-workspace:latest
```

Open **http://localhost:3000** · initial admin `admin` / `admin` (change it). The app self-creates the `claudecode_internal` network on boot for the in-browser VS Code — drop the last two `-e` lines to run without the editor.

> **Requires Docker Engine ≥ 26** (volume-subpath mounts for code-server). The mounted `docker.sock` lets the app spawn per-user editor containers.

Prefer Compose? A build-free [`docker-compose.hub.yml`](https://github.com/scian0204/ClaudeCodeWorkspace/blob/main/docker-compose.hub.yml) is in the repo.

---

## What you get

- 💬 **Per-session Claude Code** — isolated subprocess per session, streaming replies, tool cards, live web permission prompts
- 👥 **Shared team rooms** + fine-grained delegation · DM & group chat
- 🧑‍💻 **VS Code in the browser** (code-server), spawned per user as a sibling container
- 📊 Live usage meter · per-session effort · model & mode switch
- 📎 `@` file references · paste & attach images
- 📚 LLM Wiki · 🔀 automatic PR review · 🎛 full admin panel · 🌐 multilingual (ko/en) · 📱 responsive PWA

Full feature tour and screenshots in the [README](https://github.com/scian0204/ClaudeCodeWorkspace#readme).

---

## Image tags

| Tag | Meaning |
|-----|---------|
| `latest` | Newest release (moving) |
| `X.Y.Z` | Exact version (immutable) — e.g. `1.1.0` |
| `sha-<short>` | Traceable to a specific source commit |

## Key environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `ANTHROPIC_API_KEY` | — | Claude API key (empty ⇒ MOCK mode) |
| `SESSION_SECRET` | `change-me-please` | Cookie/session signing — **set this** |
| `BOOTSTRAP_ADMIN_USER` / `_PASSWORD` | `admin` / `admin` | First admin account |
| `CODE_SERVER_NETWORK` | — | Docker network for editor containers (auto-created) |
| `DATA_DIR` | `/data` | Where state is written — must match the `-v` mount point |
| `DATA_VOLUME` | — | Named volume backing `/data` (must match the `-v` volume) |
| `MAX_CONCURRENT_TURNS` | `3` | Parallel Claude turns cap |

---

Licensed under the terms in the [repository](https://github.com/scian0204/ClaudeCodeWorkspace). Issues & contributions welcome there.
