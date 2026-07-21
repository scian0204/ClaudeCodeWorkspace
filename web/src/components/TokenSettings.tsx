import { useState } from 'react';
import { useStore } from '../lib/store';
import { Modal } from './Modal';

function fmtDate(ms?: number | null) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Register / update / clear the current user's own Claude token.
// `nag` variant is the post-login reminder shown to users who haven't registered one yet.
export function MyTokenModal({ open, onClose, nag }: { open: boolean; onClose: () => void; nag?: boolean }) {
  const user = useStore((s) => s.user);
  const saveClaudeToken = useStore((s) => s.saveClaudeToken);
  const clearClaudeToken = useStore((s) => s.clearClaudeToken);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const has = !!user?.hasClaudeToken;

  const save = async () => {
    if (!token.trim()) { setErr('토큰을 입력하세요.'); return; }
    setBusy(true); setErr('');
    try { await saveClaudeToken(token.trim()); setToken(''); onClose(); }
    catch (e: any) { setErr(e.message || '저장 실패'); }
    finally { setBusy(false); }
  };
  const clear = async () => {
    if (!confirm('등록된 토큰을 삭제할까요? 삭제 후에는 공용 토큰으로 동작합니다.')) return;
    setBusy(true); setErr('');
    try { await clearClaudeToken(); }
    catch (e: any) { setErr(e.message || '삭제 실패'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) onClose(); }} title={nag ? 'Claude Code 토큰 등록' : '내 Claude 토큰'} width={460}>
      {nag && (
        <div className="text-xs text-txt2 bg-claysoft border border-line rounded-lg px-3 py-2 mb-3">
          아직 개인 토큰이 없습니다. 지금은 공용 토큰으로 동작하지만, 본인 토큰을 등록하면 질의가 본인 계정으로 실행되고 사용량도 본인에게 귀속됩니다.
        </div>
      )}

      {has ? (
        <div className="text-sm mb-3 flex items-center gap-2">
          <span className="text-ok">●</span>
          <span>등록됨{user?.claudeTokenSetAt ? ` · ${fmtDate(user.claudeTokenSetAt)}` : ''}</span>
          <button className="ml-auto text-xs text-txt3 hover:text-danger" disabled={busy} onClick={clear}>삭제</button>
        </div>
      ) : (
        <div className="text-xs text-txt3 mb-2">미등록</div>
      )}

      <label className="text-xs text-txt2">{has ? '토큰 교체' : '토큰'} (sk-ant-oat… 또는 sk-ant-api…)</label>
      <input className="input mt-1 mb-2" type="password" placeholder="sk-ant-oat-…" value={token} autoFocus
        onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      <div className="text-[11px] text-txt3 mb-3">
        터미널에서 <code className="bg-line px-1 rounded">claude setup-token</code> 실행 후 나온 토큰을 붙여넣으세요. (Pro/Max 로그인) 또는 콘솔 API 키.
      </div>
      {err && <div className="text-xs text-danger mb-2">{err}</div>}

      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose} disabled={busy}>{nag ? '나중에' : '닫기'}</button>
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? '…' : '저장'}</button>
      </div>
    </Modal>
  );
}
