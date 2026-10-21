// Appels vers le backend. Le navigateur ne parle qu'à ce serveur web : nginx redirige /api et /auth.
const TIMEOUT_MS = 8000;

export class ApiError extends Error {
  constructor(status, code) {
    super(code || `HTTP ${status}`);
    this.status = status; // 0 = réseau injoignable ou délai dépassé
    this.code = code;
  }
}

async function request(url, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* corps absent ou non JSON (ex. page d'erreur du proxy) */
  }
  if (!res.ok) throw new ApiError(res.status, data?.error);
  return data;
}

export const login = (username, password) => request('/auth/login', { method: 'POST', body: { username, password } });

export const getAccounts = (token) => request('/api/accounts', { token });

export const createTransaction = (token, tx) => request('/api/transactions', { method: 'POST', token, body: tx });

// Santé du service de paiement : 'ok' | 'down'
export async function getHealth() {
  try {
    await request('/api/health');
    return 'ok';
  } catch {
    return 'down';
  }
}

export function describeError(err) {
  if (!(err instanceof ApiError)) return 'Erreur inattendue.';
  switch (err.code) {
    case 'invalid_credentials': return 'Identifiant ou mot de passe incorrect.';
    case 'insufficient_funds': return 'Solde insuffisant pour ce paiement.';
    case 'forbidden': return 'Vous ne pouvez débiter que vos propres comptes.';
    case 'account_not_found': return 'Compte destinataire introuvable.';
    case 'duplicate': return 'Ce paiement a déjà été enregistré.';
    case 'invalid_request': return 'Données invalides : vérifiez les comptes et le montant.';
    default:
  }
  if (err.status === 0 || err.status >= 500) return 'Service de paiement indisponible. Réessayez dans un instant.';
  if (err.status === 403) return 'Requête refusée par le pare-feu applicatif.';
  if (err.status === 429) return 'Trop de requêtes : réessayez dans un instant.';
  return `Erreur ${err.status}.`;
}
