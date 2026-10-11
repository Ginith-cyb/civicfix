'use strict';
const $ = s => document.querySelector(s);
const h = (t, p, ...k) => {
  const e = document.createElement(t);
  for (const [a, v] of Object.entries(p || {})) {
    if (a.startsWith('on')) e.addEventListener(a.slice(2), v);
    else if (a === 'class') e.className = v;
    else if (v === true) e.setAttribute(a, '');
    else if (v !== false && v != null) e.setAttribute(a, v);
  }
  for (const c of k.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
};
let ME = { user: null, csrf: '', settings: {}, categories: [], needsSetup: false };
const isAdmin = () => ME.user && ME.user.role !== 'user', isSuper = () => ME.user && ME.user.role === 'super_admin';
async function api(path, opt = {}) {
  const r = await fetch('/api' + path, { method: opt.method || 'GET', credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': ME.csrf }, body: opt.body ? JSON.stringify(opt.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
  return j;
}
function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.className = bad ? 'bad' : ''; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => t.style.display = 'none', 2600); }
const ago = t => { const s = (Date.now() - t) / 1000; if (s < 60) return 'just now'; const m = s / 60; if (m < 60) return Math.floor(m) + ' min ago'; const hr = m / 60; if (hr < 24) return Math.floor(hr) + ' h ago'; const d = hr / 24; return d < 30 ? Math.floor(d) + ' d ago' : new Date(t).toLocaleDateString(); };
const lum = c => { const n = parseInt(c.slice(1), 16); return (.299 * (n >> 16) + .587 * ((n >> 8) & 255) + .114 * (n & 255)) / 255; };
function theme() {
  const S = ME.settings, r = document.documentElement.style;
  if (/^#[0-9a-f]{6}$/i.test(S.primary)) { r.setProperty('--p', S.primary); r.setProperty('--ptx', lum(S.primary) > .6 ? '#111' : '#fff'); }
  if (/^#[0-9a-f]{6}$/i.test(S.accent)) r.setProperty('--a', S.accent);
  document.title = (S.site_name || 'CivicFix') + ' - report and track local problems';
}

/* ---- illustrations used when a report has no photo ---- */
const sk = (a, b) => `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="400" height="240" fill="url(#g)"/>`;
const bl = (c, w) => `<g fill="${c}"><rect x="0" y="60" width="70" height="75"/><rect x="75" y="88" width="55" height="47"/><rect x="270" y="72" width="60" height="63"/><rect x="335" y="50" width="65" height="85"/></g><g fill="${w}">${[10, 28, 46, 342, 362, 382].flatMap(x => [78, 98, 116].map(y => `<rect x="${x}" y="${y}" width="9" height="11"/>`)).join('')}</g>`;
const rd = `<rect y="135" width="400" height="105" fill="#9ca3af"/><polygon points="160,135 240,135 400,240 0,240" fill="#4a4e57"/>${[0, 1, 2, 3].map(i => { const w = 3 + i * 2; return `<rect x="${200 - w / 2}" y="${142 + i * 22}" width="${w}" height="${6 + i * 4}" fill="#fde68a"/>`; }).join('')}`;
const ph = '<ellipse cx="200" cy="208" rx="54" ry="18" fill="#8a8f98"/><ellipse cx="200" cy="210" rx="47" ry="14" fill="#1f2125"/><ellipse cx="192" cy="207" rx="20" ry="5" fill="#33363c"/><path d="M148 205l-22-6M252 203l24-8M200 190l2-12" stroke="#2f3238" stroke-width="2"/>';
const lamp = '<rect x="66" y="55" width="7" height="85" fill="#374151"/><path d="M70 57q22-8 40 2" stroke="#374151" stroke-width="6" fill="none"/><rect x="100" y="57" width="22" height="8" rx="4" fill="#1f2937"/>';
const bag = (x, y, r, c) => `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * .85}" fill="${c}"/><path d="M${x - 4} ${y - r * .8}q4-10 8 0" stroke="${c}" stroke-width="3" fill="none"/><ellipse cx="${x - r * .3}" cy="${y - r * .3}" rx="${r * .25}" ry="${r * .15}" fill="#fff" opacity=".18"/>`;
const SC = {
  Pothole: () => sk('#bfe0ff', '#eaf4ff') + bl('#8b95a5', '#cfd8e3') + rd + ph + '<polygon points="300,215 316,215 308,190" fill="#f97316"/>',
  Streetlight: () => sk('#0b1230', '#2a3566') + '<g fill="#fff">' + [[40, 20], [120, 35], [200, 15], [260, 40], [330, 22], [370, 45]].map(a => `<circle cx="${a[0]}" cy="${a[1]}" r="1.5"/>`).join('') + '</g>' + bl('#1b2240', '#2f3a63') + rd + '<rect width="400" height="240" fill="#0b1230" opacity=".5"/>' + lamp + `<g transform="translate(220 0)">${lamp}</g><path d="M104 62l14 8M118 62l-14 8" stroke="#ef4444" stroke-width="2"/>`,
  Garbage: () => sk('#f3e3c4', '#f9f1df') + '<rect y="50" width="400" height="95" fill="#c7b9a0"/><rect y="145" width="400" height="95" fill="#9ca3af"/><rect y="140" width="400" height="8" fill="#6b7280"/>' + bag(120, 190, 34, '#111827') + bag(175, 200, 30, '#1f4d2b') + bag(230, 192, 36, '#374151') + bag(150, 168, 26, '#1f2937') + bag(205, 166, 24, '#14532d') + bag(285, 205, 22, '#111827'),
  'Water leak': () => sk('#cfe6ff', '#eef6ff') + bl('#8b95a5', '#cfd8e3') + rd + '<ellipse cx="200" cy="205" rx="95" ry="22" fill="#60a5fa" opacity=".8"/><ellipse cx="185" cy="201" rx="40" ry="6" fill="#bfdbfe" opacity=".7"/><rect x="150" y="150" width="14" height="42" fill="#6b7280"/><path d="M157 152q16-46 52-30" stroke="#93c5fd" stroke-width="5" fill="none"/>',
  Other: () => sk('#bfe0ff', '#eaf4ff') + bl('#8b95a5', '#cfd8e3') + rd + '<polygon points="186,218 214,218 200,172" fill="#f97316"/><polygon points="192,200 208,200 204,188 196,188" fill="#fff"/>',
  hero: () => sk('#8ec5ff', '#e6f3ff') + '<circle cx="320" cy="38" r="22" fill="#fde047"/>' + bl('#7d8aa0', '#d3dbe8') + '<circle cx="150" cy="118" r="20" fill="#3f8f4f"/><rect x="147" y="130" width="6" height="10" fill="#6b4423"/><circle cx="240" cy="122" r="16" fill="#4ca35c"/><rect x="237" y="132" width="5" height="8" fill="#6b4423"/>' + rd + ph + lamp + '<polygon points="330,218 346,218 338,194" fill="#f97316"/>'
};
const IMG = {};
const scene = k => IMG[k] || (IMG[k] = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240">${(SC[k] || SC.Other)()}</svg>`));

/* ---- shared pieces ---- */
const link = (href, text) => h('a', { class: 'tab', href, 'aria-current': (location.hash || '#/') === href ? 'page' : null }, text);
function header() {
  const hd = $('#hd'), S = ME.settings;
  hd.replaceChildren(
    h('a', { class: 'lg', href: '#/' }, '🛠 ' + (S.site_name || 'CivicFix')),
    h('nav', { 'aria-label': 'Main' }, link('#/', 'Reports'), link('#/report', 'Report an issue'), isAdmin() && link('#/admin', 'Admin')),
    ME.user
      ? h('div', { class: 'acct' }, h('span', {}, ME.user.name), h('span', { class: 'role' }, ME.user.role.replace('_', ' ')),
        h('button', { class: 'tab', onclick: async () => { try { await api('/logout', { method: 'POST', body: {} }); } catch { } await refresh(); location.hash = '#/'; toast('Logged out'); } }, 'Log out'))
      : h('div', { class: 'acct' }, link('#/login', 'Log in'), link('#/register', 'Register')));
  const old = $('#setup-banner'); if (old) old.remove();
  if (ME.needsSetup) hd.after(h('div', { class: 'banner', id: 'setup-banner' }, 'This site has no owner yet. ', h('a', { href: '#/setup' }, 'Finish setup')));
}
function field(label, input) { return h('label', {}, label, input); }
function formPage(title, intro, fields, submitText, onSubmit) {
  const err = h('p', { class: 'err', role: 'alert' }), btn = h('button', { class: 'btn', type: 'submit' }, submitText);
  const f = h('form', { class: 'form', novalidate: false, onsubmit: async e => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true;
    try { await onSubmit(f); } catch (x) { err.textContent = x.message; } finally { btn.disabled = false; }
  } }, ...fields, err, btn);
  return [h('h1', {}, title), intro && h('p', { class: 'muted' }, intro), f];
}
const val = (f, n) => f.elements[n].value;
async function refresh() { ME = await api('/me'); theme(); header(); }

/* ---- pages ---- */
const F = { q: '', category: 'all', status: 'all', sort: 'votes' };
const FE = [['📝', 'wig', 'Report in seconds', 'Pick a category, add the location and describe the problem.', '#/report', 'Report now'],
  ['📷', 'pulse', 'Add a real photo', 'Show the problem with a photo from your phone.', '#/report', 'Add a photo'],
  ['🌐', 'spin', 'Public report board', 'Everyone can see every report in one list.', '#reports', 'See reports'],
  ['▲', 'bounce', 'Upvote what matters', 'Registered neighbours vote so urgent issues rise to the top.', '#reports', 'Browse'],
  ['🏷️', 'swing', 'Open / Fixed status', 'Follow each report from Open to Fixed.', '#reports', 'Check status'],
  ['🔎', 'sway', 'Search and filters', 'Find reports by keyword, category or status.', '#reports', 'Search'],
  ['📊', 'float', 'Admin dashboard', 'Officers update status and see simple stats.', '#/admin', 'Admin'],
  ['🔐', 'ring', 'Roles and audit log', 'Owner, admins and residents with server-checked permissions.', '#/register', 'Join']];
function reportCard(r) {
  const up = ME.settings.upvotes === '1';
  return h('article', { class: 'card' },
    h('figure', { class: 'ph' }, h('img', { src: r.photo ? '/uploads/' + r.photo : scene(r.category), alt: r.photo ? `Photo of the ${r.category.toLowerCase()} problem, shared by ${r.by}` : `Illustration of a ${r.category.toLowerCase()} problem`, loading: 'lazy' }),
      h('figcaption', {}, r.photo ? '📷 Photo by ' + r.by : 'No photo provided')),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, `${r.category} · ${r.location}`), h('span', { class: 'tag ' + r.status }, r.status === 'open' ? 'Open' : 'Fixed')),
    h('div', {}, r.description),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, `${r.by} · ${ago(r.created_at)}`),
      up && h('button', { class: 'up', 'aria-pressed': String(r.voted), 'aria-label': `Upvote, ${r.votes} votes`, onclick: async () => {
        if (!ME.user) { toast('Log in to upvote', true); location.hash = '#/login'; return; }
        try { await api(`/reports/${r.id}/vote`, { method: 'POST', body: {} }); loadList(); } catch (e) { toast(e.message, true); }
      } }, '▲ ' + r.votes)));
}
async function loadList() {
  const box = $('#lst'); if (!box) return;
  try {
    const p = new URLSearchParams(F), { reports } = await api('/reports?' + p);
    box.replaceChildren(...(reports.length ? reports.map(reportCard) : [h('p', { class: 'empty' }, 'No reports match yet. Be the first to report a problem.')]));
  } catch (e) { box.replaceChildren(h('p', { class: 'err' }, e.message)); }
}
async function home() {
  const S = ME.settings; let st = { total: 0, open: 0, fixed: 0 }; try { st = await api('/stats'); } catch { }
  let t; const sel = (k, opts) => h('select', { 'aria-label': k, onchange: e => { F[k] = e.target.value; loadList(); } }, opts.map(o => h('option', { value: o[0], selected: F[k] === o[0] }, o[1])));
  $('#app').replaceChildren(
    h('section', { class: 'hero' }, h('div', {}, h('h1', {}, 'Report it. Track it. Fix it.'), h('p', {}, 'See what your neighbours reported, add your own, and upvote what matters most.'),
      h('span', { class: 'chip' }, st.total + ' reports'), h('span', { class: 'chip' }, st.open + ' open'), h('span', { class: 'chip' }, st.fixed + ' fixed'),
      h('div', { class: 'acts' }, h('a', { class: 'btn', href: '#/report' }, 'Report a problem'), h('a', { class: 'btn o', href: '#/', onclick: e => { e.preventDefault(); $('#reports').scrollIntoView({ behavior: 'smooth' }); } }, 'See reports'))),
      h('img', { class: 'hi', src: scene('hero'), alt: 'Illustration of a neighbourhood street with a pothole and a dark streetlight' })),
    h('h2', {}, 'How it works'),
    h('div', { class: 'fg' }, FE.map((x, i) => h('div', { class: 'card fe' }, h('div', { class: 'row' }, h('span', { class: 'ic a-' + x[1], 'aria-hidden': 'true' }, x[0]), h('span', { class: 'n' }, i + 1)), h('b', {}, x[2]), h('span', { class: 'muted' }, x[3]),
      h('a', { class: 'btn o s', href: x[4] === '#reports' ? '#/' : x[4], onclick: x[4] === '#reports' ? e => { e.preventDefault(); $('#reports').scrollIntoView({ behavior: 'smooth' }); } : null }, x[5])))),
    h('h2', { id: 'reports' }, 'Latest reports from neighbours'),
    h('div', { class: 'tb' },
      h('input', { type: 'search', 'aria-label': 'Search reports', placeholder: 'Search reports…', value: F.q, oninput: e => { F.q = e.target.value; clearTimeout(t); t = setTimeout(loadList, 250); } }),
      sel('category', [['all', 'All categories'], ...ME.categories.map(c => [c, c])]), sel('status', [['all', 'Any status'], ['open', 'Open'], ['fixed', 'Fixed']]), sel('sort', [['votes', 'Most upvoted'], ['new', 'Newest']])),
    h('div', { id: 'lst', class: 'grid', 'aria-live': 'polite' }));
  loadList();
}
function toDataURL(file) {
  return new Promise((res, rej) => {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => { const s = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); res(c.toDataURL('image/jpeg', .82)); };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('That file is not a valid image.')); };
    img.src = u;
  });
}
function reportPage() {
  const S = ME.settings;
  if (!ME.user && S.guest_reports !== '1') return $('#app').replaceChildren(h('h1', {}, 'Report a problem'), h('p', {}, 'Please ', h('a', { href: '#/login' }, 'log in'), ' to report a problem.'));
  let photo = '';
  const prev = h('img', { class: 'pv', alt: 'Photo preview' });
  const fields = [
    field('Category', h('select', { name: 'category', required: true }, ME.categories.map(c => h('option', {}, c)))),
    field('Location', h('input', { name: 'location', required: true, minlength: 3, maxlength: 120, placeholder: 'Street or landmark' })),
    field('Description', h('textarea', { name: 'description', required: true, minlength: 10, maxlength: 1000, placeholder: 'What is the problem?' })),
    !ME.user && field('Your name (optional)', h('input', { name: 'name', maxlength: 40, placeholder: 'e.g. Asha', autocomplete: 'name' })),
    S.uploads === '1' && field('Photo (optional)', h('input', { type: 'file', name: 'photo', accept: 'image/*', onchange: async e => {
      const f = e.target.files[0]; photo = ''; prev.classList.remove('on'); if (!f) return;
      try { photo = await toDataURL(f); prev.src = photo; prev.classList.add('on'); } catch (x) { toast(x.message, true); e.target.value = ''; }
    } })), S.uploads === '1' && prev];
  $('#app').replaceChildren(...formPage('Report a problem', 'Tell your neighbours and the local authority what needs fixing.', fields, 'Submit report', async f => {
    await api('/reports', { method: 'POST', body: { category: val(f, 'category'), location: val(f, 'location'), description: val(f, 'description'), name: f.elements.name ? val(f, 'name') : undefined, photo: photo || undefined } });
    toast('Report submitted. Thank you!'); location.hash = '#/';
  }));
}
function authPage(kind) {
  const reg = kind === 'register', setup = kind === 'setup';
  if (setup && !ME.needsSetup) { location.hash = '#/'; return; }
  const fields = [setup && field('Setup key', h('input', { name: 'setupKey', type: 'password', required: true, autocomplete: 'off' })), (reg || setup) && field('Your name', h('input', { name: 'name', required: true, minlength: 2, maxlength: 60, autocomplete: 'name' })),
    field('Email', h('input', { name: 'email', type: 'email', required: true, autocomplete: 'email' })),
    field('Password', h('input', { name: 'password', type: 'password', required: true, minlength: reg || setup ? 10 : 1, autocomplete: reg || setup ? 'new-password' : 'current-password' })), (reg || setup) && h('p', { class: 'muted' }, 'Use at least 10 characters.')];
  const title = setup ? 'Finish setup: create the Super Admin' : reg ? 'Create an account' : 'Log in';
  $('#app').replaceChildren(...formPage(title, setup ? 'The setup key is the SETUP_KEY value from the server settings. This only works once.' : reg ? 'An account lets you upvote reports.' : null, fields, setup ? 'Create Super Admin' : reg ? 'Register' : 'Log in', async f => {
    const body = Object.fromEntries([...f.elements].filter(e => e.name).map(e => [e.name, e.value]));
    ME = await api(setup ? '/setup' : reg ? '/register' : '/login', { method: 'POST', body }); theme(); header();
    toast(setup ? 'Super Admin created' : 'Welcome, ' + ME.user.name); location.hash = setup ? '#/admin' : '#/';
  }), reg || setup ? null : h('p', {}, 'New here? ', h('a', { href: '#/register' }, 'Create an account')));
}

