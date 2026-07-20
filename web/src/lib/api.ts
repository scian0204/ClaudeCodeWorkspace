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
  patch: (p: string, b?: any) => j('PATCH', p, b),
  del: (p: string) => j('DELETE', p),
  upload: async (p: string, form: FormData) => {
    const r = await fetch(p, { method: 'POST', body: form, credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((d as any).error || r.statusText);
    return d;
  },
};
