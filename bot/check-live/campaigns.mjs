import Database from 'better-sqlite3';
const db = new Database(process.argv[2], { readonly: true });
const cols = db.prepare("PRAGMA table_info(campaigns)").all();
console.log('cols:', cols.map(c=>c.name));
const rows = db.prepare('SELECT * FROM campaigns').all();
console.log('count:', rows.length);
for (const r of rows) {
  const masked = { ...r };
  for (const k of Object.keys(masked)) {
    if (/token|pass/i.test(k) && masked[k]) masked[k] = 'SET(len=' + String(masked[k]).length + ')';
  }
  console.log(JSON.stringify(masked));
}
