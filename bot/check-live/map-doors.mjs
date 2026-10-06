import Database from 'better-sqlite3';
const db = new Database('../session/server/data/game.db', { readonly: true });
const row = db.prepare('SELECT id, name, data FROM maps WHERE id = ?').get('11967a46-dcb2-4196-841b-be03af63f25b');
const data = JSON.parse(row.data);
console.log('map name', row.name, 'top-level keys:', Object.keys(data));
if (data.doors) {
  console.log('doors count', data.doors.length);
  console.log(JSON.stringify(data.doors.slice(0,5), null, 2));
}
if (data.rooms) {
  console.log('rooms count', data.rooms.length);
  console.log(JSON.stringify(data.rooms.slice(0,5).map(r=>({id:r.id,name:r.name})), null, 2));
}
