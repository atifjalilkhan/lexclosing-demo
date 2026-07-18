/**
 * firm-config.js — the single place to rebrand this project for a new firm.
 *
 * To onboard a different law firm: copy this whole project, set the
 * FIRM_* / BRAND_* / CASE_NUMBER_PREFIX environment variables below for
 * that firm (or edit the defaults directly), point DATABASE_URL at that
 * firm's own database, and deploy. No other code changes are required —
 * the frontend fetches this config at runtime via GET /api/config.
 *
 * Each firm should always get its own database and its own hosted
 * instance (see README.md) — never share one deployment or one database
 * across two firms, since PI firms are often direct competitors.
 */

module.exports = {
  firmName: process.env.FIRM_NAME || 'LexCase',
  firmShortName: process.env.FIRM_SHORT_NAME || 'LEX',
  tagline: process.env.FIRM_TAGLINE || 'Client Intake & Case Status',
  colors: {
    primary: process.env.BRAND_PRIMARY_COLOR || '#1b3a2e',
    accent: process.env.BRAND_ACCENT_COLOR || '#b8863e',
    background: process.env.BRAND_BACKGROUND_COLOR || '#f7f4ee',
  },
};
