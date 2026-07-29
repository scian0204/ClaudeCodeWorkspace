import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';

// Provider override profile. Mirrors GitCredList: self-contained (its own load/save, api direct),
// secrets stay in local state only and are cleared after save (GET never returns them).
export type ProviderType = 'anthropic' | 'bedrock' | 'vertex' | 'custom';
const TYPES: ProviderType[] = ['anthropic', 'bedrock', 'vertex', 'custom'];

interface ProviderStatus {
  type: ProviderType;
  fields: {
    baseUrl: string; region: string; projectId: string; model: string;
    hasAuthToken: boolean; hasApiKey: boolean; hasAccessKeyId: boolean;
    hasSecretKey: boolean; hasSessionToken: boolean; hasBearerToken: boolean;
  };
}

type FormState = {
  baseUrl: string; authToken: string; apiKey: string; region: string;
  accessKeyId: string; secretKey: string; sessionToken: string; bearerToken: string;
  projectId: string; model: string;
};
const emptyForm: FormState = {
  baseUrl: '', authToken: '', apiKey: '', region: '', accessKeyId: '', secretKey: '',
  sessionToken: '', bearerToken: '', projectId: '', model: '',
};

// User scope talks to /api/auth/me/provider; common (admin) scope to /api/admin/provider.
const endpoint = (scope: 'user' | 'common') => (scope === 'common' ? '/api/admin/provider' : '/api/auth/me/provider');

