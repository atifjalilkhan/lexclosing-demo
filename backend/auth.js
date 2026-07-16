/**
 * auth.js — staff login for the admin dashboard
 *
 * Deliberately simple, dependency-light auth: bcrypt-hashed passwords in
 * Postgres + server-side sessions (express-session). No third-party auth
 * provider required. This is enough to stop "anyone with the URL can see
 * every client's case file" — the #1 thing that must be fixed before real
 * client data touches this system.
 *
 * NOT included (add before handling real client data at scale): password
 * reset flow, account lockout after repeated failed attempts, and
 * multi-factor auth. For a single-firm pilot with a small number of staff
 * accounts created by hand (see seed.js), this is a reasonable baseline.
 */

const bcrypt = require('bcryptjs');
const db = require('./db');

const SALT_ROUNDS = 12;

async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

async function verifyPassword(plainPassword, hash) {
  return bcrypt.compare(plainPassword, hash);
}

/**
 * Middleware that blocks any route unless a staff member is logged in.
 * Apply to every /api/admin/* route except /api/admin/login itself.
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.staffId) {
    return next();
  }
  return res.status(401).json({ error: 'Not authenticated. Please log in.' });
}

/**
 * Registers /api/admin/login, /api/admin/logout, and /api/admin/session
 * on the given Express app.
 */
function registerAuthRoutes(app) {
  app.post('/api/admin/login', async (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
      }

      const staff = await db.findStaffByEmail(email);
      if (!staff) {
        // Same error for "no such user" and "wrong password" — don't leak
        // which one it was.
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      const ok = await verifyPassword(password, staff.password_hash);
      if (!ok) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      req.session.staffId = staff.id;
      req.session.staffEmail = staff.email;
      req.session.staffName = staff.name;

      return res.json({
        ok: true,
        staff: { id: staff.id, email: staff.email, name: staff.name },
      });
    } catch (err) {
      console.error('Login error:', err);
      return res.status(500).json({ error: 'Login failed. Please try again.' });
    }
  });

  app.post('/api/admin/logout', (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ ok: true });
    });
  });

  app.get('/api/admin/session', (req, res) => {
    if (req.session && req.session.staffId) {
      return res.json({
        loggedIn: true,
        staff: {
          id: req.session.staffId,
          email: req.session.staffEmail,
          name: req.session.staffName,
        },
      });
    }
    return res.json({ loggedIn: false });
  });
}

module.exports = {
  hashPassword,
  verifyPassword,
  requireAuth,
  registerAuthRoutes,
};
