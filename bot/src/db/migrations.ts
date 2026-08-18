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
  // v8: schedule_polls — /schedule (plan §11 M4). options/votes are JSON (SQLite has no
  // array/map column); votes keys on discord_id -> option index, one vote per user.
  // channel_id/message_id are nullable: the row is created first so the vote/close buttons
  // can be built with its id, then stamped with the message ref once the poll is posted.
  `
    CREATE TABLE IF NOT EXISTS schedule_polls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id TEXT NOT NULL REFERENCES campaigns (goblin_campaign_id),
      channel_id TEXT,
      message_id TEXT,
      options TEXT NOT NULL,
      votes TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL
    )
  `,
  // v9: lfg_posts — the recruiting board post per campaign (plan §11 M4).
  `
    CREATE TABLE IF NOT EXISTS lfg_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id TEXT NOT NULL REFERENCES campaigns (goblin_campaign_id),
      blurb TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL
    )
  `,
  // v10: lfg_applications — one row per /apply or board-button click.
  `
    CREATE TABLE IF NOT EXISTS lfg_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id TEXT NOT NULL REFERENCES campaigns (goblin_campaign_id),
      discord_id TEXT NOT NULL,
      message TEXT,
      created_at INTEGER NOT NULL
    )
  `,
  // v11: feedback — deliberately no discord_id column. Anonymous means not stored, not just
  // not shown (plan §7): there is nothing here to un-anonymize even with DB access.
  `
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id TEXT NOT NULL REFERENCES campaigns (goblin_campaign_id),
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `,
  // v12: the bot's second game-server seat (plan §11 M5). v1's game_server_token is the DM
  // one it always meant to be; the player token beside it is what player-facing fetches use,
  // so the server's redactor — not the bot — decides what a player may see (plan §4).
  `ALTER TABLE campaigns ADD COLUMN player_token TEXT`,
  // v13: sessions — one row per table the bot opened (plan §3). ended_at NULL is the live
  // one, and on boot it is also the list of observers to resume. recap is the accumulated
  // JSON, written once at the end; recap_message_id is where it was posted.
  //
  // invite_code and live_message_id are here for that resume: a bot that restarts mid-session
  // has to keep editing the board it already posted, and re-render a join link it cannot ask
  // the server for (there is no route that reads a live session's code back out).
  `
    CREATE TABLE IF NOT EXISTS sessions (
      goblin_session_id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns (goblin_campaign_id),
      invite_code TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      recap TEXT,
      live_message_id TEXT,
      recap_message_id TEXT
    )
  `,
]
