import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, createTransaction, describeError, getAccounts } from '../api.js';
import { eur, uuid } from '../format.js';

export default function Payment({ token, onUnauthorized }) {
  const [accounts, setAccounts] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, text }
  const [history, setHistory] = useState([]);
  // Clé d'idempotence conservée tant que le formulaire n'a pas changé : un nouvel essai après une erreur
  // réseau ne peut donc jamais débiter deux fois.
  const keyRef = useRef(null);

  const loadAccounts = useCallback(async () => {
    try {
      const list = await getAccounts(token);
      setAccounts(list);
      setLoadError('');
      setFrom((current) => current || list[0]?.account || '');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      else setLoadError(describeError(err));
    }
  }, [token, onUnauthorized]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const edit = (setter) => (e) => {
    keyRef.current = null;
    setter(e.target.value);
  };

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const value = Number(amount.replace(',', '.'));
    if (!keyRef.current) keyRef.current = uuid();
    try {
      const tx = await createTransaction(token, {
        from_account: from,
        to_account: to.trim().toUpperCase(),
        amount: value,
        currency: 'EUR',
        idempotency_key: keyRef.current,
      });
      keyRef.current = null;
      setResult({ ok: true, text: `Paiement ${tx.id} accepté.` });
      setHistory((h) => [{ id: tx.id, to: to.trim().toUpperCase(), amount: value, ts: new Date() }, ...h].slice(0, 5));
      setAmount('');
      loadAccounts();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onUnauthorized();
      if (err instanceof ApiError && err.code === 'duplicate') keyRef.current = null;
      setResult({ ok: false, text: describeError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="rounded-xl bg-white p-6 shadow ring-1 ring-slate-200">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Mes comptes</h2>
          <button onClick={loadAccounts} className="text-sm text-blue-600 hover:underline">Actualiser</button>
        </div>
        {loadError && <p className="mb-2 rounded-md bg-red-50 p-2 text-sm text-red-700">{loadError}</p>}
        <ul className="divide-y divide-slate-100">
          {accounts.map((a) => (
            <li key={a.account} className="flex items-center justify-between py-2">
              <span className="font-mono text-sm">{a.account}</span>
              <span className="font-medium">{eur(a.balance)}</span>
            </li>
          ))}
          {accounts.length === 0 && !loadError && <li className="py-2 text-sm text-slate-500">Aucun compte.</li>}
        </ul>
      </section>

      <section className="rounded-xl bg-white p-6 shadow ring-1 ring-slate-200">
        <h2 className="mb-3 text-lg font-semibold">Nouveau paiement</h2>
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm">
            Compte à débiter
            <select
              value={from}
              onChange={edit(setFrom)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              required
            >
              {accounts.map((a) => (
                <option key={a.account} value={a.account}>{a.account} ({eur(a.balance)})</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Compte destinataire
            <input
              value={to}
              onChange={edit(setTo)}
              placeholder="ACC-002"
              pattern="^[Aa][Cc][Cc]-[A-Za-z0-9-]{1,16}$"
              title="Format : ACC-002"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono"
              required
            />
          </label>
          <label className="block text-sm">
            Montant (EUR)
            <input
              value={amount}
              onChange={edit(setAmount)}
              inputMode="decimal"
              pattern="^\d+([.,]\d{1,2})?$"
              title="Ex. 25 ou 25,50"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              required
            />
          </label>
          <button
            type="submit"
            disabled={busy || !from}
            className="w-full rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Envoi…' : 'Payer'}
          </button>
        </form>
        {result && (
          <p
            role="alert"
            className={`mt-3 rounded-md p-2 text-sm ${result.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}
          >
            {result.text}
          </p>
        )}
      </section>

      {history.length > 0 && (
        <section className="rounded-xl bg-white p-6 shadow ring-1 ring-slate-200 md:col-span-2">
          <h2 className="mb-3 text-lg font-semibold">Derniers paiements de cette session</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between py-2">
                <span className="font-mono">{h.id} → {h.to}</span>
                <span>{eur(h.amount)} · {h.ts.toLocaleTimeString('fr-FR')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
