# RWHM Client Intake & Case Status System

A guided intake chat + case-status lookup system built for Rusk, Wadlin,
Heppner & Martuscello, LLP — and built to be reused for any personal injury
firm with only a config change (see "Reusing this for another firm" below).

## What this is

- A client-facing chat widget (`frontend/index.html`) that walks a new
  client through intake (name, phone, email, accident type, accident date,
  description), or looks up an existing case's status by case number or
  last name.
- A visual case-stage tracker: Intake Received -> Under Attorney Review ->
  Client in Treatment -> Demand Sent to Insurer -> Negotiation/Litigation ->
  Settled/Resolved.
- An internal staff dashboard (`frontend/admin.html`), behind a login, to
  see every case and update its stage.
- A real Postgres backend (not a flat file) with proper auth, sessions, and
  a case-number generator (`RWHM-2026-0001`, etc.).

The conversation flow is a guided, scripted chat (not a free-form AI model)
— every step is a plain if/else on the user's answer. That's a deliberate
choice: it's free to run, fully predictable, and easy for non-technical
staff to understand and trust. Swapping in the Claude or OpenAI API for
free-form natural-language intake is a scoped future upgrade, not something
this version depends on.

## Status: verified end-to-end against a live Supabase database

The full application has been run for real: `npm install`, schema
migration, seed data, `npm start`, and a complete walkthrough of both the
client chat (new-case intake through to a generated case number and stage
tracker, plus status lookup by case number and by last name) and the
admin dashboard (login, case list, stage updates), all against a live
Supabase Postgres database. The SQL layer was additionally verified query
by query by hand before that. One real bug was found and fixed during
that walkthrough (long stage-tracker labels overlapping visually — fixed
in `frontend/styles.css`).

