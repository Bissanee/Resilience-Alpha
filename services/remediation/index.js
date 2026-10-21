// Moteur de remédiation : reçoit une alerte, décide, agit, puis VÉRIFIE par une vraie transaction.
// Un redémarrage de conteneur ne suffit jamais : seul un paiement réussi + /health ok + /integrity cohérent => RESOLVED.
import Fastify from 'fastify';
import client from 'prom-client';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const SERVICE = 'remediation';
const env = process.env;

// ── Configuration ──
const PORT = Number(env.PORT || 5000);
const DOCKER_BASE = (env.DOCKER_HOST || 'tcp://docker-socket-proxy:2375').replace(/^tcp:\/\//, 'http://');
const PROJECT = env.COMPOSE_PROJECT_NAME || 'resilience-alpha';
const ALLOWED_SERVICES = (env.ALLOWED_SERVICES || 'api-paiement,auth,front').split(',').map((s) => s.trim()).filter(Boolean);
const SERVICE_URLS = {
  'api-paiement': env.API_URL || 'http://api-paiement:4000',
  auth: env.AUTH_URL || 'http://auth:4001',
  front: env.FRONT_URL || 'http://front:3000',
};
const API_URL = SERVICE_URLS['api-paiement'];
const AUTH_URL = SERVICE_URLS.auth;
const WAF_DENY_FILE = env.WAF_DENY_FILE || '/etc/waf-deny/blocked-ips.conf';
const MONITOR_PASSWORD = env.MONITOR_PASSWORD;
const VERIFY_ATTEMPTS = Number(env.VERIFY_ATTEMPTS || 10);
const VERIFY_DELAY_MS = Number(env.VERIFY_DELAY_MS || 2000);
const COOLDOWN_MS = Number(env.COOLDOWN_MS || 15000);
const RATE_LIMIT_ENABLED = env.RATE_LIMIT_ENABLED === 'true'; // à activer quand B a branché la limitation côté WAF
const RATE_LIMIT_FILE = env.RATE_LIMIT_FILE || path.join(path.dirname(WAF_DENY_FILE), 'rate-limit.json');
const PROTECTED_IPS = (env.PROTECTED_IPS || '127.0.0.1,192.168.137.1').split(',').map((s) => s.trim());
const REMEDIATION_TOKEN = env.REMEDIATION_TOKEN || ''; // optionnel : si défini, POST /incidents exige ce jeton
const MAX_INCIDENTS = 200;
const MAX_DENY_ENTRIES = 1000;

if (!MONITOR_PASSWORD) {
  console.error(JSON.stringify({ level: 'error', service: SERVICE, event: 'missing_env', var: 'MONITOR_PASSWORD' }));
  process.exit(1);
}

const log = (level, event, extra = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, service: SERVICE, event, ...extra }));

// ── Métriques ──
const register = new client.Registry();
const httpRequests = new client.Counter({
  name: 'http_requests_total', help: 'Requêtes HTTP', labelNames: ['service', 'route', 'status'], registers: [register],
});
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds', help: 'Durée des requêtes', labelNames: ['service', 'route'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5], registers: [register],
});
const incidentsTotal = new client.Counter({
  name: 'remediation_incidents_total', help: 'Incidents par type et état', labelNames: ['type', 'state'], registers: [register],
});
const remediationDuration = new client.Histogram({
  name: 'remediation_duration_seconds', help: "Durée détection -> état final", labelNames: ['type', 'state'],
  buckets: [1, 2, 5, 10, 20, 30, 60, 120], registers: [register],
});
const activeIncidents = new client.Gauge({
  name: 'remediation_active_incidents', help: 'Incidents en cours', registers: [register],
});

// ── État en mémoire ──
const incidents = new Map();
const sseClients = new Set();
const TERMINAL = new Set(['RESOLVED', 'FAILED', 'ESCALATED']);
let verifyCounter = 0;
let latestProbe = { ok: null, detail: 'Aucun paiement de contrôle demandé', ts: null };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

