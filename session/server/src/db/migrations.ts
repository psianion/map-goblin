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

  // 002 — S2 §2.3.1 / D11: token portraits and anything else a module points an id at.
  // Blobs in SQLite for the same reason maps are: one file to back up, no orphaned
  // directory to keep in sync with the rows that reference it.
  `
  CREATE TABLE assets (
    id          TEXT    PRIMARY KEY,
    campaign_id TEXT    NOT NULL REFERENCES campaigns(id),
    mime        TEXT    NOT NULL,
    bytes       BLOB    NOT NULL,
    size        INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX idx_assets_campaign ON assets(campaign_id);
  `,

  // 003 — issue #47: Scene becomes a first-class entity instead of "a scene id is a map
  // id". A scene points at the map row it currently renders (`map_id`); re-publishing
  // repoints that column without touching `scenes.id`, which is the id fog/tokens/doors
  // module state and `sessions.active_scene_id` are keyed by — the fix for the orphaning
  // bug where a re-upload used to mint a fresh scene id and strand the old one's state.
  `
  CREATE TABLE scenes (
    id                 TEXT    PRIMARY KEY,
    campaign_id        TEXT    NOT NULL REFERENCES campaigns(id),
    map_id             TEXT    NOT NULL REFERENCES maps(id),
    name               TEXT    NOT NULL,
    sort_index         INTEGER NOT NULL,
    visible_to_players INTEGER NOT NULL DEFAULT 0,
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL
  );
  CREATE INDEX idx_scenes_campaign ON scenes(campaign_id);
  -- A map row backs at most one scene — re-publishing moves a scene onto a fresh map
  -- row, it never shares one with another scene.
  CREATE UNIQUE INDEX idx_scenes_map ON scenes(map_id);

  -- Every map row that predates this table becomes a scene with the *same* id, so
  -- active_scene_id and every byScene key already on disk keep resolving to the
  -- same map without moving. Hidden by default (D5's visibility flag) — an existing
  -- table's maps were never "published to players" as a distinct step, so the safe
  -- default is the same one a brand new scene gets.
  INSERT INTO scenes (id, campaign_id, map_id, name, sort_index, visible_to_players, created_at, updated_at)
  SELECT id, campaign_id, id, name,
         ROW_NUMBER() OVER (PARTITION BY campaign_id ORDER BY imported_at) - 1,
         0, imported_at, imported_at
  FROM maps;
  `,
]
