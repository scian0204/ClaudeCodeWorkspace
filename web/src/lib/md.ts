const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// NUL-delimited placeholders — a control char that never occurs in (escaped) user text, so
// restoring them can't accidentally match real digits/spaces in the content.
const fenceTok = (i: number) => `\x00f${i}\x00`;
const codeTok = (i: number) => `\x00c${i}\x00`;

// inline spans, applied to already-escaped text. code spans are pulled out first so **/_/~~
// inside them aren't reprocessed.
function inline(t: string): string {
  const codes: string[] = [];
  t = t.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(`<code class="font-mono text-[0.9em] px-1 rounded" style="background:var(--claysoft)">${c}</code>`);
    return codeTok(codes.length - 1);
  });
  t = t
    .replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '<img src="$2" alt="$1" class="max-w-full rounded my-1"/>')
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
export function md(src: string): string {
  // 1) pull fenced code blocks out first (before escaping/splitting)
  const cb: string[] = [];
  let s = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    cb.push(`<pre class="bg-bg border border-line rounded-lg p-3 my-2 overflow-x-auto scrolly"><code class="font-mono text-[13px]">${esc(code.replace(/\n$/, ''))}</code></pre>`);
    return fenceTok(cb.length - 1);
  });
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