function publish(type, payload) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch { sseClients.delete(res); }
  }
}

function addLog(inc, msg, extra = {}) {
  const entry = { ts: now(), msg, ...extra };
  inc.log.push(entry);
  inc.updated_at = entry.ts;
  log('info', 'incident_log', { incident_id: inc.incident_id, msg, ...extra });
  publish('log', { incident_id: inc.incident_id, ...entry });
}

function setState(inc, state, msg) {
  inc.state = state;
  inc.updated_at = now();
  incidentsTotal.inc({ type: inc.type, state });
  if (TERMINAL.has(state)) {
    inc.finished_at = Date.now();
    inc.duration_ms = inc.finished_at - inc.started_at;
    remediationDuration.observe({ type: inc.type, state }, inc.duration_ms / 1000);
  }
  addLog(inc, msg || `état : ${state}`, { state });
  publish('incident', view(inc));
  activeIncidents.set([...incidents.values()].filter((i) => !TERMINAL.has(i.state)).length);
}

// Vue publique d'un incident (l'ordre des clés place "state" en premier)
function view(inc) {
  return {
    incident_id: inc.incident_id,
    state: inc.state,
    type: inc.type,
    service: inc.service,
    score: inc.score,
    source_ip: inc.source_ip,
    features: inc.features,
    detected_ts: inc.detected_ts,
    created_at: inc.created_at,
    updated_at: inc.updated_at,
    duration_ms: inc.duration_ms ?? null,
    plan: inc.plan,
    actions: inc.actions,
    log: inc.log,
  };
}

