// Runnable check (no framework): npx tsx web/src/lib/cli-commands.test.ts
// These commands used to reach the CLI and come back as "isn't available in this environment".
// What matters now is that the composer recognises them, that a mode-taking one refuses to guess
// when no mode was typed, and that a screen without the target quietly drops the command instead of
// opening a panel over nothing.
// Hand-rolled eq() instead of node:assert — the web workspace has no node types (same as
// ctxrows.test.ts) — and this still exits non-zero on failure.
import { WORKSPACE_CMDS, findWorkspaceCmd, splitCommand, PERM_MODES, type CmdStore } from './cli-commands.js';

const eq = (got: unknown, want: unknown, what: string) => {
  const [a, b] = [JSON.stringify(got), JSON.stringify(want)];
  if (a !== b) throw new Error(`${what}: got ${a}, want ${b}`);
};
const ok = (cond: unknown, what: string) => { if (!cond) throw new Error(what); };

// ── the table itself ──
const names = WORKSPACE_CMDS.flatMap((c) => c.cmds);
eq(new Set(names).size, names.length, 'no command name is claimed twice');
ok(names.every((n) => /^\/[a-z][a-z-]*$/.test(n)), 'every name is a lowercase /command');

// ── argument splitting ──
eq(splitCommand('/permissions'), { token: '/permissions', arg: '' }, 'bare command');
eq(splitCommand('  /permissions   plan  '), { token: '/permissions', arg: 'plan' }, 'padding is trimmed off both parts');
eq(splitCommand('/theme light'), { token: '/theme', arg: 'light' }, 'one argument');

// ── a stub store that records what was called ──
function stub(over: Partial<CmdStore> = {}) {
  const calls: string[] = [];
  const rec = (name: string) => (v?: unknown) => { calls.push(v === undefined ? name : `${name}:${v}`); };
  const s: CmdStore = {
    current: { projectId: 'p1', permissionMode: 'default' },
    theme: 'light', user: { role: 'member' },
    sessionExportEnabled: true, searchEnabled: true, taskPanelEnabled: true, dockerReady: true,
    setMode: async (m) => { calls.push(`setMode:${m}`); },
    setSandbox: async (on) => { calls.push(`setSandbox:${on}`); },
    setExportOpen: rec('setExportOpen'), setPanel: rec('setPanel'), setTasksOpen: rec('setTasksOpen'),
    setGitPanelOpen: rec('setGitPanelOpen'), setExplorerOpen: rec('setExplorerOpen'),
    setShortcutsOpen: rec('setShortcutsOpen'), setSearchOpen: rec('setSearchOpen'),
    setSidebarOpen: rec('setSidebarOpen'), setViewMode: rec('setViewMode'),
    toggleTheme: () => { calls.push('toggleTheme'); },
    ...over,
  };
  return { s, calls };
}
const run = (cmd: string, arg = '', over: Partial<CmdStore> = {}) => {
  const { s, calls } = stub(over);
  const entry = findWorkspaceCmd(cmd);
  ok(entry, `${cmd} is in the table`);
  return { handled: entry!.run(s, arg), calls };
};

// ── /permissions: only a real mode is acted on ──
eq(run('/permissions', 'plan'), { handled: true, calls: ['setMode:plan'] }, '/permissions plan');
eq(run('/permissions', 'bypassPermissions').calls, ['setMode:bypassPermissions'], '/permissions bypassPermissions');
// bare, or a mode that does not exist: the composer must fill the command in, not send or guess
eq(run('/permissions'), { handled: false, calls: [] }, 'bare /permissions waits for its argument');
eq(run('/permissions', 'yolo'), { handled: false, calls: [] }, 'an invented mode is not applied');
ok(PERM_MODES.includes('default') && PERM_MODES.length === 4, 'four permission modes');

// ── the rest are one-shot ──
eq(run('/plan').calls, ['setMode:plan'], '/plan');
eq(run('/export').calls, ['setExportOpen:true'], '/export');
eq(run('/help').calls, ['setShortcutsOpen:true'], '/help');
eq(run('/skills').calls, ['setPanel:plugins'], 'an alias reaches the same action');
eq(run('/bashes').calls, ['setTasksOpen:true'], '/bashes');
eq(run('/branch').calls, ['setGitPanelOpen:true'], '/branch');
eq(run('/memory').calls, ['setExplorerOpen:true'], '/memory');
eq(run('/logout').calls, ['setPanel:me'], '/logout');
eq(run('/tui').calls, ['setViewMode:editor'], '/tui');

// ── /sandbox and /theme read their argument ──
eq(run('/sandbox').calls, ['setSandbox:true'], 'bare /sandbox turns it on');
eq(run('/sandbox', 'off').calls, ['setSandbox:false'], '/sandbox off');
eq(run('/theme', 'dark').calls, ['toggleTheme'], '/theme dark from light');
eq(run('/theme', 'light').calls, [], 'already light — nothing to do');

// ── a missing target is dropped, never sent on to the CLI ──
const noProject = { current: { projectId: null, permissionMode: 'default' } };
eq(run('/diff', '', noProject), { handled: true, calls: [] }, 'no project → no git panel');
eq(run('/memory', '', noProject), { handled: true, calls: [] }, 'no project → no file explorer');
eq(run('/ide', '', { dockerReady: false }), { handled: true, calls: [] }, 'no docker → no editor view');
eq(run('/export', '', { sessionExportEnabled: false }), { handled: true, calls: [] }, 'export switched off');
eq(run('/privacy-settings').calls, [], 'a member gets no admin panel');
eq(run('/privacy-settings', '', { user: { role: 'admin' } }).calls, ['setPanel:admin'], 'an admin does');
// search switched off: the sidebar is where the past chats are
eq(run('/resume', '', { searchEnabled: false }).calls, ['setSidebarOpen:true'], '/resume without search');
eq(run('/resume').calls, ['setSearchOpen:true'], '/resume with search');

// ── an ordinary command is not ours ──
eq(findWorkspaceCmd('/compact'), undefined, '/compact still runs on the CLI');
eq(findWorkspaceCmd('/Permissions'), undefined, 'matching is case-sensitive, like the CLI');

console.log('cli-commands.test.ts ok');
