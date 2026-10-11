# CivicFix

Residents report local problems (potholes, broken streetlights, garbage piles, water leaks). Everyone sees a public board with photos, upvotes and an Open / Fixed status. Officers manage reports from an admin dashboard.

## What you get
- Public board with search, category/status filters, sorting, photos, upvotes (stretch goals included)
- Report form with category, location, description, optional photo (resized in the browser, checked on the server)
- Accounts and roles: Super Admin (owner), Admin (officer), Resident, Guest
- Admin dashboard: stats, mark Fixed/reopen, delete, users and roles, ownership transfer, website settings and feature toggles, audit log
- No npm packages. Runs on Node.js 22.13+ using its built-in SQLite.

## Tech stack
- Frontend: plain HTML, CSS and JavaScript in `public/` (no build step)
- Backend: Node.js `http` server in `server.js`
- Database: SQLite file at `data/civicfix.db` (schema in `db.js`)
- Auth: scrypt password hashing, server-side sessions in an HttpOnly SameSite=Strict cookie, CSRF token on every change request
- Hosting: any Node host with a persistent disk (Render, Railway, Fly.io, a VPS)

## Project structure
```
server.js        API, auth, permissions, static files, security headers
db.js            database schema, settings defaults, .env loader
seed.js          optional sample reports
public/          index.html, style.css, app.js
tests/smoke.js   16 automated checks (permissions, CSRF, transfer, toggles)
.env.example     settings template
data/            created at first run: database + uploaded photos (back this up)
```

## Run it locally
The website is a server app, so it cannot be opened by double-clicking `index.html`. Start the server, then use the address it prints.
1. Install Node.js (LTS, version 22.13 or newer) from https://nodejs.org and check with `node -v`.
2. Unzip, then: Windows, double-click `start.bat` | Mac/Linux, run `./start.sh` | or in a terminal inside the folder run `npm start`.
3. Open http://127.0.0.1:3000 in your browser (keep the terminal window open).
4. Without a `.env` file, a one-time setup key is printed in the terminal on first start (and saved in `data/setup-key.txt`). For production, copy `.env.example` to `.env` and set your own `SETUP_KEY`.
4. Optional sample data: `npm run seed`
5. Run the checks: `npm test`

## Create the first Super Admin
Open the site. While no owner exists a yellow banner says "Finish setup". Enter the `SETUP_KEY` from `.env`, your name, email and a password (10+ characters). This works once; afterwards the setup route is locked. The database also enforces that only one Super Admin can exist.

## Add administrators
Ask the officer to register a normal account. Then log in as Super Admin: Admin > Users and roles > Make admin. Use "Remove admin" to take it back. Only the Super Admin can do this, and the server checks it on every request.

## Transfer ownership
Super Admin > Admin > Ownership. Choose an existing admin, enter your password and type TRANSFER. The new owner becomes Super Admin immediately and you become a regular admin. Every transfer is written to the audit log.

## Change website settings
Super Admin > Admin > Settings: site name, colors, and switches for guest reports, photo uploads and upvotes. A switch that is off is also blocked in the API; data is kept.

## Add future features
Keep the pattern: add a table in `db.js`, add `route(...)` entries in `server.js` (the role argument `'user'`, `'admin'` or `'super'` enforces who can call it), then add a page or tab in `public/app.js`. Add an on/off setting to `DEFAULTS` in `db.js` if admins should be able to turn it off.

## Environment variables
| Name | Purpose |
|---|---|
| `PORT`, `HOST` | Where to listen (default 3000, 127.0.0.1) |
| `SETUP_KEY` | One-time key to create the first Super Admin |
| `COOKIE_SECURE` | `1` in production (HTTPS only cookies, HSTS) |
| `TRUST_PROXY` | `1` when behind a reverse proxy that sets `X-Forwarded-For` |
| `DATA_DIR` | Folder for the database and photos |

## Deploy
1. Put the code on a host with Node 22.13+ and a persistent disk, and set `DATA_DIR` to that disk.
2. Set `SETUP_KEY`, `COOKIE_SECURE=1`, `TRUST_PROXY=1`, `HOST=0.0.0.0`, and `PORT` if the host requires it.
3. Serve it over HTTPS (the host or a reverse proxy such as Caddy or nginx does this).
4. Start with `npm start`, open the site, finish setup, then remove or rotate `SETUP_KEY`.
5. Back up the `data/` folder regularly (copy `civicfix.db`, `civicfix.db-wal` and `uploads/` while the app is stopped, or use `sqlite3 .backup`).

## Security notes
- Permissions are checked on the server for every request; changing the page, cookies or URLs cannot grant admin access.
- Passwords are hashed with scrypt; login errors are generic; 5 wrong passwords lock the account for 15 minutes; requests are rate limited per IP.
- Cross-site request forgery: SameSite=Strict cookies, same-origin check, and a per-session token header.
- Cross-site scripting: the page builds all content with safe DOM calls, and a strict Content-Security-Policy blocks inline scripts.
- SQL injection: every query uses bound parameters.
- Uploads: type and size are checked, files get random names and are served with `nosniff`.
- Secrets live only in `.env` / server settings, never in the browser.

## Not included yet
Email verification, password reset, two-factor login, email/SMS notifications, Google login, per-report comments and maps. Accounts cannot reset a forgotten password yet; the Super Admin can only change roles, not passwords. Rate limits are in memory, so they reset on restart and apply per server instance.
