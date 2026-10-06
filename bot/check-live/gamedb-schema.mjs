import Database from 'better-sqlite3';
const db = new Database('../session/server/data/game.db', { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log(tables.map(t=>t.name));