The chat-conversation-state architecture was subsequently changed from
server memory to a `chat_sessions` Postgres table specifically so the app
also runs correctly on serverless hosts like Vercel (see "Deploying a free
demo on Vercel" below) — that change has been verified against Postgres
directly but not yet re-run through the full local server walkthrough. If
anything's off after that change, it's most likely a small integration
issue rather than a logic problem — the query itself was confirmed correct.

## Local setup

1. **Get a database.** Recommended: create a free project at
   [supabase.com](https://supabase.com) (no credit card required), then
   copy the connection string from Project Settings -> Database ->
   Connection string -> URI. Use this same connection string for local
   development and for production later — there's no reason to run a
   separate local Postgres server, and using Supabase from day one means
   your laptop never has to run a database process at all.

   (If you'd rather run Postgres locally — e.g. no internet — the code
   works with any Postgres 13+ instance. See the commented-out local
   option in `.env.example`.)

2. **Configure environment variables.**

   ```bash
   cp .env.example .env
   ```

   Fill in `DATABASE_URL` (from step 1), and generate a `SESSION_SECRET`:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   `PORT` defaults to `4000` (deliberately off the 3000-3022 range in case
   you're running other local projects on those ports).

3. **Install dependencies, set up the database, seed demo data:**

   ```bash
   npm install
   npm run db:migrate
   npm run db:seed
   ```

   The seed script prints the staff login it created
   (`admin@rwhm.com` / `ChangeMe123!` by default — **change this password
   before using real client data**; set `SEED_ADMIN_PASSWORD` in `.env`
   before seeding to use a different one from the start).

4. **Run it:**

   ```bash
   npm start
   ```

   Client intake chat: `http://localhost:4000/`
   Staff dashboard: `http://localhost:4000/admin-login.html`

## Deploying a free demo on Vercel

This is the fast, no-cost path to get a shareable URL in front of a
prospective firm before they've committed to anything — swap to the
"Deploying for real" (Render) section below once there's a paying client,
since Render's always-on process is the better fit once real leads depend
on this not sleeping or cold-starting.

The app is structured to support both hosts from the same codebase:
`backend/app.js` holds all the actual logic, `backend/server.js` boots it
with `app.listen()` for local dev/Render, and `api/index.js` +
`vercel.json` boot the exact same app as a Vercel serverless function.
Conversation state for an in-progress chat lives in the `chat_sessions`
Postgres table rather than server memory specifically so it survives
Vercel's model of every request potentially landing on a different,
memory-isolated instance.

1. **Push this repo to GitHub** (Vercel deploys from a Git repo, not a
   zip upload) — a private repo is fine.
2. **In the Vercel dashboard:** New Project -> import that repo. Vercel
   should auto-detect the `vercel.json` config; if it asks for a framework
   preset, choose "Other."
3. **Environment variables** (Project Settings -> Environment Variables in
   Vercel) — set all of these:
   - `DATABASE_URL` — same Supabase project as local dev, but see the
     pooler note below.
   - `PGSSL=true`
   - `SESSION_SECRET` — same value you generated for local dev, or a new
     long random string.
   - `NODE_ENV=production`
   - `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`, `NOTIFY_TO_EMAIL` — optional,
     same as local.
4. **Use the Transaction pooler connection string for `DATABASE_URL` on
   Vercel, not the Session pooler one used for local dev.** In Supabase:
   Connect -> Direct tab -> Connection Method -> **Transaction pooler**
   (port 6543). Serverless platforms like Vercel can spin up many
   short-lived function instances at once, each holding its own small
   connection pool — Transaction pooler is specifically designed to sit
   behind that pattern, whereas Session pooler (which Render/local dev
   use) is meant for one long-lived process holding a steady pool. Using
   the wrong one won't necessarily fail immediately, but can exhaust
   Supabase's connection limit under real traffic.
5. **Deploy.** Vercel gives you a URL like `rwhm-intake.vercel.app`
   immediately — that's what you'd send to John.
6. Run the migration and seed against the same Supabase database from
   your local machine first (`npm run db:migrate && npm run db:seed`,
   with your local `.env` pointed at that Supabase project) — you don't
   need to run these separately "on Vercel," since the database is the
   same one either way, only the app connecting to it changes.

One cost note specific to Vercel's free (Hobby) tier: it's meant for
personal, non-commercial use per Vercel's terms — fine for a pre-sale demo
you're using to close John, but check Vercel's current Hobby vs Pro terms
before treating a Vercel-hosted instance as the long-term home for a paying
client's production traffic. That's the other reason "move to Render once
John says yes" is the right sequencing, not just cost.

## Deploying for real

1. **Database:** use the same Supabase project from local setup, or create
   a fresh one for production. Once real client data is involved, upgrade
   the Supabase project off the free tier (~$25/mo) for better performance
   limits and point-in-time backup retention — Supabase's free tier does
   have daily backups, but with limited retention.

2. **Hosting:** deploy to [Render](https://render.com) using the included
   `render.yaml` (Render dashboard -> New -> Blueprint -> point at this
   repo). Use the **Starter** plan (~$7/mo), not the free tier — Render's
   free tier sleeps after inactivity, which means a lead messaging at 9pm
   would hit a slow, broken-feeling cold start. Render provisions free
   automatic HTTPS and lets you attach a custom subdomain (e.g.
   `intake.rwhm.com`) under Settings -> Custom Domains.

3. **Email alerts on new intake:** create a free account at
   [resend.com](https://resend.com) (100 emails/day free), verify a
   sending domain, and set `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`, and
   `NOTIFY_TO_EMAIL` in Render's environment variables. Without these set,
   the app still runs fine — it just logs "would have sent" to the server
   log instead of emailing staff. This is the single feature most likely
   to matter to a firm: it's what turns "a lead sat in an unopened
   dashboard all weekend" into "a paralegal got an email at 9:47pm Friday."

4. **Embedding on the firm's actual website:** the simplest approach is an
   `<iframe>` on the firm's site pointed at the deployed chat page, or a
   link/button that opens it. A more polished floating-bubble-widget
   embed (like Intercom) is a reasonable next iteration but isn't built
   into this version.

## Reusing this for another firm

This system is deliberately built so that onboarding a second firm never
means editing the application code — it means:

1. Copying this repository.
2. Setting the firm-specific values in `backend/firm-config.js` (or the
   equivalent `FIRM_*` / `BRAND_*` / `CASE_NUMBER_PREFIX` environment
   variables — see `.env.example`).
3. Creating that firm's own Supabase project and its own Render service.
4. Deploying.

The frontend fetches `/api/config` at load time and applies the firm name,
tagline, and brand colors dynamically — nothing about the firm is
hardcoded into the HTML/CSS/JS beyond a static fallback in case that fetch
ever fails.

**Always give each firm its own database and its own hosted instance.**
Personal injury firms are frequently direct competitors; never share one
deployment or one database across two firms, even with logical separation.
The "one template, isolated deployment per client" model is also just
simpler to operate as a small shop than a true multi-tenant SaaS would be.

## Cost summary

| Item | Cost |
|---|---|
| Node.js, Express, Postgres, all libraries used | $0 (open source) |
| Supabase (small firm, pilot volume) | $0 (free tier) -> ~$25/mo once live with real data |
| Render hosting (always-on, custom domain, HTTPS) | ~$7/mo (Starter plan) |
| Resend (staff email alerts on new intake) | $0 (free tier covers small-firm volume) |
| **Total to run for one firm** | **~$7-32/mo**, mostly $7 until case volume grows |
| Optional: Claude/OpenAI API for free-form intake | ~$10-50/mo, only if added later |
| Optional: Twilio for after-hours SMS/phone intake | pay-per-message/call, only if added later |

## Honest caveats / what's still not done

- **Status: verified locally end-to-end.** The full flow (new-case intake
  through to a generated case number and stage tracker, status lookup by
  case number and by last name, admin login, and stage updates) has been
  run and confirmed working against a live Supabase database.
- **No rate limiting** on the public chat/status-lookup endpoints. Before
  going live, add basic rate limiting (e.g. `express-rate-limit`) so
  someone can't spam-create fake cases or brute-force last-name lookups.
- **No password-reset flow** for staff accounts — if a staff member forgets
  their password, an admin currently has to re-run `seed.js` logic (or a
  small script using `db.createStaffUser` + `auth.hashPassword`) by hand.
  Fine for a one- or two-person pilot; add a real reset flow before rolling
  out to more staff.
- **No account lockout** after repeated failed logins.
- **Abandoned chat sessions accumulate** in the `chat_sessions` table —
  someone who opens the chat, answers a question or two, then leaves
  without finishing leaves a row behind indefinitely. `db.js` exports
  `cleanupOldChatSessions(maxAgeHours)` for this, but nothing calls it on
  a schedule yet — wire it up to a periodic job (a Vercel Cron Job or a
  Render Cron Job hitting a small protected endpoint) once this is running
  for real. Harmless at pilot volume, worth doing before it's been live
  for months.
- **No automated backup verification** — confirm Supabase's backup
  retention actually meets the firm's needs before relying on it for real
  client data, and consider a periodic `pg_dump` export as a second layer.
- Nothing in this project has had a legal/compliance review (e.g. state
  bar advertising rules for chatbots, data retention requirements, or
  what disclosure language a "confirm to submit" step legally needs) — this
  is a technical build, not legal advice, and that review should happen
  before real client data touches it.
