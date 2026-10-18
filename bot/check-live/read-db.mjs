import Database from 'better-sqlite3';
const path = process.argv[2];
const db = new Database(path, { readonly: true });
const rows = db.prepare('SELECT * FROM campaigns').all();
for (const r of rows) {
  const masked = { ...r };
  for (const k of Object.keys(masked)) {
    if (/token|pass/i.test(k) && masked[k]) masked[k] = String(masked[k]).slice(0,6) + '...(len=' + String(masked[k]).length + ')';
  }
  console.log(JSON.stringify(masked, null, 2));
}
