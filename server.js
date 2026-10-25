require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const {
  GHL_TOKEN,
  ONBOARDING_LOCATION_ID,
  ONBOARDING_PIPELINE_ID,
  STEP_STAGES = '{}',
  ALLOWED_ORIGINS = 'https://app.gohighlevel.com',
  DATABASE_URL,
  ADMIN_KEY,
  START_STAGE_ID,
  LOCATION_FIELD_ID,
  WEBHOOK_KEY,
  MAX_CREATES_PER_HOUR = '30',
  PORT = 3000
} = process.env;

let STAGES;
try {
  STAGES = JSON.parse(STEP_STAGES);
} catch {
  console.error('❌  STEP_STAGES is not valid JSON. Make sure the value is on a single line in your .env file.');
  console.error('   Example:  STEP_STAGES={"business-profile":"stage-id-1","import-contacts":"stage-id-2"}');
  process.exit(1);
}
const ORIGINS = ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
const LOC_RE = /^[A-Za-z0-9]{10,30}$/;

/* ---------------- storage: Postgres, or memory fallback ---------------- */
let pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;
const mem = { steps: new Map(), opp: new Map() };             // locationId -> Set / oppId

async function initDb() {
  if (!pool) return console.warn('⚠️  DATABASE_URL not set: using in-memory storage (data lost on restart)');
  try {
    await pool.query(`
      create table if not exists ob_steps(
        location_id text, step_id text, done_at timestamptz default now(),
        primary key (location_id, step_id));
      create table if not exists ob_opp(
        location_id text primary key, opportunity_id text not null);`);
    console.log('✅  Connected to Postgres');
  } catch (e) {
    console.warn('⚠️  Could not connect to Postgres:', e.message);
    console.warn('    Falling back to in-memory storage (data lost on restart).');
    console.warn('    If running locally, use the Render *external* DATABASE_URL (includes .render.com in the hostname).');
    pool = null; // disable pool so all storage functions use in-memory fallback
  }
}
async function getDone(loc) {
  if (!pool) return [...(mem.steps.get(loc) || [])];
  const r = await pool.query('select step_id from ob_steps where location_id=$1', [loc]);
  return r.rows.map(x => x.step_id);
}
async function markDone(loc, step) {
  if (!pool) {
    if (!mem.steps.has(loc)) mem.steps.set(loc, new Set());
    return mem.steps.get(loc).add(step);
  }
  await pool.query(
    'insert into ob_steps(location_id, step_id) values($1,$2) on conflict do nothing', [loc, step]);
}
async function getOpp(loc) {
  if (!pool) return mem.opp.get(loc);
  const r = await pool.query('select opportunity_id from ob_opp where location_id=$1', [loc]);
  return r.rows[0] && r.rows[0].opportunity_id;
}
async function setOpp(loc, opp) {
  if (!pool) return mem.opp.set(loc, opp);
  await pool.query(
    `insert into ob_opp(location_id, opportunity_id) values($1,$2)
     on conflict (location_id) do update set opportunity_id=excluded.opportunity_id`, [loc, opp]);
}

