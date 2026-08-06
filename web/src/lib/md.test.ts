// Runnable check (no framework): npx tsx web/src/lib/md.test.ts
// Covers the composer's live-markdown mirror. The mirror is painted BEHIND a transparent-text
// textarea that still owns the caret, so the one invariant that matters is that highlighting is
// purely additive: strip the tags back out and you must get the original input, character for
// character. Drop or add a single char and every caret to its right lands on the wrong glyph.
export {}; // makes this a module, so the top-level await below is allowed

// md.ts pulls in i18n (for the code-block copy button's label), which stamps <html lang> on load.
// Stub the two globals it needs, then import — this check is pure string work, no DOM.
(globalThis as any).document = { documentElement: { setAttribute() {} }, addEventListener() {} };
(globalThis as any).window = {};
const { mdHighlight } = await import('./md.js');

const eq = (got: unknown, want: unknown, what: string) => {
  const [a, b] = [JSON.stringify(got), JSON.stringify(want)];
  if (a !== b) throw new Error(`${what}: got ${a}, want ${b}`);
};

// inverse of the escaping mdHighlight does, plus tag removal
const plain = (html: string) => html
  .replace(/<[^>]*>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const SAMPLES = [
  '',
  'plain text',
  '**bold** and `code` and ~~struck~~',
  '# heading\n## second',
  '- one\n- two\n  - nested',
  '1. first\n2. second',
  '> quoted line',
  '```ts\nconst a = 1 < 2 && 3 > 2;\n```',
  '@src/app.ts and /review please',
  'unclosed ** and lone ` and <script>alert("x")</script>',
  '한글 **굵게** `코드` 목록:\n- 항목\n\n\n', // trailing blank lines must survive too
  '  \t indented   with   spaces  ',
];

for (const s of SAMPLES) {
  eq(plain(mdHighlight(s)), s, `round-trip ${JSON.stringify(s.slice(0, 24))}`);
}

// the markers are kept but marked, and the content gets its own span — this is what makes the
// highlight visible at all (a pure round-trip would also pass on a no-op implementation)
const h = mdHighlight('**b** `c`\n- item\n1. num\n# head');
for (const cls of ['mdh-mark', 'mdh-b', 'mdh-code', 'mdh-li']) {
  if (!h.includes(cls)) throw new Error(`missing ${cls} in ${h}`);
}

// escaping is not optional: the mirror is injected with innerHTML
if (mdHighlight('<img onerror=1>').includes('<img')) throw new Error('raw HTML leaked into the mirror');

// line count must match the input's, or wrapped lines drift vertically
eq(mdHighlight('a\nb\nc').split('\n').length, 3, 'line count preserved');

console.log('md.test.ts ok');
