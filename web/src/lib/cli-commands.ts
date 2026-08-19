// Slash commands the Claude Code CLI only draws as an interactive terminal panel.
//
// The workspace runs the CLI through the Agent SDK, and the SDK has no terminal to draw one in, so
// the CLI answers every one of them with "/permissions isn't available in this environment." and
// nothing happens. Checked against the CLI that ships with the SDK (2026-08): the panel commands are
// registered with a different command type from the ones that work, and the headless dispatcher
// swaps them for that one sentence before they run. No flag, env var or option turns them back on —
// the panel is terminal drawing code, and there is no terminal.
//
// Each of them, though, is something this workspace already does in its own UI. So the composer
// answers them itself: the text never reaches the CLI, the matching panel or control opens instead.
// The same table feeds the "/" menu, so the commands are listed again rather than just failing.
//
// Deliberately partial. A command with no real counterpart here (/hooks, /bug, /install-github-app …)
// is left out, so the CLI's own "not available" answer still stands — better than a button that
// pretends. Add an entry the day the workspace grows the thing it would open.
//
// Pure data + one lookup, so it can be checked without React or the store (cli-commands.test.ts).

// Only the store members the table below touches. Structural, so the real store satisfies it and a
// test can pass a stub.
export interface CmdStore {
  current: { projectId: string | null; permissionMode: string } | null;
  theme: 'light' | 'dark' | null;
  user: { role: string } | null;
  sessionExportEnabled: boolean;
  searchEnabled: boolean;
  taskPanelEnabled: boolean;
  dockerReady: boolean;
  setMode: (mode: string) => Promise<void>;
  setSandbox: (on: boolean) => Promise<void>;
  setExportOpen: (open: boolean) => void;
  setPanel: (p: null | 'admin' | 'plugins' | 'agents' | 'me') => void;
  setTasksOpen: (open: boolean) => void;
  setGitPanelOpen: (open: boolean) => void;
  setExplorerOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  setViewMode: (m: 'chat' | 'split' | 'editor') => void;
  toggleTheme: () => void;
}

export interface WorkspaceCmd {
  cmds: string[];   // '/name' plus the CLI's aliases for the same panel
  label: string;    // i18n key — says what the workspace opens, not what the CLI would have done
  hint?: string;    // argument hint, ghosted in the composer the same way a CLI one is
  // true  → handled; the composer clears.
  // false → the command needs an argument it did not get; the composer fills the command in and
  //         ghosts `hint` so the person can finish typing it (what a plain CLI command does).
  run: (s: CmdStore, arg: string) => boolean;
}

export const PERM_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];

// A target that is not on screen (no project, feature switched off) drops the command instead of
// leaving a panel open over nothing — the same rule applyGuideAction follows in store.ts.
export const WORKSPACE_CMDS: WorkspaceCmd[] = [
  {
    cmds: ['/permissions'], label: 'cliCmd.permissions', hint: PERM_MODES.join('|'),
    run: (s, arg) => { if (!PERM_MODES.includes(arg)) return false; void s.setMode(arg); return true; },
  },
  { cmds: ['/plan'], label: 'cliCmd.plan', run: (s) => { void s.setMode('plan'); return true; } },
  {
    cmds: ['/sandbox'], label: 'cliCmd.sandbox', hint: 'on|off',
    run: (s, arg) => { void s.setSandbox(arg !== 'off'); return true; },
  },
  {
    cmds: ['/export'], label: 'cliCmd.export',
    run: (s) => { if (s.sessionExportEnabled) s.setExportOpen(true); return true; },
  },
  {
    cmds: ['/theme'], label: 'cliCmd.theme', hint: 'light|dark',
    run: (s, arg) => { if (arg !== s.theme) s.toggleTheme(); return true; },
  },
  { cmds: ['/plugin', '/plugins', '/skills'], label: 'cliCmd.plugins', run: (s) => { s.setPanel('plugins'); return true; } },
  {
    cmds: ['/tasks', '/bashes', '/workflows'], label: 'cliCmd.tasks',
    run: (s) => { if (s.taskPanelEnabled && s.current) s.setTasksOpen(true); return true; },
  },
  {
    cmds: ['/diff', '/branch'], label: 'cliCmd.git',
    run: (s) => { if (s.current?.projectId) s.setGitPanelOpen(true); return true; },
  },
  {
    cmds: ['/memory'], label: 'cliCmd.memory',
    run: (s) => { if (s.current?.projectId) s.setExplorerOpen(true); return true; },
  },
  { cmds: ['/login', '/logout', '/status'], label: 'cliCmd.account', run: (s) => { s.setPanel('me'); return true; } },
  {
    cmds: ['/privacy-settings'], label: 'cliCmd.privacy',
    run: (s) => { if (s.user?.role === 'admin') s.setPanel('admin'); return true; },
  },
  { cmds: ['/help'], label: 'cliCmd.help', run: (s) => { s.setShortcutsOpen(true); return true; } },
  {
    cmds: ['/resume', '/session'], label: 'cliCmd.resume',
    run: (s) => { if (s.searchEnabled) s.setSearchOpen(true); else s.setSidebarOpen(true); return true; },
  },
  {
    cmds: ['/ide', '/terminal-setup', '/tui'], label: 'cliCmd.editor',
    run: (s) => { if (s.dockerReady && s.current?.projectId) s.setViewMode('editor'); return true; },
  },
];

const byCmd = new Map(WORKSPACE_CMDS.flatMap((c) => c.cmds.map((name) => [name, c] as const)));

// The command token is matched exactly and case-sensitively, the way the CLI matches its own.
export const findWorkspaceCmd = (token: string): WorkspaceCmd | undefined => byCmd.get(token);

// Split "/permissions plan" into the command token and the rest, both trimmed.
export function splitCommand(text: string): { token: string; arg: string } {
  const t = text.trim();
  const sp = t.search(/\s/);
  return sp < 0 ? { token: t, arg: '' } : { token: t.slice(0, sp), arg: t.slice(sp).trim() };
}
