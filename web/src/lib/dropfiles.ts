// Collect files from a drop or a file/folder picker, each with its path relative to the drop root
// (the server rebuilds the tree from that path). Shared by every bulk-upload surface: wiki topic
// creation, wiki source management, and the local session import.

export type Collected = { file: File; rel: string };

function readEntries(reader: any): Promise<any[]> {
  return new Promise((res, rej) => reader.readEntries(res, rej));
}

// Recursively walk a dropped FileSystemEntry tree (all depths).
async function traverseEntry(entry: any, parent: string, out: Collected[]) {
  if (entry.isFile) {
    const file: File = await new Promise((res, rej) => entry.file(res, rej));
    out.push({ file, rel: parent ? `${parent}/${file.name}` : file.name });
  } else if (entry.isDirectory) {
    const p = parent ? `${parent}/${entry.name}` : entry.name;
    const reader = entry.createReader();
    let batch: any[];
    do { batch = await readEntries(reader); for (const e of batch) await traverseEntry(e, p, out); } while (batch.length);
  }
}

// Dropped items: prefer the entry API (folders, any depth); fall back to the flat file list.
export async function collectDrop(dt: DataTransfer): Promise<Collected[]> {
  const entries: any[] = [];
  for (let i = 0; i < dt.items.length; i++) { const en = (dt.items[i] as any).webkitGetAsEntry?.(); if (en) entries.push(en); }
  const out: Collected[] = [];
  if (entries.length) { for (const en of entries) await traverseEntry(en, '', out); }
  else { for (const f of Array.from(dt.files)) out.push({ file: f, rel: f.name }); }
  return out;
}

// Picker: webkitRelativePath is set for the folder picker, empty for the flat one → use the name.
export function collectPick(fl: FileList | null): Collected[] {
  if (!fl?.length) return [];
  return Array.from(fl).map((f) => ({ file: f, rel: (f as any).webkitRelativePath || f.name }));
}
