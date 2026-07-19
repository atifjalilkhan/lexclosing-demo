/**
 * app.js — the RWHM Client Intake & Case Status System, as a plain Express
 * app (no app.listen() here — that's deliberate).
 *
 * A guided (not free-form-AI) chat flow for:
 *   1. New client intake: name -> phone -> email -> accident type ->
 *      accident date -> description -> confirm -> case created.
 *   2. Case status lookup: by case number or client last name.
 *
 * Plus a session-authenticated admin API for staff to list cases and
 * update case stages.
 *
 * This file is required by two different entry points:
 *   - backend/server.js — calls app.listen(PORT). Used for local dev and
 *     for always-on hosts like Render.
 *   - api/index.js — exports this app directly as a Vercel serverless
 *     function handler. No app.listen() call happens in that path; Vercel
 *     invokes the exported app as a request handler per-request instead.
 *
 * Conversation state (which step of the intake flow a given chat session
 * is on) lives in Postgres (see db.getChatSession/saveChatSession and the
 * chat_sessions table in schema.sql), not server memory. That's what makes
 * this safe to run on Vercel, where consecutive requests in the same
 * conversation can land on different, memory-isolated function instances —
 * and it also means an in-progress chat survives a server restart on any
 * host.
 */

require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const db = require('./db');
const auth = require('./auth');
const { notifyNewIntake } = require('./notify');
const firmConfig = require('./firm-config');

const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET) {
  throw new Error(
    'SESSION_SECRET is not set. Copy .env.example to .env (or set it in ' +
      'your host\'s environment variables) before starting the server.'
  );
}

