import Database from 'better-sqlite3';
const db = new Database(process.argv[2], { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log(tables);