/* ---- admin ---- */
let TAB = 'reports';
async function admin() {
  if (!isAdmin()) { $('#app').replaceChildren(h('h1', {}, 'Admin'), h('p', {}, 'You do not have permission to view this page.')); return; }
  const tabs = [['reports', 'Reports'], ...(isSuper() ? [['users', 'Users and roles'], ['owner', 'Ownership'], ['settings', 'Settings']] : []), ['audit', 'Audit log']];
  if (!tabs.some(t => t[0] === TAB)) TAB = 'reports';
  const body = h('div', {});
  $('#app').replaceChildren(h('h1', {}, 'Admin dashboard'), h('div', { class: 'tabs', role: 'tablist' }, tabs.map(t => h('button', { class: 'tab', role: 'tab', 'aria-current': t[0] === TAB ? 'page' : null, onclick: () => { TAB = t[0]; admin(); } }, t[1]))), body);
  try { await ({ reports: tabReports, users: tabUsers, owner: tabOwner, settings: tabSettings, audit: tabAudit })[TAB](body); } catch (e) { body.replaceChildren(h('p', { class: 'err' }, e.message)); }
}
async function tabReports(box) {
  const [s, { reports }] = await Promise.all([api('/admin/stats'), api('/reports?sort=new')]);
  const act = (fn, ok) => async () => { try { await fn(); toast(ok); admin(); } catch (e) { toast(e.message, true); } };
  box.replaceChildren(
    h('div', { class: 'stats' }, [['Reports', s.total], ['Open', s.open], ['Fixed', s.fixed], ['Upvotes', s.votes], ['Accounts', s.users]].map(x => h('div', { class: 'card' }, h('span', { class: 'muted' }, x[0]), h('b', {}, x[1])))),
    h('p', { class: 'muted' }, 'By category: ' + (s.byCategory.map(c => `${c.category} ${c.n}`).join(' · ') || 'no reports yet')),
    h('div', { class: 'list' }, reports.map(r => h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', {}, `#${r.id} ${r.category} · ${r.location}`), h('span', { class: 'tag ' + r.status }, r.status === 'open' ? 'Open' : 'Fixed')),
      h('div', {}, r.description), h('span', { class: 'muted' }, `${r.by} · ${ago(r.created_at)} · ${r.votes} upvotes${r.photo ? ' · has photo' : ''}`),
      h('div', { class: 'row' }, h('button', { class: 'btn s', onclick: act(() => api(`/reports/${r.id}/status`, { method: 'PATCH', body: { status: r.status === 'open' ? 'fixed' : 'open' } }), 'Status updated') }, r.status === 'open' ? 'Mark as Fixed' : 'Reopen'),
        h('button', { class: 'btn d s', onclick: () => { if (confirm('Delete this report permanently?')) act(() => api('/reports/' + r.id, { method: 'DELETE' }), 'Report deleted')(); } }, 'Delete'))))),
    reports.length ? null : h('p', { class: 'empty' }, 'No reports yet.'));
}
async function tabUsers(box) {
  const { users } = await api('/admin/users');
  box.replaceChildren(h('p', { class: 'muted' }, 'Only the Super Admin can promote residents to admin or remove admin access.'), h('div', { class: 'list' }, users.map(u => h('div', { class: 'card' },
    h('div', { class: 'row' }, h('b', {}, u.name), h('span', { class: 'role' }, u.role.replace('_', ' '))), h('span', { class: 'muted' }, `${u.email} · joined ${new Date(u.created_at).toLocaleDateString()}`),
    u.role === 'super_admin' ? null : h('div', {}, h('button', { class: u.role === 'user' ? 'btn s' : 'btn o s', onclick: async () => {
      try { await api(`/admin/users/${u.id}/role`, { method: 'POST', body: { role: u.role === 'user' ? 'admin' : 'user' } }); toast('Role updated'); admin(); } catch (e) { toast(e.message, true); }
    } }, u.role === 'user' ? 'Make admin' : 'Remove admin'))))));
}
async function tabOwner(box) {
  const { users } = await api('/admin/users'), admins = users.filter(u => u.role === 'admin');
  if (!admins.length) return box.replaceChildren(h('p', {}, 'To transfer ownership, first promote the future owner to admin in "Users and roles".'));
  box.replaceChildren(...formPage('Transfer ownership', 'The new owner becomes Super Admin. You will become a regular admin straight away. Only do this if you mean it.', [
    field('New owner (must be an admin)', h('select', { name: 'email', required: true }, admins.map(a => h('option', { value: a.email }, `${a.name} (${a.email})`)))),
    field('Your password', h('input', { name: 'password', type: 'password', required: true, autocomplete: 'current-password' })),
    field('Type TRANSFER to confirm', h('input', { name: 'confirm', required: true, autocomplete: 'off' }))], 'Transfer ownership', async f => {
    await api('/admin/transfer', { method: 'POST', body: { email: val(f, 'email'), password: val(f, 'password'), confirm: val(f, 'confirm') } });
    await refresh(); toast('Ownership transferred'); TAB = 'reports'; admin();
  }));
}
async function tabSettings(box) {
  const { settings: S } = await api('/admin/settings'), chk = (n, l) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', name: n, checked: S[n] === '1' }), l);
  box.replaceChildren(...formPage('Website settings', 'Changes apply to everyone. Turning a feature off blocks it on the server too, and keeps existing data.', [
    field('Site name', h('input', { name: 'site_name', value: S.site_name, required: true, maxlength: 40 })),
    field('Primary color', h('input', { name: 'primary', type: 'color', value: S.primary })), field('Accent color', h('input', { name: 'accent', type: 'color', value: S.accent })),
    chk('guest_reports', 'Allow reports without an account'), chk('uploads', 'Allow photo uploads'), chk('upvotes', 'Allow upvotes')], 'Save settings', async f => {
    await api('/admin/settings', { method: 'PUT', body: { site_name: val(f, 'site_name'), primary: val(f, 'primary'), accent: val(f, 'accent'), guest_reports: f.elements.guest_reports.checked, uploads: f.elements.uploads.checked, upvotes: f.elements.upvotes.checked } });
    await refresh(); toast('Settings saved');
  }));
}
async function tabAudit(box) {
  const { rows } = await api('/admin/audit');
  box.replaceChildren(h('div', { class: 'list' }, rows.map(r => h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', {}, r.action), h('span', { class: 'muted' }, new Date(r.at).toLocaleString())), h('span', { class: 'muted' }, `${r.email || 'system'}${r.detail ? ' · ' + r.detail : ''}`)))), rows.length ? null : h('p', { class: 'empty' }, 'Nothing logged yet.'));
}

/* ---- router ---- */
async function router() {
  const r = (location.hash || '#/').split('?')[0];
  header();
  try {
    if (r === '#/report') reportPage();
    else if (r === '#/login') authPage('login');
    else if (r === '#/register') authPage('register');
    else if (r === '#/setup') authPage('setup');
    else if (r === '#/admin') await admin();
    else await home();
  } catch (e) { $('#app').replaceChildren(h('p', { class: 'err' }, e.message)); }
  if (!(r === '#/')) window.scrollTo(0, 0);
}
window.addEventListener('hashchange', router);
refresh().catch(() => { }).then(router);