const app = express();
app.set('trust proxy', 1); // needed for secure cookies behind Render's/Vercel's proxy

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use(
  session({
    store: new pgSession({
      pool: db.pool,
      tableName: 'session',
      createTableIfMissing: true,
    }),
    name: 'rwhm.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Lets the frontend rebrand itself (name, tagline, colors) without any
// firm-specific values being hardcoded into the HTML/JS. See firm-config.js.
app.get('/api/config', (req, res) => {
  res.json(firmConfig);
});

// ---------------------------------------------------------------------
// Auth routes (/api/admin/login, /logout, /session)
// ---------------------------------------------------------------------
auth.registerAuthRoutes(app);

// ---------------------------------------------------------------------
// Admin API — everything below requires a logged-in staff session
// ---------------------------------------------------------------------
app.get('/api/admin/cases', auth.requireAuth, async (req, res) => {
  try {
    const results = await db.listCasesWithClients();
    res.json({
      stages: db.STAGES,
      cases: results.map(({ case: c, client }) => ({
        id: c.id,
        caseNumber: c.caseNumber,
        stage: c.stage,
        transactionType: c.accidentType,
        propertyAddress: c.accidentDate,
        description: c.description,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        client: {
          firstName: client.firstName,
          lastName: client.lastName,
          phone: client.phone,
          email: client.email,
        },
      })),
    });
  } catch (err) {
    console.error('Failed to list cases:', err);
    res.status(500).json({ error: 'Failed to load cases.' });
  }
});

app.post('/api/admin/cases/:id/stage', auth.requireAuth, async (req, res) => {
  try {
    const { stage } = req.body || {};
    const updated = await db.updateCaseStage(req.params.id, stage);
    res.json({ ok: true, case: updated });
  } catch (err) {
    console.error('Failed to update stage:', err);
    res.status(400).json({ error: err.message || 'Failed to update stage.' });
  }
});

app.get('/api/admin/stages', auth.requireAuth, (req, res) => {
  res.json({ stages: db.STAGES });
});

// ---------------------------------------------------------------------
// Client-facing chat flow
// ---------------------------------------------------------------------

function newSessionId() {
  return (
    Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
  );
}

function freshState() {
  return { step: 'mode', data: {} };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCIDENT_TYPES = [
  'Buyer Representation',
  'Seller Representation',
  'Residential Purchase',
  'Residential Sale',
  'Commercial Purchase',
  'Commercial Sale',
  'Refinance',
  'Other',
];

function stageTracker(stage) {
  const idx = db.STAGES.indexOf(stage);
  return { stages: db.STAGES, currentStage: stage, currentIndex: idx };
}

app.post('/api/chat/start', async (req, res) => {
  try {
    const sessionId = newSessionId();
    await db.saveChatSession(sessionId, freshState());
    res.json({
      sessionId,
      reply:
        `Welcome to ${firmConfig.firmName}. I can help you start a new ` +
        "case or check the status of an existing one. Which would you " +
        "like to do?",
      quickReplies: ['Start a new case', 'Check my case status'],
    });
  } catch (err) {
    console.error('Failed to start chat session:', err);
    res.status(500).json({
      error: 'Could not start a new session. Please try again.',
    });
  }
});

app.post('/api/chat/message', async (req, res) => {
  const { sessionId, message } = req.body || {};
  if (!sessionId) {
    return res.status(400).json({
      error: 'Session expired or invalid. Please refresh to start over.',
    });
  }

  try {
    const state = await db.getChatSession(sessionId);
    if (!state) {
      return res.status(400).json({
        error: 'Session expired or invalid. Please refresh to start over.',
      });
    }

    const text = (message || '').trim();
    const result = await handleStep(sessionId, state, text);
    // handleStep mutates `state` in place (including on a "start over"
    // reset — see the 'confirm' case below), so saving it here after the
    // fact always persists whatever the conversation's new state is.
    await db.saveChatSession(sessionId, state);
    res.json(result);
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({
      reply:
        "Sorry — something went wrong on our end. Please try again, or " +
        "call our office directly if this keeps happening.",
    });
  }
});

async function handleStep(sessionId, state, text) {
  switch (state.step) {
    case 'mode': {
      const lower = text.toLowerCase();
      if (lower.includes('status') || lower.includes('existing')) {
        state.step = 'status_query';
        return {
          reply:
            "No problem. Please enter your case number (looks like " +
            `${db.CASE_NUMBER_PREFIX}-2026-0001) or your last name.`,
        };
      }
      // Default to new-case intake for anything else, including "Start a new case".
      state.step = 'firstName';
      return {
        reply:
          "Great — let's get some basic information started. What is your " +
          "first name?",
      };
    }

    case 'status_query': {
      if (!text) {
        return { reply: 'Please enter a case number or last name.' };
      }
      // Case numbers look like PREFIX-YYYY-#### (e.g. RWHM-2026-0001); the
      // prefix is firm-specific (see firm-config.js / CASE_NUMBER_PREFIX),
      // so detect the shape generically rather than hardcoding "RWHM-".
      let matches = [];
      if (/^[A-Za-z]{2,}-\d{4}-\d+$/.test(text)) {
        const found = await db.findCaseByNumber(text);
        if (found) matches = [found];
      } else {
        matches = await db.findCaseByClientLastName(text);
      }

      if (matches.length === 0) {
        return {
          reply:
            `I couldn't find a case matching "${text}". Please double-check ` +
            "the case number or last name, or call our office directly for " +
            "help.",
          quickReplies: ['Try again', 'Start a new case'],
        };
      }

      state.step = 'done';
      return {
        reply:
          matches.length === 1
            ? `Found it. Here's the current status for ${matches[0].client.firstName} ${matches[0].client.lastName}:`
            : `Found ${matches.length} case(s) for that last name:`,
        type: 'status_result',
        results: matches.map(({ case: c, client }) => ({
          caseNumber: c.caseNumber,
          clientName: `${client.firstName} ${client.lastName}`,
          transactionType: c.accidentType,
          tracker: stageTracker(c.stage),
        })),
      };
    }

    case 'firstName': {
      if (!text) return { reply: 'Please enter your first name.' };
      state.data.firstName = text;
      state.step = 'lastName';
      return { reply: `Thanks, ${text}. What is your last name?` };
    }

    case 'lastName': {
      if (!text) return { reply: 'Please enter your last name.' };
      state.data.lastName = text;
      state.step = 'phone';
      return { reply: 'What is the best phone number to reach you?' };
    }

    case 'phone': {
      const digits = text.replace(/\D/g, '');
      if (digits.length < 10) {
        return {
          reply:
            "That doesn't look like a complete phone number — please " +
            "include area code (e.g. 845-555-0100).",
        };
      }
      state.data.phone = text;
      state.step = 'email';
      return { reply: 'And your email address?' };
    }

    case 'email': {
      if (!EMAIL_RE.test(text)) {
        return { reply: 'That email address doesn\'t look valid — please try again.' };
      }
      state.data.email = text;
      state.step = 'transactionType';
      return {
        reply: 'What type of real estate transaction is this regarding?',
        quickReplies: ACCIDENT_TYPES,
      };
    }

    case 'transactionType': {
      if (!text) return { reply: 'Please choose the type of real estate transaction.' };
      state.data.transactionType = text;
      state.step = 'propertyAddress';
      return { reply: 'What is the property address?' };
    }

    case 'propertyAddress': {
      if (!text) return { reply: 'Please enter the property address.' };
      state.data.propertyAddress = text;
      state.step = 'purchasePrice';
      return {
        reply:
          'What is the purchase price?',
      };
    }

    case 'purchasePrice': {
      if (!text) return { reply: 'Please enter the purchase price.' };
      state.data.purchasePrice = text;
      state.step = 'closingDate';
      return {
        reply:
          'What is the expected closing date?',
      };
    }
    case 'closingDate': {
      if (!text) return { reply: 'Please enter the expected closing date.' };
      state.data.closingDate = text;
      state.step = 'buyerName';
      return {
        reply:
          'Please enter the buyer name.',
      };
    }
    case 'buyerName': {
      if (!text) return { reply: 'Please enter the buyer name.' };
      state.data.buyerName = text;
      state.step = 'sellerName';
      return {
        reply:
          'Please enter the seller name.',
      };
    }
    case 'sellerName': {
       if (!text) return { reply: 'Please enter the seller name.' };
       state.data.sellerName = text;
       state.step = 'lenderName';
       return {
         reply:
           'Please enter the lender name',
       };
     }
     case 'lenderName': {
       if (!text) return { reply: 'Please enter the lender name.' };
       state.data.lenderName = text;
       state.step = 'description';
       return {
         reply:
           'Please provide any additional transaction details or special circumstances.',
        };
      }
    case 'description': {
      if (!text) return { reply: 'A brief description helps us understand the transaction — please add a sentence.' };
      state.data.description = text;
      state.step = 'confirm';
      return {
        reply: 'Here\'s what I have — does this look right?',
        type: 'confirm_summary',
        summary: { ...state.data },
        quickReplies: ['Yes, submit', 'Start over'],
      };
    }

    case 'confirm': {
      const lower = text.toLowerCase();
      if (lower.includes('start over') || lower.includes('no')) {
        // Mutate in place (don't reassign `state`) so the caller's
        // subsequent db.saveChatSession(sessionId, state) call persists
        // this reset correctly.
        Object.assign(state, freshState());
        return {
          reply: 'No problem, let\'s start over. What is your first name?',
        };
      }

      const client = await db.addClient({
        firstName: state.data.firstName,
        lastName: state.data.lastName,
        phone: state.data.phone,
        email: state.data.email,
      });
      const newCase = await db.addCase({
        clientId: client.id,
        transactionType: state.data.transactionType,
        propertyAddress: state.data.propertyAddress,
        purchasePrice: state.data.purchasePrice,
        closingDate: state.data.closingDate,
        buyerName: state.data.buyerName,
        sellerName: state.data.sellerName,
        lenderName: state.data.lenderName,
        description: state.data.description,
      });

      await db.logMessage({
        sessionId,
        sender: 'system',
        text: `Intake completed -> ${newCase.caseNumber}`,
      });

      notifyNewIntake({
        caseNumber: newCase.caseNumber,
        client,
        transactionType: newCase.transactionType,
        propertyAddress: newCase.propertyAddress,
      }).catch((err) => console.error('notifyNewIntake failed:', err));

      state.step = 'done';
      return {
        reply:
          `Thank you, ${client.firstName}. Your case number is ` +
          `${newCase.caseNumber}. An attorney will review your case ` +
          `shortly. Save this case number to check your status any time.`,
        type: 'intake_complete',
        caseNumber: newCase.caseNumber,
        tracker: stageTracker(newCase.stage),
      };
    }

    case 'done':
    default: {
      state.step = 'mode';
      return {
        reply: 'Is there anything else I can help with?',
        quickReplies: ['Start a new case', 'Check my case status'],
      };
    }
  }
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

module.exports = app;
