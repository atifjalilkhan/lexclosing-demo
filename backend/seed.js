/**
 * seed.js — loads demo data for local testing / walkthroughs
 *
 * Run with: node backend/seed.js
 *
 * Creates:
 *   - one staff login (email/password from env, or sensible defaults)
 *   - three demo cases at different stages, so the case-stage tracker and
 *     admin dashboard both have something realistic to show.
 *
 * Safe to run more than once: the staff user is upserted by email, and a
 * quick check skips re-seeding demo cases if any cases already exist.
 */

require('dotenv').config();
const db = require('./db');
const auth = require('./auth');

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@lexcase.com';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Demo@123';
const ADMIN_NAME = process.env.SEED_ADMIN_NAME || 'LexClosing Administrator';

async function seedStaffUser() {
  const passwordHash = await auth.hashPassword(ADMIN_PASSWORD);
  await db.createStaffUser({
    email: ADMIN_EMAIL,
    passwordHash,
    name: ADMIN_NAME,
  });
  console.log(`Staff login ready: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log('  (change this password before using with real clients)');
}

async function seedDemoCases() {
  const existing = await db.listCasesWithClients();
  if (existing.length > 0) {
    console.log(`Skipping demo cases — ${existing.length} case(s) already exist.`);
    return;
  }

  const demoCases = [
    {
      client: {
        firstName: 'Maria',
        lastName: 'Santos',
        phone: '845-555-0142',
        email: 'maria.santos@example.com',
      },
      accidentType: 'Residential Purchase',
      accidentDate: '123 Main Street, Kingston, NY',
      description: 'Buyer representation for residential home purchase. Mortgage commitment pending.',
      stage: 'Mortgage Processing',
    },
    {
      client: {
        firstName: 'David',
        lastName: 'Chen',
        phone: '845-555-0198',
        email: 'david.chen@example.com',
      },
      accidentType: 'Residential Sale',
      accidentDate: '45 Oak Avenue, Poughkeepsie, NY',
      description: 'Seller representation. Title review in progress.',
      stage: 'Title Review',
    },
    {
      client: {
        firstName: 'Sandra',
        lastName: 'Wilkes',
        phone: '845-555-0176',
        email: 'sandra.wilkes@example.com',
      },
      accidentType: 'Commercial Purchase',
      accidentDate: '800 Corporate Drive, Albany, NY',
      description: 'Commercial property acquisition. Contract received and under attorney review.',
      stage: 'Attorney Review',
    },
  ];

  for (const demo of demoCases) {
    const client = await db.addClient(demo.client);
    const created = await db.addCase({
      clientId: client.id,
      accidentType: demo.accidentType,
      accidentDate: demo.accidentDate,
      description: demo.description,
    });
    if (demo.stage !== created.stage) {
      await db.updateCaseStage(created.id, demo.stage);
    }
    console.log(`Seeded ${created.caseNumber} — ${demo.client.firstName} ${demo.client.lastName} (${demo.stage})`);
  }
}

async function main() {
  console.log('Seeding RWHM intake database...');
  await seedStaffUser();
  await seedDemoCases();
  console.log('Done.');
  await db.pool.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
