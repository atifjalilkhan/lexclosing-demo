-- RWHM Client Intake & Case Status System — Postgres schema
--
-- Run this once against a fresh database (local Postgres for dev, or a
-- Supabase project for production) before starting the server. It is safe
-- to re-run: every statement uses IF NOT EXISTS / ON CONFLICT so re-running
-- it against an already-initialized database is a no-op rather than an error.

CREATE TABLE IF NOT EXISTS clients (
  id          SERIAL PRIMARY KEY,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  phone       TEXT NOT NULL,
  email       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cases (
  id             SERIAL PRIMARY KEY,
  case_number    TEXT NOT NULL UNIQUE,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  accident_type  TEXT NOT NULL,
  accident_date  TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  stage          TEXT NOT NULL DEFAULT 'Intake Received',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cases_case_number ON cases (case_number);
CREATE INDEX IF NOT EXISTS idx_cases_client_id ON cases (client_id);
CREATE INDEX IF NOT EXISTS idx_clients_last_name ON clients (lower(last_name));

CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  session_id  TEXT,
  sender      TEXT NOT NULL,
  text        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages (session_id);

-- Staff/admin users who can log into the internal dashboard.
-- password_hash is a bcrypt hash — never store plaintext passwords.
CREATE TABLE IF NOT EXISTS staff_users (
  id             SERIAL PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  name           TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- In-progress (not-yet-submitted) client chat conversations. Storing this
-- in Postgres rather than server memory means the app works correctly on
-- serverless hosts (Vercel) where consecutive requests in the same
-- conversation can land on different, memory-isolated instances — and as
-- a side benefit, it also means an in-progress chat survives a server
-- restart on any host. Completed cases are unaffected either way, since
-- they're written to the clients/cases tables immediately on submission.
CREATE TABLE IF NOT EXISTS chat_sessions (
  session_id  TEXT PRIMARY KEY,
  state       JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions (updated_at);
