'use strict';
// Starts a throwaway server and checks the main flows and permission rules.
const { spawn } = require('node:child_process'), os = require('node:os'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const PORT = 4789, BASE = `http://127.0.0.1:${PORT}`, KEY = 'test-setup-key-123';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'civicfix-'));
const srv = spawn(process.execPath, ['--no-warnings', path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DATA_DIR: dir, SETUP_KEY: KEY, HOST: '127.0.0.1' }, stdio: 'ignore' });
class C {
  constructor() { this.cookie = ''; this.csrf = ''; }
  async req(method, url, body, extra = {}) {
    const headers = { 'content-type': 'application/json', ...extra };
    if (this.cookie) headers.cookie = this.cookie; if (this.csrf && !('x-csrf-token' in headers)) headers['x-csrf-token'] = this.csrf;
    const r = await fetch(BASE + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    const j = await r.json().catch(() => ({})); if (j.csrf !== undefined && j.user !== undefined) this.csrf = j.csrf;
    return { s: r.status, j };
  }
}
const PNG = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]).toString('base64');
let passed = 0; const ok = (name, fn) => fn().then(() => { passed++; console.log('  ok  ' + name); });
(async () => {
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/me'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  const owner = new C(), admin = new C(), user = new C(), guest = new C();
  await ok('fresh install needs setup', async () => { assert.equal((await guest.req('GET', '/api/me')).j.needsSetup, true); });
  await ok('setup rejects a wrong key', async () => { assert.equal((await owner.req('POST', '/api/setup', { setupKey: 'nope', name: 'Owner', email: 'o@x.com', password: 'a-long-password-1' })).s, 403); });
  await ok('setup creates the Super Admin once', async () => {
    const r = await owner.req('POST', '/api/setup', { setupKey: KEY, name: 'Owner', email: 'o@x.com', password: 'a-long-password-1' });
    assert.equal(r.s, 200); assert.equal(r.j.user.role, 'super_admin');
    assert.equal((await guest.req('POST', '/api/setup', { setupKey: KEY, name: 'Eve', email: 'e@x.com', password: 'a-long-password-1' })).s, 403);
  });
  await ok('security headers are set', async () => { const r = await fetch(BASE + '/'); assert.match(r.headers.get('content-security-policy'), /default-src 'self'/); assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); });
  await ok('guest can report (with photo) and list it', async () => {
    assert.equal((await guest.req('POST', '/api/reports', { category: 'Pothole', location: '5th Main', description: 'Big pothole near the bus stop', name: 'Asha', photo: PNG })).s, 200);
    const l = (await guest.req('GET', '/api/reports')).j.reports; assert.equal(l.length, 1); assert.ok(l[0].photo); assert.equal(l[0].status, 'open');
    assert.equal((await fetch(BASE + '/uploads/' + l[0].photo)).status, 200);
  });
  await ok('bad photo and bad input are rejected', async () => {
    assert.equal((await guest.req('POST', '/api/reports', { category: 'Pothole', location: 'Main', description: 'Long enough text', photo: 'data:image/png;base64,AAAA' })).s, 400);
    assert.equal((await guest.req('POST', '/api/reports', { category: 'Nope', location: 'Main', description: 'Long enough text' })).s, 400);
    assert.equal((await guest.req('POST', '/api/reports', { category: 'Garbage', location: 'Main', description: 'short' })).s, 400);
  });
  await ok('guest cannot vote or moderate', async () => {
    assert.equal((await guest.req('POST', '/api/reports/1/vote', {})).s, 401);
    assert.equal((await guest.req('PATCH', '/api/reports/1/status', { status: 'fixed' })).s, 401);
  });
  await ok('resident registers, votes, toggles vote, cannot moderate', async () => {
    assert.equal((await user.req('POST', '/api/register', { name: 'Resident', email: 'r@x.com', password: 'resident-pass-1' })).s, 200);
    assert.equal((await user.req('POST', '/api/reports/1/vote', {})).j.votes, 1);
    assert.equal((await user.req('GET', '/api/reports')).j.reports[0].voted, true);
    assert.equal((await user.req('POST', '/api/reports/1/vote', {})).j.votes, 0);
    assert.equal((await user.req('PATCH', '/api/reports/1/status', { status: 'fixed' })).s, 403);
    assert.equal((await user.req('GET', '/api/admin/users')).s, 403);
  });
  await ok('login errors are generic', async () => {
    const a = await guest.req('POST', '/api/login', { email: 'r@x.com', password: 'wrong-password-1' }), b = await guest.req('POST', '/api/login', { email: 'nobody@x.com', password: 'wrong-password-1' });
    assert.equal(a.s, 401); assert.equal(a.j.error, 'Invalid email or password.'); assert.equal(b.j.error, a.j.error);
  });
  await ok('CSRF token and cross-site origin are enforced', async () => {
    assert.equal((await user.req('POST', '/api/reports/1/vote', {}, { 'x-csrf-token': 'bad' })).s, 403);
    assert.equal((await user.req('POST', '/api/reports/1/vote', {}, { origin: 'https://evil.example' })).s, 403);
  });
  await ok('Super Admin promotes a resident to admin; admin can moderate', async () => {
    const id = (await owner.req('GET', '/api/admin/users')).j.users.find(u => u.email === 'r@x.com').id;
    assert.equal((await owner.req('POST', `/api/admin/users/${id}/role`, { role: 'admin' })).s, 200);
    assert.equal((await user.req('PATCH', '/api/reports/1/status', { status: 'fixed' })).s, 200);
    assert.equal((await user.req('GET', '/api/reports')).j.reports[0].status, 'fixed');
    assert.equal((await user.req('GET', '/api/admin/users')).s, 403);
    assert.equal((await user.req('PUT', '/api/admin/settings', {})).s, 403);
    assert.equal((await user.req('POST', '/api/admin/transfer', { email: 'o@x.com', password: 'x', confirm: 'TRANSFER' })).s, 403);
  });
  await ok('feature toggles are enforced on the server', async () => {
    const s = (await owner.req('GET', '/api/admin/settings')).j.settings;
    assert.equal((await owner.req('PUT', '/api/admin/settings', { ...s, uploads: false, upvotes: false, guest_reports: false })).s, 200);
    assert.equal((await guest.req('POST', '/api/reports', { category: 'Pothole', location: 'Main', description: 'Guest report text' })).s, 401);
    assert.equal((await owner.req('POST', '/api/reports', { category: 'Pothole', location: 'Main', description: 'With photo', photo: PNG })).s, 403);
    assert.equal((await owner.req('POST', '/api/reports/1/vote', {})).s, 403);
    assert.equal((await owner.req('PUT', '/api/admin/settings', { ...s, primary: 'red', uploads: true, upvotes: true, guest_reports: true })).s, 400);
    assert.equal((await owner.req('PUT', '/api/admin/settings', { ...s, uploads: true, upvotes: true, guest_reports: true })).s, 200);
  });
  await ok('ownership transfer needs password, confirmation and an admin target', async () => {
    assert.equal((await owner.req('POST', '/api/admin/transfer', { email: 'r@x.com', password: 'wrong-password-1', confirm: 'TRANSFER' })).s, 403);
    assert.equal((await owner.req('POST', '/api/admin/transfer', { email: 'r@x.com', password: 'a-long-password-1', confirm: 'nope' })).s, 400);
    assert.equal((await owner.req('POST', '/api/admin/transfer', { email: 'o@x.com', password: 'a-long-password-1', confirm: 'TRANSFER' })).s, 400);
    assert.equal((await owner.req('POST', '/api/admin/transfer', { email: 'r@x.com', password: 'a-long-password-1', confirm: 'TRANSFER' })).s, 200);
  });
  await ok('previous owner loses Super Admin powers immediately; new owner has them', async () => {
    assert.equal((await owner.req('GET', '/api/me')).j.user.role, 'admin');
    assert.equal((await owner.req('GET', '/api/admin/users')).s, 403);
    assert.equal((await user.req('GET', '/api/admin/users')).s, 200);
    assert.equal((await user.req('GET', '/api/me')).j.user.role, 'super_admin');
  });
  await ok('admin can delete a report; audit log recorded actions', async () => {
    assert.equal((await owner.req('DELETE', '/api/reports/1')).s, 200);
    assert.equal((await owner.req('GET', '/api/reports')).j.reports.length, 0);
    const a = (await owner.req('GET', '/api/admin/audit')).j.rows.map(r => r.action); assert.ok(a.includes('owner.transfer') && a.includes('report.delete'));
  });
  await ok('logout ends the session', async () => { await user.req('POST', '/api/logout', {}); user.cookie = user.cookie.replace(/=.*/, '=') ; assert.equal((await user.req('GET', '/api/admin/users')).s, 401); });
  console.log(`\n${passed} checks passed`);
})().catch(e => { console.error('\nFAILED:', e.message); process.exitCode = 1; }).finally(() => { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
