/**
 * api/index.js — Vercel serverless entry point.
 *
 * Vercel's Node runtime treats the default export from this file as a
 * request handler. An Express app is itself a valid (req, res) => {}
 * function, so exporting it directly here is enough — no app.listen()
 * call happens in this path (see vercel.json, which routes every request
 * to this one function).
 */

module.exports = require('../backend/app');
