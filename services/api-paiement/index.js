// API métier de paiement (données fictives) : transactions, soldes, intégrité, santé, métriques.
import Fastify from 'fastify';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import client from 'prom-client';
import { randomUUID } from 'node:crypto';

const SERVICE = 'api-paiement';
const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET;
const EXPECTED_TOTAL = Number(process.env.EXPECTED_TOTAL || '100000.00');

if (!JWT_SECRET) {
  console.error(JSON.stringify({ level: 'error', service: SERVICE, event: 'missing_env', var: 'JWT_SECRET' }));
  process.exit(1);
}

const log = (level, event, extra = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, service: SERVICE, event, ...extra }));

const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST || 'postgres',
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  max: 10,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000,
});
pool.on('error', (e) => log('error', 'pool_error', { msg: e.message }));

// ── Métriques ──
const register = new client.Registry();
const httpRequests = new client.Counter({
  name: 'http_requests_total', help: 'Requêtes HTTP', labelNames: ['service', 'route', 'status'], registers: [register],
});
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds', help: 'Durée des requêtes', labelNames: ['service', 'route'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5], registers: [register],
});
const txTotal = new client.Counter({
  name: 'transactions_total', help: 'Transactions', labelNames: ['status'], registers: [register],
});
const dbUp = new client.Gauge({ name: 'db_up', help: 'Base joignable (1/0)', registers: [register] });

const app = Fastify({ logger: false, trustProxy: true, genReqId: () => randomUUID() });

app.addHook('onResponse', async (req, reply) => {
  const route = req.routeOptions?.url ?? 'unknown';
  httpRequests.inc({ service: SERVICE, route, status: reply.statusCode });
  httpDuration.observe({ service: SERVICE, route }, reply.elapsedTime / 1000);
  if (route !== '/health' && route !== '/metrics') {
    log('info', 'http_request', { request_id: req.id, ip: req.ip, method: req.method, route, status: reply.statusCode });
  }
});

// ── Authentification : vérification locale du JWT (pas d'appel réseau à chaque requête) ──
async function requireAuth(req, reply) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return reply.code(401).send({ error: 'unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    return reply.code(401).send({ error: 'unauthorized' });
  }
}

// ── Routes publiques ──
app.get('/health', async (req, reply) => {
  try {
    await pool.query('SELECT 1');
    dbUp.set(1);
    return { status: 'ok', db: 'ok', ts: new Date().toISOString() };
  } catch {
    dbUp.set(0);
    return reply.code(503).send({ status: 'down', db: 'down', ts: new Date().toISOString() });
  }
});

app.get('/metrics', async (req, reply) => {
  reply.header('Content-Type', register.contentType);
  return register.metrics();
});

// ── Transactions ──
const txSchema = {
  body: {
    type: 'object',
    required: ['from_account', 'to_account', 'amount', 'currency', 'idempotency_key'],
    additionalProperties: false,
    properties: {
      from_account: { type: 'string', pattern: '^ACC-[A-Z0-9-]{1,16}$' },
      to_account: { type: 'string', pattern: '^ACC-[A-Z0-9-]{1,16}$' },
      amount: { type: 'number', exclusiveMinimum: 0, maximum: 1000000 },
      currency: { type: 'string', enum: ['EUR'] },
      idempotency_key: { type: 'string', minLength: 8, maxLength: 64 },
    },
  },
};

