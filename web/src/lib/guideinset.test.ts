// Runnable check (no framework): npx tsx web/src/lib/guideinset.test.ts
// The padding that keeps a composer row clear of the guide launcher. This value is measured every
// commit and then applied to the thing being measured, so the checks that matter are the ones where
// it could feed itself: a viewport reported as 0x0 (hidden pane / not laid out yet) used to produce
// a padding the size of the whole row and grow it every pass until React tore the page down, and a
// row wider than the window must still ask for no more than the launcher's own square.
import { guideInsetPx, launcherBox } from './guideinset.js';

const eq = (got: unknown, want: unknown, what: string) => {
  if (got !== want) throw new Error(`${what}: got ${got}, want ${want}`);
};
const DESK = launcherBox(1280); // 84
const PHONE = launcherBox(375); // 68

// --- a narrow centred card on a wide screen already ends left of the launcher ---
eq(guideInsetPx({ right: 1000, bottom: 700 }, 1280, 720, ), 0, 'card that clears needs nothing');
// --- a row high above the launcher clears it vertically, however wide it is ---
eq(guideInsetPx({ right: 1280, bottom: 200 }, 1280, 720), 0, 'row above the launcher');
// --- full-width row sitting in the corner: exactly the launcher's square ---
eq(guideInsetPx({ right: 1280, bottom: 700 }, 1280, 720), DESK, 'full-width desktop row');
eq(guideInsetPx({ right: 375, bottom: 800 }, 375, 812), PHONE, 'full-width phone row');
// --- partway under it: only the missing part ---
eq(guideInsetPx({ right: 1240, bottom: 700 }, 1280, 720), DESK - 40, 'partly under the launcher');

// --- the two ways it used to run away ---
eq(guideInsetPx({ right: 300, bottom: 900 }, 0, 0), 0, 'a 0x0 viewport asks for no padding');
eq(guideInsetPx({ right: 4675, bottom: 909 }, 1280, 720), DESK, 'a row wider than the window is capped');
// applying the answer must not grow the next one: feed the padded edge back in, still capped
eq(guideInsetPx({ right: 1280 + DESK, bottom: 700 }, 1280, 720), DESK, 'the answer does not chase itself');

console.log('guideinset: all checks passed');
