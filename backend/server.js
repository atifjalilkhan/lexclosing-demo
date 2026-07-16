/**
 * server.js — local dev / always-on host (Render) entry point.
 *
 * All the actual application logic lives in backend/app.js. This file just
 * boots it with app.listen(). For Vercel, api/index.js requires app.js
 * directly instead and never calls this file.
 */

const app = require('./app');

// Default kept off the 3000-3022 range in case this runs alongside other
// local projects that already use those ports — override with PORT in .env.
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`RWHM intake system listening on port ${PORT}`);
});
