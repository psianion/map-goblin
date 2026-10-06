import Database from 'better-sqlite3';
const SCRATCH = process.argv[2];
const db = new Database(SCRATCH, { readonly: true });
const row = db.prepare('SELECT game_server_token FROM campaigns WHERE goblin_campaign_id = ?').get('18358431-cfeb-46c8-b72b-9a9ac33f0eb8');
const token = row.game_server_token;
const id = '18358431-cfeb-46c8-b72b-9a9ac33f0eb8';
const res = await fetch(`http://127.0.0.1:5600/api/campaigns/${id}/scenes`, {
  headers: { Authorization: `Bearer ${token}` }
});
console.log('status', res.status);
const body = await res.json();
console.log(JSON.stringify(body, null, 2));
