import { useCallback, useState } from 'react';
import Login from './components/Login.jsx';
import Payment from './components/Payment.jsx';
import StatusBadge from './components/StatusBadge.jsx';

function Brand({ compact = false }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-950/20">
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3 19 6v5c0 4.5-2.8 7.8-7 10-4.2-2.2-7-5.5-7-10V6l7-3Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 12 2 2 4-4" />
        </svg>
      </div>
      <div className="min-w-0">
        <p className={`truncate font-bold tracking-tight ${compact ? 'text-sm text-white' : 'text-base text-slate-900'}`}>
          Resilience Alpha
        </p>
        <p className={`mt-0.5 text-xs ${compact ? 'text-slate-400' : 'text-slate-500'}`}>
          Secure payment platform
        </p>
      </div>
    </div>
  );
}

function NavItem({ active = false, icon, children, href = '#main-content' }) {
  return (
    <a
      href={href}
      className={`group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition ${
        active
          ? 'bg-indigo-500/15 text-white ring-1 ring-indigo-400/20'
          : 'text-slate-400 hover:bg-white/5 hover:text-white'
      }`}
    >
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
        active ? 'bg-indigo-500 text-white' : 'text-slate-400 group-hover:text-white'
      }`}>
        {icon}
      </span>
      {children}
      {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-indigo-400" />}
    </a>
  );
}

export default function App() {
  // Le jeton reste en mémoire uniquement : aucun stockage persistant du token.
  const [session, setSession] = useState(null);
  const [notice, setNotice] = useState('');

  const logout = useCallback((message = '') => {
    setSession(null);
    setNotice(message);
  }, []);

  const expired = useCallback(
    () => logout('Session expirée, reconnectez-vous.'),
    [logout]
  );

  return (
    <div className={`app-shell ${session ? 'app-shell-authenticated' : 'app-shell-guest'}`}>
      {session && (
        <aside className="app-sidebar">
          <div className="border-b border-white/10 px-6 py-6">
            <Brand compact />
          </div>

          <div className="px-4 pt-8">
            <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
              Espace de travail
            </p>
            <nav className="space-y-1" aria-label="Navigation principale">
              <NavItem
                active
                href="#main-content"
                icon={
                  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.7">
                    <rect x="3" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="3" width="7" height="7" rx="1.5" />
                    <rect x="3" y="14" width="7" height="7" rx="1.5" />
                    <rect x="14" y="14" width="7" height="7" rx="1.5" />
                  </svg>
                }
              >
                Vue d'ensemble
              </NavItem>
              <NavItem
                href="#accounts"
                icon={
                  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.7">
                    <rect x="3" y="5" width="18" height="14" rx="2.5" />
                    <path strokeLinecap="round" d="M3 10h18M7 15h3" />
                  </svg>
                }
              >
                Mes comptes
              </NavItem>
              <NavItem
                href="#payment-form"
                icon={
                  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.7">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18m5-13H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6" />
                  </svg>
                }
              >
                Paiements
              </NavItem>
              <NavItem
                href="#activity"
                icon={
                  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.7">
                    <circle cx="12" cy="12" r="9" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
                  </svg>
                }
              >
                Activité récente
              </NavItem>
            </nav>
          </div>

          <div className="mt-auto p-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-30" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
                </span>
                <span className="text-xs font-semibold text-slate-200">Espace de paiement</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-400">
                Environnement fictif de démonstration. Aucune donnée bancaire réelle.
              </p>
            </div>
            <p className="px-2 pt-4 text-[10px] text-slate-600">RESILIENCE ALPHA · DEMO</p>
          </div>
        </aside>
      )}

      <div className="app-main">
        <header className="app-topbar">
          <div className="flex min-w-0 items-center gap-3">
            {!session ? (
              <Brand />
            ) : (
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">Espace sécurisé / Paiements</p>
                <h1 className="mt-1 truncate text-lg font-bold tracking-tight text-slate-900">
                  Bonjour, {session.username}
                </h1>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden sm:block">
              <StatusBadge />
            </div>
            {session ? (
              <>
                <div className="hidden h-8 w-px bg-slate-200 sm:block" />
                <div className="hidden items-center gap-2 md:flex">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700">
                    {session.username.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <p className="max-w-32 truncate text-sm font-semibold text-slate-800">
                      {session.username}
                    </p>
                    <p className="text-xs text-slate-500">Utilisateur connecté</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => logout()}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                >
                  <span className="hidden sm:inline">Déconnexion</span>
                  <span className="sm:hidden">Quitter</span>
                </button>
              </>
            ) : (
              <span className="hidden text-xs font-medium text-slate-500 sm:block">
                Environnement de démonstration
              </span>
            )}
          </div>
        </header>

        <main id="main-content" className="app-content">
          {!session ? (
            <div className="guest-layout">
              <div className="guest-intro">
                <span className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-white/80 px-3 py-1.5 text-xs font-semibold text-indigo-700 shadow-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                  Une plateforme pensée pour la résilience
                </span>
                <h2 className="mt-6 max-w-xl text-4xl font-bold leading-tight tracking-tight text-slate-950 sm:text-5xl">
                  Vos paiements,
                  <span className="block bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
                    en toute clarté.
                  </span>
                </h2>
                <p className="mt-5 max-w-lg text-base leading-7 text-slate-600">
                  Retrouvez vos comptes et gérez vos transferts dans un espace simple,
                  lisible et conçu pour une expérience sereine.
                </p>

                <div className="mt-8 grid max-w-lg grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white bg-white/80 p-4 shadow-sm">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3 19 6v5c0 4.5-2.8 7.8-7 10-4.2-2.2-7-5.5-7-10V6l7-3Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="m9 12 2 2 4-4" />
                      </svg>
                    </div>
                    <p className="mt-3 font-semibold text-slate-800">Accès contrôlé</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Connexion requise pour accéder à votre espace.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white bg-white/80 p-4 shadow-sm">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
                      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8">
                        <rect x="3" y="5" width="18" height="14" rx="2.5" />
                        <path strokeLinecap="round" d="M3 10h18M7 15h3" />
                      </svg>
                    </div>
                    <p className="mt-3 font-semibold text-slate-800">Comptes centralisés</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Consultez vos soldes après connexion.
                    </p>
                  </div>
                </div>
              </div>
              <div className="guest-login-panel">
                <Login
                  onLogin={(s) => {
                    setNotice('');
                    setSession(s);
                  }}
                  notice={notice}
                />
              </div>
            </div>
          ) : (
            <Payment token={session.token} onUnauthorized={expired} />
          )}
        </main>

        <footer className="app-footer">
          <span>© {new Date().getFullYear()} Resilience Alpha</span>
          <span>Environnement fictif · Aucune donnée bancaire réelle</span>
        </footer>
      </div>
    </div>
  );
}
