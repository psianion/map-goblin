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
  // v3: quests — one active/done log per campaign. title is COLLATE NOCASE so
  // "complete <title>" and the UNIQUE constraint both ignore case (characters pattern).
  `
    CREATE TABLE IF NOT EXISTS quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id TEXT NOT NULL REFERENCES campaigns (goblin_campaign_id),
      title TEXT NOT NULL COLLATE NOCASE,
      status TEXT NOT NULL DEFAULT 'active',
      added_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (campaign_id, title)
    )
  `,
  // v4: notes (party journal) plus a standalone FTS5 index for /recall. Not external-content —
  // the store writes both tables itself (one write path, no trigger sync to keep in step).
  `
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id TEXT NOT NULL REFERENCES campaigns (goblin_campaign_id),
      discord_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      text,
      campaign_id UNINDEXED,
      note_id UNINDEXED
    );
  `,
  // v5: rolls — every /roll persisted (plan §11 M3). character_id is nullable: a player with
  // zero or 2+ characters in the campaign rolls without one attached unless they name one.
  `
    CREATE TABLE IF NOT EXISTS rolls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id TEXT NOT NULL REFERENCES campaigns (goblin_campaign_id),
      character_id INTEGER REFERENCES characters (id),
      discord_id TEXT NOT NULL,
      expr TEXT NOT NULL,
      total INTEGER NOT NULL,
      faces TEXT NOT NULL,
      is_crit INTEGER NOT NULL DEFAULT 0,
      is_fail INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `,
  // v6: ledger — gold deltas and item pickups in one append-only log; kind picks which of
  // delta/item is populated.
  `
    CREATE TABLE IF NOT EXISTS ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id TEXT NOT NULL REFERENCES campaigns (goblin_campaign_id),
      kind TEXT NOT NULL,
      delta INTEGER,
      item TEXT,
      actor TEXT NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL
    )
  `,
  // v7: calendar — one row per campaign, the DM-owned day counter (plan §3: nothing
  // server-side tracks in-game time, so the bot owns it outright).
  `
    CREATE TABLE IF NOT EXISTS calendar (
      campaign_id TEXT PRIMARY KEY REFERENCES campaigns (goblin_campaign_id),
      day INTEGER NOT NULL,
      epoch_label TEXT,
      updated_at INTEGER NOT NULL
    )
  `,
]
