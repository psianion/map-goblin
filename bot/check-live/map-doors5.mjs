import Database from 'better-sqlite3';
const db = new Database('../session/server/data/game.db', { readonly: true });
const row = db.prepare('SELECT data FROM maps WHERE id = ?').get('11967a46-dcb2-4196-841b-be03af63f25b');
const data = JSON.parse(row.data);
const dungeon = data.layers.find(l => l.type === 'dungeon');
console.log('childTypes:', [...new Set(dungeon.children.map(c => c.childType))]);
const doors = dungeon.children.filter(c => c.childType === 'door');
console.log('door count', doors.length);
console.log(JSON.stringify(doors.slice(0,5), null, 2));
