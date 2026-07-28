// Schema is spec §2.4. Append-only: index N is version N+1, and a migration that has
// shipped is never edited — edit it and every existing database silently disagrees with
// every fresh one. Applied versions live in the `migrations` table (see db.ts).

export const MIGRATIONS: readonly string[] = [
  // 001 — initial schema.
  `
  CREATE TABLE campaigns (
    id         TEXT    PRIMARY KEY,
    name       TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE maps (
    id          TEXT    PRIMARY KEY,
    campaign_id TEXT    NOT NULL REFERENCES campaigns(id),
    name        TEXT    NOT NULL,
    data        TEXT    NOT NULL,   -- JSON
    size_bytes  INTEGER NOT NULL,
    imported_at INTEGER NOT NULL
  );
  CREATE INDEX idx_maps_campaign ON maps(campaign_id);

  CREATE TABLE sessions (
    id              TEXT    PRIMARY KEY,
    campaign_id     TEXT    NOT NULL,
    invite_code     TEXT    NOT NULL UNIQUE,
    active_scene_id TEXT,
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL
  );
  -- Doubles as the campaign lookup index and as the one-active-session-per-campaign
  -- rule: a second active row for a campaign cannot be inserted at all, so the rule
  -- holds even if a future caller forgets to end the old session first.
  CREATE UNIQUE INDEX idx_sessions_active ON sessions(campaign_id) WHERE active = 1;

  CREATE TABLE identities (
    id          TEXT    PRIMARY KEY,
    campaign_id TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    role        TEXT    NOT NULL,
    banned      INTEGER NOT NULL DEFAULT 0,
    last_seen   INTEGER
  );
  CREATE INDEX idx_identities_campaign ON identities(campaign_id);

  CREATE TABLE passes (
    id          TEXT    PRIMARY KEY,
    campaign_id TEXT,                -- null = server admin (D6)
    token_hash  TEXT    NOT NULL,
    expires_at  INTEGER              -- null = never expires
  );

  CREATE TABLE module_state (
    campaign_id TEXT NOT NULL,
    module      TEXT NOT NULL,
    state       TEXT NOT NULL,       -- JSON
    PRIMARY KEY (campaign_id, module)
  );
  `,
]