app.post('/transactions', { schema: txSchema, onRequest: requireAuth }, async (req, reply) => {
  const { from_account, to_account, amount, currency, idempotency_key } = req.body;

  if (from_account === to_account) return reply.code(400).send({ error: 'invalid_request' });
  if (Math.round(amount * 100) / 100 !== amount) return reply.code(400).send({ error: 'invalid_request' });

  let db;
  try {
    db = await pool.connect();
  } catch (e) {
    txTotal.inc({ status: 'failed' });
    log('error', 'db_unavailable', { request_id: req.id, msg: e.message });
    return reply.code(503).send({ error: 'unavailable' });
  }

  try {
    await db.query('BEGIN');

    // Verrouillage des deux comptes dans un ordre fixe (évite les interblocages)
    const { rows: accounts } = await db.query(
      'SELECT id, owner, balance FROM accounts WHERE id = ANY($1) ORDER BY id FOR UPDATE',
      [[from_account, to_account]],
    );
    const from = accounts.find((a) => a.id === from_account);
    const to = accounts.find((a) => a.id === to_account);

    if (!from || !to) {
      await db.query('ROLLBACK');
      txTotal.inc({ status: 'failed' });
      return reply.code(404).send({ error: 'account_not_found' });
    }
    // On ne peut débiter que ses propres comptes
    if (from.owner !== req.user.sub) {
      await db.query('ROLLBACK');
      txTotal.inc({ status: 'failed' });
      log('warn', 'forbidden_debit', { request_id: req.id, ip: req.ip, user: req.user.sub, account: from_account });
      return reply.code(403).send({ error: 'forbidden' });
    }
    if (Number(from.balance) < amount) {
      await db.query('ROLLBACK');
      txTotal.inc({ status: 'failed' });
      return reply.code(402).send({ error: 'insufficient_funds' });
    }

    await db.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [amount, from_account]);
    await db.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [amount, to_account]);
    const { rows } = await db.query(
      `INSERT INTO transactions (from_account, to_account, amount, currency, status, idempotency_key, created_by)
       VALUES ($1, $2, $3, $4, 'COMPLETED', $5, $6) RETURNING id, status, created_at`,
      [from_account, to_account, amount, currency, idempotency_key, req.user.sub],
    );
    await db.query('COMMIT');

    txTotal.inc({ status: 'completed' });
    log('info', 'transaction_created', { request_id: req.id, ip: req.ip, id: rows[0].id, user: req.user.sub });
    return reply.code(201).send({ id: rows[0].id, status: rows[0].status, ts: rows[0].created_at });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch { /* ignore */ }
    txTotal.inc({ status: 'failed' });
    if (e.code === '23505') {
      return reply.code(409).send({ error: 'duplicate' });
    }
    log('error', 'transaction_error', { request_id: req.id, msg: e.message });
    return reply.code(503).send({ error: 'unavailable' });
  } finally {
    db.release();
  }
});

app.get('/transactions/:id', { onRequest: requireAuth }, async (req, reply) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, from_account, to_account, amount, currency, status, created_at
       FROM transactions WHERE id = $1 AND created_by = $2`,
      [req.params.id, req.user.sub],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'not_found' });
    return { ...rows[0], amount: Number(rows[0].amount) };
  } catch {
    return reply.code(503).send({ error: 'unavailable' });
  }
});

// Liste des comptes de l'utilisateur connecté (utilisée par le front)
app.get('/accounts', { onRequest: requireAuth }, async (req, reply) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, balance, currency FROM accounts WHERE owner = $1 ORDER BY id',
      [req.user.sub],
    );
    return rows.map((r) => ({ account: r.id, balance: Number(r.balance), currency: r.currency }));
  } catch {
    return reply.code(503).send({ error: 'unavailable' });
  }
});

app.get('/accounts/:id/balance', { onRequest: requireAuth }, async (req, reply) => {
  try {
    const { rows } = await pool.query('SELECT id, owner, balance, currency FROM accounts WHERE id = $1', [req.params.id]);
    const acc = rows[0];
    if (!acc || acc.owner !== req.user.sub) return reply.code(404).send({ error: 'not_found' });
    return { account: acc.id, balance: Number(acc.balance), currency: acc.currency };
  } catch {
    return reply.code(503).send({ error: 'unavailable' });
  }
});

// ── Intégrité : la somme des soldes doit rester constante, aucun solde négatif ──
app.get('/integrity', { onRequest: requireAuth }, async (req, reply) => {
  try {
    const { rows } = await pool.query(
      'SELECT COALESCE(SUM(balance), 0) AS total, COALESCE(MIN(balance), 0) AS min_balance FROM accounts',
    );
    const total = Number(rows[0].total);
    const consistent = Math.abs(total - EXPECTED_TOTAL) < 0.005 && Number(rows[0].min_balance) >= 0;
    return { consistent, total_balance: total, expected_total: EXPECTED_TOTAL };
  } catch {
    return reply.code(503).send({ error: 'unavailable' });
  }
});

async function start() {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  log('info', 'started', { port: PORT });
}

start().catch((e) => {
  log('error', 'startup_failed', { msg: e.message });
  process.exit(1);
});
