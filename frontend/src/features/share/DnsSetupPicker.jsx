import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, KeyRound, Trash2 } from 'lucide-react';
import { hostingService, hostingErrorMessage } from '../../services/hostingService';

const payload = (response) => response?.data?.data ?? response?.data ?? response;

/**
 * How the domain's DNS records get set: automatically through the owner's Cloudflare or GoDaddy account, or by hand at any other
 * provider. The credential is sent to the server once, checked with the provider and stored encrypted; it never comes back here.
 * `value` is what the server expects: 'manual', 'cloudflare' or 'godaddy'.
 */
export function DnsSetupPicker({ value, onChange, onAccounts = null, disabled = false }) {
  const [accounts, setAccounts] = useState(null);
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const automatic = value !== 'manual';

  const load = useCallback(async () => {
    try { const next = payload(await hostingService.listDnsAccounts()); setAccounts(next); onAccounts?.(next); } catch { setAccounts([]); onAccounts?.([]); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const chosen = automatic ? (accounts || []).find((account) => account.provider === value) : null;

  const save = async (provider) => {
    setBusy(`save-${provider}`); setError('');
    try {
      await hostingService.saveDnsAccount(provider, fields[provider] || {});
      setFields((state) => ({ ...state, [provider]: {} }));
      await load();
    } catch (e) { setError(hostingErrorMessage(e, 'That credential could not be saved.')); } finally { setBusy(''); }
  };
  const remove = async (provider) => {
    setBusy(`remove-${provider}`); setError('');
    try { await hostingService.removeDnsAccount(provider); await load(); } catch (e) { setError(hostingErrorMessage(e, 'The credential could not be removed.')); } finally { setBusy(''); }
  };

  return (
    <div className="space-y-2" aria-label="DNS setup">
      <p className="text-[11px] font-semibold text-zinc-700">How should the DNS records be set up?</p>
      <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="DNS setup method">
        <button type="button" role="radio" aria-checked={automatic} disabled={disabled} onClick={() => onChange(chosen?.provider || (accounts || []).find((a) => a.connected)?.provider || 'cloudflare')}
          className={`rounded-lg border px-2.5 py-1.5 text-left text-[11px] cursor-pointer ${automatic ? 'border-zinc-900 bg-white font-semibold' : 'border-zinc-200 bg-zinc-50 text-zinc-600'}`}>
          Automatic<span className="block font-normal text-zinc-500">Cloudflare or GoDaddy</span>
        </button>
        <button type="button" role="radio" aria-checked={!automatic} disabled={disabled} onClick={() => onChange('manual')}
          className={`rounded-lg border px-2.5 py-1.5 text-left text-[11px] cursor-pointer ${!automatic ? 'border-zinc-900 bg-white font-semibold' : 'border-zinc-200 bg-zinc-50 text-zinc-600'}`}>
          Manual<span className="block font-normal text-zinc-500">Any provider, you add the records</span>
        </button>
      </div>

      {automatic && (
        <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-2.5">
          {!accounts && <p className="text-[11px] text-zinc-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</p>}
          {accounts && (
            <div className="flex gap-1.5" role="tablist" aria-label="DNS provider">
              {accounts.map((account) => (
                <button key={account.provider} type="button" role="tab" aria-selected={value === account.provider} disabled={disabled} onClick={() => onChange(account.provider)}
                  className={`flex-1 rounded-md border px-2 py-1 text-[11px] font-semibold cursor-pointer ${value === account.provider ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}>
                  {account.label}{account.connected && <CheckCircle2 className="inline w-3 h-3 ml-1 -mt-0.5 text-emerald-400" />}
                </button>
              ))}
            </div>
          )}
          {chosen && chosen.connected && (
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-emerald-700 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> {chosen.label} is connected ({chosen.hint}). Veave adds the records for you.</span>
              <button type="button" onClick={() => remove(chosen.provider)} disabled={!!busy || disabled} className="text-rose-600 hover:text-rose-800 flex items-center gap-1 cursor-pointer"><Trash2 className="w-3 h-3" /> Remove</button>
            </div>
          )}
          {chosen && !chosen.connected && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-zinc-600">{chosen.help}</p>
              {chosen.fields.map((field) => (
                <input key={field.key} type={field.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} value={(fields[chosen.provider] || {})[field.key] || ''}
                  onChange={(e) => setFields((state) => ({ ...state, [chosen.provider]: { ...(state[chosen.provider] || {}), [field.key]: e.target.value } }))}
                  placeholder={field.label} aria-label={`${chosen.label} ${field.label}`} disabled={!!busy || disabled}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-mono outline-none focus:border-zinc-900" />
              ))}
              <button type="button" onClick={() => save(chosen.provider)} disabled={!!busy || disabled || !chosen.fields.every((field) => ((fields[chosen.provider] || {})[field.key] || '').trim())}
                className="px-3 py-1.5 rounded-lg bg-zinc-900 text-white text-xs font-semibold hover:bg-black disabled:opacity-50 cursor-pointer flex items-center gap-1.5">
                {busy === `save-${chosen.provider}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />} Check and save
              </button>
              <p className="text-[10px] text-zinc-400">Stored encrypted on the server and used only to change the DNS of your domain. You can remove it at any time.</p>
              {chosen.error && <p className="text-[11px] text-rose-700">{chosen.error}</p>}
            </div>
          )}
        </div>
      )}
      {!automatic && <p className="text-[11px] text-zinc-500">Veave shows you each record to add (type, name, value and TTL) with copy buttons, and keeps checking until it sees them.</p>}
      {error && <p className="text-[11px] text-rose-700 whitespace-pre-wrap" role="alert">{error}</p>}
    </div>
  );
}

export default DnsSetupPicker;