// ── Utilitaires de sécurité ──
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
function isIPv4(s) {
  const m = IPV4.exec(s);
  return !!m && m.slice(1).every((o) => Number(o) <= 255 && String(Number(o)) === o);
}
// Adresses qu'il ne faut JAMAIS bloquer (auto-blocage de la plateforme) : boucle locale, réseaux Docker, hôte
function isProtectedIp(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || PROTECTED_IPS.includes(ip);
}
function tokenOk(header) {
  if (!REMEDIATION_TOKEN) return true;
  const given = Buffer.from((header || '').replace(/^Bearer /, ''));
  const expected = Buffer.from(REMEDIATION_TOKEN);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ── Accès Docker (uniquement via le proxy filtrant) ──
async function dockerFetch(pathAndQuery, options = {}) {
  return fetch(`${DOCKER_BASE}${pathAndQuery}`, { signal: AbortSignal.timeout(15000), ...options });
}

async function restartService(serviceName) {
  if (!ALLOWED_SERVICES.includes(serviceName)) {
    throw new Error(`service non autorisé : ${serviceName}`);
  }
  const filters = encodeURIComponent(JSON.stringify({
    label: [`com.docker.compose.service=${serviceName}`, `com.docker.compose.project=${PROJECT}`],
  }));
  const listRes = await dockerFetch(`/containers/json?all=1&filters=${filters}`);
  if (!listRes.ok) throw new Error(`liste des conteneurs refusée (HTTP ${listRes.status})`);
  const list = await listRes.json();
  const id = list[0]?.Id;
  if (!id || !/^[a-f0-9]{12,64}$/.test(id)) throw new Error(`conteneur introuvable pour ${serviceName}`);
  const res = await dockerFetch(`/containers/${id}/restart?t=5`, { method: 'POST' });
  if (res.status !== 204) throw new Error(`redémarrage refusé (HTTP ${res.status})`);
  return `conteneur ${id.slice(0, 12)} redémarré`;
}

// ── Liste d'IP bloquées (fichier lu par le WAF) ──
let denyLock = Promise.resolve();
function blockIp(ip) {
  const run = async () => {
    if (!isIPv4(ip)) throw new Error('adresse IPv4 invalide');
    if (isProtectedIp(ip)) return `IP protégée, non bloquée : ${ip}`;
    let content = '';
    try { content = await fs.readFile(WAF_DENY_FILE, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const lines = content.split('\n').filter(Boolean);
    if (lines.includes(`deny ${ip};`)) return `déjà bloquée : ${ip}`;
    if (lines.length >= MAX_DENY_ENTRIES) throw new Error('liste de blocage pleine');
    lines.push(`deny ${ip};`);
    const tmp = `${WAF_DENY_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, lines.join('\n') + '\n', { mode: 0o644 });
    await fs.rename(tmp, WAF_DENY_FILE);
    return `IP ajoutée à la liste de blocage : ${ip} (le rechargement du WAF est géré côté WAF)`;
  };
  denyLock = denyLock.then(run, run);
  return denyLock;
}

async function applyRateLimit(serviceName) {
  if (!RATE_LIMIT_ENABLED) return 'ignoré : limitation de débit non branchée côté WAF (RATE_LIMIT_ENABLED=false)';
  await fs.writeFile(RATE_LIMIT_FILE, JSON.stringify({ service: serviceName, since: now() }) + '\n', { mode: 0o644 });
  return `indicateur de limitation écrit (${RATE_LIMIT_FILE})`;
}

// ── Vérification métier ──
async function httpJson(url, options = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(3000), ...options });
  let body = null;
  try { body = await res.json(); } catch { /* corps non JSON */ }
  return { status: res.status, body };
}

async function serviceHealthy(serviceName) {
  const base = SERVICE_URLS[serviceName];
  if (!base) return false;
  try {
    const { status } = await httpJson(`${base}/health`);
    return status === 200;
  } catch {
    return false;
  }
}

// Un paiement fictif de 0,01 EUR entre les deux comptes techniques, en alternant le sens (le solde reste stable)
async function verifyOnce(incidentId) {
  const login = await httpJson(`${AUTH_URL}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'monitor', password: MONITOR_PASSWORD }),
  });
  if (login.status !== 200 || !login.body?.token) return { ok: false, detail: `connexion refusée (HTTP ${login.status})` };
  const auth = { Authorization: `Bearer ${login.body.token}` };

  verifyCounter += 1;
  const [from, to] = verifyCounter % 2 === 0 ? ['ACC-MON-1', 'ACC-MON-2'] : ['ACC-MON-2', 'ACC-MON-1'];
  const tx = await httpJson(`${API_URL}/transactions`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from_account: from, to_account: to, amount: 0.01, currency: 'EUR',
      idempotency_key: `verify-${incidentId}-${Date.now()}-${verifyCounter}`.slice(0, 64),
    }),
  });
  if (tx.status !== 201) return { ok: false, detail: `paiement de contrôle refusé (HTTP ${tx.status})` };

  const health = await httpJson(`${API_URL}/health`);
  if (health.status !== 200) return { ok: false, detail: `/health en erreur (HTTP ${health.status})` };

  const integ = await httpJson(`${API_URL}/integrity`, { headers: auth });
  if (integ.status !== 200 || integ.body?.consistent !== true) return { ok: false, detail: 'contrôle d\'intégrité en échec' };

  return { ok: true, detail: `paiement ${tx.body?.id} accepté, /health ok, intégrité cohérente` };
}

async function verify(inc) {
  for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++) {
    let result;
    try {
      result = await verifyOnce(inc.incident_id);
    } catch (e) {
      result = { ok: false, detail: `service injoignable (${e.message})` };
    }
    addLog(inc, `vérification ${attempt}/${VERIFY_ATTEMPTS} : ${result.ok ? 'OK' : 'échec'} - ${result.detail}`);
    if (result.ok) return { ok: true, attempts: attempt, detail: result.detail };
    if (attempt < VERIFY_ATTEMPTS) await sleep(VERIFY_DELAY_MS);
  }
  return { ok: false, attempts: VERIFY_ATTEMPTS, detail: 'service toujours indisponible ou incohérent' };
}

