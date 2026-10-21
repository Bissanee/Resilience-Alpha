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
    <form onSubmit={submit} className="mx-auto mt-10 w-full max-w-sm space-y-4 rounded-xl bg-white p-6 shadow ring-1 ring-slate-200">
      <h2 className="text-lg font-semibold">Connexion</h2>
      {notice && <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">{notice}</p>}
      <label className="block text-sm">
        Identifiant
        <input
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />
      </label>
      <label className="block text-sm">
        Mot de passe
        <input
          type="password"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      {error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700" role="alert">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? 'Connexion…' : 'Se connecter'}
      </button>
    </form>
  );
}
