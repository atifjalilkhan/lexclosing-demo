/**
 * db.js — Postgres data access layer
 *
 * Talks to a real Postgres database via `pg`, using DATABASE_URL from the
 * environment. Works unmodified against:
 *   - a local Postgres instance during development (no SSL), or
 *   - a Supabase project in production (SSL required).
 *
 * Run backend/schema.sql once against a fresh database before starting the
 * server (see README.md). Run backend/seed.js to load demo data.
 */

const { Pool } = require('pg');

const STAGES = [
  'Contract Received',
  'Attorney Review',
  'Title Review',  
  'Mortgage Processing',
  'Clear To Close',
  'Closing Scheduled',
  'Closed',
];

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and point it at ' +
      'your local Postgres (dev) or Supabase (production) database.'
  );
}

// Supabase (and most managed Postgres hosts) require SSL but use a
// certificate chain that Node won't automatically trust, so we disable
// strict verification for the connection. Local dev Postgres has no SSL
// at all, so we only turn this on when explicitly told to.
const useSSL = process.env.PGSSL === 'true';

// On Vercel, every serverless invocation can spin up its own instance of
// this module (and therefore its own Pool). Keeping each instance's pool
// small avoids piling up connections against Supabase's connection limit —
// this is exactly what Supabase's "Transaction pooler" connection mode is
// designed to sit behind. On a persistent host (local dev, Render), one
// process holds one pool for its whole lifetime, so a larger pool is fine.
// Vercel sets the VERCEL env var automatically in its runtime; nothing
// else needs to set it.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
  max: process.env.VERCEL ? 1 : 10,
});

// Overridable per firm — see firm-config.js. Defaults to RWHM for this build.
const CASE_NUMBER_PREFIX = process.env.CASE_NUMBER_PREFIX || 'LC';

function formatCaseNumber(year, sequence) {
  return `${CASE_NUMBER_PREFIX}-${year}-${String(sequence).padStart(4, '0')}`;
}

function rowToClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    email: row.email,
    createdAt: row.created_at,
  };
}

