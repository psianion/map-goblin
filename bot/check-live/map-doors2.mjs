import Database from 'better-sqlite3';
const db = new Database('../session/server/data/game.db', { readonly: true });
const row = db.prepare('SELECT data FROM maps WHERE id = ?').get('11967a46-dcb2-4196-841b-be03af63f25b');
const data = JSON.parse(row.data);
console.log('layers count', data.layers.length);
for (const l of data.layers) {
  console.log('layer', l.id, l.type ?? l.kind, Object.keys(l));
}
