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
  // like upload() but reports upload progress (fetch can't) — used for bulk file uploads
  uploadProgress: (p: string, form: FormData, onProgress: (pct: number) => void) => new Promise<any>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', p);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      let d: any = {}; try { d = JSON.parse(xhr.responseText); } catch { /* noop */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(d);
      else reject(new Error(d.error || xhr.statusText));
    };
    xhr.onerror = () => reject(new Error('network error'));
    xhr.send(form);
  }),
};
