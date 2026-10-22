import { useState } from 'react';
import { login, describeError } from '../api.js';

export default function Login({ onLogin, notice }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');

    try {
      const { token } = await login(username.trim(), password);
      onLogin({ token, username: username.trim() });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10 sm:py-16">
      <div className="mb-7 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-200">
          <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8" stroke="currentColor" strokeWidth="1.7">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3 19 6v5c0 4.5-2.8 7.8-7 10-4.2-2.2-7-5.5-7-10V6l7-3Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="m9 12 2 2 4-4" />
          </svg>
        </div>
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">
          Resilience Alpha
        </p>
        <h2 className="text-3xl font-bold tracking-tight text-slate-900">
          Bon retour parmi nous
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          Connectez-vous pour accéder à votre espace de paiement sécurisé.
        </p>
      </div>

      <form
        onSubmit={submit}
        className="space-y-5 rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xl shadow-slate-200/50 sm:p-8"
      >
        <div className="mb-2">
          <h3 className="text-lg font-semibold text-slate-900">Connexion</h3>
          <p className="mt-1 text-sm text-slate-500">
            Entrez vos identifiants pour continuer.
          </p>
        </div>

        {notice && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-5 text-amber-900" role="status">
            {notice}
          </p>
        )}

        <label className="block text-sm font-medium text-slate-700">
          Identifiant
          <input
            className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            placeholder="Votre identifiant"
            required
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          Mot de passe
          <input
            type="password"
            className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="Votre mot de passe"
            required
          />
        </label>

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-700" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 font-semibold text-white shadow-lg shadow-indigo-200/70 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-indigo-200/80 focus:outline-none focus:ring-4 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
        >
          {busy && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          )}
          {busy ? 'Connexion en cours…' : 'Se connecter'}
          {!busy && <span aria-hidden="true">→</span>}
        </button>

        <div className="flex items-center justify-center gap-2 border-t border-slate-100 pt-5 text-xs text-slate-500">
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-emerald-600" stroke="currentColor" strokeWidth="1.8">
            <rect x="5" y="10" width="14" height="11" rx="2" />
            <path strokeLinecap="round" d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
          Accès sécurisé à votre espace
        </div>
      </form>

      <p className="mt-6 text-center text-xs text-slate-400">
        Resilience Alpha · Plateforme de paiement
      </p>
    </div>
  );
}
