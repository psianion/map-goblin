import Database from 'better-sqlite3';
const db = new Database(process.argv[2], { readonly: true });
const row = db.prepare('SELECT game_server_token FROM campaigns WHERE goblin_campaign_id = ?').get('18358431-cfeb-46c8-b72b-9a9ac33f0eb8');
const t = row.game_server_token;
const parts = t.split('.');
console.log('parts:', parts.length);
if (parts.length >= 2) {
  const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  console.log(JSON.stringify(payload));
  console.log('now', Date.now(), 'exp', payload.exp);
}
