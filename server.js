/**
 * BrainSpark Studio — Server
 * Pure Node.js, zero dependencies.
 *
 * Routes:
 *   GET  /                          → app
 *   GET  /sw.js                     → service worker
 *   POST /api/modules               → publish module → { slug, url }
 *   GET  /api/modules/:slug         → fetch module JSON
 *   GET  /m/:slug                   → redirect to /#play=:slug
 *   POST /api/responses             → save student response (cross-device)
 *   GET  /api/responses/:authorId   → fetch all responses for an author
 *   GET  /health                    → { ok: true }
 */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const PORT    = parseInt(process.env.PORT || '3000', 10);
const DB_FILE = path.join(__dirname, 'db.json');
const HTML    = path.join(__dirname, 'index.html');
const SW_FILE = path.join(__dirname, 'sw.js');

// ── DB (JSON file) ────────────────────────────────
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { modules: {} }; }
}
function saveDB(db) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); }
  catch (e) { console.error('DB write failed:', e.message); }
}

// ── Helpers ───────────────────────────────────────
function makeSlug() {
  return crypto.randomBytes(4).toString('hex'); // 8 hex chars
}

function readBody(req) {
  return new Promise((res, rej) => {
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > 5e6) rej(new Error('too large')); });
    req.on('end',  () => res(buf));
    req.on('error', rej);
  });
}

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain' });
  res.end(text);
}

// ── Server ────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const p      = urlObj.pathname;
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  // Health check
  if (method === 'GET' && p === '/health') {
    return sendJSON(res, 200, { ok: true });
  }

  // Serve the app
  if (method === 'GET' && (p === '/' || p === '/index.html')) {
    try {
      const html = fs.readFileSync(HTML, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch {
      return sendText(res, 500, 'Could not read index.html');
    }
  }

  // Serve service worker
  if (method === 'GET' && p === '/sw.js') {
    try {
      const sw = fs.readFileSync(SW_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Service-Worker-Allowed': '/' });
      return res.end(sw);
    } catch {
      return sendText(res, 404, 'sw.js not found');
    }
  }

  // POST /api/modules → publish
  if (method === 'POST' && p === '/api/modules') {
    let body;
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw);
    } catch {
      return sendJSON(res, 400, { error: 'Invalid or oversized JSON' });
    }
    if (!body || !body.id || !body.title) {
      return sendJSON(res, 400, { error: 'Missing required fields: id, title' });
    }
    const db   = loadDB();
    const slug = makeSlug();
    db.modules[slug] = { ...body, publishedAt: new Date().toISOString() };
    saveDB(db);

    const host     = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const shareUrl = `${protocol}://${host}/m/${slug}`;

    console.log(`📦 Published: "${body.title}" → ${shareUrl}`);
    return sendJSON(res, 200, { slug, url: shareUrl });
  }

  // GET /api/modules/:slug → fetch
  const apiMatch = p.match(/^\/api\/modules\/([a-f0-9]{6,16})$/);
  if (method === 'GET' && apiMatch) {
    const db = loadDB();
    const m  = db.modules[apiMatch[1]];
    if (!m) return sendJSON(res, 404, { error: 'Module not found' });
    return sendJSON(res, 200, m);
  }

  // GET /m/:slug → redirect to player
  const mMatch = p.match(/^\/m\/([a-f0-9]{6,16})$/);
  if (method === 'GET' && mMatch) {
    const db = loadDB();
    if (!db.modules[mMatch[1]]) return sendText(res, 404, 'Module not found');
    res.writeHead(302, { Location: `/#play=${mMatch[1]}` });
    return res.end();
  }

  // POST /api/responses → save student response
  if (method === 'POST' && p === '/api/responses') {
    let body;
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw);
    } catch {
      return sendJSON(res, 400, { error: 'Invalid JSON' });
    }
    if (!body || !body.id || !body.moduleId) {
      return sendJSON(res, 400, { error: 'Missing required fields: id, moduleId' });
    }
    const db = loadDB();
    if (!db.responses) db.responses = {};
    // Store by authorId so authors can fetch their own
    const authorId = body.authorId || body.moduleAuthorId || '_unknown';
    if (!db.responses[authorId]) db.responses[authorId] = [];
    // Deduplicate by response id
    if (!db.responses[authorId].some(r => r.id === body.id)) {
      db.responses[authorId].push(body);
    }
    saveDB(db);
    return sendJSON(res, 200, { ok: true });
  }

  // GET /api/responses/:authorId → fetch responses for dashboard
  const respMatch = p.match(/^\/api\/responses\/(.+)$/);
  if (method === 'GET' && respMatch) {
    const db  = loadDB();
    const recs = (db.responses || {})[decodeURIComponent(respMatch[1])] || [];
    return sendJSON(res, 200, recs);
  }

  sendText(res, 404, 'Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 BrainSpark Studio`);
  console.log(`   http://localhost:${PORT}\n`);
});

server.on('error', err => {
  console.error('Server error:', err.message);
  process.exit(1);
});
