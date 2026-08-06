// One copy path for the whole app.
//
// `navigator.clipboard` only exists in a SECURE context (https:// or localhost). This workspace is
// normally reached over plain http:// on a LAN address, where the property is simply absent — so
// every `navigator.clipboard.writeText(...)` threw and every `navigator.clipboard?.writeText(...)`
// silently returned undefined. That is why all the copy buttons looked dead.
//
// Fall back to the legacy selection + execCommand('copy') path, which needs no secure context.
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* permission denied / document not focused → try the fallback */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    // off-screen but still selectable — display:none / visibility:hidden make the copy a no-op
    ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    const sel = document.getSelection();
    const prev = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    ta.select();
    ta.setSelectionRange(0, ta.value.length); // iOS ignores select() on a readonly field
    const ok = document.execCommand('copy');
    ta.remove();
    if (sel && prev) { sel.removeAllRanges(); sel.addRange(prev); } // give the user their selection back
    return ok;
  } catch { return false; }
}
