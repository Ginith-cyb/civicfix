'use strict';
const { db, DATA, CATS, DEFAULTS, settings } = require('./db');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const E = process.env, PORT = +E.PORT || 3000, HOST = E.HOST || '0.0.0.0';
const SECURE = E.COOKIE_SECURE === '1', PROXY = E.TRUST_PROXY === '1', PUB = path.join(__dirname, 'public');
const COOKIE = SECURE ? '__Host-sid' : 'sid', WEEK = 7 * 86400000;

/* ---------- helpers ---------- */
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const rnd = n => crypto.randomBytes(n).toString('hex');
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const httpErr = (status, message) => Object.assign(new Error(message), { status });
const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
const hits = new Map();
const allow = (key, max, ms) => { const n = Date.now(), e = hits.get(key); if (!e || e.r < n) { hits.set(key, { c: 1, r: n + ms }); return true; } return ++e.c <= max; };
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (v.r < n) hits.delete(k); db.prepare('DELETE FROM sessions WHERE expires_at<?').run(n); }, 60000).unref();
async function hashPw(pw) { const salt = crypto.randomBytes(16); return 's1$' + salt.toString('hex') + '$' + (await scrypt(pw, salt, 64)).toString('hex'); }
async function checkPw(pw, stored) { const [, s, k] = String(stored).split('$'); return eq((await scrypt(pw, Buffer.from(s || '00', 'hex'), 64)).toString('hex'), k || ''); }
let DUMMY = 's1$00$00'; hashPw('dummy-password').then(h => DUMMY = h);
const clean = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
function str(v, min, max, label) {
  const s = typeof v === 'string' ? clean(v) : '';
  if (s.length < min || s.length > max) throw httpErr(400, `${label} must be ${min}-${max} characters.`);
  return s;
}
const normEmail = v => { const e = typeof v === 'string' ? v.trim().toLowerCase() : ''; if (e.length > 254 || !/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw httpErr(400, 'Please enter a valid email address.'); return e; };
const checkPass = v => { if (typeof v !== 'string' || v.length < 10 || v.length > 128) throw httpErr(400, 'Password must be 10-128 characters.'); return v; };
const clientIp = req => (PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
const audit = (uid, action, detail, ip) => db.prepare('INSERT INTO audit(user_id,action,detail,ip,at) VALUES(?,?,?,?,?)').run(uid ?? null, action, detail ?? null, ip ?? null, Date.now());
const owner = () => db.prepare("SELECT id FROM users WHERE role='super_admin'").get();
const Q = {
  userByEmail: db.prepare('SELECT * FROM users WHERE email=?'),
  sess: db.prepare('SELECT s.csrf,s.expires_at,u.id AS user_id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND u.disabled=0'),
  report: db.prepare('SELECT * FROM reports WHERE id=?')
};
function cookies(req) { const o = {}; for (const p of String(req.headers.cookie || '').split(';')) { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim(); } return o; }
function getSession(req) { const c = cookies(req)[COOKIE]; if (!c || !/^[a-f0-9]{64}$/.test(c)) return null; const r = Q.sess.get(sha(c)); return r && r.expires_at > Date.now() ? r : null; }
function newSession(res, userId) {
  const tok = rnd(32), csrf = rnd(16);
  db.prepare('INSERT INTO sessions(id,user_id,csrf,expires_at) VALUES(?,?,?,?)').run(sha(tok), userId, csrf, Date.now() + WEEK);
  res.setHeader('set-cookie', `${COOKIE}=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${WEEK / 1000}${SECURE ? '; Secure' : ''}`);
  return Q.sess.get(sha(tok));
}
const me = sess => ({ user: sess ? { id: sess.user_id, email: sess.email, name: sess.name, role: sess.role } : null, csrf: sess ? sess.csrf : '', settings: settings(), categories: CATS, needsSetup: !owner() });
function savePhoto(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === 'string' ? dataUrl : '');
  if (!m) throw httpErr(400, 'That photo could not be used. Please upload a JPG, PNG or WebP image.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length < 100 || buf.length > 3 * 1024 * 1024) throw httpErr(400, 'Photo must be under 3 MB.');
  const ok = { jpeg: buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff, png: buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), webp: buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP' }[m[1]];
  if (!ok) throw httpErr(400, 'That photo could not be used. Please upload a JPG, PNG or WebP image.');
  const name = rnd(16) + { jpeg: '.jpg', png: '.png', webp: '.webp' }[m[1]];
  fs.writeFileSync(path.join(DATA, 'uploads', name), buf);
  return name;
}

/* ---------- routes ---------- */
const ROUTES = [];
const route = (m, p, role, fn) => ROUTES.push({ m, role, fn, re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$') });
const ok = { ok: true };

route('GET', '/api/me', null, ({ sess }) => me(sess));
route('GET', '/api/stats', null, () => {
  const g = s => db.prepare(s).get();
  return { total: g('SELECT COUNT(*) c FROM reports').c, open: g("SELECT COUNT(*) c FROM reports WHERE status='open'").c, fixed: g("SELECT COUNT(*) c FROM reports WHERE status='fixed'").c };
});
route('POST', '/api/setup', null, async ({ body, ip, res }) => {
  if (owner()) throw httpErr(403, 'Setup is already complete.');
  if (!E.SETUP_KEY) throw httpErr(503, 'Setup is disabled. Set SETUP_KEY on the server first.');
  if (!allow('setup:' + ip, 5, 900000)) throw httpErr(429, 'Too many attempts. Please try again later.');
  if (!eq(typeof body.setupKey === 'string' ? body.setupKey : '', E.SETUP_KEY)) throw httpErr(403, 'Invalid setup key.');
  const email = normEmail(body.email), name = str(body.name, 2, 60, 'Name'), hash = await hashPw(checkPass(body.password));
  let id;
  try { id = db.prepare("INSERT INTO users(email,name,pass_hash,role,created_at) VALUES(?,?,?,'super_admin',?)").run(email, name, hash, Date.now()).lastInsertRowid; }
  catch { throw httpErr(409, 'Setup is already complete.'); }
  audit(id, 'setup', 'Super Admin created', ip);
  return me(newSession(res, id));
});
route('POST', '/api/register', null, async ({ body, ip, res }) => {
  if (!allow('reg:' + ip, 10, 3600000)) throw httpErr(429, 'Too many attempts. Please try again later.');
  const email = normEmail(body.email), name = str(body.name, 2, 60, 'Name'), hash = await hashPw(checkPass(body.password));
  let id;
  try { id = db.prepare('INSERT INTO users(email,name,pass_hash,created_at) VALUES(?,?,?,?)').run(email, name, hash, Date.now()).lastInsertRowid; }
  catch { throw httpErr(409, 'An account with this email already exists.'); }
  return me(newSession(res, id));
});
route('POST', '/api/login', null, async ({ body, ip, res }) => {
  if (!allow('login:' + ip, 20, 600000)) throw httpErr(429, 'Too many attempts. Please try again later.');
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '', u = Q.userByEmail.get(email);
  if (u && u.locked_until > Date.now()) throw httpErr(429, 'Too many failed attempts. Please try again in a few minutes.');
  const good = await checkPw(typeof body.password === 'string' ? body.password.slice(0, 128) : '', u ? u.pass_hash : DUMMY);
  if (!u || u.disabled || !good) {
    if (u) { const f = u.failed + 1; db.prepare('UPDATE users SET failed=?,locked_until=? WHERE id=?').run(f >= 5 ? 0 : f, f >= 5 ? Date.now() + 900000 : 0, u.id); }
    throw httpErr(401, 'Invalid email or password.');
  }
  db.prepare('UPDATE users SET failed=0,locked_until=0 WHERE id=?').run(u.id);
  if (u.role !== 'user') audit(u.id, 'login', u.role, ip);
  return me(newSession(res, u.id));
});
route('POST', '/api/logout', null, ({ req, res }) => {
  const c = cookies(req)[COOKIE]; if (c) db.prepare('DELETE FROM sessions WHERE id=?').run(sha(c));
  res.setHeader('set-cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${SECURE ? '; Secure' : ''}`);
  return ok;
});

route('GET', '/api/reports', null, ({ u, sess }) => {
  const p = u.searchParams, status = ['open', 'fixed'].includes(p.get('status')) ? p.get('status') : 'all';
  const cat = CATS.includes(p.get('category')) ? p.get('category') : 'all';
  const like = '%' + clean(p.get('q') || '').slice(0, 80).replace(/[\\%_]/g, '\\$&') + '%';
  const order = p.get('sort') === 'new' ? 'r.created_at DESC' : 'votes DESC, r.created_at DESC';
  const rows = db.prepare(`SELECT r.id,r.category,r.location,r.description,r.status,r.photo,r.reporter_name AS by,r.created_at,r.fixed_at,
    (SELECT COUNT(*) FROM votes v WHERE v.report_id=r.id) AS votes,
    EXISTS(SELECT 1 FROM votes v WHERE v.report_id=r.id AND v.user_id=?) AS voted
    FROM reports r WHERE (?='all' OR r.status=?) AND (?='all' OR r.category=?) AND (r.description LIKE ? ESCAPE '\\' OR r.location LIKE ? ESCAPE '\\')
    ORDER BY ${order} LIMIT 200`).all(sess ? sess.user_id : -1, status, status, cat, cat, like, like);
  return { reports: rows.map(r => ({ ...r, voted: !!r.voted })) };
});
route('POST', '/api/reports', null, async ({ body, ip, sess }) => {
  const S = settings();
  if (!sess && S.guest_reports !== '1') throw httpErr(401, 'Please log in to report a problem.');
  if (!allow(sess ? 'rep:u' + sess.user_id : 'rep:' + ip, sess ? 20 : 5, 3600000)) throw httpErr(429, 'You have reported a lot recently. Please try again later.');
  if (!CATS.includes(body.category)) throw httpErr(400, 'Please choose a category.');
  const loc = str(body.location, 3, 120, 'Location'), desc = str(body.description, 10, 1000, 'Description');
  const by = sess ? sess.name : (typeof body.name === 'string' && clean(body.name).slice(0, 40)) || 'Neighbour';
  let photo = null;
  if (body.photo) { if (S.uploads !== '1') throw httpErr(403, 'Photo uploads are turned off.'); photo = savePhoto(body.photo); }
  const id = db.prepare('INSERT INTO reports(user_id,reporter_name,category,location,description,photo,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(sess ? sess.user_id : null, by, body.category, loc, desc, photo, Date.now()).lastInsertRowid;
  return { id };
});
route('POST', '/api/reports/:id/vote', 'user', ({ params, sess }) => {
  if (settings().upvotes !== '1') throw httpErr(403, 'Upvoting is turned off.');
  if (!allow('vote:' + sess.user_id, 60, 3600000)) throw httpErr(429, 'Too many votes. Please slow down.');
  if (!Q.report.get(+params.id)) throw httpErr(404, 'Report not found.');
  const del = db.prepare('DELETE FROM votes WHERE report_id=? AND user_id=?').run(+params.id, sess.user_id);
  if (!del.changes) db.prepare('INSERT INTO votes(report_id,user_id) VALUES(?,?)').run(+params.id, sess.user_id);
  return { voted: !del.changes, votes: db.prepare('SELECT COUNT(*) c FROM votes WHERE report_id=?').get(+params.id).c };
});
route('PATCH', '/api/reports/:id/status', 'admin', ({ params, body, sess, ip }) => {
  if (!['open', 'fixed'].includes(body.status)) throw httpErr(400, 'Invalid status.');
  if (!db.prepare('UPDATE reports SET status=?,fixed_at=? WHERE id=?').run(body.status, body.status === 'fixed' ? Date.now() : null, +params.id).changes) throw httpErr(404, 'Report not found.');
  audit(sess.user_id, 'report.status', `#${params.id} -> ${body.status}`, ip);
  return ok;
});
route('DELETE', '/api/reports/:id', 'admin', ({ params, sess, ip }) => {
  const r = Q.report.get(+params.id); if (!r) throw httpErr(404, 'Report not found.');
  db.prepare('DELETE FROM reports WHERE id=?').run(r.id);
  if (r.photo && /^[a-f0-9]{32}\.(jpg|png|webp)$/.test(r.photo)) fs.unlink(path.join(DATA, 'uploads', r.photo), () => {});
  audit(sess.user_id, 'report.delete', `#${r.id}`, ip);
  return ok;
});

route('GET', '/api/admin/stats', 'admin', () => {
  const g = s => db.prepare(s).get().c;
  return { total: g('SELECT COUNT(*) c FROM reports'), open: g("SELECT COUNT(*) c FROM reports WHERE status='open'"), fixed: g("SELECT COUNT(*) c FROM reports WHERE status='fixed'"),
    users: g('SELECT COUNT(*) c FROM users'), votes: g('SELECT COUNT(*) c FROM votes'),
    byCategory: db.prepare('SELECT category,COUNT(*) AS n FROM reports GROUP BY category ORDER BY n DESC').all() };
});
route('GET', '/api/admin/audit', 'admin', () => ({ rows: db.prepare('SELECT a.id,a.action,a.detail,a.at,u.email FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100').all() }));
route('GET', '/api/admin/users', 'super', () => ({ users: db.prepare('SELECT id,email,name,role,created_at FROM users ORDER BY id').all() }));
route('POST', '/api/admin/users/:id/role', 'super', ({ params, body, sess, ip }) => {
  if (!['admin', 'user'].includes(body.role)) throw httpErr(400, 'Invalid role.');
  const t = db.prepare('SELECT id,email,role FROM users WHERE id=?').get(+params.id);
  if (!t) throw httpErr(404, 'User not found.');
  if (t.id === sess.user_id || t.role === 'super_admin') throw httpErr(400, 'The Super Admin role can only be changed by transferring ownership.');
  db.prepare('UPDATE users SET role=? WHERE id=?').run(body.role, t.id);
  audit(sess.user_id, 'user.role', `${t.email} -> ${body.role}`, ip);
  return ok;
});
route('POST', '/api/admin/transfer', 'super', async ({ body, sess, ip }) => {
  if (!allow('xfer:' + sess.user_id, 5, 900000)) throw httpErr(429, 'Too many attempts. Please try again later.');
  if (body.confirm !== 'TRANSFER') throw httpErr(400, 'Type TRANSFER to confirm.');
  const t = Q.userByEmail.get(typeof body.email === 'string' ? body.email.trim().toLowerCase() : '');
  if (!t || t.disabled || t.id === sess.user_id || t.role !== 'admin') throw httpErr(400, 'The new owner must be an existing admin account.');
  const mine = db.prepare('SELECT pass_hash FROM users WHERE id=?').get(sess.user_id);
  if (!(await checkPw(typeof body.password === 'string' ? body.password.slice(0, 128) : '', mine.pass_hash))) throw httpErr(403, 'Password is incorrect.');
  tx(() => {
    db.prepare("UPDATE users SET role='admin' WHERE id=? AND role='super_admin'").run(sess.user_id);
    if (db.prepare("UPDATE users SET role='super_admin' WHERE id=? AND role='admin'").run(t.id).changes !== 1) throw httpErr(409, 'Transfer failed. Please try again.');
  });
  audit(sess.user_id, 'owner.transfer', `-> ${t.email}`, ip);
  return ok;
});
route('GET', '/api/admin/settings', 'super', () => ({ settings: settings() }));
route('PUT', '/api/admin/settings', 'super', ({ body, sess, ip }) => {
  const color = (v, l) => { if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw httpErr(400, `${l} must be a hex color like #2563eb.`); return v.toLowerCase(); };
  const next = { site_name: str(body.site_name, 1, 40, 'Site name'), primary: color(body.primary, 'Primary color'), accent: color(body.accent, 'Accent color'),
    uploads: body.uploads ? '1' : '0', upvotes: body.upvotes ? '1' : '0', guest_reports: body.guest_reports ? '1' : '0' };
  const up = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  tx(() => { for (const k of Object.keys(DEFAULTS)) up.run(k, next[k]); });
  audit(sess.user_id, 'settings.update', JSON.stringify(next), ip);
  return { settings: settings() };
});

/* ---------- http ---------- */
const sameOrigin = (o, host) => { try { return new URL(o).host === host; } catch { return false; } };
function send(res, code, obj) { const b = JSON.stringify(obj); res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(b) }); res.end(b); }
function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0; const ch = [];
    req.on('data', c => { n += c.length; if (n > limit) { reject(httpErr(413, 'That upload is too large.')); req.destroy(); } else ch.push(c); });
    req.on('end', () => { try { const j = JSON.parse(Buffer.concat(ch).toString() || '{}'); resolve(j && typeof j === 'object' && !Array.isArray(j) ? j : {}); } catch { reject(httpErr(400, 'Invalid request.')); } });
    req.on('error', () => reject(httpErr(400, 'Invalid request.')));
  });
}
async function api(req, res, u) {
  res.setHeader('cache-control', 'no-store');
  const r = ROUTES.find(r => r.m === req.method && r.re.test(u.pathname));
  if (!r) throw httpErr(404, 'Not found.');
  const params = u.pathname.match(r.re).groups || {}, ip = clientIp(req), sess = getSession(req);
  if (req.method !== 'GET') {
    if (req.headers.origin && !sameOrigin(req.headers.origin, req.headers.host)) throw httpErr(403, 'Request blocked.');
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw httpErr(415, 'Unsupported request.');
    if (sess && !eq(req.headers['x-csrf-token'] || '', sess.csrf)) throw httpErr(403, 'Your session expired. Please refresh the page.');
  }
  if (r.role) {
    if (!sess) throw httpErr(401, 'Please log in.');
    const allowed = r.role === 'user' || (r.role === 'admin' && sess.role !== 'user') || (r.role === 'super' && sess.role === 'super_admin');
    if (!allowed) throw httpErr(403, 'You do not have permission to perform this action.');
  }
  const body = req.method === 'GET' ? {} : await readBody(req);
  const out = await r.fn({ req, res, u, params, ip, sess, body });
  if (out !== undefined) send(res, 200, out);
}
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
function file(res, abs, cache) {
  fs.readFile(abs, (e, buf) => {
    if (e) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream', 'cache-control': cache, 'content-length': buf.length });
    res.end(buf);
  });
}
const server = http.createServer(async (req, res) => {
  res.setHeader('content-security-policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'same-origin'); res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  if (SECURE) res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
  try {
    const u = new URL(req.url, 'http://x'), p = u.pathname;
    if (p.startsWith('/api/')) return await api(req, res, u);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    const up = /^\/uploads\/([a-f0-9]{32}\.(?:jpg|png|webp))$/.exec(p);
    if (up) { res.setHeader('content-security-policy', "default-src 'none'"); return file(res, path.join(DATA, 'uploads', up[1]), 'public, max-age=86400'); }
    let abs; try { abs = path.join(PUB, decodeURIComponent(p === '/' ? '/index.html' : p)); } catch { res.writeHead(400); return res.end(); }
    if (!abs.startsWith(PUB + path.sep)) { res.writeHead(404); return res.end(); }
    return file(res, abs, 'no-cache');
  } catch (e) {
    if (res.headersSent) return res.end();
    if (e.status) return send(res, e.status, { error: e.message });
    console.error(e); send(res, 500, { error: 'Something went wrong. Please try again.' });
  }
});
let generatedKey = false;
if (!owner() && !E.SETUP_KEY) { // first run with no .env: make a one-time setup key so "npm start" just works
  E.SETUP_KEY = rnd(12); generatedKey = true;
  fs.writeFileSync(path.join(DATA, 'setup-key.txt'), E.SETUP_KEY + '\n', { mode: 0o600 });
}
server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `\nPort ${PORT} is already in use. Close the other program or set PORT=3001 in .env.\n` : e); process.exit(1); });
server.listen(PORT, HOST, () => {
  console.log(`\nCivicFix is running. Open this in your browser:  http://${HOST}:${PORT}\n`);
  if (!owner()) console.log(generatedKey ? `First time? Click "Finish setup" on the site and enter this setup key:\n\n    ${E.SETUP_KEY}\n\n(also saved in ${path.join(DATA, 'setup-key.txt')})\n` : 'No Super Admin yet: open the site and click "Finish setup".');
});
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => server.close(() => process.exit(0)));
