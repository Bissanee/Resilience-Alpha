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
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
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
      setHistory((h) => [
        { id: tx.id, to: to.trim().toUpperCase(), amount: value, ts: new Date() },
        ...h,
      ].slice(0, 5));
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

  const inputClass =
    'mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100';

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">
            Espace financier
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
            Tableau de bord
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Gérez vos comptes et effectuez vos paiements en toute simplicité.
          </p>
        </div>

        <button
          type="button"
          onClick={loadAccounts}
          className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 sm:self-auto"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 7v5h-5M4 17v-5h5" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.5 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.5-3" />
          </svg>
          Actualiser
        </button>
      </div>

      {loadError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          <span className="font-semibold">Impossible de charger les comptes. </span>
          {loadError}
        </div>
      )}

      <section id="accounts">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Mes comptes</h3>
            <p className="mt-1 text-sm text-slate-500">
              {accounts.length} compte{accounts.length > 1 ? 's' : ''} disponible{accounts.length > 1 ? 's' : ''}
            </p>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            ● Comptes
          </span>
        </div>

        {accounts.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {accounts.map((a, index) => (
              <button
                key={a.account}
                type="button"
                onClick={() => setFrom(a.account)}
                className={`group rounded-2xl border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg ${
                  from === a.account
                    ? 'border-indigo-300 bg-indigo-50/70 shadow-md shadow-indigo-100/60 ring-2 ring-indigo-100'
                    : 'border-slate-200 bg-white shadow-sm hover:border-indigo-200'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                    index % 2 === 0
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-violet-100 text-violet-700'
                  }`}>
                    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" stroke="currentColor" strokeWidth="1.7">
                      <rect x="3" y="5" width="18" height="14" rx="2.5" />
                      <path strokeLinecap="round" d="M3 10h18M7 15h3" />
                    </svg>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    from === a.account
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-slate-100 text-slate-500'
                  }`}>
                    {from === a.account ? 'Sélectionné' : 'Compte'}
                  </span>
                </div>
                <p className="mt-5 text-xs font-medium uppercase tracking-wider text-slate-500">
                  Numéro de compte
                </p>
                <p className="mt-1 break-all font-mono text-sm font-semibold text-slate-800">
                  {a.account}
                </p>
                <p className="mt-5 text-xs font-medium text-slate-500">Solde disponible</p>
                <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
                  {eur(a.balance)}
                </p>
              </button>
            ))}
          </div>
        ) : (
          !loadError && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <p className="font-semibold text-slate-700">Aucun compte disponible</p>
              <p className="mt-1 text-sm text-slate-500">
                Actualisez pour essayer de récupérer vos comptes.
              </p>
            </div>
          )
        )}
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section id="payment-form" className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-lg shadow-slate-200/40 sm:p-8">
          <div className="mb-6 flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-200">
              <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" stroke="currentColor" strokeWidth="1.7">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18m5-13H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6" />
              </svg>
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">Nouveau paiement</h3>
              <p className="mt-1 text-sm leading-5 text-slate-500">
                Renseignez les informations du transfert.
              </p>
            </div>
          </div>

          <form onSubmit={submit} className="space-y-5">
            <label className="block text-sm font-semibold text-slate-700">
              Compte à débiter
              <select
                value={from}
                onChange={edit(setFrom)}
                className={inputClass}
                required
              >
                {accounts.map((a) => (
                  <option key={a.account} value={a.account}>
                    {a.account} ({eur(a.balance)})
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-semibold text-slate-700">
              Compte destinataire
              <input
                value={to}
                onChange={edit(setTo)}
                placeholder="Ex. ACC-002"
                pattern="^[Aa][Cc][Cc]-[A-Za-z0-9-]{1,16}$"
                title="Format : ACC-002"
                className={`${inputClass} font-mono`}
                required
              />
              <span className="mt-2 block text-xs font-normal text-slate-500">
                Saisissez le numéro du compte qui recevra le paiement.
              </span>
            </label>

            <label className="block text-sm font-semibold text-slate-700">
              Montant du paiement
              <div className="relative mt-2">
                <input
                  value={amount}
                  onChange={edit(setAmount)}
                  inputMode="decimal"
                  pattern="^\d+([.,]\d{1,2})?$"
                  title="Ex. 25 ou 25,50"
                  placeholder="0,00"
                  className={`${inputClass} mt-0 pr-16 text-lg font-semibold`}
                  required
                />
                <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-bold text-slate-400">
                  EUR €
                </span>
              </div>
            </label>

            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-500">Montant du transfert</span>
                <span className="font-semibold text-slate-800">
                  {amount.trim() && Number.isFinite(Number(amount.replace(',', '.')))
                    ? eur(Number(amount.replace(',', '.')))
                    : '—'}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Vérifiez le compte destinataire et le montant avant de confirmer.
              </p>
            </div>

            <button
              type="submit"
              disabled={busy || !from}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 font-semibold text-white shadow-lg shadow-indigo-200/70 transition hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
            >
              {busy && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              )}
              {busy ? 'Paiement en cours…' : 'Confirmer le paiement'}
              {!busy && <span aria-hidden="true">→</span>}
            </button>
          </form>

          {result && (
            <div
              role="alert"
              className={`mt-5 flex gap-3 rounded-xl border px-4 py-3 text-sm leading-5 ${
                result.ok
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              <span className="font-bold">{result.ok ? '✓' : '!'}</span>
              <span>{result.text}</span>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-indigo-700 shadow-sm ring-1 ring-indigo-100">
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.7">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3 19 6v5c0 4.5-2.8 7.8-7 10-4.2-2.2-7-5.5-7-10V6l7-3Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 12 2 2 4-4" />
              </svg>
            </div>
            <h3 className="mt-4 font-bold text-slate-900">Paiements sécurisés</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Vérifiez les informations de votre transfert avant de le confirmer.
              En cas d'erreur, consultez le message affiché avant de réessayer.
            </p>
          </section>

          <section id="activity" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.7">
                  <circle cx="12" cy="12" r="9" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-slate-900">Activité récente</h3>
                <p className="text-xs text-slate-500">Paiements de cette session</p>
              </div>
            </div>

            {history.length > 0 ? (
              <ul className="mt-5 divide-y divide-slate-100">
                {history.map((h) => (
                  <li key={h.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-all text-sm font-semibold text-slate-800">
                          Vers {h.to}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          {h.ts.toLocaleTimeString('fr-FR')}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-bold text-slate-900">
                        {eur(h.amount)}
                      </span>
                    </div>
                    <p className="mt-1 break-all font-mono text-[10px] text-slate-400">
                      Réf. {h.id}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-5 rounded-xl bg-slate-50 px-4 py-5 text-center">
                <p className="text-sm font-medium text-slate-600">
                  Aucun paiement récent
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  Les paiements effectués pendant cette session apparaîtront ici.
                </p>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
