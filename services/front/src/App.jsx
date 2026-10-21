import { useCallback, useState } from 'react';
import Login from './components/Login.jsx';
import Payment from './components/Payment.jsx';
import StatusBadge from './components/StatusBadge.jsx';

export default function App() {
  // Le jeton reste en mémoire uniquement (jamais dans le stockage du navigateur) : un rechargement déconnecte.
  const [session, setSession] = useState(null); // { token, username }
  const [notice, setNotice] = useState('');

  const logout = useCallback((message = '') => {
    setSession(null);
    setNotice(message);
  }, []);
  const expired = useCallback(() => logout('Session expirée, reconnectez-vous.'), [logout]);

  return (
    <div className="mx-auto min-h-screen max-w-4xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Plateforme de paiement</h1>
          <p className="text-xs text-slate-500">Environnement fictif : aucune donnée bancaire réelle.</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge />
          {session && (
            <button onClick={() => logout()} className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50">
              Déconnexion ({session.username})
            </button>
          )}
        </div>
      </header>

      {session ? (
        <Payment token={session.token} onUnauthorized={expired} />
      ) : (
        <Login onLogin={(s) => { setNotice(''); setSession(s); }} notice={notice} />
      )}
    </div>
  );
}
