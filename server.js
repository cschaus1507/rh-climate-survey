// server.js
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const crypto = require('crypto');
const { Pool } = require('pg');

// --------- Config ---------
const PORT = process.env.PORT || 8080;
const SURVEY_ID = process.env.SURVEY_ID || 'royhart_parent_family_climate_2025';
const DATABASE_URL = process.env.DATABASE_URL;
const SALT = process.env.SALT || 'CHANGE_ME_SALT';
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || ''; // optional Sheet webhook
const TRUST_PROXY = process.env.TRUST_PROXY !== 'false';   // default true
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL env var.');
  // Don't exit in Render build step; only warn.
}

// --------- DB pool ---------
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false } // typical for Render Postgres
    : false
});

// Create table if it doesn't exist
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS submissions (
      id SERIAL PRIMARY KEY,
      survey_id TEXT NOT NULL,
      ip_hash TEXT NOT NULL,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      payload JSONB NOT NULL,
      UNIQUE (survey_id, ip_hash)
    );
  `);
}

// --------- Express app ---------
const app = express();
if (TRUST_PROXY) app.set('trust proxy', true);

app.use(helmet());
app.use(cors({ origin: '*' })); // later you can restrict to your domain
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

// --------- Helpers ---------
function getClientIp(req) {
  // With trust proxy, req.ip should be the left-most X-Forwarded-For
  return req.ip || req.connection?.remoteAddress || '';
}

function hashIp(ip) {
  return crypto.createHmac('sha256', SALT).update(ip).digest('hex');
}

function validatePayload(payload) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return 'Payload must be an object with key/value pairs.';
  }
  const keys = Object.keys(payload);
  if (keys.length > 1000) return 'Too many fields in payload.';
  for (const k of keys) {
    if (typeof k !== 'string' || k.length > 200) return 'Invalid field name length.';
    const v = payload[k];
    const t = typeof v;
    if (!['string', 'number', 'boolean'].includes(t)) {
      return 'All values must be strings, numbers, or booleans.';
    }
    if (String(v).length > 2000) return 'Field value too long.';
  }
  return null;
}
// --------- Admin summary helper ---------
function computeSurveySummary(submissionRows) {
  const questions = {};
  const freeText = {};
  let totalSubmissions = submissionRows.length;

  for (const row of submissionRows) {
    const payload = row.payload || {};
    for (const [key, value] of Object.entries(payload)) {
      // Treat anything ending in "_free" as open-ended text
      if (key.endsWith('_free')) {
        if (!freeText[key]) freeText[key] = [];
        if (value && typeof value === 'string') {
          freeText[key].push(value);
        }
        continue;
      }

      // Ignore empty/NA
      if (value === '' || value === null || value === undefined || value === 'na' || value === 'N/A') {
        continue;
      }

      // Try to parse a numeric 1–5 response
      const num = Number(value);
      const isScale = !Number.isNaN(num) && num >= 1 && num <= 5;

      if (!questions[key]) {
        questions[key] = {
          key,
          responses: 0,
          sum: 0,
          counts: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
          type: isScale ? 'scale' : 'other'
        };
      }

      if (isScale) {
        questions[key].responses += 1;
        questions[key].sum += num;
        const bucket = String(num);
        questions[key].counts[bucket] = (questions[key].counts[bucket] || 0) + 1;
      } else {
        // Non-numeric, non-free fields → we can still count them as "other"
        questions[key].type = 'other';
      }
    }
  }

  // Compute averages
  for (const q of Object.values(questions)) {
    if (q.type === 'scale' && q.responses > 0) {
      q.average = q.sum / q.responses;
    } else {
      q.average = null;
    }
  }

  return {
    surveyId: SURVEY_ID,
    totalSubmissions,
    questions,
    freeText
  };
}

// --------- Routes ---------
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, surveyId: SURVEY_ID });
  } catch (err) {
    console.error('Health check DB error:', err);
    res.status(500).json({ ok: false, error: 'db_unreachable' });
  }
});

app.post('/submit', async (req, res) => {
  const ip = getClientIp(req);
  const ip_hash = hashIp(ip);

  const payload = req.body;
  const validationError = validatePayload(payload);
  if (validationError) {
    return res.status(400).json({ error: 'invalid_payload', message: validationError });
  }

  try {
    await ensureSchema();

    // one submission per IP forever for this SURVEY_ID
    await pool.query(
      'INSERT INTO submissions (survey_id, ip_hash, payload) VALUES ($1, $2, $3)',
      [SURVEY_ID, ip_hash, payload]
    );

    // Optional: forward to Google Apps Script Web App (Sheet)
if (APPS_SCRIPT_URL) {
  fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      surveyId: SURVEY_ID,
      payload,
      submittedAt: new Date().toISOString()
    })
  })
    .then(async (r) => {
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        console.warn('Apps Script HTTP error:', r.status, text);
      } else {
        const text = await r.text().catch(() => '');
        console.log('Apps Script success response:', text);
      }
    })
    .catch((err) => {
      console.warn('Apps Script forward failed:', err.message || err);
    });
}


    return res.json({ ok: true });
  } catch (err) {
    if (err && err.code === '23505') {
      // unique violation → duplicate IP
      return res.status(403).json({ error: 'duplicate_ip' });
    }
    console.error('Submit error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

// --- Admin route to clear all submissions (for testing) ---
// WARNING: this wipes the entire submissions table.
// Protect it with ADMIN_TOKEN and only use while testing.
app.get('/admin/reset', async (req, res) => {
  try {
    if (!ADMIN_TOKEN) {
      return res.status(500).json({ error: 'admin_token_not_set' });
    }

    const token = req.query.token;
    if (token !== ADMIN_TOKEN) {
      return res.status(403).json({ error: 'forbidden' });
    }

    // Ensure table exists
    await ensureSchema();

    // TRUNCATE has no IF EXISTS version in Postgres
    await pool.query('TRUNCATE TABLE submissions;');

    return res.json({ ok: true, message: 'Submissions table truncated.' });
  } catch (err) {
    console.error('Admin reset error:', err);
    return res
      .status(500)
      .json({ error: 'server_error', message: String(err) });
  }
});
// --- Admin summary endpoint for dashboard (read-only) ---
app.get('/admin/summary', async (req, res) => {
  try {
    if (!ADMIN_TOKEN) {
      return res.status(500).json({ error: 'admin_token_not_set' });
    }

    const token = req.query.token;
    if (token !== ADMIN_TOKEN) {
      return res.status(403).json({ error: 'forbidden' });
    }

    await ensureSchema();
    const result = await pool.query(
      'SELECT payload FROM submissions WHERE survey_id = $1',
      [SURVEY_ID]
    );

    const summary = computeSurveySummary(result.rows);
    return res.json({ ok: true, summary });
  } catch (err) {
    console.error('Admin summary error:', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

app.listen(PORT, () => {
  console.log(`Survey backend listening on port ${PORT}`);
});
