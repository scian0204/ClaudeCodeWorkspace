<div align="center">

**English** · [한국어](CHANGELOG.ko.md)

# Update notes

Everything between the spec being frozen in [DESIGN.md](DESIGN.md) (2026-07-20) and **v1.21.0** (2026-08-19) — all **390 commits**.

Each row shows only its **title and commit hash**; click the triangle for the detail (root cause, implementation, config keys).

</div>

---

## Contents

- [Timeline](#timeline)
- [Unreleased](#unreleased) — commits not yet in a release
- **1.x releases** — [v1.21.0](#v1210--2026-08-19) · [v1.20.2](#v1202--2026-08-19) · [v1.20.1](#v1201--2026-08-19) · [v1.20.0](#v1200--2026-08-19) · [v1.19.13](#v11913--2026-08-19) · [v1.19.12](#v11912--2026-08-19) · [v1.19.11](#v11911--2026-08-19) · [v1.19.10](#v11910--2026-08-19) · [v1.19.9](#v1199--2026-08-18) · [v1.19.8](#v1198--2026-08-18) · [v1.19.7](#v1197--2026-08-18) · [v1.19.6](#v1196--2026-08-18) · [v1.19.5](#v1195--2026-08-14) · [v1.19.4](#v1194--2026-08-14) · [v1.19.3](#v1193--2026-08-14) · [v1.19.2](#v1192--2026-08-14) · [v1.19.1](#v1191--2026-08-14) · [v1.19.0](#v1190--2026-08-14) · [v1.18.0](#v1180--2026-08-14) · [v1.17.3](#v1173--2026-08-14) · [v1.17.2](#v1172--2026-08-14) · [v1.17.1](#v1171--2026-08-14) · [v1.17.0](#v1170--2026-08-14) · [v1.16.1](#v1161--2026-08-13) · [v1.16.0](#v1160--2026-08-13) · [v1.15.1](#v1151--2026-08-13) · [v1.15.0](#v1150--2026-08-13) · [v1.14.2](#v1142--2026-08-13) · [v1.14.1](#v1141--2026-08-13) · [v1.14.0](#v1140--2026-08-13) · [v1.13.0](#v1130--2026-08-13) · [v1.12.0](#v1120--2026-08-07) · [v1.11.0](#v1110--2026-08-06) · [v1.10.0](#v1100--2026-08-05) · [v1.9.1](#v191--2026-08-05) · [v1.9.0](#v190--2026-08-05) · [v1.8.0](#v180--2026-08-04) · [v1.7.0](#v170--2026-08-04) · [v1.6.0](#v160--2026-08-04) · [v1.5.0](#v150--2026-08-04) · [v1.4.0](#v140--2026-08-03) · [v1.3.1](#v131--2026-08-03) · [v1.3.0](#v130--2026-07-31) · [v1.2.0](#v120--2026-07-31) · [v1.1.1](#v111--2026-07-31) · [v1.1.0](#v110--2026-07-31)
- [Early development (2026-07-20 → 07-31)](#early-development--2026-07-20--07-31)
- [Where it diverged from the original design](#where-it-diverged-from-the-original-design)

---

## Timeline

| Version | Date | Commits | Headline |
|---|---|---|---|
| [v1.21.0](#v1210--2026-08-19) | 2026-08-19 | 4 | Side chat: ask about the work without joining it |
| [v1.20.2](#v1202--2026-08-19) | 2026-08-19 | 3 | Terminal-only slash commands work in the browser |
| [v1.20.1](#v1201--2026-08-19) | 2026-08-19 | 3 | A recalled slash command stops blocking ↑ |
| [v1.20.0](#v1200--2026-08-19) | 2026-08-19 | 3 | Up/down in the message box brings back what you sent |
| [v1.19.13](#v11913--2026-08-19) | 2026-08-19 | 2 | The folded command row stops flapping open mid-answer |
| [v1.19.12](#v11912--2026-08-19) | 2026-08-19 | 2 | Cache-limit flag uses its current name |
| [v1.19.11](#v11911--2026-08-19) | 2026-08-19 | 2 | Release builder's cache no longer fills the disk |
| [v1.19.10](#v11910--2026-08-19) | 2026-08-19 | 2 | Slash commands run in a shared session |
| [v1.19.9](#v1199--2026-08-18) | 2026-08-18 | 2 | Model list really loads for browser sign-in accounts |
| [v1.19.8](#v1198--2026-08-18) | 2026-08-18 | 2 | Model list loads for browser sign-in accounts (incomplete) |
| [v1.19.7](#v1197--2026-08-18) | 2026-08-18 | 2 | Scrolling up during an answer keeps your place |
| [v1.19.6](#v1196--2026-08-18) | 2026-08-18 | 5 | The corner guide now knows every feature of the workspace |
| [v1.19.5](#v1195--2026-08-14) | 2026-08-14 | 6 | Room sessions stop asking for /login; a plain docker run keeps its data |
| [v1.19.4](#v1194--2026-08-14) | 2026-08-14 | 4 | That row rebuilt in plain text, back to one line |
| [v1.19.3](#v1193--2026-08-14) | 2026-08-14 | 4 | Message-run controls move under the message box |
| [v1.19.2](#v1192--2026-08-14) | 2026-08-14 | 4 | Usage limits came up empty (three causes) |
| [v1.19.1](#v1191--2026-08-14) | 2026-08-14 | 4 | Session pool menu no longer shows one name twice |
| [v1.19.0](#v1190--2026-08-14) | 2026-08-14 | 5 | Workspace-wide sharing pools every user's plan |
| [v1.18.0](#v1180--2026-08-14) | 2026-08-14 | 5 | Shared plans get three levels; workspace default moves to the admin panel |
| [v1.17.3](#v1173--2026-08-14) | 2026-08-14 | 4 | Room pool/container binding needs membership |
| [v1.17.2](#v1172--2026-08-14) | 2026-08-14 | 4 | Pool endpoints were unreachable; two more pool fixes |
| [v1.17.1](#v1171--2026-08-14) | 2026-08-14 | 4 | Pool order is settable from the UI |
| [v1.17.0](#v1170--2026-08-14) | 2026-08-14 | 5 | Shared Claude plans, per-session build containers, live token meter, folded command runs |
| [v1.16.1](#v1161--2026-08-13) | 2026-08-13 | 4 | Plan limits survive a busy server; docs rewritten in plain language |
| [v1.16.0](#v1160--2026-08-13) | 2026-08-13 | 3 | Agent teams per session, tmux-style split view in the task panel |
| [v1.15.1](#v1151--2026-08-13) | 2026-08-13 | 3 | "Stream closed" write failures fixed — subagents foreground in prompting modes |
| [v1.15.0](#v1150--2026-08-13) | 2026-08-13 | 8 | Project & file agents, live subagent view, sidebar quick add |
| [v1.14.2](#v1142--2026-08-13) | 2026-08-13 | 3 | Failed limit probes no longer cached; refresh button |
| [v1.14.1](#v1141--2026-08-13) | 2026-08-13 | 3 | Plan limits show with a pasted setup-token; spend ledger removed |
| [v1.14.0](#v1140--2026-08-13) | 2026-08-13 | 11 | Per-view URLs, team agents, whole-workspace backup & restore |
| [v1.13.0](#v1130--2026-08-13) | 2026-08-13 | 13 | Session export, chat diff cards, free-text answers, 7 new shortcuts, aggregate usage removed |
| [v1.12.0](#v1120--2026-08-07) | 2026-08-07 | 18 | Claude account sign-in from the browser, recorded spend, plan limits actually load |
| [v1.11.0](#v1110--2026-08-06) | 2026-08-06 | 3 | Live thinking/token meter, growing composer with markdown |
| [v1.10.0](#v1100--2026-08-05) | 2026-08-05 | 3 | Tasks panel |
| [v1.9.1](#v191--2026-08-05) | 2026-08-05 | 3 | Bypass mode under root, resume id lost mid-stream |
| [v1.9.0](#v190--2026-08-05) | 2026-08-05 | 12 | Self-update, Git diffs/graph/pull, Docker probe |
| [v1.8.0](#v180--2026-08-04) | 2026-08-04 | 3 | Guide agent |
| [v1.7.0](#v170--2026-08-04) | 2026-08-04 | 11 | Waiting animation, chats by project, webhook review, branding |
| [v1.6.0](#v160--2026-08-04) | 2026-08-04 | 12 | Import collisions, git init/publish, remote management |
| [v1.5.0](#v150--2026-08-04) | 2026-08-04 | 4 | Auto-fetched models, 5-hour window automation |
| [v1.4.0](#v140--2026-08-03) | 2026-08-03 | 17 | Unified search, shortcuts, context menu, auto session names |
| [v1.3.1](#v131--2026-08-03) | 2026-08-03 | 2 | Privacy master switch locks the per-channel toggles |
| [v1.3.0](#v130--2026-07-31) | 2026-07-31 | 2 | Per-channel egress toggles |
| [v1.2.0](#v120--2026-07-31) | 2026-07-31 | 12 | Non-essential egress blocked by default, README overhaul |
| [v1.1.1](#v111--2026-07-31) | 2026-07-31 | 3 | Multi-arch build, Docker Hub overview |
| [v1.1.0](#v110--2026-07-31) | 2026-07-31 | 4 | Release pipeline + Hub publishing |
| [Early development](#early-development--2026-07-20--07-31) | 07-20 → 07-31 | 144 | P0–P5 skeleton · LLM Wiki · tokens · git · PR review · config · import · DM |

---

## Unreleased

- **`/hooks` goes back to being unmapped** — v1.21.0 pointed it at the admin settings, which was a mistake: the workspace has no hooks editor, so it dropped people on a page that could not do what they asked. It answers with the CLI's own "not available here" again, like the other commands with no counterpart (`/bug`, `/install-github-app`). `/privacy-settings` still opens the admin settings.

---

## v1.21.0 — 2026-08-19

<sub>release commit `86d1150`</sub>

<details>
<summary><b>feat(chat): side chat — the CLI's <code>/btw</code>, as a window over the conversation</b> — ask about the work in progress without putting the question into it · <code>77e30ad</code></summary>

**What it is.** `/btw` in Claude Code means "ask a quick side question without interrupting the main conversation". It is a terminal panel, so it never worked here. Now there is one: type `/btw` and a small window opens over the chat, or `/btw <question>` to open it already asking. There is also a guide action (`openAside`) if you would rather ask the corner assistant to open it.

**Why it is useful.** "What did that error mean?", "which file were we in?", "summarise where we are" — questions you want answered *about* the work, not recorded *in* it. Asked normally they become part of the conversation, and every later turn re-reads them.

**How the answer knows everything without leaving a trace.** The server branches the chat's own Claude session: the whole conversation is read in, and every word written afterwards goes to a new session that we name up front. The chat's own transcript is not opened for writing at all, so it reads exactly the same afterwards and the next real turn carries nothing extra. Follow-up questions continue the same branch; **Start over** forgets it, and the next question branches off the conversation as it stands then.

**What it will not do.** The window has no approval buttons, so it is answer-only: it may read files to check something, and editing, running commands, web access and subagents are refused rather than asked about. Nothing is stored anywhere — the side chat lives in the tab that asked and goes away with it.

New settings: `asideEnabled` (turn the whole thing off), `asideMaxTurns`, `asideMaxInputChars`. New endpoints: `POST /api/sessions/:id/aside`, `POST /api/sessions/:id/aside/interrupt`, `DELETE /api/sessions/:id/aside` — each behind the same permission check as reading the chat, and the answer is streamed only to the tabs of the person who asked, even in a shared room.

</details>

- **`/hooks` now opens the admin settings** — it was left out of the previous release because nothing here matched it; the workspace-wide settings page is the closest thing, so it and `/privacy-settings` both land there (admins only) · `77e30ad`
- merge: `feat/side-chat` — `b9eafc3`

---

## v1.20.2 — 2026-08-19

<sub>release commit `9d08a7e`</sub>

<details>
<summary><b>feat(chat): the CLI's terminal-only slash commands now do something here</b> — /permissions, /export, /login, /help and the rest open the workspace's own screen instead of refusing · <code>5c41b20</code></summary>

**Symptom.** Typing `/permissions` in a chat answered `/permissions isn't available in this environment.` and nothing happened. Same for `/export`, `/login`, `/logout`, `/status`, `/resume`, `/help`, `/theme`, `/plan`, `/sandbox`, `/diff`, `/branch`, `/tasks`, `/bashes`, `/workflows`, `/memory`, `/plugin`, `/skills`, `/privacy-settings`, `/ide`. They were also missing from the `/` menu, so nothing hinted that they existed.

**Cause.** Claude Code draws those commands as a panel inside a terminal window. This workspace runs the CLI through the Agent SDK, which has no terminal, so the CLI swaps them for that one sentence before they run. No option or environment variable turns them back on — the panel is terminal drawing code, and there is no terminal.

**Fix.** Every one of them is something this workspace already does on a screen of its own, so the message box answers them itself and the text never reaches the CLI:

| typed | what happens now |
|---|---|
| `/permissions <mode>` · `/plan` | switches the permission pill (`default`, `acceptEdits`, `bypassPermissions`, `plan`) |
| `/export` | opens the transcript download dialog |
| `/login` · `/logout` · `/status` | opens My Page (sign-in, token, usage) |
| `/resume` · `/session` | opens search to find a past conversation |
| `/help` | opens the keyboard-shortcut sheet |
| `/theme [light\|dark]` | switches the colour theme |
| `/sandbox [on\|off]` | turns this chat's build container on or off |
| `/tasks` · `/bashes` · `/workflows` | opens the Tasks panel |
| `/diff` · `/branch` | opens the Git panel |
| `/memory` | opens the project file explorer (where CLAUDE.md lives) |
| `/plugin` · `/plugins` · `/skills` | opens the plugins panel |
| `/privacy-settings` | opens the admin settings (admins only) |
| `/ide` · `/terminal-setup` · `/tui` | opens the editor view |

They are listed in the `/` menu again, and the list is added after the CLI's real commands, so a genuine command of the same name still wins. `/permissions` with no mode after it fills the box and shows the four modes instead of picking one. A command whose screen is not there — no project, the feature switched off, a member asking for an admin page — is dropped rather than opening an empty panel. Commands with nothing here to open (`/hooks`, `/bug`, `/install-github-app`) are left out on purpose, so the CLI's own answer still stands.

Also: the export dialog moved into the shared app state, so the corner guide can open it too (new `openExport` action), and a long argument hint now shortens in the menu instead of pushing the badge off a phone-width row.

</details>

---

## v1.20.1 — 2026-08-19

<sub>release commit `66baeba`</sub>

<details>
<summary><b>fix(chat): a recalled slash command no longer blocks ↑ from going further back</b> — the command menu was opening over it and taking the arrow keys · <code>3a6ae31</code></summary>

**Symptom.** Walking back through sent messages with `↑` stopped the moment a message that is a slash command (`/compact`) came up. Further `↑` presses did nothing.

**Cause.** The command menu opens whenever the box holds a bare `/word`, because that is what typing a command looks like. A recalled command looks identical, so the menu appeared — and while it is open the arrow keys move its selection instead of walking history.

**Fix.** The box now knows the difference between text you typed and text `↑`/`↓` put there. Filling it from history keeps the `/` command and `@` file menus shut, so the arrows keep walking; the menus come back the moment you type. Pressing Enter on a recalled command sends it, as it would if you had typed it.

</details>

---

## v1.20.0 — 2026-08-19

<sub>release commit `2de2162`</sub>

<details>
<summary><b>feat(chat): ↑ and ↓ in the message box bring back what you sent before</b> — shell-style history in chat, DMs and the guide panel · <code>b77e380</code></summary>

Retyping a long prompt to change one word meant scrolling up and copying it out of the transcript.

Now, with the caret on the first line of the box, `↑` fills the box with the previous message **you** sent in that thread; press it again to keep going further back. `↓` walks the other way, and past the newest entry it puts back whatever you were typing before you started. The box still walks lines normally when the caret sits inside a multi-line draft, and while the `/` command or `@` file menu is open the arrows still move the selection there.

Works in the chat composer, in direct messages and in the corner guide panel. The list is the thread's own messages — nothing new is stored, so it is there after a reload and never shows anyone else's text.

</details>

---

## v1.19.13 — 2026-08-19

<sub>release commit `a1e8fcd`</sub>

<details>
<summary><b>fix(chat): stop the folded command row from flapping open while an answer is still coming in</b> — it opened and shut once per command · <code>90d5406</code></summary>

**Symptom.** When several commands run one after another, the chat folds them into a single row ("commands 4 — Bash ×2, Read, Edit"). While the answer was still being written, that row kept opening by itself and closing again — once for every new command.

**Cause.** Two things. The row chose to be open whenever any command inside it had no result yet: a new command starts with no result, so the row opened; a moment later the result arrived and it closed. That repeated for the whole turn. Separately, the row was identified by its position in the message, and that position shifts every time a command is added — so the row was thrown away and rebuilt, losing whichever open or closed state you had picked by hand.

**Fix.** The row now stays shut on its own and only opens by itself when a command failed. Nothing you need is hidden: the header already shows how many ran, which tools, and whether one is still going. The row is now identified by the first command in the group instead of by position, so it survives new commands arriving and keeps your choice until the answer is finished.

</details>

---

## v1.19.12 — 2026-08-19

<sub>release commit `1d638d6`</sub>

- **fix(release): use the current name for the cache-limit flag** — the previous release printed `Flag --keep-storage has been deprecated`; the cap now asks for `--max-used-space` first (which is also the flag that actually means "ceiling"), falling back to `--reserved-space` and then `--keep-storage` for older buildx · `9955227`

---

## v1.19.11 — 2026-08-19

<sub>release commit `a4caea8`</sub>

<details>
<summary><b>fix(release): cap the release builder's cache so it stops filling the disk</b> — it grew to 92GB and took the Docker engine down · <code>bb06599</code></summary>

**What happened.** The build host ran out of disk. Docker's engine then failed every command with a 500, and the workspace went down with it.

**Why.** `npm run release:*` builds through a separate builder (`ccw-multi`) so it can produce multi-architecture images. That kind of builder keeps its cache in **its own storage**, and none of the cleanup this project already runs could see it — not `docker image prune`, not `docker builder prune`, and not even the "Build Cache" line in `docker system df`. So every release added to a pile nobody was watching. It reached 92GB, against 4.2GB for the workspace's own data.

**What changed.** After a successful push the release script now trims that cache to a ceiling (10GB by default, `BUILDX_KEEP_STORAGE` to change it). Trimming rather than wiping keeps the next release fast. It runs only after the image is already pushed and never fails a release if the trim itself fails.

**Also noted in CLAUDE.md.** How to spot this (a large "Local Volumes" figure in `docker system df`), how to clear it by hand, that Docker Desktop's image scanner had been piling up another 31GB of temporary databases and is now switched off, and that the Docker VM disk must never be deleted because the workspace's data lives inside it.

</details>

---

## v1.19.10 — 2026-08-19

<sub>release commit `f6775f2`</sub>

<details>
<summary><b>fix(rooms): slash commands now actually run in a shared session</b> — two separate reasons they never reached the CLI · <code>ec7bb45</code></summary>

**What people saw.** In a shared session (방) `/clear` did nothing. The history folded in the view as if it had worked, but the conversation carried on with everything still in it. Every command was affected the same way — `/compact`, `/context`, skills, plugin commands — not just `/clear`.

**Why — first reason.** A shared session labels each message with who said it, so Claude can tell members apart. That label goes in front of the text, which turned `/clear` into `[이름]: /clear`. The CLI only treats input as a command when it *starts* with a slash, so it read the line as an ordinary sentence and answered it as one — sometimes even replying "Context cleared." while nothing had been cleared. Measured against the CLI: sent on its own, `/clear` uses no model tokens and hands back a fresh conversation; sent with a name in front, it costs a full turn and the whole history is still there afterwards. Attaching a file did the same thing in any session, shared or private, because the file paths are also written in front of the message.

**Why — second reason.** The composer in a shared session starts in team-chat mode, where what you type goes to the other members and not to Claude. Picking a command from the `/` menu in that mode filed it as a chat message, so it never ran even before the first problem could apply.

**What changed.** A command is now sent exactly as typed, with no label and no file list in front of it, and it is always routed to Claude no matter which composer mode is showing — commands are instructions to the CLI, never messages to teammates. Ordinary messages keep the speaker label, the team-chat catch-up and the attachment paths exactly as before. Files picked alongside a command are left out of that one turn, which is what the CLI does too.

**Kept honest.** The message-building logic moved into `server/src/claude/prompt.ts` with tests (`npx vitest run server/src/claude/prompt.test.ts`) covering both the command case and every decoration an ordinary message still needs.

</details>

---

## v1.19.9 — 2026-08-18

<sub>release commit `b0fd3f8`</sub>

<details>
<summary><b>fix(models): ask the Claude CLI for the model list when the account was signed in through the browser</b> — v1.19.8's attempt was still broken · <code>4314a6f</code></summary>

**What people saw.** The **Fetch now** button on the admin panel's model list still failed on workspaces whose Claude account was connected by signing in through the browser. v1.19.8 said this was fixed; it was not.

**Why.** v1.19.8 read the account's access token out of the file the Claude CLI keeps it in and sent it as a header. That token is short-lived, and the CLI is the only thing that renews it — it does so when a chat turn runs, and nothing else touches it. On this workspace the stored token was eleven days past its expiry, because the shared account had not been used for a chat in that time, so the request went out and came back rejected. Any account quiet for a few hours hits the same wall, which makes the previous fix useless in practice.

**What changed.** The server no longer copies that token. For a browser sign-in it starts the Claude CLI instead and reads the model menu the CLI offers for the account — the CLI authenticates and renews the credential on its own, which is the whole reason chat turns keep working. The session it starts is given a prompt that never produces anything and is stopped as soon as the list arrives, so no messages are used.

**What the list looks like now.** For a signed-in account it is the same menu the Claude CLI itself shows — `Default (recommended)`, `Opus (1M context)`, `Sonnet`, `Haiku` — rather than raw version ids. Those names stay valid across model releases. Workspaces using a pasted token, an API key or a custom endpoint are untouched and still get the endpoint's own list.

**New setting.** `modelsCliTimeoutMs` (default 60s) — the existing 10s limit is sized for a web request, and starting the CLI takes longer than that.

**Also.** An agent pinned to a model id that a refresh removed from the list used to show an empty box in the agent editor, and saving the form quietly reset it to "inherit". It now keeps showing the id it is actually pinned to.

</details>

---

## v1.19.8 — 2026-08-18

<sub>release commit `06b71bf`</sub>

<details>
<summary><b>fix(models): "Fetch now" for the model list works when the Claude account was signed in through the browser</b> — the sign-in credential is now read for that request too · <code>88b87a1</code></summary>

**What people saw.** In the admin panel, pressing **Fetch now** on the model list failed with `no Claude token or API key configured` — but only on workspaces whose Claude account was connected by signing in through the browser instead of pasting a token. The same list also silently stopped updating on its own (`modelsAutoFetch`).

**Why.** A browser sign-in does not produce a token the server can hand around. The credential lives in a file the Claude CLI owns and refreshes, and every chat turn just gets told which folder to read it from. The model-list request is the one call the server makes to Anthropic by itself, with no CLI involved — so it saw no token in that hand-off and gave up before sending anything.

**What changed.** That request now reads the account's access token out of the same credential folder and sends it the way an OAuth token is normally sent. A token pasted into the settings still wins over the sign-in, matching the order everything else uses. Bedrock and Vertex are unchanged (they have no model-list endpoint), and a custom base URL that needs no auth still works. If the credential file is missing or unreadable the button now says so instead of reporting a missing token.

**Known limit.** The stored access token is refreshed by the CLI, not by this request. If it expired since the last chat turn the fetch returns a `401` until a turn (or a fresh sign-in) renews it.

</details>

---

## v1.19.7 — 2026-08-18

<sub>release commit `a94e01e`</sub>

<details>
<summary><b>fix(chat): scrolling up during an answer no longer snaps back to the bottom</b> — the view follows new text only while you are already at the bottom · <code>f97497f</code></summary>

**What people saw.** While an answer was still being written, scrolling up to re-read something earlier pulled the view straight back to the newest line, over and over, until the answer finished.

**Why.** Every chat pane jumped to the bottom on each update, no matter where the reader was.

**What changed.** Each streaming pane now remembers whether the reader is sitting at the bottom (within 48px). At the bottom it keeps following new text as before; scrolled up it leaves the view where it is, and scrolling back down resumes the follow. This covers the main chat, the corner guide, direct messages and each subagent's live pane. A search hit still jumps to its message and now stays there.

</details>

---

## v1.19.6 — 2026-08-18

<sub>release commit `d0d8c11`</sub>

<details>
<summary><b>feat(guide): the corner guide now covers every feature of the workspace</b> — it used to deny having things this app ships · <code>50b6988</code></summary>

**What people saw.** Ask the guide panel about team agents, shared plans, the task panel, the file explorer, git history or exporting a session and it answered as if none of them existed — or described a feature but had no way to carry it out.

**Why.** The guide gets its knowledge from three tables in `server/src/guide/`: a feature list in the prompt, an allowlist of API routes it may call, and a list of browser actions. All three had stopped keeping up with the product, so anything added since was invisible to it.

**What changed.** The feature list now names every user-visible feature, in the words the interface uses, grouped by area and with the admin setting that can switch each one off — so the guide says "your workspace has that turned off" instead of "that does not exist". Thirty-four more API routes are reachable: team agents, shared-plan pools, project files, git branches/commit/push/checkout, wiki documents and recompile, room members and rights, DM messages, plugin contents, PR review detail, and a few admin read-outs. Four new browser actions let it open the Tasks, Git and Files panels and switch between chat / split / editor. A new section lists what it must hand back to a person — deleting anything, credentials, file uploads, merging a PR, publishing a repository — with where the control is.

**Kept out on purpose.** Deletes, anything holding a secret, admin infrastructure (restart, backup/restore, image pull, creating users), and one-way doors outside this server (merging a PR, publishing a repository, rotating a webhook secret). `git push` is the single exception, because it is the ordinary end of a commit the user just asked for — the guide states what it is about to push and waits for a yes.

**Staying in step.** A new rule 12 in `CLAUDE.md` makes updating the guide part of shipping a feature, and the check in `api-map.test.ts` now fails when a browser action exists on the server but has no handler in the client, which is the failure that used to be silent.

</details>

<details>
<summary><b>fix(guide): admin-only recipes were shown to members</b> — the how-to block named an admin route the list of callable routes already hid · <code>bcf0e8c</code></summary>

The guide's list of callable routes has always been filtered by role, but the block of worked examples below it named the admin settings endpoint for everyone. A member could not call it — the server refuses it twice over — but they were told it existed. The admin examples are now appended only for an admin, and two more were added there: refreshing the model list, and deciding a member request that is waiting.

</details>

---

## v1.19.5 — 2026-08-14

<sub>release commit `4333ca7`</sub>

<details>
<summary><b>fix(auth): a room session said "Not logged in" to people who were signed in</b> — turns in a shared room looked for the credential in the room's folder, not the sender's · <code>54d491c</code></summary>

**What people saw.** Signed in on My Page (and again as the shared account in the admin panel), every turn in a room session still failed with `Not logged in · Please run /login`. Personal sessions were fine.

**Why.** A browser sign-in stores its credential file in the signer's own workspace folder, and the code relied on the CLI finding it there because a turn runs with that folder as its home. A room session runs with the *room's* folder instead, so the CLI looked in a place that has no credential. The shared admin account would have worked — it has always been handed over as an explicit pointer — but the personal sign-in is picked first and never falls through to it. Sessions that borrow another member's plan had the mirror problem: they read the session owner's credential rather than that member's.

**What changed.** The credential folder is now named explicitly for every sign-in, not just the shared account, so a turn reads the right one wherever it runs. Nothing changes for a personal session — the folder named is the same one it was already using.

</details>

<details>
<summary><b>fix(docker): a plain <code>docker run</code> never used the data volume</b> — the editor refused to open, and the whole workspace vanished on the next container recreate · <code>a6848ca</code></summary>

**What people saw.** Deploy with the `docker run` command from the README, then press the split button in a session: `no such container - cannot access path /var/lib/docker/volumes/claudecode-workspace_data/_data/common/projects`.

**Why.** The command mounts the named volume at `/data`, but it never passed `DATA_DIR` and the image had no default for it, so the app fell back to `./data` — which resolves against the directory it starts in, `/app/server/data`. Everything (the database, projects, sign-ins) was written inside the container while the volume stayed empty. The editor container mounts that volume and asks for the `common/projects` folder inside it; in an empty volume there is no such folder, so the Docker daemon rejected it. The same setup also meant a `docker rm` or a version upgrade threw the workspace away.

**What changed.** The image now sets `DATA_DIR=/data` itself, so it matches the mount every published command uses (Compose already set it). On top of that, the server now checks at startup that the volume named by `DATA_VOLUME` really is the one mounted at `DATA_DIR`; if it is not, the boot log and the admin **Overview** say so in words, the editor is switched off up front with that reason on hover, and pressing it returns the reason instead of a raw daemon error. When the app is not running inside Docker the check is skipped rather than treated as a failure. The `docker run` snippets and the environment tables in both READMEs now spell `DATA_DIR` out.

**Upgrading an affected deployment:** its data is inside the container, not on the volume, so copy it across before recreating — `docker cp claudecode-app:/app/server/data/. ./ccw-data` with the container stopped, then write it into the volume from a throwaway container, e.g. `docker run --rm -v claudecode-workspace_data:/data -v "$PWD/ccw-data:/src:ro" alpine cp -a /src/. /data/`.

</details>

---

## v1.19.4 — 2026-08-14

<sub>release commit `05c83be`</sub>

<details>
<summary><b>fix(ui): the row under the message box is one line again, in plain text</b> — the buttons kept their heavy borders and pushed send onto a second line · <code>490bf60</code></summary>

**What people saw.** After the move, the four bordered buttons plus the keyboard hint filled the row, so the send button dropped to a line of its own and the message box grew a step taller.

**What changed.** These controls are now bare text — no border, no background until the pointer is over them. Permission mode and attach (a `+`) sit at the left, model, effort, usage and send at the right, and the keyboard hint sits between them and disappears first on narrow windows, so the row holds one line. Permission mode is coloured whenever it is not the ask-first default, so a session that is allowed to run without asking says so at a glance. A model id the admin registry does not name loses its `claude-` prefix instead of pushing everything sideways. On a phone the controls wrap in two tidy groups rather than being cut off.

</details>

---

## v1.19.3 — 2026-08-14

<sub>release commit `764b93c`</sub>

<details>
<summary><b>feat(ui): model, effort, permission mode and usage move under the message box</b> — the top bar had more buttons than fit on one line · <code>8a921fb</code></summary>

**What people saw.** The session top bar carried so many buttons that it wrapped onto a second line (a third on a phone), pushing the conversation down.

**What changed.** The four buttons that decide *how the next message runs* — permission mode, model, effort, usage — now sit in a row under the message box, beside the attach and send buttons, the same place the Claude Code desktop app puts them. Everything else (project, files, Git, agent, plan, build container, tasks, view switch) stays in the top bar. What the buttons do is unchanged; their menus now open upward so they are not cut off at the bottom of the screen.

**Fixed alongside.** The usage panel is positioned the moment it opens, while it still shows only "loading"; the limit rows arrive a moment later and make it taller. Opening upward, that extra height ran past the bottom edge and covered the button — it now measures again once the rows are in.

</details>

---

## v1.19.2 — 2026-08-14

<sub>release commit `2bb0d7b`</sub>

<details>
<summary><b>fix(usage): the usage limits came up empty — three causes, fixed together</b> — a half-finished lookup taken as the answer + a fallback wiped by every deploy + a privacy switch deleting the row that mattered · <code>04fac4b</code></summary>

**What people saw.** Opening the usage popover in the chat header showed an empty "Usage limits" section, or a message saying the token lacked permission. It kept coming back after several attempts to fix it.

**Cause 1 — a half-finished lookup was taken as the answer.** To read the limits the server briefly starts a Claude CLI and asks it. That CLI answers with *whatever it has at that moment*. One that has just started has not finished its account lookup, so it says "yes, this token may read plan windows" but sends the figures back empty. The server believed that, cached it for two minutes and also stored it as the account's "last good value" — so the screen said the account had no limits at all. It now counts an answer as an answer **only when the figures are actually in it** (a flat "no limits", as an API key gives, is still a real answer), and while they are missing it re-asks the session it already has open for `usageLimitsRetryMs` (10s by default). No model runs, so this costs nothing.

**Cause 2 — deploying wiped the fallback.** The "last good value" kept for when a lookup fails lived only in server memory. The container is replaced on every release, so **the first popover opened right after a new version went up** had nothing to fall back on — which is why this kept resurfacing. It is now one row per account in the database.

**Cause 3 — a privacy switch deleted the row that mattered most.** Testing the live CLI one environment variable at a time: with `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1` (both set by the privacy switches, which are on by default) the CLI leaves the **per-model weekly window** out of its answer entirely. On this workspace the 5-hour window sat at 8% while the per-model weekly was at 91% — so the only number that mattered was the one being hidden. The CLI used for the limits lookup is an empty session that never says a word to the model, so those two variables are dropped for that lookup alone. Chat turns and every other lookup keep the admin's privacy settings exactly as they are. To keep them blocked instead, turn `usageLimitsFullDetail` off and lose only that row.

**Fixed alongside.** A lookup that simply did not come back no longer gets reported as a token-permission problem (`limitsUnknown` plus a new "could not read the limits just now — hit refresh" message). The 5-hour window primer was making the same misreading of "not ready yet" as "no window is open", which would have spent a real message opening a window that was already running.

**New settings.** `usageLimitsRetryMs` (default 10000), `usageLimitsFullDetail` (default on). Runnable check: `npx vitest run server/src/claude/usage-limits.test.ts`.

</details>

---

## v1.19.1 — 2026-08-14

<sub>release commit `2a05741`</sub>

- **fix(chat): the session pool menu listed "Everyone" twice** — with workspace-wide sharing on, the inherit row and the workspace pool itself both rendered as plain `전체 사용자`, so the menu showed the same label twice with no way to tell which was which. The inherit row now reads `자동 · <what it resolves to>`, and a tick marks whichever entry is active. · `656cf50`

---

## v1.19.0 — 2026-08-14

<sub>release commit `61acc49`</sub>

<details>
<summary><b>feat(pool): the workspace-wide level is now "everyone shares", not "an admin picks one pool"</b> — new <code>tokenPoolAllUsers</code> switch, per-member opt-out · <code>08c562d</code></summary>

The previous cut read "workspace-wide" as *an admin nominates one of the existing pools as the default*. What it should mean is simpler and stronger: **every user in the workspace pools their plan together**, with nothing to create and nothing to join.

**How it works now.** One admin switch, `tokenPoolAllUsers` (Config tab, "Shared plans" group). On, the workspace-wide pool is *derived*: its members are every user who registered a Claude plan. It has no row in `token_pools` and no membership to manage — the reserved pool id `all` stands for it wherever a pool id is accepted, including a session that names it explicitly. Cooldowns for its members are still recorded (a `token_pool_members` row keyed by `all`, written the first time someone's window runs out), so a spent plan is skipped and the turn falls through exactly like in a named pool.

**Opt-out.** An admin turning the switch on would otherwise spend the plan of someone who registered a token purely for their own use. Each member gets one switch in My Page — "keep mine out" — that removes only their own plan (`users.pool_opt_out`, `PUT /api/pools/opt-out`, always self-only). Nothing else about the workspace-wide pool is member-editable: join, leave, delete and order all answer 400 for it.

**Removed.** `PUT /api/pools/global` and the settings key `token_pool_global` are gone, along with the custom admin-panel section they needed — the ordinary settings row for `tokenPoolAllUsers` is the whole control now.

**Resolution order** is unchanged in shape: the session's own choice (a pool, or `own` to opt out) → the sender's own default pool → the workspace-wide "everyone" pool → the sender's own plan.

Verified on the running container: the derived membership list, the opt-out removing exactly one member, all four mutation endpoints refusing `all`, round-robin across every user, a spent member being skipped, and each step of the order with the switch on and off.

</details>

- **docs: the READMEs describe the workspace-wide pool as "everyone shares"** — both language versions, matching the switch above · `d7a983f`

---

## v1.18.0 — 2026-08-14

<sub>release commit `da01277`</sub>

<details>
<summary><b>feat(pool): three levels of shared plans, with the workspace-wide one moved to the admin panel</b> — new per-user default pool, explicit per-session opt-out · <code>36fdb0c</code></summary>

The first cut had two levels and put the workspace-wide choice in My Page. Reworked to what the feature actually needs.

**Where each level is set.** The workspace-wide pool applies to *every* user, so it now lives in the admin panel (Config tab → "Shared plans — workspace default") as a dropdown of the existing pools. My Page keeps only what a member decides for themselves: which pools they join, and which one is their own default.

**A new middle level.** A member can mark one pool they have joined as **their own** default (`PUT /api/pools/my-default`, stored in `users.default_pool_id`). It applies to their turns wherever no session picked a pool, and it overrides the workspace-wide one. It is per user, so two members of one shared room can draw from different pools. Only a pool you already joined can be your default, and leaving one clears it.

**An explicit opt-out.** With "not set" now meaning "inherit", a shared room could never be put *back* on "everyone pays for their own turns". The session picker gains that as its own choice, stored as the sentinel `own` in `chat_sessions.pool_id` (null still means inherit). `PATCH /api/sessions/:id` also rejects an unknown pool id instead of storing a binding that resolves to nothing.

**Resolution order**, most specific first: the session's own choice (a pool, or `own` for no pooling) → the sender's own default pool → the workspace-wide pool → the sender's own plan.

Verified against the running container: every step of the order, the opt-out, a session naming a deleted pool falling through instead of dropping off pooling, and `my-default` refusing a pool the caller has not joined.

</details>

- **docs: the READMEs spell out the three-level order** — both language versions · `e90c666`

---

## v1.17.3 — 2026-08-14

<sub>release commit `28effc1`</sub>

- **fix(sessions): binding a pool or a build container to a room needs room membership** — `PATCH /api/sessions/:id` guards a room's shared row with `canEditChat`, which returns true for any signed-in user (it leans on the chat-session id being unguessable). That is fine for the model dropdown, but the two fields added in v1.17.0 have a cost attached: one decides whose Claude plan the room's turns spend, the other spawns a container. `poolId` and `sandbox` now require the same authority as sending a turn in that room — an admin, or a member. Everything else in the same request is unchanged. · `8582d6a`

---

## v1.17.2 — 2026-08-14

<sub>release commit `1ead1ac`</sub>

<details>
<summary><b>fix(pool): the pool endpoints were never reachable</b> — plus two smaller pool fixes found while testing the running app · <code>6855c47</code></summary>

Testing v1.17.1 against the real container instead of the mocked demo turned up three things.

**`/api/pools` answered 404.** `poolRoutes` was imported in `server/src/index.ts` but the `app.register(poolRoutes)` line next to the other route registrations was missing, so the whole feature was unreachable from the app — every pool screen showed an empty list and nothing could be created or joined. TypeScript did not catch it (an unused import is not an error) and the static demo did not either, since it answers `/api/pools` from its own mock router. Registered.

**A session bound to a deleted pool stopped pooling entirely.** `poolForSession` read the session's own `pool_id` first and gave up when no such pool existed, instead of falling back to the workspace-wide one. `deletePool` clears the bindings it knows about, so this only bit rows removed another way (a restore from an older backup, a manual edit) — it now falls back as intended.

**An unrecognised order value silently wiped the pool's setting.** `PUT /api/pools/:id/strategy` normalised anything it did not recognise to "follow the admin default" and answered 200, so a typo quietly discarded a pool's real `sequential`/`rotate` choice. It now answers 400 and leaves the setting alone; `""` still explicitly means "follow the admin default".

Verified on the running container: pool create/join/leave/delete, the workspace-default binding, order changes, and every authorization boundary (a non-owner cannot change order, set the default, remove another member or delete the pool). Consent holds — a join request carrying someone else's `userId` in the body enrols only the caller. A real two-turn conversation confirmed the rest end to end: the first turn ran on the other member's plan and said so in the transcript, the second rotated to the sender's own plan, and the live meter read `입력 61.3k · 출력 3` before any answer text appeared.

</details>

---

## v1.17.1 — 2026-08-14

<sub>release commit `76cabd8`</sub>

- **feat(pool): pick a pool's order from the UI** — the per-pool `rotate` / `sequential` override was reachable only through `PUT /api/pools/:id/strategy`, so in practice every pool sat on the admin default. The pool row in My Page → Credentials now shows it as a dropdown for the pool's creator and for admins; everyone else still sees it as text. · `245ee4b`

---

## v1.17.0 — 2026-08-14

<sub>release commit `e3b3d26`</sub>

<details>
<summary><b>feat(chat): live token counter that moves before the answer appears</b> — input tokens are reported at the start of each step · <code>6d50d29</code></summary>

**Symptom.** The token count next to the waiting mark stayed at 0 until Claude's text started printing. A turn could think for a minute or run several commands and the number never moved, which read as "nothing is happening".

**Cause.** The counter only ever counted what was already on screen. The server reported output tokens once per assistant message — that report arrives at the END of a message — and in between the client guessed from the characters it had received. Thinking and tool time produce no characters, so there was nothing to guess from. Input tokens (the conversation re-sent on every step, and usually the bulk of a command-heavy turn) were never reported at all.

**Fix.** The server now also reports the input tokens Claude reports at the START of each step, cache reads and writes included, and sends both directions on the same `turn:usage` event. The chat shows `입력 6.1k · 출력 ~420` while the turn runs; the `~` still marks the character estimate that fills the gap until the next exact output count. The "생각 중" mark is also raised as soon as a thinking block opens rather than on its first chunk, so it appears immediately.

</details>

<details>
<summary><b>feat(chat): fold a long run of back-to-back commands into one row</b> — new <code>toolFoldMin</code> setting · <code>6d50d29</code></summary>

An answer that runs many commands in a row buried its own text between tool cards. Three or more consecutive command cards now collapse into a single row that names what ran (`명령 4개 · Bash ×2, Read, Edit`) with the run's overall result; clicking it expands the individual cards as before.

A run stays open while any command in it is still running or came back with an error — folding away the command you are waiting on, or the one that failed, would be worse than the noise it saves. The threshold is the admin setting `toolFoldMin` (default 3, `0` disables folding).

</details>

<details>
<summary><b>feat(pool): shared plans — run a turn on another member's Claude plan</b> — new <code>token_pools</code> tables, <code>/api/pools</code>, <code>tokenPool*</code> settings · <code>6d50d29</code></summary>

Members who registered their own Claude plan can now pool them. A turn bound to a pool runs on a pool member's plan rather than only the sender's, and when that member's allowance is used up the same prompt continues on the next member's plan instead of failing.

**Shapes.** A pool can be the workspace-wide default (an admin sets it), a per-session choice (a shared room is one session — the header pill picks it), or a party a few people start themselves. Resolution at turn time: the session's own pool, else the workspace default, else the sender's own plan exactly as before.

**Order.** `rotate` moves to the next member each turn; `sequential` keeps using one member until their allowance runs out. Set per pool, defaulting to the admin's `tokenPoolStrategy`. A member whose allowance came back spent is skipped until the reset instant Claude reported (or `tokenPoolCooldownMs` when it reported none) — but they are pushed to the back of the order rather than dropped, so a wrong guess can never make a pool unusable. The sender is always the last resort.

**Consent.** Joining is only ever the member's own action: the join endpoint takes the user id from the session cookie and never from the request body, so one person cannot enrol another's plan. Leaving is allowed for the member, the pool's creator and admins, since removing someone can only spend less. Each answer that ran on someone else's plan says whose, both live and in the saved transcript.

New settings: `tokenPoolEnabled` (off by default — it spends other people's plans), `tokenPoolStrategy`, `tokenPoolCooldownMs`, `tokenPoolMaxFallback`, `tokenPoolPartyCreate`. Every endpoint checks `tokenPoolEnabled` server-side; hiding the UI is not the control.

</details>

<details>
<summary><b>feat(sandbox): a build container per session</b> — <code>mcp__sandbox__run</code> for ordinary sessions, new <code>sessionSandbox*</code> settings · <code>6d50d29</code></summary>

Every session shared the one app container, so two people who both started a dev server or a test suite collided on ports, caches and the process table.

With `sessionSandboxEnabled` on, a session's header toggle gives it its own sibling container with only that session's project directory mounted, at the same absolute path the app sees. The turn then carries an `mcp__sandbox__run` tool and a house rule — appended to Claude's own instructions, never shown in the chat — telling it to run anything that installs, builds, serves or tests in there. The ordinary shell stays available on purpose: git, search and file work have no reason to pay for a container hop.

Unlike the PR-review sandbox, which is destroyed after every turn because it runs code from outside the team, this one stays up between turns so installed dependencies survive, and is removed once the session has been quiet for `sessionSandboxIdleMs`. It runs with no capabilities and `no-new-privileges`, under a memory cap and a process cap, and appears in the admin process panel next to the review sandboxes. If the container cannot start, the turn falls back to the shared shell exactly as before.

New settings: `sessionSandboxEnabled` (off by default — one container per active session), `sessionSandboxImage`, `sessionSandboxMemMB`, `sessionSandboxPidsLimit`, `sessionSandboxExecTimeoutMs`, `sessionSandboxMaxOutputBytes`, `sessionSandboxIdleMs`, `sessionSandboxReaperMs`.

</details>

- merge: `feat/token-pool-sandbox-live-usage` — `d53fe55`

---

## v1.16.1 — 2026-08-13

<sub>release commit `e178dbd`</sub>

<details>
<summary><b>docs: clear out the jargon that had built up, and a rule to stop it returning</b> — recent entries and the README rewritten in plain language · <code>7f17b19</code></summary>

Wording that made sense while writing the code (probe, cold start, starve, plumbing, corrupted stream, foreground/background, last-known-good, headless, spawn, clamp, gating, replay, persona…) kept getting copied straight into the docs, leaving sentences that only their author could read. A sweep over six documents turned up 90 such passages; they were rewritten against one shared list of plain replacements.

- **CHANGELOG (en/ko)**: entries from v1.14.1 onward restructured as **symptom → cause → fix**; the worst passages in older sections cleaned up too.
- **README (en/ko)**: the task panel, usage meter, 5-hour window, self-update and security sections now describe what happens instead of borrowing internal metaphors.
- **Prevention**: [CLAUDE.md](CLAUDE.md) rule 11 gains a "write it plainly" clause, so the same standard applies to whatever is written next.

</details>

<details>
<summary><b>fix(usage): show the last successful plan limits when the lookup fails</b> — the usage popover no longer blanks out while the server is busy · <code>d0ff87d</code></summary>

**Symptom.** For a signed-in account, "plan limits" in the usage popover occasionally read as unavailable — even though it had shown real numbers minutes earlier, and would show them again a little later.

**Cause.** To read the limits, the server briefly starts one more Claude CLI and asks it. When the server is busy (a team-agent turn running several CLIs, say), that CLI can take longer to start than the 45-second budget (`usageProbeTimeoutMs`), so no answer arrives — and the screen presented "no answer" as "no limits".

**Fix.** The server now remembers the last limits it successfully read for each account and shows those whenever a lookup comes back with nothing at all. A real "this account has no plan limits" answer (an API key) is a genuine answer and is still shown as-is. How long the remembered value stays usable is set by `usageLastGoodTtlMs` (30 minutes by default, 0 turns it off). A lookup that gets no answer also writes one `[usage]` warning to the server log, so the next report of this can be checked immediately.

</details>

## v1.16.0 — 2026-08-13

<sub>release commit `f15fb3c`</sub>

<details>
<summary><b>feat(agents): turn on agent teams per session + watch every teammate at once</b> — the task panel is the teammate screen · <code>43c4f12</code></summary>

**Background.** Claude Code has an experimental mode where several agents work as a team; it is turned on with the environment variable `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.

**What we checked.** We turned it on inside the container and ran a small team for real. When Claude Code runs on a server with no terminal (the way this workspace runs it), each teammate runs as a **named agent behind the conversation**, and its progress arrives in exactly the shape the workspace already receives — task start/progress events, and messages labelled with which teammate sent them. The teammate window you see in the CLI is part of the CLI's own screen, so on a server there is none: here the **task panel plays that role**.

**Change.** Every session now runs with that environment variable (admin switch `agentTeamsEnabled`, on by default), and the task panel header gains a **split view** button. Until now you opened one teammate's live window at a time; this opens all of them at once, so you can watch the whole team on one screen.

**Caveat.** Teammates run behind the conversation, so in sessions that ask you for approval they work one at a time because of the workaround in v1.15.1 below. To have several teammates working simultaneously, use a bypass-mode session for now.

</details>

---

## v1.15.1 — 2026-08-13

<sub>release commit `006e4de`</sub>

<details>
<summary><b>fix(agents): run subagents one at a time when a session can ask for approval</b> — works around the "Stream closed" failure that killed every file edit · <code>9323c43</code></summary>

**Symptom.** Halfway through a team-agent test turn, nothing could be written any more: every tool that creates or edits a file failed with `Tool permission request failed: AbortError: Stream closed`, while read-only tools kept working.

**Cause.** A bug in Claude Code itself ([anthropics/claude-code#27203](https://github.com/anthropics/claude-code/issues/27203)). When a subagent running behind the conversation uses a tool that needs approval, the approval request never reaches the workspace — the CLI refuses it internally. That refusal breaks the channel the approvals travel on, so every later approval in the same turn fails too, including ones from the main conversation. Reproduced on CLI 2.1.229.

**Fix.** Sessions that can ask a person for approval now start the CLI with `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`, the official switch for this. With subagents running one at a time instead of behind the conversation, approvals travel normally. Sessions that never ask (bypass mode, automated PR review) keep running them in the background. Once the original bug is fixed, the admin switch `bgTasksWithPrompts` (off by default) puts the old behavior back.

</details>

---

## v1.15.0 — 2026-08-13

<sub>release commit `6555973`</sub>

- merge: `feat/sidebar-and-agents-v2` — `fca7dde`

<details>
<summary><b>feat(sidebar): project-group spacing, per-project quick add, distinct import icon</b> — three small session-list annoyances · <code>84966f5</code></summary>

Project groups in the sidebar ran together with no gap, so it was hard to see where one project ended — each group now has space beneath it and reads as its own block. Every project title row gains a `+` that opens a new chat already assigned to that project (the server accepted a project id all along; the web app simply wasn't passing it). Session **import** used the same downward-arrow icon as **export**; import now uses an upward arrow, so the two directions are told apart at a glance.

</details>

<details>
<summary><b>feat(agents): project-scope team agents</b> — an agent for the project, not the person · <code>a123de8</code></summary>

Until now a team agent was either shared with the whole team or personal. It can now belong to a **project**: any session opened in that project can use it, whoever runs it and whether it is a private chat or a shared room. If names collide, a personal agent wins, then a project one, then a team-wide one.

A project agent's instructions also go into **other people's** conversations in that project, so creating and editing them is treated as the same level of trust as team-wide agents: admins only, except for personal projects, which their owner manages. You only see agents from projects you have access to.

The agents panel gains a project card — you pick the project when creating one, and each row shows which project it belongs to. The agent picker in the chat header only offers agents belonging to the current session's project. (Storage: `team_agents` gains a `project_id` column, and its uniqueness rule is rebuilt to include the project, so existing databases carry over as they are.)

</details>

<details>
<summary><b>feat(agents): surface filesystem agents (.claude/agents) in the UI</b> — what Claude writes, you now see · <code>e7af605</code></summary>

Besides creating agents in the UI, you can write them as files (`.claude/agents/*.md`) — and Claude sometimes writes them itself while working. The CLI picks those files up on its own, but the workspace never showed them, so an agent you had just created appeared to be missing. The server now scans your home folder and the `.claude/agents` folder of every project you can see (reading only the header at the top of each file) and shows them in the agents panel as **read-only** cards, labelled with where they came from. Editing and deleting them stays file work, by design.

</details>

<details>
<summary><b>feat(tasks): watch a running subagent live</b> — see a team agent work · <code>2e982cb</code></summary>

Text written by a subagent was being shown as part of the main conversation, because the server ignored the marker saying which agent it came from. Subagent text is now sent and stored with that marker attached, so it also reaches anyone who opens the session while the turn is still running, and it no longer mixes into the main conversation.

Instead, each running subagent in the task panel gets a **Live** button that opens a terminal-like window showing that agent's own tool calls and the text it is writing, following along as new lines arrive. The static demo simulates the same thing, so you can click through it there too.

</details>

- **docs(readme): project agents, file agents, live subagent view (en/ko)** · `5e31ac0`

---

## v1.14.2 — 2026-08-13

<sub>release commit `747c2c2`</sub>

<details>
<summary><b>fix(usage): stop reusing a failed limit lookup, and add a refresh button</b> — the "shows nothing, then suddenly works" mystery · <code>2426cdb</code></summary>

**Symptom.** Plan limits would refuse to appear for a while, then suddenly work again.

**Cause.** The server asks for the limits once and reuses that answer briefly (`usageProbeTtlMs`, two minutes by default) — but it was **reusing failures too**. When the machine is busy (building a Docker image on the same host, say), the answer often does not arrive in time, and that failure was then kept for the full two minutes, so reopening the popover showed the same failure again instead of retrying.

**Fix.** Only an answer that actually arrived is reused; a failure is not stored, so the next open tries again. The popover also gains a **refresh** button that skips the stored value and asks again on the spot. The lookup itself was verified inside the running container.

</details>

---

## v1.14.1 — 2026-08-13

<sub>release commit `bd5a532`</sub>

<details>
<summary><b>fix(usage): read the limits with the browser sign-in, not the pasted token; drop the spend ledger</b> · <code>f77ffad</code></summary>

**Symptom.** Even for people who had signed in through the browser, the usage popover only said the account lacked permission (`user:profile`).

**Cause.** When running a turn, the workspace deliberately prefers a **pasted token** — that is explicit configuration. But the limit lookup used the same token, and a token from `claude setup-token` can only run requests; it cannot read account details, so the lookup always failed.

**Fix.** For the limit lookup only, the requester's **browser sign-in** is used when they have one (turns keep the old order). When there is no sign-in at all, the popover says what to do about it — sign in from My Page — instead of blaming the plan. With real plan limits finally visible, the workspace's own "usage totals" section we had built as a stand-in was removed everywhere it appeared: the popover, the API field, the summing function and its test, the demo data, and the wording. Usage records are still written (they are small, and cleanup manages them).

</details>

---

## v1.14.0 — 2026-08-13

<sub>release commit `e4d1300`</sub>

- merge: `feat/url-routing` — `db3d0bf` · `feat/team-agents` — `5569291` · `feat/backup-restore` — `84ec173`

<details>
<summary><b>feat(web): URL routing — refresh restores the open view</b> — /chat/:id · /room/:id · /admin … · <code>8ceceb4</code></summary>

A dependency-free history-API router ([web/src/lib/router.ts](web/src/lib/router.ts)) serializes every view to a path (`/chat/:id`, `/room/:id`, `/wiki/:id`, `/review/:id`, `/dm/:id`, `/admin`, `/plugins`, `/me`) and back. Derivation mirrors Shell's view priority (panel > DM > thread > home; wiki before the private kind — a wiki thread restores through its topic endpoint). Thread routes clear an open panel first (`join()` doesn't touch `panel`, which outranks the thread — without this, back from `/admin` snapped the URL right back). The app never rewrites the address while you are logged out, so the login screen cannot wipe a link you arrived on; an id that is missing or belongs to someone else sends you home and corrects the address bar to match; who may see what is still decided on the server. Demo `autoOpenFirst` yields to deep links, and the Pages deploy copies `index.html` to `404.html` so refreshes on deep links work on GitHub Pages. The server's SPA fallback already existed.

</details>

<details>
<summary><b>feat(agents): team/personal custom agents on every session</b> — subagents you call from the Task tool, plus a picker for who drives the main conversation · <code>fce75e7</code></summary>

"Team agent env vars" resolved to the SDK's real mechanism — there is no env var: the Agent SDK takes `options.agents` (programmatic subagent definitions, invocable via the Task tool) and `options.agent` (a named agent driving the main thread). Definitions live in a new `team_agents` table (two scopes like plugins: admin-managed common — its prompt injects into every member's turns, so admin-only — and personal, which wins name collisions). `resolveAgents()` hands the definitions over every time a session starts. The agent put in charge of a session's main conversation (`chat_sessions.agent`, header button, applied from the next turn) is checked when it is set **and** again when the session starts — a name that no longer resolves fails the whole CLI turn, so an agent deleted in between has to fall back to the default. Description and prompt are length-capped (they go straight into the model's input); a per-agent permission mode is deliberately not offered, since an agent could otherwise ask for more than the workspace's permission ceiling allows. Turning off `teamAgentsEnabled` makes the server refuse these requests. Web: AgentsPanel (create/edit/enable/delete), sidebar entry, chat-header picker, demo mocks with 3 seeded agents. Also fixes an item-7 gap this surfaced: `Alt+↑/↓` now closes an open panel before opening the thread, otherwise the thread opened invisibly behind it.

</details>

<details>
<summary><b>feat(admin): whole-workspace backup &amp; restore</b> — one .tgz migrates the server · <code>532711d</code></summary>

Backup = a consistent SQLite snapshot (`VACUUM INTO`, WAL-safe) + a streamed system-tar of the data dirs (user/room homes incl. CLI credential files, wiki, brand, review clones — WAL sidecars deliberately excluded, a stale WAL corrupts a restored DB). `backup-meta.json` records version, DATA_DIR and an encryption-key **fingerprint** (never the key). Restore: streamed upload (`restoreMaxMB`) → staging extract → validation summary (version · users · size · key match · DATA_DIR match) → typed-keyword apply, which kills editors, refuses while turns run, parks the current state in `.pre-restore` (one-shot manual rollback), swaps the staged data in and exits — docker's restart policy revives on the restored data, and boot-time DDL/ALTERs migrate an older DB forward. Key mismatch isn't fatal but is loudly warned: decrypt sites degrade to "no token", so stored tokens/credentials drop. The archive contains everyone's stored sign-in credentials, so it is admin-only and the server itself refuses the request unless the new **`backupEnabled`** flag is on (alongside `backupIncludeReviews` and `restoreMaxMB`). Admin panel gains a Backup tab (download card, upload→summary→RESTORE-keyword apply with health-poll reload); demo mocks + i18n + README included.

</details>

---

## v1.13.0 — 2026-08-13

<sub>release commit `31e4a88`</sub>

- **fix(shortcuts): Alt+↑/↓ closes an open panel first** — a panel outranks the thread in Shell's priority and `join()` doesn't touch it, so thread-hopping while a panel was open opened the chat invisibly behind it · `31bbeee`

<details>
<summary><b>feat(chat): Edit/Write tool calls render as diff cards</b> — see the change, not "File updated" · <code>3b526f0</code></summary>

File-edit tool calls used to show only the CLI's success string. They now render a real diff: a `+N −N` badge on the collapsed header, colored added/removed lines when expanded (shared prefix/suffix lines collapse to two context rows; `Write` is labeled *full write*), capped at 500 rows. The same diff appears inside the Edit/Write **approval prompt**, so what you're allowing is visible before it runs. No server change — tool inputs already stream and persist untruncated, so old transcripts get diffs retroactively. Diff text renders as JSX text nodes only (never through `md()`), and the body scrolls in its own container (mobile-safe, verified at 375px). Demo seeds and the live demo turn now include a real Edit.

</details>

<details>
<summary><b>feat(sessions): export a session for local resume</b> — the reverse of local-session import · <code>72a0793</code></summary>

`GET /api/sessions/:id/export` returns the CLI's own transcript jsonl; `?cwd=<localAbsPath>` rewrites each line's `cwd` to the local project path (the CLI matches transcripts against the runtime cwd — without it resume won't list the session; the value never touches the server fs). A `custom-title` line carries the workspace name into the local resume picker. Gated owner/admin + private-only (transcripts carry full tool output) plus a new **`sessionExportEnabled`** admin flag (server-side 403, UI hidden via `publicConfig`). The chat header gains a download button opening a modal: local-path input with a live `~/.claude/projects/<slug>/` preview, an explicit warning when left empty, then the exact file target and the `claude --resume <uuid>` command. Demo mock, i18n (ko/en) and README bullets included.

</details>

<details>
<summary><b>fix(usage): drop the workspace aggregate usage view</b> — mixed auth kinds made the total meaningless · <code>c8966f5</code></summary>

Root cause of the "usage doesn't measure on a no-API-key deployment" report: subscription sign-ins report **no billing cost**, so the admin usage tab summed zeros next to any old API-key spend and read as broken. A workspace-wide aggregate cannot be measured meaningfully across mixed auth kinds, so the view is removed end to end — admin tab + `/api/admin/usage` + `usageTotals`/`usageByUser`, the guide API-map row (the guide would otherwise call a 404), demo mocks and the i18n keys. Per-session measurement stays: the usage pill still shows the context window, claude.ai plan windows and the per-user recorded spend (session / 5h / 7d).

</details>

<details>
<summary><b>feat(shortcuts): 7 new core-feature bindings</b> — thread hopping, panels, view cycle, composer focus · <code>400a5e1</code></summary>

`Alt+↑/↓` moves to the previous/next thread in sidebar order (project-grouped chats → rooms → DMs → wiki → reviews, wrap-around; guarded so Option+arrows still edits text on mac). `Mod+Shift+E/G/F` toggle the task panel, Git panel and project file explorer — the latter two's open state moved from Header `useState` into the store so a global key can drive it, and `join()`/`goHome()` reset both so a switched thread never inherits a panel aimed at the previous project. `Mod+Shift+\` cycles chat→split→editor under the same gates as the seg buttons (desktop, docker ready, not wiki/review). `Shift+Esc` focuses the composer from anywhere; bare `Esc` outside a text field closes the mobile drawer first, then interrupts the running turn. Header pills advertise their keys via `withKeys()`, and the help sheet picks the rows up from the same `SHORTCUT_GROUPS` table (listed == working). README en/ko updated.

</details>

- **feat(chat): free-text "Other" answer on AskUserQuestion cards** — when none of the offered options fit, a "직접 입력" row under each question takes typed text and feeds it back through the same `respond(..., 'answer', …)` path a button pick uses; the static demo gains an `!ask` trigger to exercise the card · `14c2386`

---

## v1.12.0 — 2026-08-07

<sub>release commit `1760a80`</sub>

- merge: `feat/claude-browser-login` — `e059bf6`

<details>
<summary><b>fix: plan limits never loaded, and the shared token looked undeletable</b> — two reports, two unrelated causes · <code>8d1e7de</code></summary>

**Plan limits missing on a subscription session.** The probe drove its session with a one-shot `'ping'` prompt. That starts a real model turn *and* closes the query the moment the turn ends — while the plan-limit lookup is a live claude.ai call that outlives it, so the SDK rejected with `Query closed before response received`. Streaming input that never yields keeps the session open until we abort it, and takes no turn at all (`probeCommands` had the same bug, quietly spending a turn per palette open).

Even then the lookup lost: it shared a query with the context-window probe, which resumes the transcript and loads the session's plugins. Measured on a team subscription, the account lookup answers in **~3s on a bare session** but was waiting tens of seconds behind that startup — and running the two concurrently just made two CLI startups fight for the CPU. It now runs first on its own bare session (no resume, no plugins), then the context probe runs. `usageProbeTimeoutMs` 8s → 45s (the old value could not have fit either call) and `usageProbeTtlMs` 15s → 120s, so the cost is paid once per window rather than on every popover open. Verified against the real CLI in the container: `rate_limits_available: true`, 5-hour 65%, weekly 46%.

**Deleting the admin-set shared token appeared to do nothing.** It did delete — `commonTokenMeta` then reported the token still configured because `ANTHROPIC_API_KEY` is set in the server environment and counts as a fallback. The meta now carries `fromEnv`, and the admin panel says the value comes from the deployment (hiding the delete button) instead of offering an action that cannot apply to it.

</details>

<details>
<summary><b>feat(auth): back the shared account with an admin sign-in</b> — a common token is no longer the only shared fallback · <code>e9e1140</code></summary>

The shared credential could only be a **pasted token**, so the workspace-wide fallback inherited every setup-token limitation: no plan window, no refresh. An admin can now sign in from the admin panel instead, and members with no auth of their own run on that account.

The hard part: a shared credential has to reach a turn **without taking over the borrowing user's HOME** — that is where their settings, transcripts and resume ids live. `CLAUDE_SECURESTORAGE_CONFIG_DIR` relocates *only* the credential store (the CLI resolves it before falling back to the config dir), so the common-login branch of `resolveProvider` sets exactly that one var: HOME stays the user's, the CLI reads and refreshes the shared credential in place, and no token value is ever copied around. It joins `PROVIDER_ENV_KEYS` so a stale value can never silently route a turn at the shared account.

`claude-login.ts` now takes a **scope key** — a user id, or `COMMON` for the shared home — and the admin routes (`/api/admin/claude-login*`) mirror the per-user ones behind `requireAdmin`. Precedence stays explicit: user provider → user token → user sign-in → common provider → common token → common sign-in → mock. The admin panel's "no shared token" warning now counts a shared sign-in as configured.

Also raises `claudeLoginStartMs` to 60s: the **first** `claude` spawn in a fresh container extracts its native binary and can take well over 20s, which failed the very first sign-in after a deploy (found by smoke-testing the new path against the real CLI).

</details>

<details>
<summary><b>fix(auth): stop nagging for a token when the user already has auth</b> — sign-in and provider profiles count too · <code>6e68e91</code></summary>

The "register a Claude token" popup and the sidebar's "token unregistered" badge both keyed on `hasClaudeToken`, which only means *a token is pasted*. Someone who signed in through the browser, or who runs their turns on their own LLM provider profile (local LLM, Bedrock, Vertex), has perfectly good auth and was still nagged on every login.

`authUserWithToken` now also reports **`hasClaudeAuth`** — token OR browser sign-in OR a user-scope provider profile, the same three sources `resolveProvider` walks. An `anthropic` profile with **no** token deliberately does not count: `resolveProvider` falls straight through it, so counting it would silence the nag for someone who genuinely has none. The nag and the badge key on the new field; the token form keeps reporting `hasClaudeToken`, which is what it is actually about.

Sign-in/out and a user-scope provider save/clear return no user DTO, so they now call a small `refreshMe()` store action — otherwise the nag lingered until a reload.

</details>

<details>
<summary><b>feat(auth): sign in to a Claude account from the browser</b> — the only path to a full-scope credential · <code>acb274b</code></summary>

A pasted `claude setup-token` token is minted **inference-only**, so it runs turns but can never report the plan window — the CLI gates that on `user:profile`. The workspace had no way to obtain a full-scope credential at all.

`claude auth login --claudeai` requests the whole scope set (`org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload`) and, with no browser in the container, degrades to a **line-oriented flow**: it prints the authorize URL (`redirect_uri=…/oauth/code/callback&code=true`) and reads the code from stdin. No PTY, no TUI scraping. So the server drives the official CLI rather than implementing — or impersonating — an OAuth client of its own:

```
POST   /api/auth/me/claude-login/start  → spawn with HOME=<user home>, return the authorize URL
POST   /api/auth/me/claude-login/code   → write the pasted code to the child's stdin
GET    /api/auth/me/claude-login        → status (loggedIn, scopes, planLimits, subscriptionType)
DELETE /api/auth/me/claude-login        → sign out (and remove the credential file)
```

The CLI writes `.credentials.json` into the user's own HOME — the same HOME `buildOptions` gives every turn — so turns pick it up with **no token env at all** and refresh keeps working by itself. `resolveProvider` gains a `'login'` source, ranked under an explicitly pasted token (deliberate configuration beats ambient) and over the shared one (it is the user's own account). Both subscription-only features had to learn about it: auto-resume and the 5h window primer gated on `CLAUDE_CODE_OAUTH_TOKEN`, which this path deliberately omits, so they would have silently switched off for exactly the accounts that have a plan window.

**Security**: every endpoint is scoped to the caller's own id — no `userId` is ever read from a request — and responses carry only booleans, scope names, subscription type and expiry. No token value is ever returned; the one-time OAuth code goes straight to the child's stdin, unlogged and unstored. Admin keys `claudeLoginEnabled` (enforced server-side, not just a hidden button) and `claudeLoginStartMs` / `claudeLoginTimeoutMs` / `claudeLoginFinishMs`. The demo fakes both steps so the flow stays clickable on GitHub Pages.

</details>

<details>
<summary><b>fix(usage): explain a missing plan window on OAuth tokens</b> — it's a scope problem, not a plan problem · <code>ab1fd6f</code></summary>

The popover printed "API key / Bedrock / custom providers have no plan window" for *every* `rate_limits_available: false`, which misdiagnoses the most common real case: a `claude setup-token` OAuth token, where the user does have a subscription.

**Root cause is scope, not billing.** The bundled CLI computes `rate_limits_available` as `xi() && fR()`, where `fR()` requires the `user:profile` scope and `xi()` requires `user:inference` — and the setup-token flow calls `startOAuthFlow(..., { inferenceOnly: true })`, so the minted `sk-ant-oat…` token carries `user:inference` only. The SDK's own type comment says it: "False when plan rate limits do not apply (API key, Bedrock, Vertex, **or missing profile scope**)". No workspace bug; that token structurally cannot read plan windows.

`probeUsage` now reports `authKind` (`oauth` | `apiKey` | `other` | `none`), derived from the resolved provider env's **key names only** — no secret value is read, so nothing sensitive reaches the client — and the popover picks the matching explanation (new i18n key `usage.unavailableScope`). Recorded spend already covers what those sessions can actually report.

</details>

<details>
<summary><b>feat(usage): recorded spend when a session has no plan window</b> — the usage popover was a dead end on API keys · <code>eada33a</code></summary>

An API-key (or Bedrock/Vertex/custom) account has no claude.ai plan window at all, so the CLI reports `rate_limits_available=false` — and the popover printed "plan limits are not shown for API-key sessions" and nothing else. For a workspace running on an API key that made the whole meter useless.

Those sessions now get our own ledger instead: **this session**, **my last 5 hours**, **my last 7 days**, each with turns, in/out tokens and cost. `spendSummary()` (`server/src/usage/tracker.ts`) just sums the existing `usage` table — `recordUsage` already writes a row per turn — so it needs no CLI probe and still reports when the probe times out. The session total is author-agnostic (a room's turns come from several members); the rolling windows are per-user, mirroring the plan windows they replace. The unavailable note now explains *why* (no plan window, billed per token) instead of reading like a failure.

`GET /api/sessions/:id/usage` gains an additive `spend` field; the popover also gained a max height/width so the taller content cannot overflow a phone viewport. Runnable check: `server/src/usage/spend.test.ts` (needs a built better-sqlite3 — run it in the app container).

</details>

<details>
<summary><b>docs: these update notes</b> — every commit since the original design · <code>2671942</code> <code>5011c73</code> <code>4a4e0b7</code> <code>b4c02c8</code></summary>

- `2671942` added `CHANGELOG.md`/`CHANGELOG.ko.md` (from the DESIGN.md spec through v1.11.0) and linked them from both READMEs' contents + roadmap
- `5011c73` expanded the grouped summaries into one entry per commit — all 236, each with its root cause, config keys and security reasoning
- `4a4e0b7` collapsed the detail behind `<details>` toggles and grouped entries under `####` subheadings, so a folded row shows only its title and hash
- `b4c02c8` CLAUDE.md rule 11 added: from now on every commit gets an entry in both files (format, placement and the verification command included)

</details>

---

## v1.11.0 — 2026-08-06

<sub>release commit `cdc60ff`</sub>

<details>
<summary><b>Live thinking/token meter · growing composer · working copy</b> — <code>d0aaf40</code></summary>

Four strands in one commit:

- **fix(copy)** — every copy button was dead outside a secure context. `navigator.clipboard` does not exist over plain `http://` on a LAN address, which is how this workspace is normally reached. New `lib/clipboard.ts` copies via the API when present and falls back to a selection + `execCommand('copy')`; all call sites (answer copy, rendered code blocks, right-click menu, webhook fields) route through it, and a failed copy now says so instead of doing nothing
- **fix(chat)** — editing a message no longer requires changing it: re-sending the same text truncates from that point and regenerates, same as any other edit
- **feat(chat)** — a turn reports what it is doing: "Thinking…" while extended-thinking deltas stream, plus an output-token meter that climbs live (char estimate) and snaps to the SDK's exact per-message count on `turn:usage`
- **feat(chat)** — the composer and the message-edit box grow with their content up to a ceiling, then scroll. Live markdown is a highlight mirror painted behind the transparent textarea, so the caret, IME composition and the `/` and `@` menus are untouched. Only width-preserving styles are used (colour, background, text-stroke faux bold), or the caret would drift off the glyphs; `md.test.ts` pins the invariant that highlighting is purely additive

</details>

<details>
<summary><b>Per-turn slot / TTFT / total timing logged</b> — <code>acc2336</code></summary>

Turn latency was unattributable: no way to tell a turn blocked on the global `maxConcurrentTurns` cap from one where the CLI/model itself was slow. One line per turn: slot (semaphore wait), ttft (spawn + time to first visible output), total, tokens, cap usage.

Also guards `endRunningTasks` in the `finally` — a throw there would replace the turn's own outcome and skip the sandbox teardown below it.

</details>

---

## v1.10.0 — 2026-08-05

<sub>release commit `b245db9`</sub>

<details>
<summary><b>Tasks panel</b> — subagents, background shells and workflows beside the conversation · <code>f1051b3</code></summary>

A turn's Task-tool subagents, backgrounded shells, local workflows and MCP monitors never appeared anywhere in the UI: the CLI reports them as `system` messages (`task_started` / `task_progress` / `task_updated` / `task_notification` / `background_tasks_changed`), which the turn stream received and discarded without showing. Their nested tool calls DID show up — indistinguishable from main-thread ones.

- `server/src/claude/tasks.ts` folds those events into one ordered list per chat session and broadcasts the whole list on each change (`tasks:update` — each message replaces the list, so a dropped event cannot leave a finished task stuck showing "running"). `session:join` replays it, and `runTurn`'s `finally` settles anything still running — the CLI subprocess dies with the turn, so nothing it spawned can outlive it
- Web: a "Tasks" header pill (live count, glints while work runs) opens a resizable right-side panel with per-kind filter tabs, status, elapsed time, token/tool-call counts, the tool each task is on, and its summary or error. Full-screen overlay on a phone. Subagent tool calls now carry `parentId` and get badged in the transcript
- Admin: `taskPanelEnabled` / `taskHistoryMax` / `taskSessionsMax`

</details>

- merge: `feat/task-panel` — `bf5598d`

---

## v1.9.1 — 2026-08-05

<sub>release commit `1984531`</sub>

<details>
<summary><b>fix(claude): bypass mode no longer kills the turn under root</b> — <code>67b4ff8</code></summary>

`bypassPermissions` maps to the CLI's `--dangerously-skip-permissions`, which the CLI refuses when the process is root ("cannot be used with root/sudo privileges"). The app container runs as uid 0, so every turn in bypass mode — and every `probeCommands`/`probeUsage` on such a session — died with "process exited with code 1".

`buildOptions` now downgrades the SDK mode to `acceptEdits` when running as root, and `makeCanUseTool` auto-allows every tool in bypass mode, so the mode keeps its never-prompt behaviour (the class-1 path fence still applies). Same approach the wiki compile path already used.

</details>

<details>
<summary><b>fix(claude): keep the resume id when a turn dies mid-stream</b> — <code>2b8b24b</code></summary>

`claude_session_id` was written only on the success path, so any turn that errored, was interrupted, or died with the container left the column null. The CLI transcript was already on disk under the session's HOME, but with no id to resume the next message started a brand-new conversation — Claude with zero context while the UI still rendered the full history from our DB, **which makes the loss invisible**.

`runReal` now reports `session_id` as soon as the CLI emits it and `runTurn` persists it immediately; the capture also moved ahead of the abort check so a turn stopped on its first message keeps its transcript.

</details>

---

## v1.9.0 — 2026-08-05

<sub>release commit `6b9b4ca`</sub>

#### Self-update

<details>
<summary><b>Admin self-update</b> — check the published image and swap this container · <code>e2506cd</code></summary>

An Update tab compares the running version against the newest semver tag published for the app's own image (Docker Hub), then updates the workspace from inside the workspace. A container cannot recreate itself, so the swap runs in a **throwaway helper container** started from the freshly pulled image:

1. create the replacement under a temp name — validates the whole create spec while the old container is still serving, so a bad spec means no downtime
2. graceful stop + remove the old one, letting SQLite checkpoint (no SIGKILL)
3. rename temp → real name and start it
4. watch it for `selfUpdateHealthWaitMs`; if it exits or crash-loops, remove it and restore the previous image

The create spec is rebuilt from our own inspect output so ports, mounts, env, labels, networks and the restart policy carry over. Two fields are deliberately not copied verbatim: an auto-assigned Hostname (the old container's short id, which would break the new instance's self-lookup) and Cmd/Entrypoint when they merely mirror the old image's defaults (copying those would pin the new image to the old startup command). Rollback targets a dedicated `:ccw-previous` tag rather than a bare image id.

The outcome is reconciled at the next boot by comparing our own image id against the ids recorded before the swap, so nothing has to survive in memory; failures keep the helper's log for the panel to show. The panel polls through the downtime and reloads itself once the new version answers.

`GET /api/admin/update`, `POST /api/admin/update/check|apply` (admin-only, gated by `selfUpdateEnabled`, pull restricted to the app's own repo). Config group update: `selfUpdateEnabled` · `selfUpdateAutoCheckMs` · `selfUpdateCheckTimeoutMs` · `selfUpdateHealthWaitMs` · `selfUpdateContainer`. The periodic check only refreshes a cache — it never applies anything by itself. Verified against real Docker (swap + rollback).

</details>

- merge: `feat/self-update` — `80db2c6`

<details>
<summary><b>feat(docker): probe the daemon and surface it instead of failing on use</b> — <code>29422de</code></summary>

Three features hang off the Docker daemon (code-server editors, PR review sandboxes, self-update) and each only failed at the moment of use with a raw dockerode error. The existing check only asked whether `DATA_VOLUME`/`CODE_SERVER_NETWORK` were set, so a deploy whose socket is missing or whose daemon is down passed it and broke later.

- `lib/docker-status.ts` pings the daemon at boot and every `dockerProbeMs`, caches the verdict, and classifies the failure into something an operator can act on: socket-missing / denied / unreachable / unconfigured
- The boot log warns with the reason and names the disabled features; `GET /api/admin/overview` carries `docker` (+ `POST /api/admin/docker/probe` to re-probe); admin Overview shows a banner (reason, what stops working, how to fix it, the raw error, a Re-check button)
- `GET /api/config` carries `dockerReady`/`dockerReason`, so the chat header disables the split/editor views with the reason as their tooltip and a remembered 'editor' view is coerced back to chat; the editor endpoint's 501 names the reason
- Chat, projects, wiki, search and DMs are unaffected, which the banner says explicitly. Reason precedence lives on the server only: a ping failure outranks "env unset"

</details>

<details>
<summary><b>fix(deps): add vitest so typecheck stops failing</b> — <code>68b2906</code></summary>

`images.test.ts` and `self-update.test.ts` import from `vitest`, which was never a dependency, so `npm run typecheck` failed with "Cannot find module 'vitest'" regardless of the change under test.

Root devDependency on purpose: the runtime image installs `-w server` without `--include-workspace-root`, so vitest never ships. No `test` script — the other `*.test.ts` files are standalone `npx tsx` scripts, so a repo-wide `vitest run` fails on them.

</details>

#### Git panel

<details>
<summary><b>feat(git): pull a project from origin, and open the Git panel from My Page</b> — <code>dcf5013</code></summary>

The panel could commit and push but never fetch, so a project that moved on the remote had no way back short of the terminal. `POST /api/projects/:id/git/pull` — fast-forward only by default (so it never invents a merge commit in someone's workspace), `{ rebase: true }` replays diverged local commits on top with `--autostash`. Plus a Pull button and rebase toggle.

Reaching that panel also required attaching the project to a chat first, so My Page's project list now has a per-project Git button opening the same panel.

</details>

<details>
<summary><b>feat(git): pull with <code>--all</code></b> — so branches created upstream come along · <code>56ec8ac</code></summary>

A plain pull only updates the current branch's upstream, so a branch created on the remote stayed invisible. Pull now fetches every remote in the same pass and widens a `--single-branch` clone's refspec first, or `--all` still could not see the other branches.

git refuses `--all` next to a refspec ("fetch --all does not make sense with refspecs"), so the no-upstream case fetches all remotes in a separate step and keeps its explicit `origin <branch>`. The panel shows the tail of git's output instead of only its last line — with `--all` the `* [new branch] …` lines are the interesting part.

</details>

<details>
<summary><b>feat(git): per-file diffs and a lane-drawn commit history graph</b> — <code>ab118bc</code></summary>

The panel could stage and push a change but never show it. The file name in the change list is now a button that opens the patch, and a History section draws the commit graph (branches, merges, refs) from `git log --topo-order` with a colour lane per line of development — clicking a commit shows its stat + patch.

Two read-only endpoints back it (`GET /git/log`, `GET /git/diff`), both **validating rather than escaping** (execFile never involves a shell): a commit must look like a sha so it cannot be a flag or an arbitrary ref, and a path cannot be absolute or contain `..` — the untracked case reads the file off disk, since git has nothing to diff it against.

Lane layout lives in `web/src/lib/gitgraph.ts` so it runs under plain tsx: a commit reached from two lanes collapses them, or the graph would creep rightwards forever with a line that never ends. `gitLogMaxCount` / `gitDiffMaxKB` are admin settings, not constants.

</details>

<details>
<summary><b>feat(web): a full-screen toggle for the Git dialog</b> — <code>dea68b3</code></summary>

A 560px dialog was fine for staging and pushing, but the history graph and a patch are exactly the content it crops. One title-bar button trades the fixed width for 96vw × 94vh, and the boxes inside grow with it (patch 18rem → 58vh, graph 16rem → 40vh, change list 13rem → 30vh).

`fullscreen`/`titleExtra` are optional Modal props, so the other nine dialogs render exactly as before.

</details>

- merge: `feat/git-diff-graph` — `534d2db`

#### UI cleanup

<details>
<summary><b>feat(web): split My Page into tabs like the admin panel</b> — <code>c240899</code></summary>

Nine stacked sections were one long scroll → profile / session / requests / credentials / projects. The session tab hides when all three automation toggles are disabled, requests when approvals are off.

</details>

<details>
<summary><b>fix(web): stop the composer reserving dead space, centre the guide input</b> — <code>cd0df76</code></summary>

Every composer padded a blanket `pr-14` so the floating guide launcher could not cover Send, even on a wide screen where the centred 760px card already clears it. `useGuideInset` measures the row instead (0 when it clears the launcher), re-measured on every commit plus a ResizeObserver and window resize.

The guide panel's textarea also parked its text on the row's bottom edge — `py-1.5` lines the 20px box up with the 32px send button.

</details>

---

## v1.8.0 — 2026-08-04

<sub>release commit `1c9a70c`</sub>

<details>
<summary><b>Floating product-guide + control assistant</b> — explains, and carries the request out · <code>ff4cd1f</code></summary>

A round button in the bottom-right corner opens a small chat panel that both explains the product and carries requests out. The agent's whole tool surface is **two** in-process MCP tools:

- **`api`** re-enters this Fastify app through `app.inject()` with the caller's own session cookie, so each route runs its normal `requireAuth`/`requireAdmin`/ownership checks — permission enforcement is identical to clicking the UI, there is no second copy of the rules. An allowlist (`server/src/guide/api-map`) narrows it further: **no DELETE at all**, no credential/secret routes, no admin infrastructure verbs. The same table renders the agent's API reference, with admin routes filtered out for members
- **`ui`** covers what has no API (language, theme, navigation, dialogs) by pushing a `guide:action` to every tab of that user

Every built-in tool (Bash/Read/Write/…) is denied twice: `disallowedTools` plus a `canUseTool` that only ever allows the two tools above.

Thread state lives in its own per-user tables (`guide_threads`/`guide_messages`) rather than `chat_sessions`, whose viewer check falls through to true for unknown kinds. Streaming rides the existing `user:<id>` socket room.

Admin settings: `guideEnabled`, `guideWriteEnabled` (read-only mode), `guideModel`, `guideMaxTurns`, `guideHistoryMax`, `guideMaxInputChars`, `guideMaxToolChars`. Plus ko/en strings, static-demo parity (canned turns for the suggestion chips, including a real language switch and session creation), and `pr-14` on the chat + DM composers so the launcher never covers Send.

</details>

- merge: `feat/guide-agent` — `8e170e2`

---

## v1.7.0 — 2026-08-04

<sub>release commit `94f9791`</sub>

#### UI

<details>
<summary><b>feat(ui): signature waiting animation for every model wait</b> — naming included · <code>f8b645b</code></summary>

Replaces the generic blinking dots with one mark used everywhere a model call is in flight: the brand mark's three dots (favicon.svg) travelling as a wave down its own clay tint ladder, a clay glint running through the label next to them, and a turning clay ring around the sparkle for naming calls.

- `ClayDots`/`ClaySpark`/`ClayWait` in `lib/ui.tsx` + keyframes in `styles/index.css` (`--clay-mid`/`--clay-pale` tokens, reduced-motion freezes to a static badge)
- Applied to the streaming answer, the wiki compile line, the composer hint, the queued-turn banner, and the retitle button in the header + sidebar rows
- **Session titling was invisible until now**: auto-title/retitle/import emit `session:titling {on}` around the call, so the row title, the header title and every naming button wait together (`store.titling`, one source of truth, cleared in `finally` so the mark can never stick)
- The demo mirrors the titling event pair, and `route()` may answer late so a canned model call still shows its wait

</details>

<details>
<summary><b>feat(ui): group sidebar chats by project with collapsible headers</b> — <code>5567ec4</code></summary>

Private chats filed under their project (common first, then personal, unassigned last) instead of one flat list. Each project header folds its chats away; the fold state persists in localStorage. `setProject` also patches the session list so a row moves group instantly.

</details>

<details>
<summary><b>feat(ui): the right-click menu builds itself from the clicked element</b> — <code>366a986</code></summary>

The context menu was wired per surface, so only four places had one. Now it is assembled from whatever was right-clicked:

- `mirrorRows()` — the clicked row's/card's own controls, read off the DOM by aria-label/title/text, with their icon cloned and danger styling inferred. Selecting a row clicks the real button, so the surface keeps owning the handler. Sibling rows are excluded, so a project header can't offer to delete the chats under it
- `dataRows()` — clipboard rows for a selection, a field, a link, an image, a code block, or a tree row's full path
- `appRows()` — the app-wide rows, as before

Groups merge with dedup by label (a surface's own row wins) and separator collapsing. That made most hand-written menus dead code: chat messages lose theirs entirely, sidebar rows keep only "Open", and the admin-only delete on wiki topics is now gated by **the button's own presence** instead of a duplicated `isAdmin` check.

The menu scrolls when long (Shift+right-click hint stays pinned) and scrolling inside it no longer closes it. `GroupHeader` gets the aria-label it was missing; `turnSkillKeys`' block type widened because `npm run typecheck` was red on main.

</details>

<details>
<summary><b>feat(brand): admin-set custom logo + workspace title</b> — <code>ba7ebb6</code></summary>

The name and mark were hardcoded in three places. An admin uploads a logo and sets the title once (Admin → Config → Branding); both apply live for everyone across sidebar, login card, landing screen and browser tab.

- `brandTitle` / `brandLogoMaxMB` config keys; the logo is stored as `<dataDir>/brand/logo.<ext>` with its mtime as the cache-bust token (no DB column)
- `GET /api/brand` and `GET /api/brand/logo` are public so the login card is branded before sign-in; logo responses carry nosniff + a locked-down CSP so **an uploaded SVG cannot script this origin**
- Image mime/magic validation extracted to `lib/images.ts` and shared with the avatar upload (which stays raster-only; SVG is opt-in per call site)

</details>

#### LLM Wiki · plugins

<details>
<summary><b>feat(wiki): add + edit raw sources on an existing topic</b> — <code>0cfb7bf</code></summary>

Admins can keep a compiled topic current without recreating it: the file explorer's raw/ tab gets a drop zone (files or whole folders) and an inline editor for existing text sources.

- Server: `PUT /api/wiki/topics/:id/file` writes one raw/ text file in place (path sanitized, text-only, capped by `wikiEditMaxKB`); the existing add-sources POST **no longer auto-recompiles** — uploads are one request per file, so N compiles would race and the inflight guard would drop the ones carrying the later files. The client recompiles once instead
- Config: `wikiSourceEditEnabled` (endpoints 403 + UI hidden), `wikiEditMaxKB`
- Web: `FileExplorer` grows optional `uploadDir`/`onUpload` + `editDir`/`onSave`, so the tree/preview pane is reused instead of a second modal; `WikiExplorer` wires them for admins and shows a "recompile needed" bar. Drag-drop collection moved to `lib/dropfiles` (was duplicated in Sidebar and ImportSessionModal, would have been a third copy)

</details>

<details>
<summary><b>feat(wiki): open the source manager from the sidebar topic row</b> — <code>675711f</code></summary>

The explorer was only reachable from a topic's chat banner, so managing sources meant switching threads first. Admins now get a folder button on every sidebar topic row; the right-click menu mirrors it automatically (`ctxrows` reads the row's buttons), so touch users reach it by long-press.

</details>

<details>
<summary><b>feat(plugins): per-user skill usage counters in the skill detail</b> — <code>4861dae</code></summary>

Count which skills each turn invoked, per user, and surface the numbers where skills already live: expanding a skill in a plugin's detail modal shows the workspace total, the viewer's own count, and (admins only) the per-user breakdown.

- `skill_usage` table: one counter row per (user, skill key), upserted per turn. Keys are recorded raw and matched to a plugin's skills at read time (`skillKey` collapses `plugin:skill`, `plugin/skill` and bare `skill`)
- Both invocation paths counted: a prompt that is a slash command (what the composer palette sends) and Skill / SlashCommand tool calls mid-turn
- `skillUsageEnabled` (default on) gates counting AND the UI; orphan rows of deleted users join the resource-cleanup sweep

</details>

#### PR review — webhooks

<details>
<summary><b>feat(review): webhook-triggered PR review, per-repo secret</b> — <code>2130a27</code></summary>

Providers can push PR events instead of waiting for the poll interval: `POST /api/review/hooks/<repoId>`, authenticated per repo by GitHub HMAC (`X-Hub-Signature-256`), the GitLab secret-token header, or `?token=` for Bitbucket (no secret field of its own). Only PR events poll; comment/push noise is answered 200-and-ignored. Admins issue/rotate/clear the secret from the repo edit dialog (URL + secret with copy + per-provider setup hint).

Also coalesces polls: a request arriving mid-poll re-runs once afterwards instead of being dropped — that hole is fatal for webhook-only deploys with `REVIEW_POLL_MS=0`.

</details>

<details>
<summary><b>feat(review): per-repo polling toggle</b> — webhook-only repos · <code>226aef7</code></summary>

`REVIEW_POLL_MS=0` was all-or-nothing. `review_repos.poll_enabled` lets the interval poller skip individual repos, so a webhook-wired repo stops polling while repos you couldn't wire keep it. Webhook deliveries and the manual "refresh now" still call `pollRepo` directly — only the interval tick honours the flag. Sidebar marks a skipped repo "webhook only".

</details>

<details>
<summary><b>feat(review): decide webhook + polling when registering a repo</b> — <code>716a1f7</code></summary>

The webhook was edit-dialog-only, so every new repo started webhook-less. The add dialog now carries both switches (polling on, webhook off by default), `createRepo` issues the secret when asked, and the URL/secret are shown right after creation — that is when the admin needs them. Asking for a webhook while `reviewWebhook` is off is refused (403), not silently downgraded to a repo whose hook never fires.

</details>

---

## v1.6.0 — 2026-08-04

<sub>release commit `d7af8ef`</sub>

#### Naming imported sessions

<details>
<summary><b>feat: name imported local sessions after their own conversation</b> — <code>cb9cb5e</code></summary>

Transcripts the CLI never named landed as a raw uuid in both the import picker and the resulting chat row. Two layers:

- `listSessions` falls back to a cleaned snippet of the first user message (and reports `custom` so a CLI-set title is never overwritten)
- once the import response is out, each snippet-named chat gets the same model titling pass a fresh chat gets, reading the first few user turns, with the new title arriving over `session:title`

`auto-title.ts` grows `autoTitleImported` on a shared `titleFor` core, and its title sanitizer moves to `lib/session-import.ts` so both callers use it. New knobs: `importAutoTitleEnabled`, `importAutoTitleMessages`.

</details>

<details>
<summary><b>feat(import): make titling a choice on the import screen</b> — <code>b93c07d</code></summary>

Reading each transcript to name it costs one model call per session, so it should not just happen. The screen carries a checkbox (seeded from the user's own auto-naming preference); the server runs the pass only when the request asks for it, and the admin flag still gates whether the choice is offered at all. Without it, imported sessions keep the first-message snippet — still never a raw uuid.

</details>

<details>
<summary><b>feat: manual "name this chat" button</b> — on demand, not only on the first turn · <code>67ee010</code></summary>

Automatic naming fired once, on the first turn of a chat still carrying the placeholder, so any chat past that point was stuck — including every chat imported before the naming pass existed. There is now a ✨ button in the chat header and on each sidebar row, plus a context-menu row next to Rename.

`retitleSession` deliberately drops the guards `maybeAutoTitle` needs: **pressing the button IS the request**, so neither the placeholder title nor the user's preference gates it, and it overwrites what is there. It reads several turns instead of just the first, since a conversation that already ran is not described by its opening message, and it throws a reason the UI shows (no auth, nothing said yet, not a private chat) rather than failing quietly the way the automatic path must. The header button is the one that works on a phone.

</details>

#### Import integrity

<details>
<summary><b>fix(import): drop the CLI's own inserted lines from imported transcripts</b> — <code>d105d33</code></summary>

An imported session ended with a raw `<local-command-caveat>` block: the CLI files its own injected lines as `type:"user"`, and `jsonlToMessages` only skipped `isSidechain` and the meta *types*, so `isMeta` lines came through as real chat messages. Slash-command wrappers and captured local-command stdout landed the same way.

Both are dropped at the one place every caller routes through, so the message rows and the generated title are clean. A line is only discarded when nothing but the tags is left — a genuine message that merely quotes one survives.

</details>

<details>
<summary><b>fix(import): make an imported <code>/clear</code> or <code>/compact</code> fold the history above it</b> — <code>0c06e3f</code></summary>

Chat.tsx folds a segment when a user message starts with `/clear` or `/compact` — the plain form our own composer sends. The CLI files the same action as `<command-name>/clear</command-name><command-args>…</command-args>`, which never matched, so an imported session showed those raw tags instead — and once the inserted lines were filtered out, nothing at all — with no fold.

Slash-command lines are rewritten to `/name args` on import; `userTexts` skips them, so a command can never become the generated title.

</details>

<details>
<summary><b>feat(import): flag already-imported sessions, pick overwrite or clone per session</b> — <code>b74f044</code></summary>

Nothing keyed `chat_sessions` by `claude_session_id`, so re-importing a folder silently produced a second copy of every session it already held. The staging list now reports `dup` for transcripts this user owns; the picker badges them and puts an Overwrite / Add a copy select on each row.

Overwrite reuses the existing chat id — its messages are replaced and it re-points at the freshly uploaded project — so links and history survive. The select sits outside the row label, since inside it every interaction would toggle the checkbox. The demo router serves a seeded list with two duplicates.

</details>

<details>
<summary><b>feat(import): choose overwrite or clone for the project too</b> — <code>1376bd7</code></summary>

The project half always cloned: a name collision quietly became `myproj-2` and a second projects row, so re-importing left two copies of the same working dir. The picker flags a name the user already owns and offers the same choice.

Overwrite reuses that row and path — the upload is copied OVER it, so files at the same path are replaced and everything else survives. Deliberately not a wipe: `.git`, untracked work and editor state live in that directory. Sessions imported alongside then resume against the existing path, since the slug is derived from it.

</details>

<details>
<summary><b>feat(import): choose whether overwriting keeps or deletes the files</b> — <code>335fa6b</code></summary>

Overwriting always merged, so a re-import of a moved project leaves stale files behind forever. The picker now asks, next to the overwrite choice: keep (merge, unchanged) or delete (empty the folder first).

Delete is never the default, only runs when there are files to put back, and its hint switches to a warn-coloured warning naming what goes: the `.git` history and any uncommitted work. The directory itself is kept rather than recreated, since a code-server container may have it mounted and the path is recorded in the projects row.

`emptyProjectDir` refuses any path not strictly under the caller's own projects root — the path comes from our own row, but the operation cannot be undone, so it is guarded rather than trusted.

</details>

<details>
<summary><b>fix(import): settle the project on the step that uploads it</b> — <code>fc6b082</code></summary>

The project name and its overwrite/clone choice sat on the final step, after the `~/.claude` folder pick — but the project is already uploaded when the tree step ends. Skipping the session folder was worse: the flow then asked for a name by hand at the end, for a project that had been on disk since the previous step.

The name is now asked on the tree step, prefilled from the folder the user actually picked (`stripRoot` already knew that name and threw it away). The final step just recaps "Project: x · Overwrite". The transcript's own cwd tail stays as a fallback for a flat multi-file drop.

</details>

#### Git

<details>
<summary><b>feat(git): git init and publish a project that is not a repository yet</b> — <code>9519395</code></summary>

An imported project lands as plain files, so its Git panel was a dead end. The panel now offers both ways out: init alone, or publish (init → first commit → create the repository on the provider through the credential the user already registered → push). A pasted URL skips creation, and is the only route for a provider whose API we do not speak.

Repo creation lives in `lib/git-publish.ts` (GitHub incl. Enterprise, GitLab, Bitbucket); `git-ops` gains `gitInit`/`gitHasCommits`/`gitSetOrigin`, all no-ops on the parts already done, so publishing an already-tracked project never rewrites its history. The remote is wired up only after creation succeeds.

Credential ids from the body are re-checked against the caller (user-scoped credentials resolve only for their owner). Knobs: `gitPublishEnabled` (gates the endpoints, not just the buttons), `gitInitBranch`.

</details>

<details>
<summary><b>feat(git): manual remote management per project</b> — <code>7dd4e90</code></summary>

The panel could only ever talk to whatever origin a clone happened to have. It now lists the project's remotes and lets you add, retarget and remove them — collapsed by default. Every mutation returns the fresh list and reloads the panel's status, because retargeting origin also changes which credential push resolves to.

`git remote add` takes no `--` separator, so names and URLs are **validated rather than escaped**: a leading `-` would be read as a flag. URLs are restricted to http(s)/ssh/git and scp-like `user@host:path` — a bare local path or `file://` is rejected on purpose, since as a remote it would let one user fetch out of another user's project directory, and git's `ext::` transport runs a command. `lib/git-ops.test.ts` covers those cases; the publish route validates its pasted URL through the same function.

Also fixes the branch row overflowing the dialog at 375px, and lets a remote's URL field take its own line on a phone.

</details>

---

## v1.5.0 — 2026-08-04

<sub>release commit `17a1e3a`</sub>

<details>
<summary><b>feat: auto-fetch the model list from the provider's <code>/v1/models</code></b> — <code>c5c5f5d</code></summary>

Frontier model ids change often, so the hardcoded `models` map goes stale. The server pulls the live list (newest first, capped by `modelsMax`) from the configured provider — api.anthropic.com or a custom base URL — and writes it back into the same `models` config every consumer already reads. Runs at boot + on `modelsRefreshMs`, or on demand from the admin panel's [Fetch now].

`defaultModel`'s select options now track that map instead of a frozen array, so a freshly fetched id is selectable.

</details>

<details>
<summary><b>feat: auto-resume a turn when the claude.ai 5-hour window resets</b> — <code>7bc5495</code></summary>

A turn that dies on the plan limit (5-hour / weekly) is not a transient 429, so `withRateLimitRetry` cannot help and the prompt was simply lost. It is now parked in a new `pending_resumes` table, the composer shows the scheduled retry time (cancellable), and the server re-enqueues it once the window reopens. Timers are re-armed at boot, so a restart inside the wait does not drop the prompt; rows overdue by more than `autoResumeStaleMs` are discarded instead of replayed.

**Claude-subscription only by construction**: eligibility requires `CLAUDE_CODE_OAUTH_TOKEN` in the resolved provider env, so API keys and bedrock/vertex/custom providers are never parked. Review sessions are excluded too — they run unattended under an admin's auth and have their own watchdog.

Opt-in per user on My Page (`users.auto_resume`, default off: it runs unattended hours later); admin `autoResume*` keys gate it workspace-wide and tune grace/attempt/pending/stale limits. The demo fakes the whole loop on a `!limit` prefix.

</details>

<details>
<summary><b>feat: keep the 5-hour window open with a primer query</b> — <code>7db52ae</code></summary>

The window is not a wall clock: it opens on the first billed message and closes 5 hours later. Idle after a reset and that time is simply gone — sit out an hour and you get 4 usable hours, not 5.

For users who opt in, a per-user scheduler probes the live window and, when none is open, sends one tiny throwaway query (cheap model, tools denied, hard timeout) to open it, then sleeps until that window's real `resets_at`. It is not a chat session: no `chat_sessions` row, no messages, nothing in the sidebar — just a short-lived CLI subprocess in the user's project dir, billed as one `usage` row so the cost stays visible.

Same Claude-subscription gate as auto-resume. An unreadable probe retries on `windowPrimerRetryMs` rather than guessing, so a bad guess never spends a message for nothing. Opt-in on My Page (`users.prime_window`, default off — it spends quota) with the last prime time shown live over a `user:primed` socket event; admin `windowPrimer*` keys tune model/prompt/grace/retry.

</details>

---

## v1.4.0 — 2026-08-03

<sub>release commit `5e7a59b`</sub>

#### Unified search

<details>
<summary><b>feat(search): workspace-wide unified search <code>Ctrl/Cmd+K</code></b> — <code>37033e9</code></summary>

One endpoint + one palette across every internal surface: private chats, shared room chats, DM/group messages, projects, LLM Wiki topics and their compiled/raw documents, PR review sessions, and the user directory.

- Visibility reuses each feature's own gate instead of re-deriving it (`canViewChat` semantics, `rooms.isMember`, projects `canAccess`, `listReviewSessionsForUser`, dm membership) — DMs stay membership-only even for admins
- Message matching flattens the stored content JSON so prose, tool names, tool inputs and tool outputs are all searchable
- Clicking a hit lands where the sidebar would: the thread opens and scrolls to the matched message with a ring (folded `/clear`|`/compact` blocks auto-open); project and wiki-file hits open a FileExplorer straight on the file
- Admin config: `searchEnabled` (hard-404s the API + hides the UI), `searchMaxPerType`, `searchFileMaxKB`, `searchScanMaxFiles`

</details>

<details>
<summary><b>feat(search): sort by type (default) or one newest/oldest timeline</b> — <code>0b71232</code></summary>

Grouped stays the default (one section per surface, newest-first inside each). The two time modes flatten every surface into a single list, each row carrying its own type badge; undated hits (people, wiki documents) trail the list in both directions instead of pretending to be the oldest.

**Oldest-first also needs the server to pick candidates from the other end**: the per-type cap would otherwise hand back each surface's newest rows for the client to reverse, so the genuinely oldest hits never left the DB. Added `?sort=newest|oldest`, honoured by every time-ordered collector before capping.

The choice persists per browser (localStorage `searchSort`). A row's snippet is constrained to the row width — items-start let a long path/CJK run size to content and overflow the palette on a phone.

</details>

- **docs: note the search sort options** — `b5ca545`

<details>
<summary><b>feat(search): time-only sort + per-feature filter tabs</b> — <code>e5f86ed</code></summary>

The grouped-by-type mode is gone. Results are always one newest/oldest timeline; narrowing happens through filter chips under the sort control: all · personal · rooms · DM · projects · LLM Wiki · PR reviews · people, each with its hit count, and only surfaces that actually matched get a chip.

Tabs are per **feature**, not per hit type — a message inside a room files under "rooms", the same shape inside a wiki thread files under "LLM Wiki" — resolved from `nav.kind`, which already records the surface a chat hit came from. Every row keeps its type badge now that there are no section headers. Switching sort refetches (the server still picks candidates from the chosen end), and a filter the new query has nothing for falls back to "all".

</details>

<details>
<summary><b>fix(search): scope candidate rows to the caller before the per-type cap</b> — <code>1a976f9</code></summary>

Visibility was already correct (the in-memory `chats` map is the gate; an audit with a throwaway member account confirmed no cross-user leak), but the private-title collector ran its LIKE + LIMIT over every user's `chat_sessions` and only dropped invisible rows afterwards — so on a busy workspace a member's own matching chats could be pushed off the end of the limit by rows they can never see.

Owner-scoped in SQL for members (admins keep the cross-user view they already have through `canViewChat`). The message prefilter gets the same escape hatch when someone's visible-session list is too large to bind as an IN list, so a huge account degrades to a wider scan instead of a SQLite parameter error.

</details>

<details>
<summary><b>fix(search)!: never let an admin search another user's personal space</b> — security · <code>87ccb9b</code></summary>

`canViewChat`/`canAccess` let an admin open a single private thread or a user-scoped project directly, and search inherited that. **Opening one thread on request and grepping every user's private conversations at once are not the same permission**, so search no longer takes the admin shortcut:

- private chats and wiki query threads: owner only, admins included (`visibleChats` loses its isAdmin branch, and the title query is owner-scoped in SQL)
- user-scoped projects: owner only
- messages: always prefiltered to the caller's own visible sessions, so an admin's query never reads another user's private messages off disk at all
- DMs were already membership-only

Shared surfaces are untouched: rooms the caller belongs to, room-scoped projects, PR review sessions, the LLM Wiki knowledge base, the user directory. Single-item endpoints keep their existing gates — this narrows search only. Verified against the running container with a throwaway member account: the member's own private session and project are found by them (2 hits) and by the admin not at all (0 hits, also with `types=` forced).

</details>

#### Interaction · shortcuts

<details>
<summary><b>feat(web): keyboard shortcuts for the core actions, keyed per platform</b> — <code>bd9b76a</code></summary>

One table (`SHORTCUT_GROUPS`) drives both the global handler and the `?` cheat sheet, so a listed binding always works. Keys render the way each platform writes them (⇧⌘O on a Mac, Ctrl+Shift+O elsewhere).

Mod+K / Mod+/ search, Mod+Shift+O new chat, Mod+B sidebar (drawer `<md`, column `≥md`), Mod+Shift+H home, Mod+Shift+L theme. `?` opens the cheat sheet only outside a text field, so typing one in a message never triggers it; an open dialog owns the keyboard. `Esc` in the composer interrupts the running turn once no menu is open. Buttons carry their shortcut in the tooltip; the sidebar footer gets a Shortcuts row; the hardcoded `search.shortcut` ('Ctrl+K') is dropped for `fmtKeys`.

</details>

<details>
<summary><b>feat(web): the app owns right-click</b> — its own menu, Shift for the browser's · <code>733c583</code></summary>

One window listener claims `contextmenu`, so a right-click anywhere lands on workspace actions: new chat, search, sidebar, theme, reload, plus clipboard rows when the click hit a field, a selection or a link. Surfaces with better items attach their own (sidebar rows, chat messages) and the global handler stands down for anything already default-prevented.

Escape hatch: hold **Shift** while right-clicking — we never preventDefault then, so the browser's own menu comes through untouched (Firefox / VS Code convention). Listed in the shortcut sheet and the menu's own footer; admins can disable the whole thing with `customContextMenu`.

Mod+B's sidebar logic moves into a shared `toggleSidebar()`, and the sidebar's rename/delete prompts into named handlers, so the hover buttons and the menu rows run the same code instead of two copies.

</details>

<details>
<summary><b>feat(web): collapsible left sidebar on desktop</b> — <code>607e460</code></summary>

The sidebar column can be hidden (persisted in localStorage). The existing header hamburger doubles as the expand control: always visible `<md` for the drawer, visible `≥md` only while collapsed.

</details>

- **feat(web): the logo returns to the landing screen, with search in its centre** — `a943777`
- **fix(web): sidebar header no longer hides the language toggle behind the title** — `f2fb154`
- **fix(web): move the language switch to the sidebar footer so the title fits** — `a35a08d`

<details>
<summary><b>refactor(web): pick the language from a list instead of a two-way toggle</b> — <code>965f4be</code></summary>

A toggle only works while there are exactly two languages, so it was the wrong control for a UI that will gain more. Driven off `LANGS` instead:

- `LangSelect` (native `<select>`, options from LANGS) replaces `LangToggle`, used in the sidebar footer and on the login page
- `Lang` is derived from LANGS, and `detect()` validates the stored/browser value against LANGS instead of branching on `'ko'`/`'en'`
- `toggleLang` dropped; `lang.toggleTitle` becomes `lang.pickTitle` (ko + en), which also stops baking the language list into a translated string

Adding a language is now one LANGS entry + its label + its dictionary (DICT is typed per-Lang, so tsc points at what's missing).

</details>

#### Session names · build

<details>
<summary><b>feat: name a fresh chat after its topic, toggleable per user</b> — <code>663b859</code></summary>

A new private chat kept its placeholder title until someone renamed it. Once the first turn finishes, the server asks a cheap model for a one-line title and pushes it to every client over `session:title`. Only chats still carrying the placeholder are touched, so a name the user chose always wins; no auth or a failed/timed-out call falls back to truncating the first message.

Off is one checkbox on My Page (`users.auto_title`), and admins can drop the whole thing with `autoTitleEnabled` — model, length cap and timeout are registry keys too. The static demo mirrors the flow with a canned title.

</details>

- merge: `feat/auto-session-title` — `bca1272`

<details>
<summary><b>chore: local compose rebuilds clean up after themselves</b> — <code>94ce165</code></summary>

`docker compose up -d --build` leaves the previous image dangling every time — it loses the :latest tag but keeps its layers. Build + `docker image prune -f` are wrapped in one script and CLAUDE.md's release workflow points at it, so no session has to remember the cleanup step.

Prune only touches dangling images: tagged versions, running containers, volumes and the build cache stay.

</details>

---

## v1.3.1 — 2026-08-03

<sub>release commit `0f736c0`</sub>

<details>
<summary><b>fix(privacy): master switch overrides and locks the per-channel toggles</b> — <code>f1cfd57</code></summary>

Two problems with the panel as shipped. A bare checkbox next to "Usage telemetry" does not say whether ticking it sends the data or blocks it, and the master switch read as "block everything" while actually being an AND gate — so turning it on left nine live-looking checkboxes underneath that could each appear to undo it.

Master is now an **OR override**: on = every channel blocked, per-channel keys ignored, and those rows render locked (greyed, disabled, effective state shown) with a line naming the switch holding them. Turn it off to choose channel by channel; with the master and every channel off, nothing is blocked and the inherited env is untouched, as before.

The lock is driven by a new `disabledWhen` field on `ConfigDef` rather than the view special-casing the privacy group, so the registry stays the single source of truth. Every label now reads "Block …" and the group carries a "checked = blocked" hint, so a tick can only mean one thing.

</details>

---

## v1.3.0 — 2026-07-31

<sub>release commit `68e920c`</sub>

<details>
<summary><b>feat(privacy): per-channel toggles for non-essential Anthropic egress</b> — <code>1e62f66</code></summary>

The single master switch stayed, but an operator who wants exactly one channel back (metrics into their own OTel collector, say) had to give up all of them.

`privacy.ts` now describes each channel as data — key, env it pins, inherited vars it strips, settings it merges, and whether the umbrella variable covers it — and `privacyPlan()` resolves the master plus the nine per-channel keys into one plan the two spawn points apply. `on` is passed in rather than imported so the module stays DB-free and the self-check can drive it directly.

`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is only emitted while every channel it covers is still on: it blocks telemetry, error reports, the survey and the updater wholesale, so setting it next to a deliberately re-enabled channel would have quietly overridden the operator. Master off still leaves the inherited env completely untouched.

Descriptions live in i18n (`cfgDesc.<key>`, ko + en) and name what leaves the machine, not just the env var.

</details>

---

## v1.2.0 — 2026-07-31

<sub>release commit `de73205`</sub>

#### Privacy

<details>
<summary><b>feat(privacy): block all non-essential Anthropic egress by default</b> — <code>1e8f69f</code></summary>

Every agent turn spawns the Claude Code CLI, which by default also talks to Anthropic outside the inference request: usage telemetry, error reports, `/feedback` + `/bug` + `/share` (these upload the whole transcript incl. code), the session-quality survey and its transcript-upload follow-up, non-essential model calls, auto-updater pings, the WebFetch domain preflight (sends the hostname to api.anthropic.com), Artifact publishing, official-marketplace auto-install and OpenTelemetry export.

New `server/src/claude/privacy.ts` holds every opt-out in one place and is applied at the two spawn points: `buildOptions()` (env pinned **last** so nothing upstream can reopen a channel, plus `skipWebFetchPreflight` via the SDK flag-settings layer, which is a setting rather than an env var) and the code-server container spec, so a `claude` run from the editor terminal is covered too. Inherited OTel/tracing endpoints and headers are stripped, not just overridden.

Gated by `blockNonessentialTraffic` (default on, `BLOCK_NONESSENTIAL_TRAFFIC`); off leaves the inherited env untouched so a deliberate OTel collector still works. The inference request itself is never affected — LLM Provider = custom remains the way to remove that too.

</details>

#### README

<details>
<summary><b>docs(readme): fully-local run stack + recommended specs</b> — 5 commits · <code>7d123d5</code> <code>b39d856</code> <code>1adfd4b</code> <code>fcb675c</code> <code>8e84bff</code></summary>

- `7d123d5` recommended specs (CPU/RAM/disk/arch/network)
- `b39d856` a "fully local" section (`ANTHROPIC_BASE_URL` → LiteLLM/local model, no api.anthropic.com) and a note that local-LLM GPU/VRAM is separate from app specs
- `1adfd4b` copy-paste compose for offline operation (Ollama + LiteLLM + app); the app points at the local Anthropic-compatible gateway via LLM Provider (custom)
- `fcb675c` a docker run variant of the same stack
- `8e84bff` correction — Ollama ≥0.14, vLLM, LM Studio and llama.cpp expose `/v1/messages` natively, so Claude Code connects directly via `ANTHROPIC_BASE_URL`. LiteLLM dropped from the default local stack (kept only as fallback)

</details>

<details>
<summary><b>docs(readme): re-recorded demo GIF · TOC · badge · GFM strikethrough fix</b> — 4 commits · <code>c24608c</code> <code>b0ec001</code> <code>2d3526a</code> <code>fe74580</code></summary>

- `c24608c` the old hero GIF was from an early build. Re-captured from the current VITE_DEMO app: team room + presence, streaming turn, in-browser tool approval, tool run, Split into code-server. English UI, 1200px
- `b0ec001` a top-level TOC after the hero in both READMEs, anchors verified against GitHub's rendered slugs
- `2d3526a` Docker ≥26 badge in the header
- `fe74580` `4~8` / `~20~30` parse as `~strikethrough~` on GitHub → replaced with en dashes

</details>

<details>
<summary><b>feat(release): default to amd64, add <code>--arm</code> for occasional multi-arch</b> — <code>0a97718</code></summary>

arm64 emulated builds take ~20–30m on this host, so release builds amd64 by default; pass `-- --arm` to also publish linux/arm64.

</details>

---

## v1.1.1 — 2026-07-31

<sub>release commit `6d2d8c5`</sub>

<details>
<summary><b>docs(dockerhub): repo overview page + per-shell run commands</b> — <code>5ea9258</code></summary>

`DOCKERHUB.md` (Hub overview with GitHub link, bash/PowerShell/CMD run blocks), `scripts/hub-description.mjs` + `npm run hub:desc` to push the overview via the Hub API, and the README's docker run split into bash/zsh, PowerShell and CMD variants.

</details>

<details>
<summary><b>feat(release): multi-arch build via buildx</b> — linux/amd64 + linux/arm64 · <code>d5b1956</code></summary>

`release.mjs` uses `docker buildx build --platform … --push` and auto-creates a docker-container builder (`ccw-multi`) if missing. Override arches with `PLATFORMS`.

</details>

---

## v1.1.0 — 2026-07-31

<sub>release commit `8d01636`</sub>

<details>
<summary><b>feat(release): version + Docker Hub image publish pipeline</b> — <code>8102e6a</code></summary>

`scripts/release.mjs` builds & pushes `:version` / `:latest` / `:sha-<short>`; `npm run release[:patch|:minor|:major]` (npm version bumps + git tag); the compose `APP_IMAGE` param pulls the published image; CLAUDE.md rule 3 + the READMEs document the release step.

</details>

<details>
<summary><b>feat(deploy): standalone <code>docker-compose.hub.yml</code> for clone-free runs</b> — <code>ecfe492</code></summary>

Pull-only compose (no `build:`) so users run the published image with a single downloaded file. The READMEs document the curl + up flow.

</details>

<details>
<summary><b>feat(codeserver): self-provision the network so a single <code>docker run</code> works</b> — <code>7ee811c</code></summary>

`ensureNetwork()` creates the code-server network and attaches the app container on boot. No-op under compose.

</details>

---

## Early development — 2026-07-20 → 07-31

144 commits before the first version tag. The build followed the **P0–P5 stages** in section 14 of [DESIGN.md](DESIGN.md); axes the design never mentioned arrived after that.

### 07-20 — the P0–P5 skeleton (straight from the spec)

<details>
<summary><b>P0 skeleton</b> — scaffold · DB · auth · <code>b536aac</code> <code>f043752</code> <code>6c155d3</code></summary>

- `b536aac` monorepo scaffold, Docker deploy (compose · single image · socket mount · named volume), build config
- `f043752` SQLite/Drizzle schema, DDL init, path/settings/id utils
- `6c155d3` scrypt auth, revocable DB sessions, account provisioning

</details>

<details>
<summary><b>P1–P4 core</b> — SDK runner · rooms · code-server · plugins · <code>545efb6</code> <code>47153ef</code> <code>6d8dcdf</code> <code>f7c1a44</code></summary>

- `545efb6` **P1** per-session SDK runner, streaming, `canUseTool` web permission bridge, global throttle + 429 backoff, usage tracking
- `47153ef` **P4** shared rooms (owner/delegation), FIFO queue + cancel, Socket.IO fanout/presence
- `6d8dcdf` **P2** dockerode spawn/reap, scoped volume-subpath mounts, in-app http+ws proxy
- `f7c1a44` **P3** two-class plugin manager (common/personal, git + tarball, forced/preferred)

</details>

<details>
<summary><b>API + web shell</b> — full REST surface · React SPA · <code>6e6e220</code> <code>4fc95f4</code></summary>

- `6e6e220` REST routes (sessions/rooms/projects/plugins/admin) + Fastify entrypoint
- `4fc95f4` React SPA — chat/tool-cards/permission prompts, rooms, editor split, admin + plugins panels

</details>

<details>
<summary><b>Four early stabilizations</b> — code-server container lifetime · blank editor · <code>b611365</code> <code>f6a0e5c</code> <code>de41ba9</code> <code>0dcc963</code></summary>

- `b611365` remove a user's editor containers on logout
- `f6a0e5c` wait for code-server to bind `:8080` before returning the URL — avoids the iframe 502 race
- `de41ba9` editor-only view rendered in a 0-width grid column, so the editor was blank
- `0dcc963` remove orphaned editor containers on boot — untracked survivors were never reaped

</details>

<details>
<summary><b>Open-sourcing · branding</b> — README · LICENSE · icon · i18n README · <code>219f1d1</code> <code>85207d9</code> <code>5642b85</code> <code>bfb51ba</code> <code>96a98c6</code></summary>

- `219f1d1` polished OSS README (strengths / architecture mermaid / badges) + MIT LICENSE
- `85207d9` live demo GIF (chat · web tool approval · code-server split)
- `5642b85` app icon (clay spark favicon.svg) + PWA manifest + theme-color
- `bfb51ba` original app icon (split-workspace mark) across favicon, in-app logos, README
- `96a98c6` i18n README — English (default) + Korean with a language switcher

</details>

### 07-21 — the LLM Wiki (a fourth entity the design never had)

<details>
<summary><b>feat(server): route OAuth tokens vs API keys, wrap plugins, permission answer channel</b> — <code>2b7d42a</code></summary>

`sk-ant-oat*` via `CLAUDE_CODE_OAUTH_TOKEN`, `sk-ant-api*` via `ANTHROPIC_API_KEY`; plugins wrapped as `{type:'local',path}`; isolation roots / `additionalDirectories`. AskUserQuestion selection delivered back to Claude via deny+message (answer channel), emitting `permission:resolved`/`answered`. `.env.example` gains the bootstrap admin + key notes.

</details>

- **fix(web): chat pane scroll + grid layout `minmax(0,1fr)`** — `8519167`

<details>
<summary><b>feat(projects): create a project by git clone</b> — <code>8f5324e</code></summary>

`POST /api/projects` accepts an optional `gitUrl` → clone (execFile, no shell) instead of mkdir. Validates http(s)/git/ssh (blocks `file://`), derives the name from the URL, `GIT_TERMINAL_PROMPT=0` so private repos fail fast, cleans the partial dir on failure.

</details>

<details>
<summary><b>feat(wiki): LLM Wiki tab</b> — admin topics · per-user query threads · folder upload · <code>af18dd4</code></summary>

`wiki_topics` table + `chat_sessions.wiki_topic_id` + compile status columns (guarded ALTER migrations), topic dirs and wiki cwd resolution (the session list excludes wiki threads), `routes/wiki.ts` (topic CRUD with admin-only create/delete, get-or-create per-user thread, staged upload = upload → deletable list → confirm/cancel, folder drag&drop with recursive all-depth paths, CLAUDE.md grounding), raised multipart `fieldNameSize`, staging reaped on boot, queries blocked while a topic compiles.

Web: the Wiki sidebar section + `WikiCreateModal` (drop zone, progress bar, staged list), `WikiBanner`, store/socket state and `api.uploadProgress`.

</details>

<details>
<summary><b>feat(wiki): full compile pipeline</b> — raw sources → synthesized articles + <code>_index</code> · <code>9bc2159</code></summary>

`compileTopic()` runs Claude (acceptEdits + always-allow `canUseTool`) over `./raw/` to produce cross-linked `./wiki/` articles with confidence and a hierarchical `_index.md`. Auto-runs on create/add-file, manual recompile button, single-flight guard, empty/mock → instant done. Status (idle|compiling|done|error) + a live per-step heartbeat broadcast over `wiki:status`/`wiki:progress` so it never looks hung.

</details>

<details>
<summary><b>feat(wiki): <code>raw/</code> immutable fence + file-tree & single-file endpoints</b> — <code>3c742b7</code></summary>

The compile `canUseTool` denies Write/Edit under `raw/` (originals stay immutable even if the agent misbehaves), `wiki/` output only. `GET …/tree` → `{raw, wiki}` paths + sizes (no content), `GET …/file?dir=raw|wiki&path=` → one file's text.

</details>

<details>
<summary><b>feat(wiki): tree file explorer for topic files</b> — raw + compiled · <code>1367783</code></summary>

A `WikiBanner` button opens a modal: raw/wiki toggle, collapsible folder tree built from relative paths, lazy per-file viewer. Shows all uploaded originals (incl. nested + binaries) so nothing looks lost after compile.

</details>

<details>
<summary><b>fix(wiki): preserve unicode (Korean/NFD) folder names on upload</b> — <code>14a8a1f</code></summary>

`safeFile`'s `[가-힣]` whitelist matched only precomposed NFC syllables, so macOS-decomposed (NFD) Hangul jamo were stripped — a pure-Korean folder became `''` (inner files fell to the parent) and Korean+alnum lost the Korean part.

Replaced with `safeSeg`: NFC-normalize + strip only path separators/control chars, keep all unicode. Verified nested Korean/mixed paths survive.

</details>

<details>
<summary><b>feat(wiki): delete topic files on disk + sweep orphaned dirs at boot</b> — <code>91460d1</code></summary>

Topic delete now rm's the topic dir (raw/ + wiki/), not just the DB row. `reapWikiOrphans()` removes any `/data/wiki/<id>` with no DB row at boot (cleaning leftovers from the old keep-files behaviour). The confirm dialog warns files are permanently deleted.

</details>

<details>
<summary><b>feat(wiki): include images in compile (multimodal) + query grounding</b> — <code>2e315ce</code></summary>

Images were not code-excluded, but the prompt never mentioned them so they were effectively ignored — and at query time grounding points at text `wiki/`, so `raw/` images were unreachable.

Compile now reads images (.png/.jpg/.gif/.webp) via the multimodal Read tool and transcribes/describes diagrams + screenshots into the articles with source citation; grounding tells the query agent to open `raw/` images directly for visual questions. Verified: a red/blue test image was read and described (confidence high).

</details>

<details>
<summary><b>feat(wiki): image preview + markdown render toggle in the file explorer</b> — <code>a89e08e</code></summary>

`GET …/blob` streams raw bytes with an image content-type (same-origin cookie auth) for `<img>` preview; the markdown renderer is extracted to `lib/md.ts` (shared by chat + explorer); image files render as `<img>`, `.md` gets a rendered/raw toggle, other text stays raw.

</details>

<details>
<summary><b>fix(md): proper block-level markdown renderer</b> — chat + wiki preview · <code>03bae9a</code></summary>

The old renderer turned every newline into `<br/>` (huge gaps between blocks) and had no hr/table/h4-6/strikethrough/task-list support.

Rewritten as a block parser: headings 1–6, hr (`---`/`***`/`___`), blockquote, fenced + inline code, ul/ol (split on ordered switch) + task items, GFM tables, images, paragraphs with soft breaks (block margins, not `<br/>` spam). Escape-first so still XSS-safe; NUL-sentinel placeholders so digits/spaces in text are never corrupted; blockquote/list detection runs post-escape (matches `&gt;`). Verified across all syntaxes.

</details>

<details>
<summary><b>feat(chat): copy buttons for answers/code blocks + project file explorer</b> — <code>1e143de</code> <code>dfb89f1</code></summary>

- `1e143de` a message hover control copies an answer (assistant text blocks joined, tool cards excluded; user messages copy their text), and every markdown code block gets a copy button via one delegated click listener (content is `dangerouslySetInnerHTML`, so no React onClick), reading `pre code` textContent to copy the decoded source. The non-rendering ⧉ glyph replaced with 📋
- `dfb89f1` a Files button on project chats opens a tree+preview modal like the wiki explorer; the wiki explorer's shared tree/preview is extracted into a generic `FileExplorer` that `WikiExplorer` now wraps. New endpoints `GET /api/projects/:id/tree|file|blob` (bloat dirs skipped, 5000-file cap, path-traversal guarded, binary/large files not previewed)

</details>

### 07-22 — per-user tokens · i18n · static demo · git commit/push

- **docs: add CLAUDE.md with workflow rules** — `aed6b6e`

<details>
<summary><b>feat(token): per-user encrypted tokens + per-author resolution</b> — 3 commits + merge · <code>d06bde9</code> <code>8310b93</code> <code>37cddf9</code> <code>ee0a3d8</code></summary>

- `d06bde9` `secret-box` (AES-256-GCM at-rest), `users.claude_token_enc`/`_set_at` columns + idempotent migration, `claude-token` (set/clear/meta for user + admin common token, `resolveClaudeAuth`), config gains `forceMock` + `tokenEncSecret`; `anthropicApiKey` demoted to legacy fallback
- `8310b93` `buildOptions` injects the resolved per-author token and scrubs stray host keys; `runTurn`/`probeCommands`/wiki-compile resolve per author/creator; a per-turn mock when no token resolves (replacing the global `mockClaude`); `PUT/DELETE /api/auth/me/claude-token`; `/me` and `/login` expose token status; `POST /api/users` accepts `claudeToken`; admin common-token endpoints
- `37cddf9` `MyTokenModal` (self-service register/update/clear + nag variant), sidebar entry with an unregistered badge, a nag modal each login until a token is registered, AdminPanel common-token section + optional token on user creation, `.env.example` gains `TOKEN_ENC_SECRET` + token precedence docs
- `ee0a3d8` merge

</details>

<details>
<summary><b>feat(plugins): detail (manifest + skills) · file tree · update API</b> — <code>bb43660</code> <code>4cc47f7</code></summary>

- `bb43660` `lib/filetree.ts` extracts `walkFiles`/`resolveUnder`/`IMG_CT` shared by projects + plugins; `GET …/detail` → plugin.json manifest + `skills/*/SKILL.md` frontmatter; `GET …/{tree,file,blob}`; `POST …/update` → git fetch+reset to remote HEAD (marketplace only); `canViewPlugin` (common visible to all, user-scoped to owner/admin)
- `4cc47f7` plugin detail modal — skills list, file tree, update

</details>

<details>
<summary><b>feat(wiki): import an already-compiled wiki, skipping compile</b> — <code>432ec46</code></summary>

A "precompiled" option treats the uploaded folder as a finished wiki instead of raw sources: staged files are placed under `wiki/` (and `raw/` when a topic-export folder carries both), the topic is marked `compileStatus=done`, and the Claude compile step is skipped entirely. `mapPrecompiled()` normalizes the staged tree (strips the wrapper folder, routes `wiki/*`+`raw/*` for topic exports, else all → `wiki/`).

</details>

<details>
<summary><b>feat(web): i18n, Korean + English</b> — 3 commits + merge · <code>a42a7b1</code> <code>fbf6c2d</code> <code>23476b6</code> <code>c057788</code></summary>

- `a42a7b1` a self-contained module (`web/src/lib/i18n.ts`): lang state + localStorage persistence + `useSyncExternalStore` subscription, `t()`/`useT()`, ko/en dictionaries (~230 keys). Default: localStorage → `navigator.language` → ko. `LangToggle` in the chat header and login page; all Korean UI strings externalized across 12 components + App/store/ui; `{name}` interpolation
- `fbf6c2d` toggle moved to the sidebar top (global) — visible on chat, plugins and admin; the redundant chat-header toggle removed
- `23476b6` float `LangToggle` absolute top-right so the fixed 264px sidebar title no longer wraps in EN
- `c057788` merge (Sidebar.tsx conflict resolved)

</details>

<details>
<summary><b>docs: standing rules for i18n + README upkeep, and a README refresh</b> — <code>b05471d</code> <code>7c3b6b1</code></summary>

- `b05471d` CLAUDE.md rule 6 (all user-facing strings go through i18n, ko+en keys) and rule 7 (meaningful new features go in both READMEs)
- `7c3b6b1` token precedence (personal → admin-common → env → MOCK) as a strength, feature section, `.env` note and checked-off roadmap item; structure section gains `src/wiki`, `src/auth`, `src/usage`, web i18n

</details>

<details>
<summary><b>feat(web): fold conversation history at <code>/clear</code> and <code>/compact</code></b> — <code>d075c12</code></summary>

Each `/clear` or `/compact` user message closes a segment; the conversation above it collapses into a timestamped, per-command toggle (default folded), so folds stack as the two commands accumulate. Purely a render pass over the persisted message list — history is never lost, just tucked away.

</details>

<details>
<summary><b>feat(web): LLM Wiki cited-sources panel, resizable, markdown fixes</b> — <code>0e6d4e7</code> <code>b0f9a4b</code> <code>30fb4c3</code> <code>fac5d3f</code> <code>e5aed82</code></summary>

- `0e6d4e7` a right-side panel per wiki thread listing the files each answer drew on (grouped wiki / raw). Sources come from the turn's Read tool calls plus `wiki/`//`raw/` paths the model names in prose. Mentions are wrapped as `<mark>` citations with two-way hover highlighting; clicking previews the file in place. Written paths are approximate (the model collapses whitespace), so the preview resolves a cited path onto a real tree entry by normalized basename before fetching, and fails gracefully inline on a true miss
- `b0f9a4b` a drag handle on the panel's left edge resizes it (clamped 300–1000px, persisted), default widened to 360px
- `30fb4c3` Notion exports wrap callouts in `<aside>` and link images with relative hrefs, both of which were broken — `md()` unwraps `<aside>` and takes an optional `opts.img` resolver mapping non-http srcs onto the topic/project blob endpoint
- `fac5d3f` merge · `e5aed82` seed the demo thread with Read calls and citations so the panel actually demos

</details>

<details>
<summary><b>feat(web): static GitHub Pages demo mirroring the real app</b> — <code>d300b00</code></summary>

A backend-free demo build (`VITE_DEMO`) reuses every real component, store and style, swapping only the network layer so the demo looks identical and new UI shows up automatically.

`web/src/demo` (fetch + XHR + socket.io mock: router, seeded in-memory db, simulated streaming turns with a web permission prompt) installed from `main.tsx` behind `import.meta.env.VITE_DEMO` (tree-shaken from normal builds), a `build:demo` script + Pages deploy workflow, favicon refs via `BASE_URL`, README demo badge + CLAUDE.md rule 8 + `web/src/demo/README.md`.

</details>

<details>
<summary><b>feat(git): commit/push from chat + encrypted remote credentials</b> — spec → build → security fix · <code>304bbad</code> <code>a7418b8</code> <code>2abdd2c</code> <code>7053eca</code></summary>

- `304bbad` design spec first
- `a7418b8` `git_credentials` table (per-user + admin-common, AES-GCM, host-keyed), user→common resolution by remote host, HTTPS PAT via a static `GIT_ASKPASS` helper (the secret only in the child env, never in the URL/reflog), project git endpoints (status / commit / push) and a clone credential picker, git author identity + push creds handed to the Claude subprocess so it can commit/push itself, plus UI, i18n, demo mocks and READMEs
- `2abdd2c` **security**: clone is rejected when an explicit `credentialId`'s host differs from the repo URL host — prevents exfiltrating a stored PAT to an attacker-controlled URL (review: high). `gitCommit` expands a selected staged rename to include its origin path so the staged deletion of the old path isn't dropped (review: medium)
- `7053eca` merge

</details>

### 07-23 — sanding down the git workflow

<details>
<summary><b>feat(git): branch list + switch, all remote branches surfaced</b> — <code>f6a5b99</code> <code>4fccdee</code> <code>4a0cd5f</code></summary>

- `f6a5b99` `gitBranches` (current + local + remote, `origin/HEAD` filtered), `gitCheckout` (DWIM: local switch or auto-track a remote-only branch), `GET /git/branches` + `POST /git/checkout`, a branch select replacing the static badge
- `4fccdee` mention branch switching in both READMEs
- `4a0cd5f` shallow clones were single-branch so remote branches were invisible — clone with `--no-single-branch` (`--depth` alone implies `--single-branch`), and `gitFetchRemotes()` widens the origin refspec to `*` so pre-existing clones are covered too. Verified over real network: before = master only, after = master + test + octocat-patch-1

</details>

<details>
<summary><b>feat(git): delete a project (files included) + separate select vs delete</b> — <code>f47160e</code> <code>f13a849</code></summary>

- `f47160e` `DELETE /api/projects/:id` also removes the working dir, but only if it resolves strictly inside the scope's projects root (path-escape guard). Fixes the re-clone name conflict from leftover files
- `f13a849` Radix `DM.Item`'s `onSelect` fired even when clicking the trash icon, so delete also switched the project — the menu is now controlled and each row renders as plain select + delete buttons

</details>

<details>
<summary><b>feat(git): show the resolved credential · full clone · clone branch</b> — <code>d4749fc</code> <code>8a159b1</code> <code>895ac7d</code> <code>bf2d2aa</code></summary>

- `d4749fc` credential hint clarifies the Bitbucket username (email for ATATT API tokens)
- `8a159b1` surface the actual resolved credential (source: yours vs shared, provider, host, username) and the commit identity, so a rejected or expired PAT is diagnosable at a glance. `resolveGitCredMeta()` returns meta only — the token is never sent
- `895ac7d` full clone instead of shallow depth 1 so `git log`/`blame` work; `--depth 1` also dropped from the ref-refresh fetch, which would otherwise re-shallow a full clone on every branch listing
- `bf2d2aa` optional branch when cloning — the ref name is validated (safe chars, no leading dash to block `--arg` injection)

</details>

- **feat(session): rename a private session from the sidebar** — `532fba8`

<details>
<summary><b>feat(server): optional TLS so the PWA installs off-localhost</b> — <code>64e4d0e</code></summary>

PWA "Install as app" needs a secure context; browsers exempt localhost but not `http://<ip>`, so install worked at localhost:3000 but never on a server accessed by IP. Serve HTTPS when `TLS_KEY`/`TLS_CERT` point at a browser-trusted cert (socket.io + the `/cs` proxy ride the same server, so one listener covers all); empty = plain HTTP. Compose env passthrough + read-only `./certs` mount, docs + `.env.example`, certs gitignored.

</details>

### 07-24 — PR review sessions (DESIGN §16)

<details>
<summary><b>feat(review): PR-review session backend</b> — clone · poll · local merge · <code>b6a84fb</code></summary>

A new admin-created session type parallel to private/room/wiki: `review_repos` (watched remote) + `review_sessions` (one per open PR) schema, GitHub/GitLab/Bitbucket Cloud PR/MR listing over REST, a manager doing full clone, host polling, per-PR git worktree and local no-ff merge (conflicts left in-tree for review) plus author→local-user matching, `/api/review/{repos,sessions}` (admin create/poll/delete; author read-only), review turns running in the PR worktree cwd (async `cwdFor`), admin write / PR-author read-only gating + `review:changed` broadcast, a `REVIEW_POLL_MS` poller + manual refresh, boot orphan reaper.

</details>

<details>
<summary><b>feat(review): PR-review UI · demo · docs · polling timeout</b> — <code>6572ba3</code> <code>88630ac</code> <code>48e061e</code> <code>80b802c</code></summary>

- `6572ba3` store state for repos/sessions plus `openReview`, add/delete/poll repo, local-merge and `review:changed` live refresh; a sidebar "Code review" section (admins see watched repos with nested PR sessions, members see their read-only PRs); a chat review header (PR link, base←head, merge state, local-merge button, read-only badge) with the composer/model/mode locked for a read-only author
- `88630ac` static demo seeds a watched repo (acme/webapp) + two PR review sessions and mocks `/api/review/*`
- `48e061e` README ko/en · DESIGN §16 · `.env` docs
- `80b802c` `AbortSignal.timeout(20s)` on host API fetch so a hung host can't stall `createRepo` or wedge a poll lock (the `finally` always runs); a note on `matchAuthor` recording the trusted-team assumption and its upgrade path. Addresses two MEDIUM findings from adversarial review

</details>

### 07-27 — the automatic review pipeline · sandbox · usage meter · mobile

<details>
<summary><b>feat(review): automatic pipeline</b> — merge → build/run → review → verdict · <code>96c38b9</code> <code>c91e30e</code> <code>eca05ec</code></summary>

- `96c38b9` on PR detection (`REVIEW_AUTO`, default on) the server runs the whole flow with no chat: local merge, then an **unattended** agent turn (review sessions auto-allow tools via `makeAutoAllow`; the class-1 fence still applies) that builds/runs, detects bugs, reviews the diff and emits `VERDICT: MERGE_SAFE|DO_NOT_MERGE`; `runTurn`'s `onDone` (threaded through the FIFO queue) parses the verdict + summary. A merge conflict → verdict=conflict, skipping build/review. `approvePr()` is the explicit admin action that merges the PR **on the remote** via the host API
- `c91e30e` UI — a header VERDICT badge (running/merge-safe/hold/conflict) with summary tooltip, admin re-run and remote-merge buttons (with confirm), a sidebar badge, i18n and demo mocks
- `eca05ec` README ko/en · DESIGN · `.env` docs

</details>

<details>
<summary><b>fix(review): withhold the git PAT from auto-turns + guard re-entrancy</b> — security · <code>1aa4d54</code></summary>

Addresses adversarial-review findings (1 CRITICAL, 1 HIGH, 1 MEDIUM):

- **CRITICAL**: review turns build/run PR-controlled code with Bash auto-allowed, so the merge-capable git credential is no longer injected (`buildGitEnv` skipped for `kind=review`). Review never pushes; the remote merge uses the host API
- **HIGH**: `autoReview()` holds a per-review in-flight guard from local merge through the turn's `onDone`, so a re-run can't `git reset`/merge the worktree under a live turn (and can't race the verdict). The re-run button is disabled while verdict=running
- **MEDIUM**: the verdict is an advisory LLM opinion, steerable by PR content — the approve confirm now tells the admin to read the diff first

The residual ceiling (auto-run executes PR code; Claude token in env; use `REVIEW_AUTO=0` for untrusted repos; sandbox = upgrade path) is documented in `makeAutoAllow` and the READMEs' security posture.

</details>

<details>
<summary><b>fix(review): four consecutive re-review correctness fixes</b> — re-poll · stale live · resume · watchdog · <code>78c7f2c</code> <code>308c676</code> <code>1601682</code> <code>3c630de</code> <code>8028893</code></summary>

- `78c7f2c` (1) `pollRepo` detects a changed PR head SHA, resets the verdict, posts a note and re-runs the pipeline. (2) "History missing when not viewing": messages were always persisted; the gap was live delivery to a client not subscribed during the turn — the server replays the in-flight turn's partial blocks in the `session:join` ack, and the client re-joins + re-fetches on socket (re)connect
- `fbd2d10` merge PR #2
- `308c676` (A) `applyJoinState` always sets `live` (null when none), clearing ghost/duplicate LiveViews. (B) a push landing mid-run is recorded in `rerunPending` and re-reviewed when the in-flight run finishes instead of being dropped
- `1601682` **root cause**: `autoReview` enqueued its turn with the stored `claudeSessionId`, so the re-review **resumed** the first review's conversation — the model saw its own prior verdict, decided it was the "same task", and re-submitted stale findings without re-reading the updated worktree. Clearing `claude_session_id` before each auto-review turn makes every run fresh
- `3c630de` a hung turn left the review wedged at verdict='running' with the guard never released → a `REVIEW_TURN_TIMEOUT_MS` (default 10m) watchdog plus a `settled` flag making `done()`/`onDone`/watchdog idempotent
- `8028893` the watchdog released the guard immediately after `interruptTurn` (async abort), so a queued re-review's `git reset --hard` could race the still-terminating turn on the same worktree — guard release and the queued re-review now happen exclusively in the turn's `onDone`

</details>

<details>
<summary><b>feat(review): run PR build/test in an isolated sandbox container</b> — security · <code>768121e</code> <code>033afd6</code> <code>c876330</code> <code>0dedf93</code></summary>

- `768121e` review turns no longer execute untrusted PR code in the app container (which mounts the Docker socket ≈ host root): `review/sandbox.ts` starts a per-PR locked-down sibling container (worktree-only mount, **no docker socket**, CapDrop ALL, no-new-privileges, memory/pid limits) and exposes only the in-process MCP tool `mcp__sandbox__run`. Review turns deny host `Bash` via `disallowedTools`. Falls back to host exec when Docker isn't available (trusted-team ceiling). Removed at turn end, orphans reaped at boot. Stacks the image can't build get static review only with the verdict saying "build not run". `REVIEW_SANDBOX_IMAGE`/`_MEM_MB`/`_EXEC_TIMEOUT_MS`
- `033afd6` the worktree's `.git` references the main clone's gitdir by absolute path, so mounting only the worktree broke `git diff`/`log` inside the sandbox — mount the whole `reviews/<id>` dir at its real absolute path with cwd = the worktree
- `c876330` merge PR #3
- `0dedf93` the prompt let the agent judge build-availability by host inspection (looking for a `docker` CLI) and prematurely declare "build not run (environment constraint)" — **the presence of `mcp__sandbox__run` in the tool list is the only signal**, and an env constraint may only be claimed after actually attempting the build

</details>

<details>
<summary><b>feat(review): post the finished auto-review back as a PR comment</b> — <code>60df2ce</code> <code>0b183e0</code></summary>

When a turn produces a verdict, publish the verdict label + summary + review body onto the PR itself (GitHub issue comment / GitLab MR note / Bitbucket PR comment) via the same merge-capable credential.

`postReviewComment()` is called from the enqueueTurn `onDone` **only when THIS turn produced the verdict** (`setFinal` now returns a boolean), so a watchdog-timed-out partial review is not published. Best-effort — failures are recorded as a system note and never break the pipeline. `REVIEW_COMMENT` (default on) keeps reviews internal when 0.

</details>

<details>
<summary><b>feat(usage): context window + claude.ai plan limits in the chat header</b> — <code>123312f</code> <code>e40b0ce</code> <code>7f5f6ed</code></summary>

A usage popover mirroring the CLI's `/usage` view: per-session context-window fill (`getContextUsage`) and claude.ai plan rate limits (5h / weekly / per-model) with reset countdowns (`usage_EXPERIMENTAL` SDK control call, unavailable for API-key sessions).

Server-side `probeUsage()` reuses the `probeCommands` short-lived-query trick (resume the session, ask the CLI control channel, abort) with a 15s TTL cache, exposed at `GET /api/sessions/:id/usage`; frontend `UsagePill` (Radix popover) + i18n + demo mock. `e40b0ce` keys the cache per requester and clears the stale pill on session switch.

</details>

<details>
<summary><b>feat(mobile): responsive layout across the whole web UI</b> — <code>b6e8e22</code> <code>b6a06e6</code> <code>6ed6f9d</code></summary>

The sidebar becomes an off-canvas drawer below md (768px), toggled by a hamburger in every top bar (backdrop + close; navigation and panel switches auto-close it); the Shell grid is static two-column ≥md and single column with the drawer <md; on phones chat-only is forced (split view + code-server iframe are unusable at that width, the wiki sources panel is hidden but inline citations stay); the FileExplorer modal stacks tree/preview vertically <md; login, plugin install forms, git-credential and admin grids and the usage table are made fluid/scrollable; side padding is reduced; new `useIsMobile` hook + `MobileMenuButton`.

`6ed6f9d` makes it work-rule 9: no horizontal body scroll, `md:` branching over fixed grids, the drawer pattern, hide phone-useless views, verify at a mobile viewport.

</details>

### 07-28 — room chat split out · interrupt · `@` autocomplete · config registry

<details>
<summary><b>feat(rooms): separate team chat from Claude instructions</b> — <code>83bba34</code> <code>422ef8c</code> <code>f7f5368</code></summary>

- `83bba34` design spec first
- `422ef8c` a composer mode toggle (chat / Claude, default chat, sticky per room). Chat messages broadcast + persist only — no Claude turn. Typing `@claude`/`@클로드` flips to instruct mode. An optional "include chat" injects team chat accrued since the last turn as prompt context. `messages.chat` column (+ idempotent migration), `postChat()` for turnless broadcast
- `f7f5368` review follow-ups — the edit affordance is hidden for `chat=1` messages, because editing re-emitted `chat:send` without the chat flag, **firing an unintended Claude turn AND truncating all later room history**. The `includeChat` boundary goes `gt` → `gte` so a message written in the same millisecond as the last instruction isn't permanently dropped

</details>

<details>
<summary><b>fix(session): stop/interrupt actually halts the running turn</b> — two-stage fix · <code>6ec7012</code> <code>daf99ab</code></summary>

- `6ec7012` interrupt relied solely on `abortController`, which only closes the CLI's stdin and waits ~2s for the graceful path, so the model kept streaming. `runReal`'s loop never checked the abort signal, and a stop during backoff slept out the full timer. `interruptTurn` now fires the SDK control-channel `query.interrupt()` immediately (abort kept as teardown fallback), `runReal` exposes its Query handle and breaks the loop the instant abort fires, partials are saved as interrupted, and `withRateLimitRetry` cuts the backoff sleep short. Verified: `q.interrupt()` resolves in ~11ms with 0 tokens after
- `daf99ab` **why it was dead anyway**: the handlers put their side-effecting call inside the optional-chained ack — `ack?.({ ok: interruptTurn(p.sessionId) })`. Clients emit with no ack callback, so `ack` is undefined, and optional chaining short-circuits and **never evaluates the argument** → `interruptTurn()`/`cancelQueued()` were never invoked. Hoisted to its own statement

</details>

<details>
<summary><b>feat(chat): <code>@</code> file/folder reference autocomplete in the composer</b> — <code>6bc9a74</code> <code>c3e950c</code></summary>

- `6bc9a74` typing `@` in a project-backed chat opens a fuzzy-search menu of files and folders (folders derived from the flat tree endpoint), mirroring the `/` palette. Selecting inserts an `@path`. Works mid-text and coexists with the room `@claude` mention. Reuses the existing tree endpoint; verified desktop + 375px
- `c3e950c` arrow-key navigation moved the selection but never scrolled the list, so the highlight could disappear below the fold — a module-scope callback ref (`scrollIntoView block:'nearest'`) applied to both the slash palette and the `@` picker

</details>

- **feat(review): skip merge/build/run for docs-only PRs** — all non-source (Markdown/text/images/LICENSE) → MERGE_SAFE with a note; unknown files count as source · `0010237`

<details>
<summary><b>feat(config): admin-managed settings registry for all runtime config</b> — 3 commits + 2 merges · <code>b56e82b</code> <code>0ed0ba8</code> <code>bea431f</code></summary>

- `b56e82b` a single registry (`server/src/lib/config-registry.ts`) is the source of truth for every operational knob, resolving DB override → env → default. Runtime consumers read live via `cfg.int/str/bool`, so admin edits apply without a restart (turn-cap semaphore, review poller, code-server reaper re-arm via `applyLive` hooks). `GET/PUT/DELETE /api/admin/config` (grouped, typed, secrets masked), public `GET /api/config`, a grouped live-editable AdminPanel UI, migration of env + hardcoded constants into the registry, infra + secrets read-only
- `0ed0ba8` per-key displayName + description from i18n, a structured editor for object/array JSON settings, Docker image presence check + pull (allowlisted), a Restart button + "restart needed" banner
- `bea431f` each category becomes a collapsed native `<details>` with a caret + item count — zero JS, accessible, works on mobile
- merges `a4dd6f7` · `a19c330`

</details>

### 07-29 — local session import, plus ten feature groups

<details>
<summary><b>feat(import): local session import</b> — spec → module → endpoints → modal → demo → docs · 9 commits · <code>0eae20a</code> … <code>35e5497</code></summary>

- `0eae20a` design spec (project + `~/.claude` session files) · `eb335df` implementation plan
- `c83b85e` pure session-import module (encode/rewrite/backfill) + staging paths
- `b793f40` staging + confirm endpoints — `POST/DELETE /api/import/staging/:sid` (files + slot whitelist + cancel), `GET …/sessions`, `POST /api/import/sessions` (place project + cwd-rewritten jsonl + backfill), `reapImportStaging()` boot cleanup. The server computes the destination slug via `encodeSlug(path.resolve(dest))` — **client paths are never trusted**
- `f8a3a86` store `importSessions` + i18n ko/en
- `c1c93cb` `ImportSessionModal` — project (pick/drop the folder; the root `.gitignore` seeds default checks) → tree (gitignore/.git-aware checkbox tree with cascade, `CLAUDE.md` and `.claude/*` force-checked + locked) → claude (folder picker + slug-encoding guide, skip supported) → sessions (select-all + project name, confirm). Cancel/close discards staging
- `68e217a` demo mocks · `e08436c` README entry · `35e5497` merge

</details>

<details>
<summary><b>feat(import): tree UX + per-file upload progress + feature flag</b> — <code>f18bef8</code> <code>0f899dc</code> <code>f44daa8</code> <code>c675112</code></summary>

- `f18bef8` collapsible directory rows in the upload tree · `0f899dc` expand-all / collapse-all in FileExplorer + the import tree
- `f44daa8` one file per request instead of one giant multipart, fixing 'Payload Too Large' on big `~/.claude` folders (a single transcript can be 20MB+). A shared `<UploadProgress>` (overall bar by bytes + current-file bar), the auto-open `.claude` picker removed (it hid the guide popup on macOS) with the reveal-hidden-folders shortcut (Cmd+Shift+.) shown instead, `uploadMaxMB` 50 → 200
- `c675112` `sessionImportEnabled` flag (routes 403 + button hidden) + **CLAUDE.md rule 10** — new features must push tunable constants / feature flags into the config-registry `DEFS`, read live via `cfg.*`, and gate server-side too

</details>

- **docs(claude): no automatic merge to main from a branch without an explicit instruction** — `9a27d4c`
- **chore: ignore `bash.exe.stackdump` crash-dump junk** — `698d18b`

<details>
<summary><b>feat(review): per-repo sandbox image · editable repos · self-healing</b> — <code>1aba1cd</code> <code>2dbfb3a</code> <code>5e6455e</code> <code>0eeba85</code></summary>

- `1aba1cd` every project ran in one global sandbox image (node:20-bookworm), so Python/Rust repos had no toolchain — an optional per-repo `sandbox_image` (nullable) with the global as fallback
- `2dbfb3a` `PATCH /api/review/repos/:id` for in-place edits of name/base/image/credential. `gitUrl`/provider/host stay immutable; `credentialId` re-validates host binding + scope
- `5e6455e` merge PR #6
- `0eeba85` **root cause of a review stalling mid-way**: the watchdog killed a still-working turn at the 10-minute default and marked it verdict=error with no path back (polling only re-triggers on a new PR / moved head). Timeout 10m → 30m (tunable to 2h), new `reviewMaxRetries` (default 2) keeps the review 'running' and auto-retries, boot `recoverInterruptedReviews()` re-queues reviews left at 'running' by a restart (or marks them interrupted when `reviewAuto` is off), sandbox teardown is awaited before `onDone` to close a retry-path race on the worktree, and `forgetReview()` clears in-memory state for a review deleted mid-pipeline. Found by an adversarial concurrency-verification pass

</details>

<details>
<summary><b>feat(admin): panel tabs · live activity manager · host-Docker cleanup</b> — <code>063e0eb</code> <code>561e470</code> <code>6cd1ddd</code></summary>

- `063e0eb` the single-scroll panel becomes tabbed (overview/users/providers/usage/config); a `TABS` array makes future tabs a one-line add. Pure frontend reorg
- `561e470` a live task-manager over running Claude turns, queued messages, code-server + review-sandbox containers and running review pipelines, each with a per-row control (interrupt/cancel/kill). Read-only scan degrades gracefully without Docker; auto-polls while open (`processPollMs`)
- `6cd1ddd` a Resources tab with a read-only inventory scan (ccw containers, referenced + dangling images, orphan dirs and DB rows) and cleanup. Full-reset removes spawned containers + dangling images + genuine orphans only — **never user data** (a module-load assertion enforces this). `rmSync` path-contained under the data root, dangling-only prune, orphans re-derived server-side per action, a 10-minute clone grace guard, double-confirm

</details>

<details>
<summary><b>feat(mypage): add My Page</b> — avatar · token · git creds · projects · <code>9b00a83</code></summary>

A per-user settings page consolidating profile image upload, Claude token, git credentials and personal project management into a new 'me' panel, moving the token + git-cred entry points out of the sidebar footer into a clickable profile row.

**Security**: streaming-layer size cap (413), mime + magic-byte validation, mime-derived on-disk filename (traversal-safe), `safeName` rejects all-dot project names, nosniff header.

</details>

<details>
<summary><b>feat(chat): per-session effort + file attachments and screenshot paste</b> — <code>b36bc11</code> <code>d8301b3</code></summary>

- `b36bc11` an effort pill (low/medium/high/xhigh/max) next to the model selector, wired to the SDK `Options.effort`. New `chat_sessions.effort` column, `defaultEffort` admin config. Unsupported models downgrade silently
- `d8301b3` upload files/images to a per-session `.attachments` dir inside allowed roots; absolute paths are prepended to the prompt so the agent Reads them (images render visually). Attach button, paste handler, drag-drop, thumbnail chips. **Security**: size cap, count cap, atomic exclusive writes, basename sanitizer (traversal/RLO/ADS/Windows-reserved), room GET membership gate, nosniff. `attachmentMaxMB`/`Count`

</details>

<details>
<summary><b>feat(provider): LLM provider override</b> — bedrock/vertex/custom base URL · <code>11cec38</code></summary>

Per-user + admin-common provider profiles that build the turn's subprocess env. Custom base URL is the path for OpenAI/ChatGPT/local LLMs via an Anthropic-compatible translating proxy. The default Claude-token path is unchanged when no provider is set.

Secrets AES-GCM encrypted, never returned/logged. `buildOptions` clears **all** provider env vars before applying so host-global vars can't leak into default/mock turns. Routes gated by `requireAdmin`/`requireAuth` + `llmProvidersEnabled`.

</details>

<details>
<summary><b>feat(requests): member request → admin approval workflow</b> — <code>b962d99</code></summary>

A generic approval framework with an action registry (add a requestable admin action in one place). Members submit typed requests (common_project / wiki_topic / role_upgrade) with a reason; admins approve/reject from a new tab; approval executes the action via the reused create functions.

**Authz**: admin-only decide, `role_upgrade` promotes only the requester (no payload target), an atomic `WHERE status='pending'` claim = execute-at-most-once, members see only their own. Gated by `approvalsEnabled`.

</details>

<details>
<summary><b>feat(dm): simple DM + group chat channels, promotable to a room</b> — <code>74bb92b</code></summary>

Lightweight human-only messaging (no Claude): 1:1 DMs and group channels over Socket.IO, usable by all users. A sidebar Messages section + `DmView` with unread badges; an admin can promote a group channel to a common project room.

Membership-gated on every read/write/socket path; promote is admin-only; socket payloads string-coerced (no crash-DoS); message length capped; gated by `dmEnabled`.

</details>

<details>
<summary><b>feat(ui): unified hand-made SVG icon set</b> — emoji fully replaced · <code>ec5d444</code> <code>21dc2af</code></summary>

- `ec5d444` `web/src/lib/icons.tsx`: 43 Feather/Lucide-style outline icons from one Svg wrapper (currentColor, 1.75 stroke, size prop, title/aria), replacing all standalone chrome glyphs across 16 components. Content/doc/demo emoji left intact
- `21dc2af` strips decorative emoji still embedded in i18n string values (admin/plugins/mypage titles, mode + verdict + tool-status labels) and renders the matching icon beside the unchanged text. `MODES`/`VERDICT_UI`/`ToolCard` carry an Icon, Modal title widened to ReactNode, 5 icons added. Only genuine content symbols (→, ＋, ⌘⇧) remain

</details>

### 07-30 → 07-31 — closing the request flow · final polish

<details>
<summary><b>feat(requests): common-project creation is request-gated with real-form parity</b> — <code>dfbc5ae</code> <code>9397a48</code></summary>

Members can no longer create a common (shared) project directly; the shared `ProjectCreateForm` routes member+common submissions through the approval flow instead of `POST /api/projects` (which still 403s scope=common for non-admins).

The request carries the **same fields as the real create UI** (name + git clone URL + branch + credential picker); on approval the `common_project` action runs the actual clone as the requester. Extracted `createProject`/`validateProjectInput` (shared by route + action) preserve the credential ownership + host-match checks at both submit and execute. The form is reused in the Chat project menu (personal/common toggle) and My Page. `9397a48` merges the ten feature groups.

</details>

<details>
<summary><b>docs(readme): captured feature-tour gallery, 23 screenshots</b> — <code>c4c2f0f</code></summary>

`docs/screenshots/*.png` captured from the static demo (real UI, MOCK mode) covering every feature: chat/tool-cards, web permission prompt, usage meter, slash + `@` menus, rooms + delegation, DM/group, git panel, split editor, LLM Wiki + sources, PR review verdict, My Page, all admin tabs, plugins, i18n (ko), mobile/PWA. A "Feature tour" section is inserted into both READMEs.

`main.tsx` exposes the zustand store on window in the demo build only (tree-shaken from prod) so screenshot/e2e tooling can drive views deterministically.

</details>

<details>
<summary><b>fix: login Enter · IME composing Enter · image lightbox</b> — <code>f182546</code> <code>fe30ac2</code> <code>90954fd</code></summary>

- `f182546` `LangToggle` lacked a type and defaulted to submit. As the first submit button in the login form, pressing Enter in an input triggered it (toggling language) instead of the login button → `type="button"`
- `fe30ac2` click an image attachment for a full-size lightbox (Radix Dialog overlay — Esc + focus trap free), in the composer and transcript thumbnails
- `90954fd` pressing Enter to send while a Hangul syllable is still composing fired the submit and cleared the textarea; the open composition then re-committed the last char into the empty field, duplicating it → submit/edit/DM-send Enter handlers guarded with `!e.nativeEvent.isComposing`

</details>

---

## Where it diverged from the original design

[DESIGN.md](DESIGN.md) covers P0–P5 plus PR review. Everything below is what actually got built on top of it.

| Axis | Status |
|---|---|
| Per-user API keys (§15 "extension seam") | **Built** — per-user encrypted tokens with per-author resolution (07-22) |
| Webhook intake (§16 "not implemented") | **Built** — per-repo secret with a polling toggle (v1.7.0) |
| Full git GUI (§15 "out of scope") | **Partly built** — commit, push, pull, branches, remotes, init/publish, diffs, history graph (through v1.9.0) |
| LLM Wiki | Added after the design — the **fourth workspace entity** (07-21) |
| DM and group chat | Added after the design (07-29) |
| Admin config registry | The design's "global settings tuning" (P5) grown into a runtime-editable registry (07-28) |
| Local session import | Added after the design (07-29) |
| Unified search · shortcuts · context menu | Added after the design (v1.4.0) |
| Guide agent | Added after the design — calls the workspace's own API with your permissions (v1.8.0) |
| Self-update | Added after the design (v1.9.0) |
| Non-essential egress blocking | Added after the design — nine channels, individually controllable (v1.2.0–v1.3.1) |
| SSO / proxy-header auth (§15) | Not implemented |
| Postgres · Redis promotion (§15) | Not implemented |
| CRDT live collaborative editing (§15) | Still out of scope |
