import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';

export function PluginsPanel() {
  const setPanel = useStore((s) => s.setPanel);
  const user = useStore((s) => s.user)!;
  const isAdmin = user.role === 'admin';
  const [data, setData] = useState<any>({ common: [], mine: [], prefs: [] });
  const [mkt, setMkt] = useState<any>({ common: [], mine: [] });

  const load = async () => {
    const [p, m] = await Promise.all([api.get('/api/plugins'), api.get('/api/marketplaces')]);
    setData(p); setMkt(m);
  };
  useEffect(() => { load().catch((e) => useStore.getState().setError(e.message)); }, []);
  const err = (e: any) => useStore.getState().setError(e.message || String(e));

  const prefMap = new Map<string, number>(data.prefs.map((p: any) => [p.pluginId, p.enabled]));

  return (
    <div className="h-full overflow-y-auto scrolly">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-line sticky top-0 bg-panel z-10">
        <button className="toolbtn" onClick={() => setPanel(null)}>←</button>
        <div className="font-semibold">🧩 플러그인</div>
      </div>
      <div className="max-w-[860px] mx-auto p-5 space-y-6">
        {/* COMMON */}
        <div className="bg-card border border-line rounded-xl p-4">
          <div className="font-semibold mb-1">공통 플러그인 {isAdmin ? '' : '(관리자 관리 · 개인 on/off 가능)'}</div>
          <div className="text-xs text-txt3 mb-3">{isAdmin ? '팀 전체에 적용. 필수강제 지정 시 개인이 끌 수 없음.' : '관리자가 설치. 필수(🔒)가 아니면 내 세션에서 끌 수 있음.'}</div>
          {isAdmin && <InstallForms scope="common" mkt={mkt.common} onChange={load} onErr={err} />}
          <div className="mt-3 space-y-1.5">
            {data.common.length === 0 && <Empty />}
            {data.common.map((p: any) => {
              const pref = prefMap.has(p.id) ? prefMap.get(p.id) === 1 : true;
              return (
                <Row key={p.id} p={p}>
                  {isAdmin ? (
                    <>
                      <Toggle on={!!p.enabled} label="활성" onClick={async () => { await api.post(`/api/plugins/${p.id}/enabled`, { enabled: !p.enabled }); load(); }} />
                      <Toggle on={!!p.forced} label="🔒 필수" onClick={async () => { await api.post(`/api/plugins/${p.id}/forced`, { forced: !p.forced }); load(); }} />
                      <button className="text-xs text-txt3 hover:text-danger" onClick={async () => { await api.del(`/api/plugins/${p.id}`); load(); }}>삭제</button>
                    </>
                  ) : (
                    p.forced ? <span className="text-[11px] text-clay">🔒 필수</span>
                      : <Toggle on={pref} label="내 세션 사용" onClick={async () => { await api.post(`/api/plugins/${p.id}/pref`, { enabled: !pref }).catch(err); load(); }} />
                  )}
                </Row>
              );
            })}
          </div>
        </div>

        {/* PERSONAL */}
        <div className="bg-card border border-line rounded-xl p-4">
          <div className="font-semibold mb-1">개인 플러그인</div>
          <div className="text-xs text-txt3 mb-3">내 세션에만 적용. 이름 충돌 시 개인 우선.</div>
          <InstallForms scope="user" mkt={mkt.mine} onChange={load} onErr={err} />
          <div className="mt-3 space-y-1.5">
            {data.mine.length === 0 && <Empty />}
            {data.mine.map((p: any) => (
              <Row key={p.id} p={p}>
                <Toggle on={!!p.enabled} label="활성" onClick={async () => { await api.post(`/api/plugins/${p.id}/enabled`, { enabled: !p.enabled }); load(); }} />
                <button className="text-xs text-txt3 hover:text-danger" onClick={async () => { await api.del(`/api/plugins/${p.id}`); load(); }}>삭제</button>
              </Row>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function InstallForms({ scope, mkt, onChange, onErr }: { scope: 'common' | 'user'; mkt: any[]; onChange: () => void; onErr: (e: any) => void }) {
  const [git, setGit] = useState({ name: '', repo: '' });
  const [mk, setMk] = useState({ name: '', url: '' });
  const [upName, setUpName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const installGit = async () => { if (!git.name || !git.repo) return; try { await api.post('/api/plugins/install', { scope, ...git }); setGit({ name: '', repo: '' }); onChange(); } catch (e) { onErr(e); } };
  const addMk = async () => { if (!mk.name || !mk.url) return; try { await api.post('/api/marketplaces', { scope, ...mk }); setMk({ name: '', url: '' }); onChange(); } catch (e) { onErr(e); } };
  const upload = async () => {
    const f = fileRef.current?.files?.[0]; if (!f || !upName) return;
    const form = new FormData(); form.append('scope', scope); form.append('name', upName); form.append('file', f);
    try { await api.upload('/api/plugins/upload', form); setUpName(''); if (fileRef.current) fileRef.current.value = ''; onChange(); } catch (e) { onErr(e); }
  };

  return (
    <div className="space-y-2 border-t border-line pt-3">
      {mkt.length > 0 && <div className="text-xs text-txt3">마켓플레이스: {mkt.map((m) => m.name).join(', ')}</div>}
      <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
        <input className="input !py-1.5 !text-xs" placeholder="마켓 이름" value={mk.name} onChange={(e) => setMk({ ...mk, name: e.target.value })} />
        <input className="input !py-1.5 !text-xs" placeholder="git URL" value={mk.url} onChange={(e) => setMk({ ...mk, url: e.target.value })} />
        <button className="btn-ghost !py-1.5 !text-xs" onClick={addMk}>마켓추가</button>
      </div>
      <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
        <input className="input !py-1.5 !text-xs" placeholder="플러그인 이름" value={git.name} onChange={(e) => setGit({ ...git, name: e.target.value })} />
        <input className="input !py-1.5 !text-xs" placeholder="git repo (clone)" value={git.repo} onChange={(e) => setGit({ ...git, repo: e.target.value })} />
        <button className="btn-primary !py-1.5 !text-xs" onClick={installGit}>설치</button>
      </div>
      <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
        <input className="input !py-1.5 !text-xs" placeholder="업로드 이름" value={upName} onChange={(e) => setUpName(e.target.value)} />
        <input ref={fileRef} type="file" accept=".tar.gz,.tgz" className="text-xs text-txt2" />
        <button className="btn-ghost !py-1.5 !text-xs" onClick={upload}>업로드(.tar.gz)</button>
      </div>
    </div>
  );
}

function Row({ p, children }: { p: any; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm border-b border-line py-1.5">
      <span>🧩</span><span className="font-medium">{p.name}</span>
      <span className="text-[10px] text-txt3">{p.source === 'local' ? '업로드' : 'git'}</span>
      <div className="ml-auto flex items-center gap-3">{children}</div>
    </div>
  );
}
function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`text-[11px] px-2 py-0.5 rounded-full border ${on ? 'bg-oksoft border-ok text-ok' : 'border-line text-txt3'}`}>
      {on ? '✓ ' : ''}{label}
    </button>
  );
}
function Empty() { return <div className="text-xs text-txt3">아직 없음</div>; }
