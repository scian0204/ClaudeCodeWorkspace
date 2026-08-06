import { copyToClipboard } from './clipboard';
import { t } from './i18n';

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// One delegated listener for every rendered code-block copy button (content is injected via
// dangerouslySetInnerHTML, so React can't bind onClick). textContent decodes the escaped code back.
if (typeof document !== 'undefined' && !(window as any).__mdCopyBound) {
  (window as any).__mdCopyBound = true;
  document.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-copy]') as HTMLElement | null;
    if (!btn) return;
    const code = btn.parentElement?.querySelector('pre code')?.textContent ?? '';
    void copyToClipboard(code).then((ok) => {
      const prev = btn.textContent;
      btn.textContent = ok ? `✓ ${t('md.copied')}` : t('md.copyFailed');
      setTimeout(() => { btn.textContent = prev; }, 1500);
    });
  });
}

// NUL-delimited placeholders — a control char that never occurs in (escaped) user text, so
// restoring them can't accidentally match real digits/spaces in the content.
const fenceTok = (i: number) => `\x00f${i}\x00`;
const codeTok = (i: number) => `\x00c${i}\x00`;

// image src resolver for the current md() call — maps relative image hrefs to real URLs
// (e.g. wiki blob endpoint). Set per call from opts.img; undefined = relative images dropped.
let IMG: ((src: string) => string | null) | undefined;

// inline spans, applied to already-escaped text. code spans are pulled out first so **/_/~~
// inside them aren't reprocessed.
function inline(t: string): string {
  const codes: string[] = [];
  t = t.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(`<code class="font-mono text-[0.9em] px-1 rounded" style="background:var(--claysoft)">${c}</code>`);
    return codeTok(codes.length - 1);
  });
  t = t
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, url) => {
      const src = /^https?:/i.test(url) ? url : (IMG ? IMG(url) : null);
      return src ? `<img src="${src}" alt="${alt}" class="max-w-full rounded my-1"/>` : (alt || '');
    })
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-clay underline">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, '$1<em>$2</em>');
  return t.replace(/\x00c(\d+)\x00/g, (_m, i) => codes[+i]);
}

