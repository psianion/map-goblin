import Database from 'better-sqlite3';
const db = new Database('../session/server/data/game.db', { readonly: true });
const campaignId = '18358431-cfeb-46c8-b72b-9a9ac33f0eb8';

console.log('--- scenes for campaign ---');
console.log(db.prepare('SELECT id, campaign_id, name, map_id, updated_at FROM scenes WHERE campaign_id = ?').all(campaignId));

console.log('--- sessions for campaign (active/live) ---');
console.log(db.prepare('SELECT * FROM sessions WHERE campaign_id = ?').all(campaignId));