// ── Politique de remédiation (liste fermée d'actions) ──
function planFor(inc) {
  switch (inc.type) {
    case 'dos': return ['block_ip', 'rate_limit', 'restart_service_if_degraded', 'verify'];
    case 'bruteforce': return ['block_ip', 'verify'];
    case 'sqli': return ['block_ip', 'verify'];
    default: return [];
  }
}

async function runAction(inc, action) {
  const t0 = Date.now();
  let ok = true;
  let detail = '';
  try {
    if (action === 'block_ip') {
      detail = inc.source_ip ? await blockIp(inc.source_ip) : 'aucune IP source fournie, rien à bloquer';
    } else if (action === 'rate_limit') {
      detail = await applyRateLimit(inc.service);
    } else if (action === 'restart_service_if_degraded') {
      if (await serviceHealthy(inc.service)) {
        detail = `${inc.service} répond encore : pas de redémarrage nécessaire`;
      } else {
        detail = await restartService(inc.service);
      }
    } else if (action === 'restart_service') {
      detail = await restartService(inc.service);
    } else {
      throw new Error(`action inconnue : ${action}`);
    }
  } catch (e) {
    ok = false;
    detail = e.message;
  }
  inc.actions.push({ action, ok, detail, ms: Date.now() - t0, ts: now() });
  addLog(inc, `action ${action} : ${ok ? 'OK' : 'ÉCHEC'} - ${detail}`, { action, ok });
}

async function runIncident(inc) {
  try {
    const plan = planFor(inc);
    inc.plan = plan;
    if (plan.length === 0) {
      setState(inc, 'ESCALATED', 'type inconnu : aucune action automatique, intervention humaine requise');
      return;
    }
    setState(inc, 'DECIDED', `plan retenu : ${plan.join(' -> ')}`);
    setState(inc, 'ACTING', 'exécution des actions');
    for (const action of plan.filter((a) => a !== 'verify')) {
      await runAction(inc, action);
    }
    setState(inc, 'VERIFYING', 'vérification du service par une transaction réelle');
    const result = await verify(inc);
    inc.actions.push({ action: 'verify', ok: result.ok, detail: result.detail, attempts: result.attempts, ts: now() });
    if (result.ok) setState(inc, 'RESOLVED', `service rétabli : ${result.detail}`);
    else setState(inc, 'FAILED', `reprise non confirmée : ${result.detail}`);
  } catch (e) {
    log('error', 'incident_crash', { incident_id: inc.incident_id, msg: e.message });
    setState(inc, 'FAILED', `erreur interne : ${e.message}`);
  }
}

// ── API ──
const app = Fastify({ logger: false, trustProxy: false, genReqId: () => randomUUID() });

app.addHook('onResponse', async (req, reply) => {
  const route = req.routeOptions?.url ?? 'unknown';
  httpRequests.inc({ service: SERVICE, route, status: reply.statusCode });
  httpDuration.observe({ service: SERVICE, route }, reply.elapsedTime / 1000);
});

app.get('/health', async () => ({ status: 'ok', service: SERVICE, ts: now() }));

app.get('/metrics', async (req, reply) => {
  reply.header('Content-Type', register.contentType);
  return register.metrics();
});

const incidentSchema = {
  body: {
    type: 'object',
    required: ['incident_id', 'type', 'service', 'score'],
    additionalProperties: false,
    properties: {
      incident_id: { type: 'string', pattern: '^[A-Za-z0-9._-]{1,64}$' },
      type: { type: 'string', enum: ['dos', 'bruteforce', 'sqli', 'unknown'] },
      service: { type: 'string', pattern: '^[a-z0-9-]{1,32}$' },
      score: { type: 'number', minimum: 0, maximum: 1 },
      source_ip: { type: ['string', 'null'], maxLength: 15 },
      features: { type: 'object', maxProperties: 20 },
      ts: { type: 'string', maxLength: 40 },
    },
  },
};