function rowToCase(row) {
  if (!row) return null;
  return {
    id: row.id,
    caseNumber: row.case_number,
    clientId: row.client_id,
    accidentType: row.accident_type,
    accidentDate: row.accident_date,
    description: row.description,
    stage: row.stage,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Add a new client record.
 */
async function addClient({ firstName, lastName, phone, email }) {
  const res = await pool.query(
    `INSERT INTO clients (first_name, last_name, phone, email)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [
      (firstName || '').trim(),
      (lastName || '').trim(),
      (phone || '').trim(),
      (email || '').trim(),
    ]
  );
  return rowToClient(res.rows[0]);
}

/**
 * How many cases were opened in a given calendar year — used to build the
 * sequential portion of the case number (RWHM-YYYY-XXXX). Exposed mainly
 * for tests/inspection; addCase() computes this itself inside a locked
 * transaction to avoid race conditions between concurrent intakes.
 */
async function countCasesForYear(year) {
  const res = await pool.query(
    `SELECT count(*)::int AS n FROM cases WHERE case_number LIKE $1`,
    [`${CASE_NUMBER_PREFIX}-${year}-%`]
  );
  return res.rows[0].n;
}

/**
 * Create a new case for an existing client. Auto-generates the case number
 * and sets the initial stage to "Contract Received". Uses a Postgres advisory
 * lock so two simultaneous intakes can never be handed the same case
 * number.
 */
async function addCase({ clientId, accidentType, accidentDate, description }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Advisory lock scoped to this transaction — released automatically on
    // COMMIT/ROLLBACK. Serializes case-number generation without locking
    // the whole cases table for reads.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      'rwhm_case_number_sequence',
    ]);

    const year = new Date().getFullYear();
    const countRes = await client.query(
      `SELECT count(*)::int AS n FROM cases WHERE case_number LIKE $1`,
      [`${CASE_NUMBER_PREFIX}-${year}-%`]
    );
    const caseNumber = formatCaseNumber(year, countRes.rows[0].n + 1);

    const insertRes = await client.query(
      `INSERT INTO cases (case_number, client_id, accident_type, accident_date, description, stage)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        caseNumber,
        clientId,
        (accidentType || '').trim(),
        (accidentDate || '').trim(),
        (description || '').trim(),
        STAGES[0],
      ]
    );

    await client.query('COMMIT');
    return rowToCase(insertRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Look up a single case (with its client) by exact case number.
 * Matching is case-insensitive.
 */
async function findCaseByNumber(caseNumber) {
  const normalized = (caseNumber || '').trim();
  const res = await pool.query(
    `SELECT
        cases.*,
        clients.id AS client_id_full,
        clients.first_name, clients.last_name, clients.phone, clients.email,
        clients.created_at AS client_created_at
     FROM cases
     JOIN clients ON clients.id = cases.client_id
     WHERE upper(cases.case_number) = upper($1)
     LIMIT 1`,
    [normalized]
  );
  if (res.rows.length === 0) return null;
  return rowToJoined(res.rows[0]);
}

/**
 * Look up all cases (with clients) belonging to clients with a given last
 * name. Matching is case-insensitive and exact on last name.
 */
async function findCaseByClientLastName(lastName) {
  const normalized = (lastName || '').trim();
  const res = await pool.query(
    `SELECT
        cases.*,
        clients.id AS client_id_full,
        clients.first_name, clients.last_name, clients.phone, clients.email,
        clients.created_at AS client_created_at
     FROM cases
     JOIN clients ON clients.id = cases.client_id
     WHERE lower(clients.last_name) = lower($1)
     ORDER BY cases.created_at DESC`,
    [normalized]
  );
  return res.rows.map(rowToJoined);
}

/**
 * List every case with its client attached, newest first. Used by the
 * admin dashboard.
 */
async function listCasesWithClients() {
  const res = await pool.query(
    `SELECT
        cases.*,
        clients.id AS client_id_full,
        clients.first_name, clients.last_name, clients.phone, clients.email,
        clients.created_at AS client_created_at
     FROM cases
     JOIN clients ON clients.id = cases.client_id
     ORDER BY cases.created_at DESC`
  );
  return res.rows.map(rowToJoined);
}

function rowToJoined(row) {
  return {
    case: rowToCase(row),
    client: rowToClient({
      id: row.client_id_full,
      first_name: row.first_name,
      last_name: row.last_name,
      phone: row.phone,
      email: row.email,
      created_at: row.client_created_at,
    }),
  };
}

/**
 * Update a case's stage. Throws if the case or stage is invalid.
 */
async function updateCaseStage(caseId, newStage) {
  if (!STAGES.includes(newStage)) {
    throw new Error(
      `Invalid stage "${newStage}". Must be one of: ${STAGES.join(', ')}`
    );
  }
  const res = await pool.query(
    `UPDATE cases SET stage = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [newStage, Number(caseId)]
  );
  if (res.rows.length === 0) {
    throw new Error(`No case found with id ${caseId}`);
  }
  return rowToCase(res.rows[0]);
}

/**
 * Append a chat-log entry. Not surfaced in the UI yet, but keeping a raw
 * transcript is useful for QA and for training a future free-form AI layer.
 */
async function logMessage({ sessionId, sender, text }) {
  const res = await pool.query(
    `INSERT INTO messages (session_id, sender, text) VALUES ($1, $2, $3) RETURNING *`,
    [sessionId || null, sender || 'unknown', text || '']
  );
  return res.rows[0];
}

/**
 * Load an in-progress chat conversation's state by session id, or null if
 * it doesn't exist / hasn't been started. See the chat_sessions comment in
 * schema.sql for why this lives in Postgres instead of server memory.
 */
async function getChatSession(sessionId) {
  const res = await pool.query(
    `SELECT state FROM chat_sessions WHERE session_id = $1`,
    [sessionId]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0].state;
}

/**
 * Create or update a chat conversation's state. `state` is a plain JS
 * object (the whole conversation's step + collected answers so far) —
 * stored as JSONB, no schema migration needed if new fields are added
 * to the conversation state shape later.
 */
async function saveChatSession(sessionId, state) {
  await pool.query(
    `INSERT INTO chat_sessions (session_id, state, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (session_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
    [sessionId, JSON.stringify(state)]
  );
}

/**
 * Delete chat sessions untouched for longer than maxAgeHours. Abandoned
 * conversations (someone opens the chat, answers a question or two, then
 * leaves) accumulate rows here forever otherwise. Not scheduled
 * automatically anywhere — run manually or wire up to a periodic job
 * (e.g. a Vercel Cron Job hitting a protected endpoint, or a Render Cron
 * Job) once this is running for real. See README.md.
 */
async function cleanupOldChatSessions(maxAgeHours = 72) {
  const res = await pool.query(
    `DELETE FROM chat_sessions WHERE updated_at < now() - ($1 || ' hours')::interval`,
    [maxAgeHours]
  );
  return res.rowCount;
}

/**
 * Find a staff user by email (for login). Returns the raw row including
 * password_hash — callers must not leak that field back to clients.
 */
async function findStaffByEmail(email) {
  const res = await pool.query(
    `SELECT * FROM staff_users WHERE lower(email) = lower($1) LIMIT 1`,
    [(email || '').trim()]
  );
  return res.rows[0] || null;
}

/**
 * Create a staff user. `passwordHash` must already be a bcrypt hash —
 * this function never sees or stores a plaintext password.
 */
async function createStaffUser({ email, passwordHash, name }) {
  const res = await pool.query(
    `INSERT INTO staff_users (email, password_hash, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name
     RETURNING id, email, name, created_at`,
    [(email || '').trim(), passwordHash, name || '']
  );
  return res.rows[0];
}

async function countStaffUsers() {
  const res = await pool.query(`SELECT count(*)::int AS n FROM staff_users`);
  return res.rows[0].n;
}

module.exports = {
  STAGES,
  pool,
  CASE_NUMBER_PREFIX,
  formatCaseNumber,
  addClient,
  addCase,
  countCasesForYear,
  findCaseByNumber,
  findCaseByClientLastName,
  listCasesWithClients,
  updateCaseStage,
  logMessage,
  getChatSession,
  saveChatSession,
  cleanupOldChatSessions,
  findStaffByEmail,
  createStaffUser,
  countStaffUsers,
};
