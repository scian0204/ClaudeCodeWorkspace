// Keyboard shortcut cheat sheet (? or the sidebar footer row). Keys are rendered per platform —
// ⇧⌘O on a Mac, Ctrl+Shift+O everywhere else — straight from the SHORTCUT_GROUPS table.
import { useStore } from '../lib/store';
import { Modal } from './Modal';
import { SHORTCUT_GROUPS, fmtKeys, isMac } from '../lib/shortcuts';
import { useT } from '../lib/i18n';

function Kbd({ spec }: { spec: string }) {
  return (
    <kbd className="font-mono text-[11px] leading-none bg-rail border border-line2 rounded px-1.5 py-1 text-txt2 whitespace-nowrap">
      {fmtKeys(spec)}
    </kbd>
  );
}

export function ShortcutsHelp() {
  const open = useStore((s) => s.shortcutsOpen);
  const setOpen = useStore((s) => s.setShortcutsOpen);
  const t = useT();
  return (
    <Modal open={open} onOpenChange={setOpen} title={t('sc.title')} width={460}>
      <div className="text-[11px] text-txt3 mb-3">{t(isMac ? 'sc.platformMac' : 'sc.platformPc')}</div>
      {SHORTCUT_GROUPS.map((g) => (
        <div key={g.label} className="mb-3 last:mb-0">
          <div className="text-[11px] uppercase tracking-wider text-txt3 font-semibold mb-1">{t(g.label)}</div>
          <div className="border border-line rounded-lg divide-y divide-line">
            {g.rows.map((r) => (
              <div key={r.label} className="flex items-center gap-2 px-2.5 py-2">
                <span className="text-[13px] text-txt2 flex-1 min-w-0">{t(r.label)}</span>
                <span className="flex items-center gap-1 shrink-0">
                  {r.keys.map((k) => <Kbd key={k} spec={k} />)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Modal>
  );
}
