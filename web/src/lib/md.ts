const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Lightweight Markdown → HTML (escape-first, so it's XSS-safe).
// ponytail: intentionally partial — headings, bold/italic, code, lists, links, quotes.
// Not a full CommonMark parser; good enough for chat + wiki preview rendering.
export function md(src: string): string {
  const codeBlocks: string[] = [];
  // 1) pull fenced code blocks out first so inline rules don't touch them
  let s = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    const i = codeBlocks.length;
    codeBlocks.push(`<pre class="bg-bg border border-line rounded-lg p-3 my-2 overflow-x-auto scrolly"><code class="font-mono text-[13px]">${esc(code.replace(/\n$/, ''))}</code></pre>`);
    return ` CB${i} `;
  });
  s = esc(s);
  const inline = (t: string) => t
    .replace(/`([^`]+)`/g, '<code class="font-mono text-[13px] px-1 rounded" style="background:var(--claysoft)">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-clay underline">$1</a>');
  // 2) block-level: headings, lists, blockquotes, paragraphs
  const lines = s.split('\n');
  const out: string[] = [];
  let list: '' | 'ul' | 'ol' = '';
  const closeList = () => { if (list) { out.push(`</${list}>`); list = ''; } };
  for (const line of lines) {
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    const qt = /^&gt;\s?(.*)$/.exec(line);
    if (h) { closeList(); const n = h[1].length; out.push(`<h${n} class="font-semibold ${n === 1 ? 'text-lg' : n === 2 ? 'text-base' : 'text-sm'} mt-2 mb-1">${inline(h[2])}</h${n}>`); }
    else if (ul) { if (list !== 'ul') { closeList(); list = 'ul'; out.push('<ul class="list-disc pl-5 my-1">'); } out.push(`<li>${inline(ul[1])}</li>`); }
    else if (ol) { if (list !== 'ol') { closeList(); list = 'ol'; out.push('<ol class="list-decimal pl-5 my-1">'); } out.push(`<li>${inline(ol[1])}</li>`); }
    else if (qt) { closeList(); out.push(`<blockquote class="border-l-2 border-line pl-3 text-txt2 my-1">${inline(qt[1])}</blockquote>`); }
    else if (line.trim() === '') { closeList(); out.push(''); }
    else { closeList(); out.push(`<span>${inline(line)}</span>`); }
  }
  closeList();
  let html = out.join('\n').replace(/\n/g, '<br/>');
  // restore code blocks (strip the <br/> the join may have added around the placeholder)
  html = html.replace(/(<br\/>)? CB(\d+) (<br\/>)?/g, (_m, _a, i) => codeBlocks[+i]);
  return html;
}
