// Single source of truth for every admin-manageable setting. One definition array drives BOTH the
// admin API (GET/PUT /api/admin/config) and the admin UI. Value resolution is layered:
//   DB override (settings table) → env var → hardcoded default.
// Runtime-tunable values are read live at each use site via cfg.int/str/bool, so an admin edit
// applies without a restart (a few consumers register an applyLive hook to re-arm timers/semaphores).
//
// NOTE: this module MUST NOT be imported by config.ts — paths.ts reads config.dataDir at module load,
// so config.ts → registry → settings → db → paths → config.ts would be a TDZ import cycle at boot.
// config.ts stays pure-env; runtime consumers import `cfg` from here directly.
import { getSetting, setSetting, deleteSetting } from './settings.js';

const env = process.env;

export type ConfigType = 'bool' | 'int' | 'string' | 'select' | 'json';

export interface ConfigDef {
  key: string;          // DB settings key + API key
  group: string;        // UI group
  type: ConfigType;
  default: string;      // canonical string form of the hardcoded default
  env?: string;         // env var that seeds the default (before any DB override)
  restart?: boolean;    // only takes effect after a process restart (read once at boot)
  readonly?: boolean;   // display-only (infra/bootstrap) — never written from the UI, no DB override
  secret?: boolean;     // never expose the value; report set/unset status only
  min?: number;         // int lower bound (clamped)
  max?: number;         // int upper bound (clamped)
  options?: string[];   // select choices
  unit?: string;        // UI hint: 'ms' | 'MB' | 'days' | 'bytes' | ''
  image?: boolean;      // docker image value → UI offers presence check + pull/update
  imageHost?: 'windows'; // that image lives on the remote Windows daemon, not the local one
  disabledWhen?: string; // bool key that overrides this one — UI locks the row while that key is on
}

const DEFAULT_MODELS = '{"claude-opus-4-8":"Opus 4.8","claude-sonnet-5":"Sonnet 5","claude-haiku-4-5-20251001":"Haiku 4.5"}';

