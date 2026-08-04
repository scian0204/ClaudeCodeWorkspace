// Client-side actions the guide agent can trigger.
//
// Some of the product lives only in the browser — the language, the theme, which panel is open, the
// shortcut sheet. Those have no HTTP route to call, so the agent emits one of these instead and the
// server pushes it to every tab of that user (socket event `guide:action`). The store applies it.
//
// This table is the single source of truth for BOTH the tool's schema and the prompt's action list.
// The mirror on the client is web/src/lib/store.ts (applyGuideAction) — keep the two in step.

export interface UiAction {
  action: string;
  value?: string;  // documented value shape; absent = takes none
  note: string;
  admin?: boolean; // only offered to (and only applied for) an admin
}

export const UI_ACTIONS: UiAction[] = [
  { action: 'openSession', value: '<sessionId>', note: 'open a private chat in the main area.' },
  { action: 'openRoom', value: '<roomId>', note: 'open a shared room.' },
  { action: 'openWiki', value: '<topicId>', note: 'open an LLM Wiki topic thread.' },
  { action: 'openReview', value: '<reviewId>', note: 'open a PR review session.' },
  { action: 'openChannel', value: '<channelId>', note: 'open a DM / group channel.' },
  { action: 'openPanel', value: 'plugins|me', note: 'open the plugins panel or My Page.' },
  { action: 'openAdmin', note: 'open the admin panel.', admin: true },
  { action: 'newChat', note: 'create and open a fresh private chat (no API call needed).' },
  { action: 'goHome', note: 'go back to the landing screen.' },
  { action: 'openShortcuts', note: 'open the keyboard-shortcut cheat sheet.' },
  { action: 'openSearch', note: 'open the workspace search palette.' },
  { action: 'setLanguage', value: 'ko|en', note: 'switch the interface language.' },
  { action: 'setTheme', value: 'light|dark', note: 'switch the colour theme.' },
  { action: 'toggleSidebar', note: 'show/hide the sidebar.' },
  { action: 'refresh', note: 're-pull the sidebar lists. Use after creating a project/plugin/room so the change shows up.' },
];

const byAction = new Map(UI_ACTIONS.map((a) => [a.action, a]));

export function findUiAction(action: string, isAdmin: boolean): UiAction | null {
  const a = byAction.get(String(action));
  if (!a || (a.admin && !isAdmin)) return null;
  return a;
}

export function uiActionReference(isAdmin: boolean): string {
  return UI_ACTIONS.filter((a) => isAdmin || !a.admin)
    .map((a) => `- ${a.action}${a.value ? ` (value: ${a.value})` : ''}${a.admin ? ' [admin]' : ''} — ${a.note}`)
    .join('\n');
}
