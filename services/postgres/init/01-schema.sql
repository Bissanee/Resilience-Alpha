-- Schéma initial. Exécuté UNIQUEMENT au premier démarrage d'un volume pgdata vide.
-- Données 100 % fictives. Total des soldes = 100000.00 (utilisé par GET /integrity).

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('user', 'monitor'))
);

CREATE TABLE accounts (
  id       TEXT PRIMARY KEY,
  owner    TEXT NOT NULL,
  balance  NUMERIC(12,2) NOT NULL CHECK (balance >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'EUR'
);

CREATE SEQUENCE tx_seq;

CREATE TABLE transactions (
  id              TEXT PRIMARY KEY DEFAULT ('TX-' || nextval('tx_seq')),
  from_account    TEXT NOT NULL REFERENCES accounts(id),
  to_account      TEXT NOT NULL REFERENCES accounts(id),
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency        CHAR(3) NOT NULL DEFAULT 'EUR',
  status          TEXT NOT NULL,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO accounts (id, owner, balance, currency) VALUES
  ('ACC-001',   'alice',   40000.00, 'EUR'),
  ('ACC-002',   'bob',     30000.00, 'EUR'),
  ('ACC-003',   'alice',   20000.00, 'EUR'),
  ('ACC-004',   'bob',      9000.00, 'EUR'),
  ('ACC-MON-1', 'monitor',   500.00, 'EUR'),
  ('ACC-MON-2', 'monitor',   500.00, 'EUR');
