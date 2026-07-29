async function j(method: string, p: string, body?: any) {
  const r = await fetch(p, {
    method, credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as any).error || r.statusText);
  return data;
}

export const api = {
  get: (p: string) => j('GET', p),
  post: (p: string, b?: any) => j('POST', p, b),
  put: (p: string, b?: any) => j('PUT', p, b),
  patch: (p: string, b?: any) => j('PATCH', p, b),
  del: (p: string) => j('DELETE', p),
  upload: async (p: string, form: FormData) => {
    const r = await fetch(p, { method: 'POST', body: form, credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((d as any).error || r.statusText);
    return d;
  },
  // Bulk upload, ONE request per file (sequential). Avoids a single huge multipart request (413 on
  // big session folders) and yields real per-file + overall progress. Each file's relative path is
  // carried in the multipart field NAME (the server rebuilds the tree). Resolves with the last
  // response body (staging endpoints return the accumulated file list). Rejects on first failure.
  uploadFiles: (
    p: string,
    items: { file: File; rel: string }[],
    onProgress: (s: UploadState) => void,
  ) => new Promise<any>((resolve, reject) => {
    const total = items.length;
    const totalBytes = items.reduce((a, x) => a + x.file.size, 0) || 1;
    let doneBytes = 0;
    let last: any = {};
    const sendOne = (i: number) => {
      if (i >= total) { resolve(last); return; }
      const { file, rel } = items[i];
      const form = new FormData();
      form.append(rel, file, file.name); // rel carried in field NAME
      const xhr = new XMLHttpRequest();
      xhr.open('POST', p);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        onProgress({
          overall: Math.round(((doneBytes + e.loaded) / totalBytes) * 100),
          file: Math.round((e.loaded / e.total) * 100),
          name: file.name, index: i, total,
        });
      };
      xhr.onload = () => {
        let d: any = {}; try { d = JSON.parse(xhr.responseText); } catch { /* noop */ }
        if (xhr.status >= 200 && xhr.status < 300) {
          doneBytes += file.size; last = d;
          onProgress({ overall: Math.round((doneBytes / totalBytes) * 100), file: 100, name: file.name, index: i, total });
          sendOne(i + 1);
        } else reject(new Error(d.error || xhr.statusText));
      };
      xhr.onerror = () => reject(new Error('network error'));
      xhr.send(form);
    };
    sendOne(0);
  }),
};

// Progress snapshot for uploadFiles: overall % (by bytes) + current file % + which file.
export type UploadState = { overall: number; file: number; name: string; index: number; total: number };