// ── the registry ──
export const DEFS: ConfigDef[] = [
  // Claude / turns
  { key: 'defaultModel', group: 'claude', type: 'select', default: 'claude-opus-4-8',
    options: ['claude-opus-4-8', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-fable-5'] },
  { key: 'defaultEffort', group: 'claude', type: 'select', default: 'high',
    options: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { key: 'models', group: 'claude', type: 'json', default: DEFAULT_MODELS },
  { key: 'modelsAutoFetch', group: 'claude', type: 'bool', default: '1' },
  { key: 'modelsRefreshMs', group: 'claude', type: 'int', default: '86400000', min: 60000, max: 2592000000, unit: 'ms' },
  { key: 'modelsMax', group: 'claude', type: 'int', default: '8', min: 1, max: 100 },
  { key: 'modelsFetchTimeoutMs', group: 'claude', type: 'int', default: '10000', min: 1000, max: 120000, unit: 'ms' },
  // Separate from the HTTP one on purpose: a browser sign-in has no token to send, so the list comes
  // from starting the Claude CLI and reading its model menu — that costs a process start, which is
  // several times an HTTP round trip and would trip the 10s budget above.
  { key: 'modelsCliTimeoutMs', group: 'claude', type: 'int', default: '60000', min: 5000, max: 300000, unit: 'ms' },
  { key: 'forceMock', group: 'claude', type: 'bool', default: '0', env: 'MOCK_CLAUDE' },
  { key: 'maxConcurrentTurns', group: 'claude', type: 'int', default: '3', env: 'MAX_CONCURRENT_TURNS', min: 1, max: 100 },
  { key: 'turnMaxRetries', group: 'claude', type: 'int', default: '5', min: 0, max: 20 },
  { key: 'turnBackoffBaseMs', group: 'claude', type: 'int', default: '1000', min: 100, max: 60000, unit: 'ms' },
  { key: 'turnBackoffCapMs', group: 'claude', type: 'int', default: '30000', min: 1000, max: 600000, unit: 'ms' },
  // Upstream SDK bug (anthropics/claude-code#27203): a background subagent's permission request
  // never reaches canUseTool and the internal denial corrupts the control stream — every later
  // prompt in the turn dies with "Stream closed". Until fixed upstream, sessions that can prompt
  // run with CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 (subagents run foreground; prompts work).
  // Turn this ON to allow background tasks in prompting modes anyway (e.g. after an upstream fix).
  { key: 'bgTasksWithPrompts', group: 'claude', type: 'bool', default: '0' },
  // CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS for every real turn (teams only form when a user asks)
  { key: 'agentTeamsEnabled', group: 'claude', type: 'bool', default: '1' },
  { key: 'autoTitleEnabled', group: 'claude', type: 'bool', default: '1' },
  { key: 'autoTitleModel', group: 'claude', type: 'string', default: 'claude-haiku-4-5-20251001' },
  { key: 'autoTitleMaxChars', group: 'claude', type: 'int', default: '40', min: 10, max: 120 },
  { key: 'autoTitleTimeoutMs', group: 'claude', type: 'int', default: '20000', min: 2000, max: 120000, unit: 'ms' },
  // same naming pass for chats cloned by the local-session import (one call per session, so it is
  // separately switchable — a 50-session import means 50 calls)
  { key: 'importAutoTitleEnabled', group: 'claude', type: 'bool', default: '1' },
  { key: 'importAutoTitleMessages', group: 'claude', type: 'int', default: '6', min: 1, max: 30 },
  // The plan-limit half of the probe is a live claude.ai lookup behind a CLI cold start — measured
  // around 30s on a subscription session, so 8s silently reported "no rate limits". The TTL is long
  // enough that the cost is paid once, not on every popover open.
  { key: 'usageProbeTtlMs', group: 'claude', type: 'int', default: '120000', min: 1000, max: 600000, unit: 'ms' },
  { key: 'usageProbeTimeoutMs', group: 'claude', type: 'int', default: '45000', min: 1000, max: 120000, unit: 'ms' },
  // A freshly started CLI answers the account lookup with whatever it has — on a cold start that is
  // "not yet" (rate_limits null while available). Keep re-asking the open session for this long
  // before giving up; each retry is a control round-trip, so the model never runs. 0 = ask once.
  { key: 'usageLimitsRetryMs', group: 'claude', type: 'int', default: '10000', min: 0, max: 60000, unit: 'ms' },
  // The CLI omits the per-model weekly window (`model_scoped`) when DISABLE_TELEMETRY is set, which
  // the privacy switches do by default — and that row is usually the first limit an account hits.
  // On: lift that one var for the limits lookup only (a bare session that runs no model turn).
  { key: 'usageLimitsFullDetail', group: 'claude', type: 'bool', default: '1' },
  // when the lookup does not settle (CLI cold start starved under load), serve the account's previous
  // answer instead of "unavailable" — plan windows are account-wide and drift slowly. 0 disables.
  { key: 'usageLastGoodTtlMs', group: 'claude', type: 'int', default: '1800000', min: 0, max: 86400000, unit: 'ms' },
  // auto-resume a turn that hit the claude.ai plan window (5h / weekly), once the window resets
  { key: 'autoResumeEnabled', group: 'claude', type: 'bool', default: '1' },
  { key: 'autoResumeGraceMs', group: 'claude', type: 'int', default: '60000', min: 0, max: 3600000, unit: 'ms' },
  { key: 'autoResumeMaxAttempts', group: 'claude', type: 'int', default: '3', min: 1, max: 10 },
  { key: 'autoResumeMaxPending', group: 'claude', type: 'int', default: '20', min: 1, max: 200 },
  { key: 'autoResumeStaleMs', group: 'claude', type: 'int', default: '21600000', min: 60000, max: 604800000, unit: 'ms' },
  // 5h-window primer: open a new claude.ai window with a tiny throwaway query as soon as none runs
  { key: 'windowPrimerEnabled', group: 'claude', type: 'bool', default: '1' },
  { key: 'windowPrimerModel', group: 'claude', type: 'string', default: 'claude-haiku-4-5-20251001' },
  { key: 'windowPrimerPrompt', group: 'claude', type: 'string', default: 'Reply with exactly: ok' },
  { key: 'windowPrimerGraceMs', group: 'claude', type: 'int', default: '60000', min: 0, max: 3600000, unit: 'ms' },
  { key: 'windowPrimerRetryMs', group: 'claude', type: 'int', default: '900000', min: 60000, max: 21600000, unit: 'ms' },
  { key: 'windowPrimerTimeoutMs', group: 'claude', type: 'int', default: '20000', min: 2000, max: 120000, unit: 'ms' },
  // how long a scheduled prime time stays "due" after it passes (covers a restart, a retry after a
  // failed prime, timer drift) before the primer waits for the next listed time instead
  { key: 'windowPrimerSlotGraceMs', group: 'claude', type: 'int', default: '1800000', min: 60000, max: 21600000, unit: 'ms' },
  // task panel: the subagents / background shells / workflows a turn spawns (server/src/claude/tasks.ts)
  // transcript: fold a run of N+ back-to-back tool calls into one collapsible row. 0 = never fold.
  { key: 'toolFoldMin', group: 'claude', type: 'int', default: '3', min: 0, max: 50 },
  { key: 'taskPanelEnabled', group: 'claude', type: 'bool', default: '1' },
  { key: 'taskHistoryMax', group: 'claude', type: 'int', default: '80', min: 5, max: 1000 },
  { key: 'taskSessionsMax', group: 'claude', type: 'int', default: '200', min: 10, max: 5000 },

  // ── shared-plan pool ("토큰 모아쓰기") — see server/src/auth/token-pool.ts ──
  // Members opt IN by joining a pool; a turn then runs on one member's Claude plan instead of only
  // the sender's. Off by default: it spends someone else's plan, so an admin must turn it on.
  { key: 'tokenPoolEnabled', group: 'pool', type: 'bool', default: '0' },
  // The workspace-wide level: everyone who registered a plan shares one pot, without anyone having to
  // create or join a pool. Individual members can still keep their own plan out (My Page).
  { key: 'tokenPoolAllUsers', group: 'pool', type: 'bool', default: '0' },
  // rotate = round-robin every turn (spreads the load); sequential = drain the first member, then
  // move to the next (keeps one plan's cache warm).
  { key: 'tokenPoolStrategy', group: 'pool', type: 'select', default: 'rotate', options: ['rotate', 'sequential'] },
  // How long a member is skipped after their plan window came back exhausted, when the error text
  // carried no reset instant of its own. Default = one 5h window.
  { key: 'tokenPoolCooldownMs', group: 'pool', type: 'int', default: '18000000', min: 60000, max: 604800000, unit: 'ms' },
  // How many further members one turn may fall through to after a plan-window failure.
  { key: 'tokenPoolMaxFallback', group: 'pool', type: 'int', default: '3', min: 0, max: 20 },
  // Off = only admins create pools (members can still join existing ones).
  { key: 'tokenPoolPartyCreate', group: 'pool', type: 'bool', default: '1' },

  // ── per-session build container (server/src/claude/session-sandbox.ts) ──
  // Every session shares the app container, so two people running `npm run dev` collide on ports and
  // node_modules. On = each session gets its own sibling container and an mcp__sandbox__run tool that
  // builds/runs inside it. Off by default: one container per active session is not free.
  { key: 'sessionSandboxEnabled', group: 'sandbox', type: 'bool', default: '0' },
  { key: 'sessionSandboxImage', group: 'sandbox', type: 'string', default: 'node:20-bookworm', image: true },
  { key: 'sessionSandboxMemMB', group: 'sandbox', type: 'int', default: '4096', min: 256, max: 131072, unit: 'MB' },
  { key: 'sessionSandboxPidsLimit', group: 'sandbox', type: 'int', default: '1024', min: 64, max: 65536 },
  { key: 'sessionSandboxExecTimeoutMs', group: 'sandbox', type: 'int', default: '900000', min: 10000, max: 7200000, unit: 'ms' },
  { key: 'sessionSandboxMaxOutputBytes', group: 'sandbox', type: 'int', default: '60000', min: 1000, max: 5000000, unit: 'bytes' },
  // Kept alive between turns so a build's node_modules/target survive; reaped once the session idles.
  { key: 'sessionSandboxIdleMs', group: 'sandbox', type: 'int', default: '3600000', min: 60000, max: 86400000, unit: 'ms' },
  { key: 'sessionSandboxReaperMs', group: 'sandbox', type: 'int', default: '60000', min: 10000, max: 3600000, unit: 'ms' },

  // ── shared headless browser (server/src/claude/browser.ts) ──
  // One Playwright MCP container for the whole workspace, on the internal network, so a chat can open
  // pages, click, read the DOM and take screenshots — including its own dev server running in the app
  // or build container. Each session gets its own browser context inside it (own tabs/cookies).
  // Off by default: a chromium is ~80MB idle plus ~40MB per open session.
  { key: 'browserEnabled', group: 'browser', type: 'bool', default: '0' },
  { key: 'browserImage', group: 'browser', type: 'string', default: 'mcr.microsoft.com/playwright/mcp:latest', image: true },
  { key: 'browserMemMB', group: 'browser', type: 'int', default: '2048', min: 256, max: 65536, unit: 'MB' },
  // A turn that ends without closing its browser session leaves the context open; recreating the
  // container after everyone has been quiet this long is what reclaims those.
  { key: 'browserIdleMs', group: 'browser', type: 'int', default: '1800000', min: 60000, max: 86400000, unit: 'ms' },
  { key: 'browserReaperMs', group: 'browser', type: 'int', default: '60000', min: 10000, max: 3600000, unit: 'ms' },

  // ── Windows build container (server/src/claude/win-sandbox.ts) ──
  // .NET Framework only builds in a Windows container, and one Docker daemon cannot run Linux and
  // Windows containers at the same time — so this points at a SECOND daemon on a Windows machine.
  // The project is copied there as an archive (no shared volume), so it also works on a bare-metal
  // deploy with no DATA_VOLUME. Off by default: it needs a Windows host to exist.
  { key: 'winSandboxEnabled', group: 'windocker', type: 'bool', default: '0' },
  // tcp://host:2376 (TLS, with winDockerCertDir) or tcp://host:2375 (plain — every machine that can
  // reach that port is root on the Windows host, so only on a network you fully trust).
  { key: 'winDockerHost', group: 'windocker', type: 'string', default: '', env: 'WIN_DOCKER_HOST' },
  // Dir holding ca.pem / cert.pem / key.pem, the layout the docker CLI uses. Set → TLS.
  { key: 'winDockerCertDir', group: 'windocker', type: 'string', default: '', env: 'WIN_DOCKER_CERT_DIR' },
  { key: 'winDockerTimeoutMs', group: 'windocker', type: 'int', default: '120000', min: 5000, max: 1800000, unit: 'ms' },
  // How long a failed reachability check is trusted before the next build attempt re-checks.
  { key: 'winDockerProbeTtlMs', group: 'windocker', type: 'int', default: '60000', min: 5000, max: 3600000, unit: 'ms' },
  // Several GB — pull it from the admin panel before the first build, not during a turn.
  { key: 'winSandboxImage', group: 'windocker', type: 'string', default: 'mcr.microsoft.com/dotnet/framework/sdk:4.8', image: true, imageHost: 'windows' },
  { key: 'winSandboxWorkdir', group: 'windocker', type: 'string', default: 'C:\\project' },
  // 'process' needs the container's Windows build to match the host's; 'default' lets the daemon pick.
  { key: 'winSandboxIsolation', group: 'windocker', type: 'select', default: 'default', options: ['default', 'process', 'hyperv'] },
  { key: 'winSandboxShell', group: 'windocker', type: 'select', default: 'cmd', options: ['cmd', 'powershell'] },
  { key: 'winSandboxMemMB', group: 'windocker', type: 'int', default: '8192', min: 512, max: 262144, unit: 'MB' },
  // A cold MSBuild + NuGet restore is slow; the Linux default (15min) times out real solutions.
  { key: 'winSandboxExecTimeoutMs', group: 'windocker', type: 'int', default: '1800000', min: 10000, max: 14400000, unit: 'ms' },
  { key: 'winSandboxMaxOutputBytes', group: 'windocker', type: 'int', default: '60000', min: 1000, max: 5000000, unit: 'bytes' },
  { key: 'winSandboxIdleMs', group: 'windocker', type: 'int', default: '3600000', min: 60000, max: 86400000, unit: 'ms' },
  { key: 'winSandboxReaperMs', group: 'windocker', type: 'int', default: '60000', min: 10000, max: 3600000, unit: 'ms' },
  // Guard rail on the copy: refuse instead of pushing a huge tree over the network every command.
  { key: 'winSandboxSyncMaxMB', group: 'windocker', type: 'int', default: '512', min: 1, max: 20480, unit: 'MB' },
  // Names left out of the copy, matched against each file/dir name at any depth (*.suffix works).
  { key: 'winSandboxSyncExclude', group: 'windocker', type: 'string', default: '.git,node_modules,bin,obj,packages,.vs,dist,target,.next' },

  // ── project file-change watch (server/src/lib/project-watch.ts) ──
  // A shared project is edited from many places (another chat's turn, the VS Code editor, a git pull),
  // and a chat pointed at it had no way to hear about that. On = a session may subscribe to its own
  // project: 'notify' posts a notice, 'prompt' also sends a stored prompt as a turn.
  { key: 'projectWatchEnabled', group: 'watch', type: 'bool', default: '1' },
  // Which projects may be watched at all. shared = common + room (the ones other people also edit);
  // all = personal projects too. Sessions already subscribed to a now-excluded project stop firing.
  { key: 'projectWatchScope', group: 'watch', type: 'select', default: 'shared', options: ['common', 'shared', 'all'] },
  // The 'prompt' mode spends tokens without anybody pressing send, so it is separately switchable.
  { key: 'projectWatchPromptEnabled', group: 'watch', type: 'bool', default: '1' },
  { key: 'projectWatchPromptMaxChars', group: 'watch', type: 'int', default: '2000', min: 10, max: 20000 },
  // One save touches several files (and editors write twice); collect them into one notice.
  { key: 'projectWatchDebounceMs', group: 'watch', type: 'int', default: '2000', min: 200, max: 60000, unit: 'ms' },
  // A session's own turn writes land slightly after it ends, so for this long afterwards a change is
  // treated as that session's own work: the notice still goes out (marked as such), the auto-prompt
  // does not — queueing a prompt about the files a turn just wrote makes it write again, forever.
  { key: 'projectWatchGraceMs', group: 'watch', type: 'int', default: '15000', min: 0, max: 600000, unit: 'ms' },
  // Shortest gap between two auto-sent prompts in ONE session. Also what bounds how fast two sessions
  // watching the same project can answer each other's writes. Long enough to swallow one save burst,
  // short enough that editing a file twice in a row still gets a second prompt.
  { key: 'projectWatchCooldownMs', group: 'watch', type: 'int', default: '30000', min: 0, max: 86400000, unit: 'ms' },
  { key: 'projectWatchMaxFiles', group: 'watch', type: 'int', default: '20', min: 1, max: 500 },
  // Upper bound on directories under an OS watch at once (each one costs kernel watch descriptors).
  { key: 'projectWatchMaxProjects', group: 'watch', type: 'int', default: '20', min: 1, max: 200 },
  // Re-read the subscriptions periodically, so a watcher left behind by a deleted chat/project goes
  // away even if nothing called sync(). 0 = only on change.
  { key: 'projectWatchSyncMs', group: 'watch', type: 'int', default: '60000', min: 0, max: 3600000, unit: 'ms' },

  // guide assistant — the floating product-guide / control agent (server/src/guide)
  { key: 'guideEnabled', group: 'guide', type: 'bool', default: '1' },
  // off = it can still explain the product and navigate the UI, but every state-changing API call is refused
  { key: 'guideWriteEnabled', group: 'guide', type: 'bool', default: '1' },
  { key: 'guideModel', group: 'guide', type: 'string', default: 'claude-sonnet-5' },
  { key: 'guideMaxTurns', group: 'guide', type: 'int', default: '20', min: 1, max: 100 },
  { key: 'guideHistoryMax', group: 'guide', type: 'int', default: '100', min: 10, max: 1000 },
  { key: 'guideMaxInputChars', group: 'guide', type: 'int', default: '4000', min: 100, max: 100000 },
  { key: 'guideMaxToolChars', group: 'guide', type: 'int', default: '20000', min: 1000, max: 200000 },

  // side chat — the floating "/btw" window: a read-only question about the open chat, forked off its
  // transcript so the main conversation is untouched (server/src/claude/aside.ts)
  { key: 'asideEnabled', group: 'guide', type: 'bool', default: '1' },
  { key: 'asideMaxTurns', group: 'guide', type: 'int', default: '8', min: 1, max: 50 },
  { key: 'asideMaxInputChars', group: 'guide', type: 'int', default: '4000', min: 100, max: 100000 },

  // privacy — non-essential egress to Anthropic (the inference call itself is never affected).
  // Every key here means the same thing: on = blocked. The master switch OVERRIDES the channel keys
  // (on = block everything), so they are locked in the UI while it is on. See privacy.ts for the env.
  { key: 'blockNonessentialTraffic', group: 'privacy', type: 'bool', default: '1', env: 'BLOCK_NONESSENTIAL_TRAFFIC' },
  ...(['privacyTelemetry', 'privacyErrorReports', 'privacyFeedbackCommands', 'privacyFeedbackSurvey',
       'privacyNonEssentialModelCalls', 'privacyAutoUpdater', 'privacyWebFetchPreflight',
       'privacyArtifact', 'privacyMarketplace'] as const).map((key): ConfigDef =>
    ({ key, group: 'privacy', type: 'bool', default: '1', disabledWhen: 'blockNonessentialTraffic' })),

  // PR review pipeline
  { key: 'reviewAuto', group: 'review', type: 'bool', default: '1', env: 'REVIEW_AUTO' },
  { key: 'reviewComment', group: 'review', type: 'bool', default: '1', env: 'REVIEW_COMMENT' },
  { key: 'reviewWebhook', group: 'review', type: 'bool', default: '1', env: 'REVIEW_WEBHOOK' },
  { key: 'reviewPollMs', group: 'review', type: 'int', default: '60000', env: 'REVIEW_POLL_MS', min: 0, max: 86400000, unit: 'ms' },
  { key: 'reviewTurnTimeoutMs', group: 'review', type: 'int', default: '1800000', env: 'REVIEW_TURN_TIMEOUT_MS', min: 60000, max: 7200000, unit: 'ms' },
  { key: 'reviewMaxRetries', group: 'review', type: 'int', default: '2', min: 0, max: 10 },
  { key: 'reviewSandboxImage', group: 'review', type: 'string', default: 'node:20-bookworm', env: 'REVIEW_SANDBOX_IMAGE', image: true },
  { key: 'reviewSandboxMemMB', group: 'review', type: 'int', default: '4096', env: 'REVIEW_SANDBOX_MEM_MB', min: 256, max: 131072, unit: 'MB' },
  { key: 'reviewSandboxExecTimeoutMs', group: 'review', type: 'int', default: '300000', env: 'REVIEW_SANDBOX_EXEC_TIMEOUT_MS', min: 10000, max: 3600000, unit: 'ms' },
  { key: 'reviewSandboxPidsLimit', group: 'review', type: 'int', default: '1024', min: 64, max: 65536 },
  { key: 'reviewSandboxMaxOutputBytes', group: 'review', type: 'int', default: '60000', min: 1000, max: 5000000, unit: 'bytes' },
  { key: 'reviewMaxOpenPrs', group: 'review', type: 'int', default: '100', min: 1, max: 100 },
  { key: 'reviewHttpTimeoutMs', group: 'review', type: 'int', default: '20000', min: 1000, max: 300000, unit: 'ms' },

  // git operations
  { key: 'gitOpTimeoutMs', group: 'git', type: 'int', default: '120000', min: 5000, max: 3600000, unit: 'ms' },
  { key: 'gitNetworkTimeoutMs', group: 'git', type: 'int', default: '300000', min: 10000, max: 3600000, unit: 'ms' },
  { key: 'gitMaxBufferMB', group: 'git', type: 'int', default: '8', min: 1, max: 512, unit: 'MB' },
  { key: 'git_author_domain', group: 'git', type: 'string', default: 'ccw.local' },
  // history graph + diff viewer: how much history one request may walk, and how big a patch may get
  { key: 'gitLogMaxCount', group: 'git', type: 'int', default: '200', min: 10, max: 5000 },
  { key: 'gitDiffMaxKB', group: 'git', type: 'int', default: '512', min: 16, max: 8192, unit: 'KB' },
  // publish: git init an untracked project and push it to a repo created through the provider API
  { key: 'gitPublishEnabled', group: 'git', type: 'bool', default: '1' },
  { key: 'gitInitBranch', group: 'git', type: 'string', default: 'main' },

  // code-server editors
  { key: 'codeServerImage', group: 'codeserver', type: 'string', default: 'codercom/code-server:latest', env: 'CODE_SERVER_IMAGE', image: true },
  { key: 'codeServerIdleMs', group: 'codeserver', type: 'int', default: '1800000', env: 'CODE_SERVER_IDLE_MS', min: 60000, max: 86400000, unit: 'ms' },
  { key: 'codeServerReaperMs', group: 'codeserver', type: 'int', default: '60000', min: 10000, max: 3600000, unit: 'ms' },
  { key: 'codeServerWaitReadyMs', group: 'codeserver', type: 'int', default: '30000', min: 5000, max: 300000, unit: 'ms' },

  // docker reachability probe (lib/docker-status.ts) — editors, review sandboxes and self-update all
  // depend on the daemon, so its state is surfaced instead of failing at the moment of use.
  { key: 'dockerProbeMs', group: 'docker', type: 'int', default: '30000', min: 0, max: 3600000, unit: 'ms' },
  { key: 'dockerProbeTimeoutMs', group: 'docker', type: 'int', default: '5000', min: 500, max: 60000, unit: 'ms' },

  // self-update: check the published image for a newer version and swap this container for it
  // (admin/self-update.ts). Off = both the check and the apply endpoint are refused.
  { key: 'selfUpdateEnabled', group: 'update', type: 'bool', default: '1', env: 'SELF_UPDATE_ENABLED' },
  { key: 'selfUpdateAutoCheckMs', group: 'update', type: 'int', default: '21600000', min: 0, max: 604800000, unit: 'ms' },
  { key: 'selfUpdateCheckTimeoutMs', group: 'update', type: 'int', default: '10000', min: 1000, max: 120000, unit: 'ms' },
  { key: 'selfUpdateHealthWaitMs', group: 'update', type: 'int', default: '30000', min: 5000, max: 600000, unit: 'ms' },
  // empty = find our own container by hostname (its short id under Docker); set it when a deploy
  // overrides the hostname so that lookup can't work
  { key: 'selfUpdateContainer', group: 'update', type: 'string', default: '', env: 'CCW_CONTAINER' },

  // auth
  { key: 'sessionTtlDays', group: 'auth', type: 'int', default: '30', min: 1, max: 365, unit: 'days' },
  { key: 'allow_bypass', group: 'auth', type: 'bool', default: '1' },
  // Claude account sign-in (drives `claude auth login` per user). The only path to a user:profile
  // scope, i.e. to plan-limit reporting — a pasted setup-token can never carry it.
  { key: 'claudeLoginEnabled', group: 'auth', type: 'bool', default: '1' },
  // Generous: the FIRST `claude` spawn in a fresh container extracts its native binary and can take
  // well over 20s, which would fail the very first sign-in after a deploy.
  { key: 'claudeLoginStartMs', group: 'auth', type: 'int', default: '60000', min: 5000, max: 300000, unit: 'ms' },
  { key: 'claudeLoginTimeoutMs', group: 'auth', type: 'int', default: '600000', min: 60000, max: 3600000, unit: 'ms' },
  { key: 'claudeLoginFinishMs', group: 'auth', type: 'int', default: '60000', min: 5000, max: 300000, unit: 'ms' },

  // ── external directories: AD/LDAP sign-in and OIDC single sign-on ──
  // Both are OFF by default and both need their connection settings filled in (admin panel › 인증),
  // which live encrypted in the auth_providers table — never here, because they carry a secret.
  // The local username/password form keeps working the whole time unless localLoginEnabled is off,
  // and even then admins can still use it, so a broken directory can never lock the workspace out.
  { key: 'localLoginEnabled', group: 'auth', type: 'bool', default: '1' },
  { key: 'ldapEnabled', group: 'auth', type: 'bool', default: '0' },
  // Create the local account the first time someone signs in through the directory. Off = only the
  // people a bulk import (or an admin) already created may sign in.
  { key: 'ldapJitEnabled', group: 'auth', type: 'bool', default: '1' },
  // DANGEROUS by design: on, a directory account may take over an existing local account with the
  // same username. Anyone who can create a `admin` user upstream then inherits this workspace's
  // admin row, so it stays off unless an operator is deliberately migrating local accounts.
  { key: 'ldapLinkExisting', group: 'auth', type: 'bool', default: '0' },
  // Let the directory's admin group decide the workspace role on every sign-in / import.
  { key: 'ldapRoleSync', group: 'auth', type: 'bool', default: '0' },
  { key: 'ldapTimeoutMs', group: 'auth', type: 'int', default: '10000', min: 1000, max: 120000, unit: 'ms' },
  // Periodic bulk import of directory users. 0 = never (the manual button in the admin panel still works).
  { key: 'ldapSyncMs', group: 'auth', type: 'int', default: '0', min: 0, max: 604800000, unit: 'ms' },
  { key: 'ldapImportMax', group: 'auth', type: 'int', default: '500', min: 1, max: 20000 },
  { key: 'oidcEnabled', group: 'auth', type: 'bool', default: '0' },
  { key: 'oidcJitEnabled', group: 'auth', type: 'bool', default: '1' },
  { key: 'oidcLinkExisting', group: 'auth', type: 'bool', default: '0' }, // same takeover warning as ldapLinkExisting
  { key: 'oidcRoleSync', group: 'auth', type: 'bool', default: '0' },
  { key: 'oidcTimeoutMs', group: 'auth', type: 'int', default: '10000', min: 1000, max: 120000, unit: 'ms' },
  // How long an unfinished sign-in stays valid (the browser is away at the identity provider).
  { key: 'oidcStateTtlMs', group: 'auth', type: 'int', default: '600000', min: 60000, max: 3600000, unit: 'ms' },
  // Discovery document + signing keys are static per issuer; refetched on a key the JWKS does not know.
  { key: 'oidcDiscoveryTtlMs', group: 'auth', type: 'int', default: '3600000', min: 60000, max: 86400000, unit: 'ms' },
  { key: 'oidcClockSkewMs', group: 'auth', type: 'int', default: '60000', min: 0, max: 600000, unit: 'ms' },

  // feature flags (live — toggle without restart)
  { key: 'sessionImportEnabled', group: 'features', type: 'bool', default: '1' },
  { key: 'sessionExportEnabled', group: 'features', type: 'bool', default: '1' },
  // project-folder bundle (.tgz of the session's working dir + its transcript) — the heavier of the
  // two export shapes, so it gets its own switch, a size ceiling and an exclude list.
  { key: 'sessionBundleEnabled', group: 'features', type: 'bool', default: '1' },
  { key: 'sessionBundleMaxMB', group: 'features', type: 'int', default: '1024', min: 16, max: 65536, unit: 'MB' },
  { key: 'sessionBundleExcludes', group: 'features', type: 'string',
    default: 'node_modules,.venv,venv,__pycache__,dist,build,.next,target,.cache,.attachments' },
  { key: 'sessionBundleMaxFiles', group: 'features', type: 'int', default: '200000', min: 100, max: 2000000 },
  // file pickers and explorers load one folder at a time; these two keep a monstrous folder from
  // freezing the browser — warn before opening it, and never send more than this in one level
  { key: 'fileTreeWarnCount', group: 'features', type: 'int', default: '300', min: 20, max: 100000 },
  { key: 'fileTreeMaxEntries', group: 'features', type: 'int', default: '2000', min: 50, max: 100000 },
  { key: 'teamAgentsEnabled', group: 'features', type: 'bool', default: '1' },
  // members may create a COMMON project straight away. Off (default) keeps the direct route
  // admin-only and members go through the approval request instead (admin/requests.ts).
  // Deleting a common project stays admin-only either way — the row has no creator column.
  { key: 'commonProjectOpen', group: 'features', type: 'bool', default: '0' },

  // whole-workspace backup & restore (admin migration tool)
  { key: 'backupEnabled', group: 'backup', type: 'bool', default: '1' },
  { key: 'backupIncludeReviews', group: 'backup', type: 'bool', default: '1' },
  { key: 'restoreMaxMB', group: 'backup', type: 'int', default: '2048', min: 16, max: 16384, unit: 'MB' },
  { key: 'resourceCleanupEnabled', group: 'features', type: 'bool', default: '1' },
  { key: 'llmProvidersEnabled', group: 'features', type: 'bool', default: '1' },
  { key: 'approvalsEnabled', group: 'features', type: 'bool', default: '1' },
  { key: 'dmEnabled', group: 'features', type: 'bool', default: '1' },
  { key: 'customContextMenu', group: 'features', type: 'bool', default: '1' },
  // count skill invocations per user (shown in a plugin's skill detail); off = stop counting AND hide
  { key: 'skillUsageEnabled', group: 'features', type: 'bool', default: '1' },
  { key: 'processPollMs', group: 'features', type: 'int', default: '5000', min: 1000, max: 60000, unit: 'ms' },
  { key: 'avatarMaxMB', group: 'features', type: 'int', default: '5', min: 1, max: 50, unit: 'MB' },
  { key: 'attachmentMaxMB', group: 'features', type: 'int', default: '20', min: 1, max: 200, unit: 'MB' },
  { key: 'attachmentMaxCount', group: 'features', type: 'int', default: '10', min: 1, max: 50 },

  // branding — the workspace name + logo shown in the sidebar, login card, landing screen, browser tab.
  // Empty title = the built-in product name. The logo itself is a FILE (<dataDir>/brand/logo.<ext>,
  // uploaded through /api/admin/brand/logo), so only the text lives here.
  { key: 'brandTitle', group: 'brand', type: 'string', default: '', env: 'BRAND_TITLE' },
  { key: 'brandLogoMaxMB', group: 'brand', type: 'int', default: '2', min: 1, max: 20, unit: 'MB' },

  // LLM wiki — admins editing an existing topic's raw/ sources (add files / edit in place).
  // off = the endpoints 403 AND the explorer's edit affordances disappear.
  { key: 'wikiSourceEditEnabled', group: 'wiki', type: 'bool', default: '1' },
  { key: 'wikiEditMaxKB', group: 'wiki', type: 'int', default: '512', min: 1, max: 10240, unit: 'KB' },
  // Attaching a wiki topic to an ordinary chat/room session as reference knowledge.
  { key: 'wikiLinkEnabled', group: 'wiki', type: 'bool', default: '1' },
  // The single plugin a wiki turn loads (query thread + compile). Empty = the bundled llm-wiki
  // skill shipped with the app. Workspace-wide plugins are never applied to a wiki turn.
  { key: 'wikiPluginPath', group: 'wiki', type: 'string', default: '' },
  // Growing a topic from conversations. The per-topic mode (off/ask/auto) still decides; this is the
  // workspace-wide master switch — off skips the learner entirely, whatever the topics say.
  { key: 'wikiAutoLearnEnabled', group: 'wiki', type: 'bool', default: '1' },
  { key: 'wikiLearnModel', group: 'wiki', type: 'string', default: 'claude-haiku-4-5-20251001' },
  { key: 'wikiLearnTimeoutMs', group: 'wiki', type: 'int', default: '60000', min: 5000, max: 600000, unit: 'ms' },
  { key: 'wikiLearnMaxKB', group: 'wiki', type: 'int', default: '64', min: 1, max: 1024, unit: 'KB' },
  // Seeding a new topic from an existing project directory (files copied into raw/).
  // Article link graph (the wiki explorer's graph view) — how many articles it draws at once.
  // The layout is O(nodes^2) per tick in the browser, so this is the guard on a huge topic.
  { key: 'wikiGraphMaxNodes', group: 'wiki', type: 'int', default: '400', min: 10, max: 5000 },
  { key: 'wikiSeedMaxFiles', group: 'wiki', type: 'int', default: '400', min: 1, max: 20000 },
  { key: 'wikiSeedMaxKB', group: 'wiki', type: 'int', default: '4096', min: 64, max: 1048576, unit: 'KB' },

  // workspace-wide search (routes/search.ts) — off hard-404s the endpoint AND hides the UI
  { key: 'searchEnabled', group: 'search', type: 'bool', default: '1' },
  { key: 'searchMaxPerType', group: 'search', type: 'int', default: '8', min: 1, max: 100 },
  { key: 'searchFileMaxKB', group: 'search', type: 'int', default: '512', min: 1, max: 10240, unit: 'KB' },
  { key: 'searchScanMaxFiles', group: 'search', type: 'int', default: '2000', min: 10, max: 100000 },

  // server limits (read once at server construction → restart to apply)
  { key: 'httpBodyLimitMB', group: 'server', type: 'int', default: '6', min: 1, max: 1024, unit: 'MB', restart: true },
  { key: 'uploadMaxMB', group: 'server', type: 'int', default: '200', min: 1, max: 4096, unit: 'MB', restart: true },
  { key: 'socketMaxMB', group: 'server', type: 'int', default: '5', min: 1, max: 1024, unit: 'MB', restart: true },
  { key: 'claudeCodePath', group: 'server', type: 'string', default: '', env: 'CLAUDE_CODE_PATH' },

  // infrastructure (env-only, read-only display: a UI living in the DB can't relocate the DB)
  { key: 'port', group: 'infra', type: 'int', default: '3000', env: 'PORT', readonly: true, restart: true },
  { key: 'dataDir', group: 'infra', type: 'string', default: './data', env: 'DATA_DIR', readonly: true, restart: true },
  { key: 'bindHost', group: 'infra', type: 'string', default: '0.0.0.0', readonly: true, restart: true },
  { key: 'tlsKey', group: 'infra', type: 'string', default: '', env: 'TLS_KEY', readonly: true, restart: true },
  { key: 'tlsCert', group: 'infra', type: 'string', default: '', env: 'TLS_CERT', readonly: true, restart: true },
  { key: 'codeServerNetwork', group: 'infra', type: 'string', default: '', env: 'CODE_SERVER_NETWORK', readonly: true, restart: true },
  { key: 'dataVolume', group: 'infra', type: 'string', default: '', env: 'DATA_VOLUME', readonly: true, restart: true },
  { key: 'bootstrapAdminUser', group: 'infra', type: 'string', default: 'admin', env: 'BOOTSTRAP_ADMIN_USER', readonly: true, restart: true },

  // secrets (env-only, status only — value never leaves the server)
  { key: 'sessionSecret', group: 'secret', type: 'string', default: 'change-me-please', env: 'SESSION_SECRET', secret: true, readonly: true, restart: true },
  { key: 'tokenEncSecret', group: 'secret', type: 'string', default: '', env: 'TOKEN_ENC_SECRET', secret: true, readonly: true, restart: true },
  { key: 'anthropicApiKey', group: 'secret', type: 'string', default: '', env: 'ANTHROPIC_API_KEY', secret: true, readonly: true, restart: true },
];

const byKey = new Map(DEFS.map((d) => [d.key, d]));
function mustDef(key: string): ConfigDef {
  const d = byKey.get(key);
  if (!d) throw new Error(`unknown config key: ${key}`);
  return d;
}

const SENTINEL = ' __ccw_unset__';
function envValue(d: ConfigDef): string {
  if (d.env && env[d.env] != null && env[d.env] !== '') return String(env[d.env]);
  return d.default;
}

// resolved string value: DB override (editable keys only) → env → default
function resolve(key: string): string {
  const d = mustDef(key);
  if (!d.readonly) {
    const dbv = getSetting(key, SENTINEL);
    if (dbv !== SENTINEL) return dbv;
  }
  return envValue(d);
}

// small cache; cleared wholesale on any write (values re-resolve lazily)
const cache = new Map<string, string>();
function cached(key: string): string {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const v = resolve(key);
  cache.set(key, v);
  return v;
}

function toBool(s: string): boolean {
  const v = s.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

export const cfg = {
  str: (key: string): string => cached(key),
  int: (key: string): number => {
    const n = Number(cached(key));
    return Number.isFinite(n) ? n : Number(mustDef(key).default) || 0;
  },
  bool: (key: string): boolean => toBool(cached(key)),
};

// ── applyLive: consumers register a hook to re-arm live state (semaphore/timers) after an edit.
// Registration is push (module → registry) to avoid registry importing those modules (cycle-free).
const applyHooks = new Map<string, (v: string) => void>();
export function registerApply(key: string, fn: (v: string) => void) { applyHooks.set(key, fn); }

// `defaultModel` picks from the live model map (hand-edited or auto-fetched — see claude/models.ts),
// so its choices can't be a frozen array: a model id that only exists after a fetch must be settable.
// The registry defaults stay in the union as a floor for when the map is empty/broken.
function optionsFor(d: ConfigDef): string[] | undefined {
  if (d.key !== 'defaultModel') return d.options;
  return [...new Set([...Object.keys(modelMap()), ...(d.options || [])])];
}

// ── validation / normalization ──
function normalize(d: ConfigDef, raw: unknown): string {
  const s = raw == null ? '' : String(raw);
  switch (d.type) {
    case 'bool':
      return toBool(s) ? '1' : '0';
    case 'int': {
      let n = Math.round(Number(s));
      if (!Number.isFinite(n)) throw new Error(`${d.key}: not a number`);
      if (d.min != null && n < d.min) n = d.min;
      if (d.max != null && n > d.max) n = d.max;
      return String(n);
    }
    case 'select': {
      const opts = optionsFor(d);
      if (opts && !opts.includes(s)) throw new Error(`${d.key}: '${s}' not an allowed option`);
      return s;
    }
    case 'json':
      try { JSON.parse(s); } catch { throw new Error(`${d.key}: invalid JSON`); }
      return s;
    default:
      return s.trim();
  }
}

export function setConfigValue(key: string, value: unknown): void {
  const d = mustDef(key);
  if (d.readonly) throw new Error(`${key} is read-only (edit .env and restart)`);
  const norm = normalize(d, value);
  setSetting(key, norm);
  cache.clear();
  applyHooks.get(key)?.(norm);
}

// Drop the DB override → revert to env/default.
export function resetConfigValue(key: string): void {
  const d = mustDef(key);
  if (d.readonly) throw new Error(`${key} is read-only`);
  deleteSetting(key);
  cache.clear();
  applyHooks.get(key)?.(resolve(key));
}

// ── API projection ──
export interface ConfigItemDto {
  key: string; group: string; type: ConfigType; unit?: string;
  restart: boolean; readonly: boolean; secret: boolean;
  min?: number; max?: number; options?: string[]; image?: boolean; imageHost?: string; disabledWhen?: string;
  default: string; overridden: boolean;
  value?: string;   // omitted for secrets
  set?: boolean;    // secrets only: is a non-default value configured
}

export function listConfigForApi(): ConfigItemDto[] {
  return DEFS.map((d): ConfigItemDto => {
    const val = resolve(d.key);
    const overridden = !d.readonly && getSetting(d.key, SENTINEL) !== SENTINEL;
    const base: ConfigItemDto = {
      key: d.key, group: d.group, type: d.type, unit: d.unit,
      restart: !!d.restart, readonly: !!d.readonly, secret: !!d.secret,
      min: d.min, max: d.max, options: optionsFor(d), image: !!d.image, imageHost: d.imageHost, disabledWhen: d.disabledWhen,
      default: d.default, overridden,
    };
    if (d.secret) return { ...base, set: val !== '' && val !== d.default };
    return { ...base, value: val };
  });
}

// Current values of every image-typed setting — the allowlist for admin image pull/inspect,
// so an admin can only act on images the app actually uses.
export function imageConfigValues(): string[] {
  return DEFS.filter((d) => d.image).map((d) => resolve(d.key)).filter(Boolean);
}

// Which daemon an image-typed setting's value lives on: the local socket, or the remote Windows
// host. The admin inspect/pull routes read this so a Framework SDK image is never looked for on the
// Linux daemon (where it can neither be pulled nor run).
export function imageHostFor(image: string): 'local' | 'windows' {
  const d = DEFS.find((x) => x.image && resolve(x.key) === image);
  return d?.imageHost === 'windows' ? 'windows' : 'local';
}

// The (model id → display name) map behind the chat dropdown. Corrupt JSON falls back to the default.
export function modelMap(): Record<string, string> {
  try {
    const m = JSON.parse(cfg.str('models'));
    return m && typeof m === 'object' && !Array.isArray(m) ? m : JSON.parse(DEFAULT_MODELS);
  } catch { return JSON.parse(DEFAULT_MODELS); }
}

// Client-facing subset (any authed user): drives the model dropdown.
// The Docker-readiness flags the UI also gates on are merged in by the /api/config route — importing
// lib/docker-status.ts here would make the two modules circular (it reads cfg).
export function publicConfig(): { models: Record<string, string>; defaultModel: string; defaultEffort: string; sessionImportEnabled: boolean; sessionExportEnabled: boolean; sessionBundleEnabled: boolean; fileTreeWarnCount: number; teamAgentsEnabled: boolean; commonProjectOpen: boolean; llmProvidersEnabled: boolean; approvalsEnabled: boolean; dmEnabled: boolean; searchEnabled: boolean; customContextMenu: boolean; autoTitleEnabled: boolean; autoResumeEnabled: boolean; windowPrimerEnabled: boolean; gitPublishEnabled: boolean; wikiSourceEditEnabled: boolean; wikiLinkEnabled: boolean; wikiAutoLearnEnabled: boolean; reviewWebhookEnabled: boolean; guideEnabled: boolean; guideWriteEnabled: boolean; asideEnabled: boolean; taskPanelEnabled: boolean; projectWatchEnabled: boolean; projectWatchPromptEnabled: boolean; projectWatchPromptMaxChars: number; processPollMs: number; toolFoldMin: number; tokenPoolEnabled: boolean; tokenPoolAllUsers: boolean; tokenPoolPartyCreate: boolean; sessionSandboxEnabled: boolean; winSandboxEnabled: boolean; browserEnabled: boolean } {
  return { models: modelMap(), defaultModel: cfg.str('defaultModel'), defaultEffort: cfg.str('defaultEffort'), sessionImportEnabled: cfg.bool('sessionImportEnabled'), sessionExportEnabled: cfg.bool('sessionExportEnabled'), sessionBundleEnabled: cfg.bool('sessionBundleEnabled'), fileTreeWarnCount: cfg.int('fileTreeWarnCount'), teamAgentsEnabled: cfg.bool('teamAgentsEnabled'), commonProjectOpen: cfg.bool('commonProjectOpen'), llmProvidersEnabled: cfg.bool('llmProvidersEnabled'), approvalsEnabled: cfg.bool('approvalsEnabled'), dmEnabled: cfg.bool('dmEnabled'), searchEnabled: cfg.bool('searchEnabled'), customContextMenu: cfg.bool('customContextMenu'), autoTitleEnabled: cfg.bool('autoTitleEnabled'), autoResumeEnabled: cfg.bool('autoResumeEnabled'), windowPrimerEnabled: cfg.bool('windowPrimerEnabled'), gitPublishEnabled: cfg.bool('gitPublishEnabled'), wikiSourceEditEnabled: cfg.bool('wikiSourceEditEnabled'), wikiLinkEnabled: cfg.bool('wikiLinkEnabled'), wikiAutoLearnEnabled: cfg.bool('wikiAutoLearnEnabled'), reviewWebhookEnabled: cfg.bool('reviewWebhook'), guideEnabled: cfg.bool('guideEnabled'), guideWriteEnabled: cfg.bool('guideWriteEnabled'), asideEnabled: cfg.bool('asideEnabled'), taskPanelEnabled: cfg.bool('taskPanelEnabled'), projectWatchEnabled: cfg.bool('projectWatchEnabled'), projectWatchPromptEnabled: cfg.bool('projectWatchEnabled') && cfg.bool('projectWatchPromptEnabled'), projectWatchPromptMaxChars: cfg.int('projectWatchPromptMaxChars'), processPollMs: cfg.int('processPollMs'), toolFoldMin: cfg.int('toolFoldMin'), tokenPoolEnabled: cfg.bool('tokenPoolEnabled'), tokenPoolAllUsers: cfg.bool('tokenPoolAllUsers'), tokenPoolPartyCreate: cfg.bool('tokenPoolPartyCreate'), sessionSandboxEnabled: cfg.bool('sessionSandboxEnabled'), winSandboxEnabled: cfg.bool('winSandboxEnabled'), browserEnabled: cfg.bool('browserEnabled') };
}
