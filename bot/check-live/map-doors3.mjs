import Database from 'better-sqlite3';
const db = new Database('../session/server/data/game.db', { readonly: true });
const row = db.prepare('SELECT data FROM maps WHERE id = ?').get('11967a46-dcb2-4196-841b-be03af63f25b');
const data = JSON.parse(row.data);
const dungeon = data.layers.find(l => l.type === 'dungeon');
console.log('rooms:', dungeon.rooms.map(r => ({ id: r.id, name: r.name })));
console.log('children count', dungeon.children?.length);
const doors = (dungeon.children || []).filter(c => c.type === 'door' || c.kind === 'door' || /door/i.test(c.type ?? ''));
console.log('door-like children:', doors.length);
console.log(JSON.stringify(doors.slice(0,6), null, 2));
if (doors.length === 0) {
  console.log('all child types:', [...new Set((dungeon.children||[]).map(c=>c.type))]);
}