export function LlmProviderForm({ scope }: { scope: 'user' | 'common' }) {
  const t = useT();
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [type, setType] = useState<ProviderType>('custom');
  const [f, setF] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof FormState, v: string) => setF((p) => ({ ...p, [k]: v }));

  const load = async () => {
    const r = await api.get(endpoint(scope));
    setStatus(r.provider || null);
    if (r.provider) {
      setType(r.provider.type);
      // pre-fill non-secrets; secrets stay blank (a "설정됨" hint marks the ones already stored)
      setF({ ...emptyForm, baseUrl: r.provider.fields.baseUrl, region: r.provider.fields.region, projectId: r.provider.fields.projectId, model: r.provider.fields.model });
    }
  };
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [scope]);

  const save = async () => {
    setBusy(true); setErr('');
    const config: any = { model: f.model };
    if (type === 'anthropic') config.authToken = f.authToken;
    else if (type === 'custom') { config.baseUrl = f.baseUrl; config.authToken = f.authToken; }
    else if (type === 'bedrock') { config.region = f.region; config.bearerToken = f.bearerToken; config.accessKeyId = f.accessKeyId; config.secretKey = f.secretKey; config.sessionToken = f.sessionToken; }
    else if (type === 'vertex') { config.region = f.region; config.projectId = f.projectId; }
    try {
      const r = await api.put(endpoint(scope), { type, config });
      setStatus(r.provider || null);
      setF((p) => ({ ...emptyForm, baseUrl: p.baseUrl, region: p.region, projectId: p.projectId, model: p.model })); // drop secrets from state
    } catch (e: any) { setErr(e.message || t('provider.saveFailed')); }
    finally { setBusy(false); }
  };
  const clear = async () => {
    if (!confirm(t('provider.clearConfirm'))) return;
    setBusy(true); setErr('');
    try { await api.del(endpoint(scope)); setStatus(null); setType('custom'); setF(emptyForm); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  // "설정됨: custom · https://…" style summary of the stored profile
  const summary = () => {
    if (!status) return '';
    const fld = status.fields;
    const detail = status.type === 'custom' ? fld.baseUrl
      : status.type === 'bedrock' ? fld.region
      : status.type === 'vertex' ? `${fld.region} · ${fld.projectId}`
      : t('provider.usesClaudeToken');
    return `${status.type}${detail ? ` · ${detail}` : ''}`;
  };

  const hint = (has: boolean) => (has ? ` (${t('provider.alreadySet')})` : '');

  return (
    <div className="space-y-3">
      <div className="text-sm flex items-center gap-2">
        {status
          ? <><span className="text-ok">●</span><span className="min-w-0 truncate">{t('provider.setAs')}: {summary()}</span>
              <button className="ml-auto text-xs text-txt3 hover:text-danger shrink-0" disabled={busy} onClick={clear}>{t('common.delete')}</button></>
          : <><span className="text-txt3">○</span><span className="text-txt3">{t('provider.notSet')}</span></>}
      </div>

      <label className="block text-xs text-txt2">{t('provider.type')}
        <select className="input mt-1" value={type} onChange={(e) => setType(e.target.value as ProviderType)}>
          {TYPES.map((tp) => <option key={tp} value={tp}>{t(`provider.type.${tp}`)}</option>)}
        </select>
      </label>

      {type === 'anthropic' && (
        <>
          <div className="text-[11px] text-txt3">{t('provider.anthropicNote')}</div>
          <label className="block text-xs text-txt2">{t('provider.authTokenClaude')}{hint(!!status?.fields.hasAuthToken)}
            <input className="input mt-1" type="password" placeholder="sk-ant-oat… / sk-ant-api…" value={f.authToken} onChange={(e) => set('authToken', e.target.value)} />
          </label>
        </>
      )}

      {type === 'custom' && (
        <>
          <div className="text-[11px] text-txt3">{t('provider.customNote')}</div>
          <label className="block text-xs text-txt2">{t('provider.baseUrl')}
            <input className="input mt-1" placeholder="http://litellm:4000" value={f.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} />
          </label>
          <label className="block text-xs text-txt2">{t('provider.authTokenBearer')}{hint(!!status?.fields.hasAuthToken)}
            <input className="input mt-1" type="password" placeholder={t('provider.optional')} value={f.authToken} onChange={(e) => set('authToken', e.target.value)} />
          </label>
          <label className="block text-xs text-txt2">{t('provider.model')}
            <input className="input mt-1" placeholder={t('provider.modelCustomPlaceholder')} value={f.model} onChange={(e) => set('model', e.target.value)} />
          </label>
        </>
      )}

      {type === 'bedrock' && (
        <>
          <div className="text-[11px] text-txt3">{t('provider.bedrockNote')}</div>
          <label className="block text-xs text-txt2">{t('provider.region')}
            <input className="input mt-1" placeholder="us-east-1" value={f.region} onChange={(e) => set('region', e.target.value)} />
          </label>
          <label className="block text-xs text-txt2">{t('provider.bearerToken')}{hint(!!status?.fields.hasBearerToken)}
            <input className="input mt-1" type="password" placeholder="AWS_BEARER_TOKEN_BEDROCK" value={f.bearerToken} onChange={(e) => set('bearerToken', e.target.value)} />
          </label>
          <div className="text-[11px] text-txt3">{t('provider.bedrockOr')}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block text-xs text-txt2">{t('provider.accessKeyId')}{hint(!!status?.fields.hasAccessKeyId)}
              <input className="input mt-1" placeholder="AKIA…" value={f.accessKeyId} onChange={(e) => set('accessKeyId', e.target.value)} />
            </label>
            <label className="block text-xs text-txt2">{t('provider.secretKey')}{hint(!!status?.fields.hasSecretKey)}
              <input className="input mt-1" type="password" value={f.secretKey} onChange={(e) => set('secretKey', e.target.value)} />
            </label>
          </div>
          <label className="block text-xs text-txt2">{t('provider.sessionToken')}{hint(!!status?.fields.hasSessionToken)}
            <input className="input mt-1" type="password" placeholder={t('provider.optional')} value={f.sessionToken} onChange={(e) => set('sessionToken', e.target.value)} />
          </label>
          <label className="block text-xs text-txt2">{t('provider.model')}
            <input className="input mt-1" placeholder="anthropic.claude-…-v2:0" value={f.model} onChange={(e) => set('model', e.target.value)} />
          </label>
        </>
      )}

      {type === 'vertex' && (
        <>
          <div className="text-[11px] text-txt3">{t('provider.vertexNote')}</div>
          <label className="block text-xs text-txt2">{t('provider.region')}
            <input className="input mt-1" placeholder="us-east5" value={f.region} onChange={(e) => set('region', e.target.value)} />
          </label>
          <label className="block text-xs text-txt2">{t('provider.projectId')}
            <input className="input mt-1" placeholder="my-gcp-project" value={f.projectId} onChange={(e) => set('projectId', e.target.value)} />
          </label>
          <label className="block text-xs text-txt2">{t('provider.model')}
            <input className="input mt-1" placeholder="claude-…@…" value={f.model} onChange={(e) => set('model', e.target.value)} />
          </label>
        </>
      )}

      {err && <div className="text-xs text-danger">{err}</div>}
      <div className="flex justify-end">
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? '…' : t('provider.save')}</button>
      </div>
    </div>
  );
}
