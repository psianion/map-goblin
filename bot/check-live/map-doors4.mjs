import Database from 'better-sqlite3';
const db = new Database('../session/server/data/game.db', { readonly: true });
const row = db.prepare('SELECT data FROM maps WHERE id = ?').get('11967a46-dcb2-4196-841b-be03af63f25b');
const data = JSON.parse(row.data);
const dungeon = data.layers.find(l => l.type === 'dungeon');
console.log('sample child keys', Object.keys(dungeon.children[0]));
console.log(JSON.stringify(dungeon.children[0], null, 2));
console.log('kinds:', [...new Set(dungeon.children.map(c => c.kind))]);