app.post('/incidents', { schema: incidentSchema }, async (req, reply) => {
  if (!tokenOk(req.headers.authorization)) return reply.code(401).send({ error: 'unauthorized' });
  const b = req.body;

  if (!ALLOWED_SERVICES.includes(b.service)) {
    return reply.code(400).send({ error: 'service_not_allowed', allowed: ALLOWED_SERVICES });
  }
  if (b.source_ip != null && !isIPv4(b.source_ip)) {
    return reply.code(400).send({ error: 'invalid_source_ip' });
  }
  if (incidents.has(b.incident_id)) {
    return reply.code(409).send({ error: 'duplicate_incident', incident_id: b.incident_id });
  }

  // Anti-boucle : même service + type + IP déjà en cours de traitement ou résolu depuis peu
  const key = `${b.service}|${b.type}|${b.source_ip ?? '-'}`;
  for (const i of incidents.values()) {
    if (i.dedup_key === key && (!TERMINAL.has(i.state) || Date.now() - i.finished_at < COOLDOWN_MS)) {
      log('info', 'incident_deduplicated', { incident_id: b.incident_id, existing: i.incident_id });
      return reply.code(202).send({ incident_id: i.incident_id, state: i.state, deduplicated: true });
    }
  }

  const inc = {
    incident_id: b.incident_id,
    state: 'DETECTED',
    type: b.type,
    service: b.service,
    score: b.score,
    source_ip: b.source_ip ?? null,
    features: b.features ?? {},
    detected_ts: b.ts ?? null,
    created_at: now(),
    updated_at: now(),
    started_at: Date.now(),
    dedup_key: key,
    plan: [],
    actions: [],
    log: [],
  };
  incidents.set(inc.incident_id, inc);
  if (incidents.size > MAX_INCIDENTS) incidents.delete(incidents.keys().next().value);
  setState(inc, 'DETECTED', `alerte reçue : ${inc.type} sur ${inc.service} (score ${inc.score})`);

  runIncident(inc); // asynchrone : la réponse n'attend pas la remédiation
  return reply.code(202).send({ incident_id: inc.incident_id, state: inc.state });
});

app.get('/probe', async (req, reply) => {
  // Le mot de passe du compte technique reste exclusivement dans le conteneur remediation.
  try {
    const result = await verifyOnce(`dashboard-probe-${Date.now()}`);
    latestProbe = { ...result, ts: now() };
    return latestProbe;
  } catch (e) {
    latestProbe = { ok: false, detail: `probe impossible : ${e.message}`, ts: now() };
    return reply.code(502).send(latestProbe);
  }
});

app.get('/blocked-ips', async () => {
  let content = '';
  try { content = await fs.readFile(WAF_DENY_FILE, 'utf8'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const ips = content.split(/\\r?\\n/).map((line) => line.match(/^\\s*deny\\s+([0-9.]+);\\s*$/)?.[1]).filter(Boolean);
  return { ips, count: ips.length, ts: now() };
});

app.get('/incidents', async () => {
  return [...incidents.values()].reverse().slice(0, 100).map(view);
});

app.get('/incidents/:id', async (req, reply) => {
  const inc = incidents.get(req.params.id);
  if (!inc) return reply.code(404).send({ error: 'not_found' });
  return view(inc);
});

// Flux d'événements pour le dashboard (Server-Sent Events)
app.get('/events', (req, reply) => {
  if (sseClients.size >= 20) return reply.code(503).send({ error: 'too_many_clients' });
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(': connected\n\n');
  sseClients.add(res);
  req.raw.on('close', () => sseClients.delete(res));
});

setInterval(() => {
  for (const res of sseClients) {
    try { res.write(': ping\n\n'); } catch { sseClients.delete(res); }
  }
}, 15000).unref();

app.listen({ port: PORT, host: '0.0.0.0' }).then(() => {
  log('info', 'started', { port: PORT, allowed_services: ALLOWED_SERVICES, deny_file: WAF_DENY_FILE, token_required: !!REMEDIATION_TOKEN });
}).catch((e) => {
  log('error', 'startup_failed', { msg: e.message });
  process.exit(1);
});