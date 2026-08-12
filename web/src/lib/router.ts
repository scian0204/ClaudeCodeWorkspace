import { useStore } from './store';

// History-API router (no dependency). URL scheme, mirroring Shell's view priority
// (panel > DM channel > current thread > home):
//   /               home            /chat/:sessionId   private chat
//   /room/:roomId   room            /wiki/:topicId     wiki thread
//   /review/:id     PR review       /dm/:channelId     DM / group channel
//   /admin  /plugins  /me           panels
// viewMode/editorUrl stay out of the URL: ephemeral, and openEditor mints a fresh URL per open.
// Authorization stays server-side — deep-linking a foreign id just makes the opener's GET fail.

const BASE = import.meta.env.BASE_URL; // '/' in prod · '/ClaudeCodeWorkspace/' in the demo build
const toUrl = (p: string) => BASE.replace(/\/$/, '') + p;
export const fromUrl = (): string => location.pathname.slice(BASE.length - 1) || '/';

type S = ReturnType<typeof useStore.getState>;

function pathFromState(s: S): string {
  if (s.panel) return `/${s.panel}`;
  if (s.activeChannelId) return `/dm/${s.activeChannelId}`;
  const c = s.current;
  if (!c) return '/';
  // wiki first: its kind is 'private' but the thread must restore through the topic endpoint
  if (c.wikiTopicId) return `/wiki/${c.wikiTopicId}`;
  if (c.kind === 'room') return `/room/${c.roomId}`;
  if (c.kind === 'review') return `/review/${c.reviewId}`;
  return `/chat/${c.chatSessionId}`;
}

let applying = false; // URL→store navigation in flight: the subscription must not echo it back

export async function applyPath(path: string): Promise<void> {
  const s = useStore.getState();
  if (!s.user) return;
  const [, head, id] = path.split('/');
  applying = true;
  // thread routes: clear any open panel first — join() doesn't touch `panel`, and a panel outranks
  // the thread in Shell's priority chain (same setPanel(null)+open pairing every Sidebar row uses)
  const clearPanel = () => { if (useStore.getState().panel) s.setPanel(null); };
  try {
    switch (head) {
      case 'chat': if (id) { clearPanel(); await s.openPrivate(id); } break;
      case 'room': if (id) { clearPanel(); await s.openRoom(id); } break;
      case 'wiki': if (id) { clearPanel(); await s.openWiki(id); } break;
      case 'review': if (id) { clearPanel(); await s.openReview(id); } break;
      case 'dm': if (id && s.dmEnabled) await s.openChannel(id); break; // openChannel clears the panel itself
      case 'admin': if (s.user.role === 'admin') s.setPanel('admin'); else s.goHome(); break;
      case 'plugins': s.setPanel('plugins'); break;
      case 'me': s.setPanel('me'); break;
      case '': case undefined: s.goHome(); break;
      default: s.goHome();
    }
  } catch {
    // deleted/foreign/unknown id — the API 403/404s; land home instead of a broken view
    useStore.getState().goHome();
  } finally {
    applying = false;
    // self-correct the bar when the landing view differs from what the URL asked for
    // (failed open, member hitting /admin, dm disabled, unknown segment …)
    const landed = pathFromState(useStore.getState());
    if (landed !== path) history.replaceState(null, '', toUrl(landed));
  }
}

let wired = false;

// Called once after bootstrap resolves (App.tsx). Idempotent — StrictMode mounts twice in dev.
export function initRouter(): void {
  if (wired) return; wired = true;

  window.addEventListener('popstate', () => { void applyPath(fromUrl()); });

  let lastPath: string | null = null;
  useStore.subscribe((s, prev) => {
    // Login screen: never sync store→URL while logged out, or the deep link gets rewritten to '/'.
    if (!s.user) { lastPath = null; return; }
    // The moment a user lands (bootstrap /me or manual login), apply the URL the tab arrived with.
    if (!prev.user) { lastPath = pathFromState(s); void applyPath(fromUrl()); return; }
    const p = pathFromState(s);
    if (p === lastPath) return;
    lastPath = p;
    if (applying) return; // URL-side navigation already owns the bar
    if (p === fromUrl()) return;
    // '/' transitions replace instead of push: openers pass through home-shaped intermediate
    // states (openHit clears the panel before awaiting), and stacking those breaks back/forward.
    if (p === '/') history.replaceState(null, '', toUrl(p));
    else history.pushState(null, '', toUrl(p));
  });

  // bootstrap resolved before init (the common path) — apply the deep link now
  if (useStore.getState().user) void applyPath(fromUrl());
}
