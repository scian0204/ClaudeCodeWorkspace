import { useState } from 'react';
import { useStore } from '../lib/store';

export function Login() {
  const login = useStore((s) => s.login);
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await login(u, p); } catch (e: any) { setErr(e.message || '로그인 실패'); } finally { setBusy(false); }
  };

  return (
    <div className="h-full grid place-items-center bg-bg">
      <form onSubmit={submit} className="w-[340px] bg-panel border border-line rounded-xl p-7 shadow-sm">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-8 h-8 rounded-lg bg-clay text-white grid place-items-center font-bold">✳</div>
          <div>
            <div className="font-semibold">ClaudeCode Workspace</div>
            <div className="text-xs text-txt3">팀 워크스페이스에 로그인</div>
          </div>
        </div>
        <label className="text-xs text-txt2">아이디</label>
        <input className="input mt-1 mb-3" value={u} onChange={(e) => setU(e.target.value)} autoFocus />
        <label className="text-xs text-txt2">비밀번호</label>
        <input className="input mt-1 mb-4" type="password" value={p} onChange={(e) => setP(e.target.value)} />
        {err && <div className="text-xs text-danger mb-3">{err}</div>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? '…' : '로그인'}</button>
        <div className="text-[11px] text-txt3 mt-3 text-center">초기 관리자: admin / admin (배포 후 변경)</div>
      </form>
    </div>
  );
}
