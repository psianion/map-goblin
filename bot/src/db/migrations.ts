// Append-only: index N is version N+1, and a migration that has shipped is never edited —
// edit it and every existing database silently disagrees with every fresh one. Applied
// versions live in the `migrations` table (see db.ts).

export const MIGRATIONS: readonly string[] = [
  // v1: campaign registry — the channel/role/DM mapping `/campaign setup` owns (plan §3).
  // game_server_token and next_session_at are nullable: milestone 5 mints the token,
  // /schedule (milestone 4) sets the date; both stay unused until then.
  `
    CREATE TABLE IF NOT EXISTS campaigns (
      goblin_campaign_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      channel_id TEXT NOT NULL UNIQUE,
      dm_channel_id TEXT NOT NULL UNIQUE,
      dm_discord_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      game_server_token TEXT,
      next_session_at INTEGER,
      created_at INTEGER NOT NULL
    )
  `,
  // v2: characters — one per player per campaign. name is COLLATE NOCASE so the UNIQUE
  // constraint (and every lookup) is case-insensitive without repeating the collation per query.
  `
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL REFERENCES campaigns (goblin_campaign_id),
      name TEXT NOT NULL COLLATE NOCASE,
      class TEXT NOT NULL,
      level INTEGER NOT NULL,
      portrait_url TEXT,
      last_played INTEGER,
      created_at INTEGER NOT NULL,
      UNIQUE (campaign_id, name)
    )
  `,
]