// Lightweight block-level Markdown → HTML (escape-first = XSS-safe). ponytail: hand-rolled, no dep.
// Covers headings(1-6), hr, blockquote, fenced code, ul/ol + task items, GFM tables, paragraphs
// with soft breaks, and inline bold/italic/strike/code/links/images.
export function md(src: string, opts?: { img?: (src: string) => string | null }): string {
  IMG = opts?.img;
  // 1) pull fenced code blocks out first (before escaping/splitting)
  const cb: string[] = [];
  let s = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    cb.push(`<div class="relative group/code"><button type="button" data-copy class="absolute top-1.5 right-1.5 z-10 text-[11px] px-1.5 py-0.5 rounded border border-line bg-card text-txt3 opacity-70 hover:opacity-100 hover:text-clay transition" title="${esc(t('md.copy'))}">${esc(t('md.copy'))}</button><pre class="bg-bg border border-line rounded-lg p-3 my-2 overflow-x-auto scrolly"><code class="font-mono text-[13px]">${esc(code.replace(/\n$/, ''))}</code></pre></div>`);
    return fenceTok(cb.length - 1);
  });
  s = s.replace(/<\/?aside[^>]*>/gi, ''); // Notion callout wrapper — unwrap so inner markdown renders
  s = esc(s);

  const lines = s.split('\n');
  const out: string[] = [];
  const blank = (l: string) => l.trim() === '';
  const fenceLine = (l: string) => /^\x00f\d+\x00$/.test(l.trim());
  const isH = (l: string) => /^ {0,3}#{1,6}\s/.test(l);
  const isHr = (l: string) => /^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(l);
  const isQuote = (l: string) => /^ {0,3}&gt;/.test(l); // '>' is already escaped to &gt; at this point
  const isList = (l: string) => /^\s*([-*+]|\d+\.)\s+/.test(l);
  const special = (l: string) => blank(l) || fenceLine(l) || isH(l) || isHr(l) || isQuote(l) || isList(l);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) { i++; continue; }
    if (fenceLine(line)) { out.push(cb[+/\d+/.exec(line)![0]]); i++; continue; }
    if (isHr(line)) { out.push('<hr class="border-line my-3"/>'); i++; continue; }

    const h = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const n = h[1].length;
      const size = n <= 1 ? 'text-lg' : n === 2 ? 'text-base' : 'text-sm';
      out.push(`<h${n} class="font-semibold ${size} mt-3 mb-1">${inline(h[2])}</h${n}>`); i++; continue;
    }

    if (isQuote(line)) {
      const buf: string[] = [];
      while (i < lines.length && isQuote(lines[i])) { buf.push(lines[i].replace(/^ {0,3}&gt;\s?/, '')); i++; }
      out.push(`<blockquote class="border-l-2 border-line pl-3 text-txt2 my-2">${inline(buf.join('\n')).replace(/\n/g, '<br/>')}</blockquote>`);
      continue;
    }

    // GFM table: header row + a |---|---| separator on the next line
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1])) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
      const head = cells(line); i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && !blank(lines[i])) { rows.push(cells(lines[i])); i++; }
      let tb = '<div class="overflow-x-auto scrolly my-2"><table class="text-sm border-collapse"><thead><tr>';
      tb += head.map((c) => `<th class="border border-line px-2 py-1 text-left font-semibold">${c}</th>`).join('');
      tb += '</tr></thead><tbody>';
      tb += rows.map((r) => `<tr>${r.map((c) => `<td class="border border-line px-2 py-1">${c}</td>`).join('')}</tr>`).join('');
      out.push(tb + '</tbody></table></div>');
      continue;
    }

    if (isList(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && isList(lines[i]) && /^\s*\d+\.\s+/.test(lines[i]) === ordered) {
        let item = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(lines[i])![1];
        item = item.replace(/^\[([ xX])\]\s+/, (_m, c) => (c === ' ' ? '☐ ' : '☑ ')); // task list
        items.push(`<li>${inline(item)}</li>`); i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag} class="${ordered ? 'list-decimal' : 'list-disc'} pl-5 my-2 space-y-0.5">${items.join('')}</${tag}>`);
      continue;
    }

    // paragraph: consecutive normal lines; single newlines become soft <br> (no blank-line gaps)
    const para: string[] = [];
    while (i < lines.length && !special(lines[i])) { para.push(lines[i]); i++; }
    out.push(`<p class="my-2 leading-relaxed">${inline(para.join('\n')).replace(/\n/g, '<br/>')}</p>`);
  }

  // restore any fenced-code placeholder that ended up inside another block
  return out.join('').replace(/\x00f(\d+)\x00/g, (_m, i) => cb[+i]);
}

// ── live markdown for what the user is TYPING (see MdMirror in lib/ui.tsx) ──────────────────────
// This renders a mirror that sits *behind* a transparent-text textarea; the caret and the line
// wrapping still come from the textarea's own layout. So every character of the input must survive
// (markers included) and every style used here must preserve glyph advance widths — colour,
// background and the faux-bold text-stroke do; font-weight / font-family / font-size / padding do
// not, and would drift the visible glyphs away from the caret. Hence no real bold and no italics.
const dim = (s: string) => `<span class="mdh-mark">${s}</span>`;

function hlInline(s: string): string {
  const codes: string[] = [];
  // code spans first, so ** / ~~ inside them are left alone
  s = s.replace(/`([^`\n]*)`/g, (_m, c) => {
    codes.push(`${dim('`')}<span class="mdh-code">${c}</span>${dim('`')}`);
    return codeTok(codes.length - 1);
  });
  s = s
    .replace(/\*\*([^*\n]+)\*\*/g, (_m, c) => `${dim('**')}<span class="mdh-b">${c}</span>${dim('**')}`)
    .replace(/~~([^~\n]+)~~/g, (_m, c) => `${dim('~~')}<span class="line-through">${c}</span>${dim('~~')}`)
    .replace(/(^|\s)(@[^\s@]+)/g, (_m, p, r) => `${p}<span class="mdh-ref">${r}</span>`);
  return s.replace(/\x00c(\d+)\x00/g, (_m, i) => codes[+i]);
}

export function mdHighlight(src: string): string {
  return src.split('\n').map((raw) => {
    const line = esc(raw);
    let m = /^(\s*)(```\w*)(.*)$/.exec(line);          // fence open/close
    if (m) return m[1] + dim(m[2]) + hlInline(m[3]);
    m = /^(\s*)(#{1,6}\s)(.*)$/.exec(line);            // heading
    if (m) return m[1] + dim(m[2]) + `<span class="mdh-b">${hlInline(m[3])}</span>`;
    m = /^(\s*)(&gt;\s?)(.*)$/.exec(line);             // blockquote ('>' is escaped by now)
    if (m) return m[1] + dim(m[2]) + `<span class="text-txt2">${hlInline(m[3])}</span>`;
    m = /^(\s*)([-*+]\s|\d+\.\s)(.*)$/.exec(line);     // ul / ol item
    if (m) return m[1] + `<span class="mdh-li">${m[2]}</span>` + hlInline(m[3]);
    m = /^(\s*)(\/[a-zA-Z][\w:-]*)(.*)$/.exec(line);   // slash command (this app's own syntax)
    if (m) return m[1] + `<span class="mdh-li">${m[2]}</span>` + hlInline(m[3]);
    return hlInline(line);
  }).join('\n');
}
