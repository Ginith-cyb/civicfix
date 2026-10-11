'use strict';
// Optional: adds a few sample reports so the board is not empty. Run: npm run seed
const { db } = require('./db');
const now = Date.now(), d = 86400000;
const rows = [
  ['Ravi K.', 'Pothole', '5th Main Rd', 'Deep pothole near the bus stop, damaging two-wheelers.', 'open', now - 2 * d],
  ['Meena S.', 'Streetlight', 'Lakeview Park Rd', 'Three streetlights are out along the park road. Very dark at night.', 'open', now - 4 * d],
  ['Arjun P.', 'Garbage', 'Market Gate', 'Garbage pile uncollected for a week beside the market gate.', 'fixed', now - 8 * d],
  ['Fatima A.', 'Water leak', 'Temple Street', 'Pipe leaking onto the road, water wasted all day.', 'open', now - 3600000]
];
const ins = db.prepare('INSERT INTO reports(reporter_name,category,location,description,status,created_at,fixed_at) VALUES(?,?,?,?,?,?,?)');
for (const r of rows) ins.run(r[0], r[1], r[2], r[3], r[4], r[5], r[4] === 'fixed' ? now - d : null);
console.log('Added', rows.length, 'sample reports.');
