'use strict';
const fs = require('node:fs'), path = require('node:path');
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 13)) {
  console.error('\nCivicFix needs Node.js 22.13 or newer. You have ' + process.versions.node + '.\nInstall the LTS version from https://nodejs.org and run it again.\n');
  process.exit(1);
}
const { DatabaseSync } = require('node:sqlite');
try {
  for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env file */ }
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
fs.mkdirSync(path.join(DATA, 'uploads'), { recursive: true });
const db = new DatabaseSync(path.join(DATA, 'civicfix.db'));
db.exec(`
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN('super_admin','admin','user')),
  disabled INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS one_owner ON users(role) WHERE role='super_admin';
CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS reports(
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reporter_name TEXT NOT NULL, category TEXT NOT NULL, location TEXT NOT NULL, description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','fixed')), photo TEXT,
  created_at INTEGER NOT NULL, fixed_at INTEGER);
CREATE INDEX IF NOT EXISTS rep_status ON reports(status, created_at);
CREATE TABLE IF NOT EXISTS votes(
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(report_id, user_id));
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit(
  id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, detail TEXT, ip TEXT, at INTEGER NOT NULL);
`);
const CATS = ['Pothole', 'Streetlight', 'Garbage', 'Water leak', 'Other'];
const DEFAULTS = { site_name: 'CivicFix', primary: '#2563eb', accent: '#f59e0b', uploads: '1', upvotes: '1', guest_reports: '1' };
const settings = () => {
  const o = { ...DEFAULTS };
  for (const r of db.prepare('SELECT key,value FROM settings').all()) if (r.key in DEFAULTS) o[r.key] = r.value;
  return o;
};
module.exports = { db, DATA, CATS, DEFAULTS, settings };
