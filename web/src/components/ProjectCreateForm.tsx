import { useEffect, useState } from 'react';
import { useStore, type Project } from '../lib/store';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { IconDownload, IconPlus } from '../lib/icons';

// The single project-create form, reused by Chat's ProjectMenu (compact, in the dropdown) and My Page's
// requests section. It mirrors the real create feature — name / git clone URL / branch / credential
// picker — and decides what "submit" means from the scope + the current user's role:
//   • scope !== 'common'                       → direct POST /api/projects (as today)
//   • scope === 'common' AND admin             → direct POST /api/projects { scope:'common' }
//   • scope === 'common' AND commonProjectOpen → direct POST for members too (admin setting)
//   • scope === 'common' AND member            → submitRequest('common_project', …) (admin approval → real clone)
// Only a credentialId REFERENCE is sent — never a token/secret.
export function ProjectCreateForm({ scope, roomId, compact, onCreated, onDone }: {
  scope: 'user' | 'room' | 'common';
  roomId?: string;
  compact?: boolean;                              // dropdown sizing vs full-width section
  onCreated?: (project: Project) => void | Promise<void>; // direct-create only (no project on the request path)
  onDone?: () => void;                            // called after any successful submit (close menu / reset)
}) {
  const isAdmin = useStore((s) => s.user?.role === 'admin');
  const commonOpen = useStore((s) => s.commonProjectOpen);
  const submitRequest = useStore((s) => s.submitRequest);
  const refresh = useStore((s) => s.refreshLists);
  const setError = useStore((s) => s.setError);
  const [name, setName] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [credentialId, setCredentialId] = useState('');
  const [reason, setReason] = useState('');
  const [creds, setCreds] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const t = useT();

  const listsVersion = useStore((s) => s.listsVersion); // refetch when something changed elsewhere
  useEffect(() => { api.get('/api/git-credentials').then((r) => setCreds([...(r.mine || []), ...(r.common || [])])).catch(() => {}); }, [listsVersion]);

  const asRequest = scope === 'common' && !isAdmin && !commonOpen; // member → request instead of direct create
  const git = gitUrl.trim();
  const inputCls = compact ? 'input !py-1 !text-xs' : 'input';

  const submit = async () => {
    const nm = name.trim();
    if (busy || (!nm && !git)) return;
    setBusy(true);
    try {
      if (asRequest) {
        // payload carries only references/text (credentialId is a reference, never a secret)
        await submitRequest('common_project', { name: nm, gitUrl: git, branch: (git && branch.trim()) || '', credentialId: (git && credentialId) || '' }, reason.trim());
        setReason('');
      } else {
        const { project } = await api.post('/api/projects', { scope, name: nm, roomId, gitUrl: git || undefined, branch: (git && branch.trim()) || undefined, credentialId: (git && credentialId) || undefined });
        await refresh();
        await onCreated?.(project);
      }
      setName(''); setGitUrl(''); setBranch(''); setCredentialId('');
      onDone?.();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  // Enter submits from the name field only when no git URL is set (git needs the extra fields first).
  const onEnter = (fromName: boolean) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !(fromName && git)) { e.preventDefault(); submit(); }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <input className={inputCls} placeholder={t('chat.newProjectNamePlaceholder')} value={name}
        onChange={(e) => setName(e.target.value)} onKeyDown={onEnter(true)} />
      <input className={inputCls} placeholder={t('chat.gitCloneUrlPlaceholder')} value={gitUrl}
        onChange={(e) => setGitUrl(e.target.value)} onKeyDown={onEnter(false)} />
      {git && (
        <input className={inputCls} placeholder={t('chat.gitBranchPlaceholder')} value={branch}
          onChange={(e) => setBranch(e.target.value)} onKeyDown={onEnter(false)} />
      )}
      {git && (
        <select className={inputCls} value={credentialId} onChange={(e) => setCredentialId(e.target.value)}>
          <option value="">{t('chat.credAuto')}</option>
          {creds.map((cr) => <option key={cr.id} value={cr.id}>[{cr.provider}] {cr.host} · {cr.username}</option>)}
        </select>
      )}
      {asRequest && (
        <textarea className={`${inputCls} resize-none`} rows={2} placeholder={t('requests.reasonPlaceholder')}
          value={reason} onChange={(e) => setReason(e.target.value)} />
      )}
      <button className={compact ? 'btn-ghost !py-1 !text-xs inline-flex items-center justify-center gap-1' : 'btn-primary inline-flex items-center justify-center gap-1'}
        disabled={busy} onClick={submit}>
        {busy ? t('common.creating')
          : asRequest ? t('project.requestBtn')
          : git ? <><IconDownload size={13} />{t('chat.cloneCreate')}</>
          : <><IconPlus size={13} />{t('chat.createBtn')}</>}
      </button>
      {asRequest && <div className="text-[11px] text-txt3">{t('project.commonRequestHint')}</div>}
    </div>
  );
}