/* ---------------- GHL API ---------------- */
async function ghl(method, path, body) {
  const r = await fetch('https://services.leadconnectorhq.com' + path, {
    method,
    headers: {
      Authorization: `Bearer ${GHL_TOKEN}`,
      Version: '2021-07-28',
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!r.ok) throw Object.assign(new Error('GHL ' + r.status), { detail: json });
  return json;
}

// Finds the onboarding opportunity for a client sub-account:
// 1) saved mapping, else 2) opportunity in the onboarding pipeline whose name contains the location id
async function resolveOpportunity(loc) {
  const saved = await getOpp(loc);
  if (saved) return saved;
  const q = new URLSearchParams({
    location_id: ONBOARDING_LOCATION_ID,
    pipeline_id: ONBOARDING_PIPELINE_ID,
    q: loc,
    limit: '5'
  });
  const res = await ghl('GET', '/opportunities/search?' + q);
  const opp = (res.opportunities || [])[0];
  if (!opp) return null;
  await setOpp(loc, opp.id);
  return opp.id;
}

// Link a sub-account to the opportunity the order form already created, using the order-form email
async function findContactByEmail(email) {
  const q = new URLSearchParams({ locationId: ONBOARDING_LOCATION_ID, query: email, limit: '5' });
  const r = await ghl('GET', '/contacts/?' + q);
  const want = email.toLowerCase();
  return (r.contacts || []).find(c => String(c.email || '').toLowerCase() === want) || null;
}

async function findOpportunityForContact(contactId) {
  const q = new URLSearchParams({
    location_id: ONBOARDING_LOCATION_ID,
    pipeline_id: ONBOARDING_PIPELINE_ID,
    contact_id: contactId,
    limit: '5'
  });
  const r = await ghl('GET', '/opportunities/search?' + q);
  return (r.opportunities || [])[0] || null;
}

async function linkByEmail(loc, email) {
  if (!email) return null;
  const contact = await findContactByEmail(String(email).trim());
  if (!contact) return null;
  const opp = await findOpportunityForContact(contact.id);
  if (!opp) return null;
  await setOpp(loc, opp.id);
  if (LOCATION_FIELD_ID) {
    await ghl('PUT', `/contacts/${contact.id}`, {
      customFields: [{ id: LOCATION_FIELD_ID, value: loc }]
    });
  }
  return opp.id;
}

// Auto-create the onboarding contact + opportunity for a brand-new sub-account
const inflight = new Map();
let created = { hour: 0, n: 0 };
function underCreateLimit() {
  const h = Math.floor(Date.now() / 3600000);
  if (created.hour !== h) created = { hour: h, n: 0 };
  return created.n < Number(MAX_CREATES_PER_HOUR);
}

async function createOpportunity(loc, info = {}) {
  const label = info.name || 'New sub-account';
  let contactId;
  try {
    const c = await ghl('POST', '/contacts/', {
      locationId: ONBOARDING_LOCATION_ID,
      firstName: label,
      lastName: loc,
      email: info.email || undefined,
      tags: ['onboarding']
    });
    contactId = c.contact.id;
  } catch (e) {
    contactId = e.detail && e.detail.meta && e.detail.meta.contactId;   // duplicate email -> reuse
    if (!contactId) throw e;
  }
  const o = await ghl('POST', '/opportunities/', {
    pipelineId: ONBOARDING_PIPELINE_ID,
    locationId: ONBOARDING_LOCATION_ID,
    name: `${label} - ${loc}`,
    pipelineStageId: START_STAGE_ID,
    status: 'open',
    contactId
  });
  return o.opportunity.id;
}

async function ensureOpportunity(loc, info) {
  const existing = await resolveOpportunity(loc);
  if (existing || !START_STAGE_ID) return existing || null;
  if (inflight.has(loc)) return inflight.get(loc);
  if (!underCreateLimit()) return null;
  const p = (async () => {
    const id = await createOpportunity(loc, info);
    created.n++;
    await setOpp(loc, id);
    return id;
  })().finally(() => inflight.delete(loc));
  inflight.set(loc, p);
  return p;
}

/* ---------------- app ---------------- */
const app = express();
app.use(express.json());
app.use(cors({ origin: (origin, cb) => cb(null, !origin || ORIGINS.includes(origin)) }));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/onboarding/status', async (req, res) => {
  const loc = String(req.query.locationId || '');
  if (!LOC_RE.test(loc)) return res.status(400).json({ error: 'bad locationId' });
  ensureOpportunity(loc).catch(e => console.error('auto-create failed', e.message, JSON.stringify(e.detail || {})));
  try { res.json({ completed: await getDone(loc) }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

app.post('/onboarding/complete', async (req, res) => {
  const { locationId: loc, stepId } = req.body || {};
  if (!LOC_RE.test(String(loc))) return res.status(400).json({ error: 'bad locationId' });
  const stageId = STAGES[stepId];
  if (!stageId) return res.status(400).json({ error: 'unknown step' });
  try {
    const oppId = await ensureOpportunity(loc);
    if (!oppId) return res.status(404).json({ error: 'no onboarding opportunity for this location' });
    await ghl('PUT', `/opportunities/${oppId}`, { pipelineStageId: stageId });
    await markDone(loc, stepId);
    res.json({ ok: true });
  } catch (e) {
    console.error(e.message, JSON.stringify(e.detail || {}));
    res.status(502).json({ error: 'ghl update failed' });
  }
});

// Manually link a client location to its onboarding opportunity
app.post('/admin/map', async (req, res) => {
  if (!ADMIN_KEY || req.get('x-admin-key') !== ADMIN_KEY) return res.status(401).end();
  const { locationId, opportunityId } = req.body || {};
  if (!LOC_RE.test(String(locationId)) || !opportunityId) return res.status(400).end();
  await setOpp(locationId, opportunityId);
  res.json({ ok: true });
});

// Optional: Marketplace app webhook (event LocationCreate) -> create the opportunity at sign-up time
app.post('/webhooks/ghl', async (req, res) => {
  if (!WEBHOOK_KEY || req.query.key !== WEBHOOK_KEY) return res.status(401).end();
  const b = req.body || {};
  if (b.type && b.type !== 'LocationCreate') return res.json({ ignored: true });
  const loc = String(b.id || b.locationId || '');
  if (!LOC_RE.test(loc)) return res.status(400).end();
  try {
    const linked = await linkByEmail(loc, b.email);
    if (!linked) await ensureOpportunity(loc, { name: b.name, email: b.email });
    res.json({ ok: true, linked: !!linked });
  } catch (e) {
    console.error(e.message, JSON.stringify(e.detail || {}));
    res.status(502).end();
  }
});

// Manual / workflow link: POST { locationId, email } with x-admin-key
app.post('/admin/link', async (req, res) => {
  if (!ADMIN_KEY || req.get('x-admin-key') !== ADMIN_KEY) return res.status(401).end();
  const { locationId, email } = req.body || {};
  if (!LOC_RE.test(String(locationId)) || !email) return res.status(400).end();
  try {
    const id = await linkByEmail(locationId, email);
    if (!id) return res.status(404).json({ error: 'no contact/opportunity for that email in the onboarding pipeline' });
    res.json({ ok: true, opportunityId: id });
  } catch (e) {
    console.error(e.message, JSON.stringify(e.detail || {}));
    res.status(502).end();
  }
});

initDb()
  .then(() => app.listen(PORT, () => console.log('🚀  onboarding api on :' + PORT)))
  .catch(e => { console.error('Fatal startup error:', e.message); process.exit(1); });