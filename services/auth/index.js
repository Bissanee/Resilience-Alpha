// Service d'authentification : login (JWT), vérification de jeton, santé, métriques.
import Fastify from 'fastify';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import client from 'prom-client';
import { randomUUID } from 'node:crypto';

const SERVICE = 'auth';
const PORT = Number(process.env.PORT || 4001);
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = 900; // secondes

if (!JWT_SECRET) {
  console.error(JSON.stringify({ level: 'error', service: SERVICE, event: 'missing_env', var: 'JWT_SECRET' }));
  process.exit(1);
}

// ── Logs JSON (format du contrat) ──
const log = (level, event, extra = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, service: SERVICE, event, ...extra }));

// ── Base de données ──
const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST || 'postgres',
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  max: 5,
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

// ── Routes ──
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

// Hash factice pour égaliser le temps de réponse quand l'utilisateur n'existe pas
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);

app.post('/auth/login', {
  schema: {
    body: {
      type: 'object',
      required: ['username', 'password'],
      additionalProperties: false,
      properties: {
        username: { type: 'string', minLength: 1, maxLength: 64 },
        password: { type: 'string', minLength: 1, maxLength: 128 },
      },
    },
  },
}, async (req, reply) => {
  const { username, password } = req.body;
  try {
    const { rows } = await pool.query('SELECT username, password_hash, role FROM users WHERE username = $1', [username]);
    const user = rows[0];
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) {
      log('warn', 'login_failed', { request_id: req.id, ip: req.ip, username });
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    const token = jwt.sign({ sub: user.username, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_TTL });
    log('info', 'login_success', { request_id: req.id, ip: req.ip, username });
    return { token, expires_in: TOKEN_TTL };
  } catch (e) {
    log('error', 'login_error', { request_id: req.id, msg: e.message });
    return reply.code(503).send({ error: 'unavailable' });
  }
});

app.get('/auth/verify', async (req, reply) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return reply.code(401).send({ valid: false });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return { valid: true, sub: payload.sub, role: payload.role };
  } catch {
    return reply.code(401).send({ valid: false });
  }
});

// ── Démarrage : attendre la BDD, créer les comptes de test (mots de passe depuis l'environnement) ──
async function seedUsers() {
  const users = [
    ['alice', 'user', process.env.USER_PASSWORD],
    ['bob', 'user', process.env.USER_PASSWORD],
    ['monitor', 'monitor', process.env.MONITOR_PASSWORD],
  ];
  for (const [username, role, password] of users) {
    if (!password) throw new Error(`mot de passe manquant pour ${username} (USER_PASSWORD / MONITOR_PASSWORD)`);
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING',
      [username, hash, role],
    );
  }
}

async function start() {
  for (let i = 1; i <= 30; i++) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (e) {
      log('warn', 'waiting_for_db', { attempt: i });
      if (i === 30) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await seedUsers();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  log('info', 'started', { port: PORT });
}

start().catch((e) => {
  log('error', 'startup_failed', { msg: e.message });
  process.exit(1);
});
