// server.js
require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const crypto = require('crypto');
const { Pool } = require('pg');

// --------- Config ---------
const PORT = process.env.PORT || 8080;
const SURVEY_ID =
  process.env.SURVEY_ID || 'royhart_parent_family_climate_2025';
const DATABASE_URL = process.env.DATABASE_URL;
const SALT = process.env.SALT || 'CHANGE_ME_SALT';
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || ''; // optional Sheet webhook
const TRUST_PROXY = process.env.TRUST_PROXY !== 'false';   // default true
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

// Comma-separated list of prefixes, e.g.
// "168.169.220.,168.169.221.,168.169.220.139"
const IP_WHITELIST_PREFIXES = (process.env.IP_WHITELIST_PREFIXES || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL env var.');
}

// --------- DB pool ---------
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false } // typical for Render Postgres
      : false,
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
app.use(cors({ origin: '*' })); // you can restrict later if desired
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

const path = require('path');

// Serve the /public folder (admin.html, admin.js)
app.use(express.static(path.join(__dirname, 'public')));

// Diagnostic route: See your true IP
app.get('/myip', (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || '';
  res.json({ ip });
});


// --------- Helpers ---------
function getClientIp(req) {
  // With trust proxy, req.ip should be taken from X-Forwarded-For
  return req.ip || req.connection?.remoteAddress || '';
}

function isIpWhitelisted(ip) {
  if (!ip || !IP_WHITELIST_PREFIXES.length) return false;
  return IP_WHITELIST_PREFIXES.some(prefix => ip.startsWith(prefix));
}

function makeIpHash(ip, allowMultiple) {
  const base = ip || 'unknown_ip';
  if (allowMultiple) {
    // Generate a unique hash per submission so UNIQUE constraint never blocks
    const rand = crypto.randomBytes(8).toString('hex');
    return crypto
      .createHmac('sha256', SALT)
      .update(`${base}:${Date.now()}:${rand}`)
      .digest('hex');
  }
  // One hash per IP → one submission per IP per survey
  return crypto.createHmac('sha256', SALT).update(base).digest('hex');
}

function validatePayload(payload) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return 'Payload must be an object with key/value pairs.';
  }
  const keys = Object.keys(payload);
  if (keys.length > 1000) return 'Too many fields in payload.';
  for (const k of keys) {
    if (typeof k !== 'string' || k.length > 200)
      return 'Invalid field name length.';
    const v = payload[k];
    const t = typeof v;
    if (!['string', 'number', 'boolean'].includes(t)) {
      return 'All values must be strings, numbers, or booleans.';
    }
    if (String(v).length > 2000) return 'Field value too long.';
  }
  return null;
}

// --------- Routes ---------

// Quick helper to see what IP Render is seeing
app.get('/myip', (req, res) => {
  const ip = getClientIp(req);
  res.json({
    ip,
    forwardedFor: req.headers['x-forwarded-for'] || null,
  });
});

// Health check
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, surveyId: SURVEY_ID });
  } catch (err) {
    console.error('Health check DB error:', err);
    res.status(500).json({ ok: false, error: 'db_unreachable' });
  }
});

// Survey submission
app.post('/submit', async (req, res) => {
  const ip = getClientIp(req);
  const whitelisted = isIpWhitelisted(ip);
  const ip_hash = makeIpHash(ip, whitelisted);

  const payload = req.body;
  const validationError = validatePayload(payload);
  if (validationError) {
    return res
      .status(400)
      .json({ error: 'invalid_payload', message: validationError });
  }

  try {
    await ensureSchema();

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
          submittedAt: new Date().toISOString(),
        }),
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

    console.log(
      `Submission stored from IP ${ip} (whitelisted=${whitelisted}) with hash ${ip_hash}`
    );

    return res.json({ ok: true });
  } catch (err) {
    if (err && err.code === '23505') {
      // unique violation → duplicate IP (non-whitelisted)
      return res.status(403).json({ error: 'duplicate_ip' });
    }
    console.error('Submit error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

// --- Admin route to clear all submissions (for testing / new year) ---
// WARNING: this wipes the entire submissions table.
app.get('/admin/reset', async (req, res) => {
  try {
    if (!ADMIN_TOKEN) {
      return res.status(500).json({ error: 'admin_token_not_set' });
    }

    const token = req.query.token;
    if (token !== ADMIN_TOKEN) {
      return res.status(403).json({ error: 'forbidden' });
    }

    await ensureSchema();
    await pool.query('TRUNCATE TABLE submissions;');

    return res.json({ ok: true, message: 'Submissions table truncated.' });
  } catch (err) {
    console.error('Admin reset error:', err);
    return res
      .status(500)
      .json({ error: 'server_error', message: String(err) });
  }
});

// --- Admin summary route (used by admin.html/admin.js) ---
async function buildSummary() {
  await ensureSchema();

  const { rows } = await pool.query(
    'SELECT payload FROM submissions WHERE survey_id = $1',
    [SURVEY_ID]
  );

  const questions = {};
  const freeText = {};
  const totalSubmissions = rows.length;

  for (const row of rows) {
    const payload = row.payload || {};
    for (const [key, rawVal] of Object.entries(payload)) {
      const val = rawVal == null ? '' : String(rawVal).trim();

      // Free-text fields (section open responses)
      if (key.endsWith('_free')) {
        if (!val) continue;
        if (!freeText[key]) {
          freeText[key] = {
            key,
            responses: 0,
            // grouped by "building" label – currently we only know "All / N/A"
            byBuilding: {
              'All / N/A': [],
            },
          };
        }
        freeText[key].responses += 1;
        freeText[key].byBuilding['All / N/A'].push(val);
        continue;
      }

      // Numeric 1–5 scale responses
      const num = Number(val);
      if (!Number.isFinite(num) || num < 1 || num > 5) continue;

      if (!questions[key]) {
        questions[key] = {
          key,
          responses: 0,
          sum: 0,
          counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
          type: 'scale',
        };
      }
      const q = questions[key];
      q.responses += 1;
      q.sum += num;
      q.counts[num] = (q.counts[num] || 0) + 1;
    }
  }

  // Compute averages
  Object.values(questions).forEach((q) => {
    q.average = q.responses ? q.sum / q.responses : null;
  });

  return {
    surveyId: SURVEY_ID,
    totalSubmissions,
    questions,
    freeText,
  };
}

// Protected summary endpoint
app.get('/admin/summary', async (req, res) => {
  try {
    if (!ADMIN_TOKEN) {
      return res.status(500).json({ error: 'admin_token_not_set' });
    }
    const token = req.query.token;
    if (token !== ADMIN_TOKEN) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const summary = await buildSummary();
    return res.json({ ok: true, summary });
  } catch (err) {
    console.error('Admin summary error:', err);
    return res
      .status(500)
      .json({ error: 'server_error', message: String(err) });
  }
});

// Optional public alias (if you’ve ever hit /summary directly)
app.get('/summary', async (_req, res) => {
  try {
    const summary = await buildSummary();
    return res.json({ ok: true, summary });
  } catch (err) {
    console.error('Summary error:', err);
    return res
      .status(500)
      .json({ error: 'server_error', message: String(err) });
  }
});

// 404 for everything else (after static + routes)
app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

app.listen(PORT, () => {
  console.log(`Survey backend listening on port ${PORT}`);
  console.log(
    `IP whitelist prefixes: ${
      IP_WHITELIST_PREFIXES.length
        ? IP_WHITELIST_PREFIXES.join(', ')
        : '(none)'
    }`
  );
});
