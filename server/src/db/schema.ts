export const SCHEMA = `
PRAGMA journal_mode = WAL;
-- Safe with WAL (a power cut can lose the last moments of writes, never corrupt the file),
-- and far fewer disk flushes than the default
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS games (
  id            TEXT PRIMARY KEY,          -- "sw:eu:<nsuid>", "sw:us:<nsuid>", "steam:<appid>"
  platform      TEXT NOT NULL,             -- switch2 | switch | steam
  title         TEXT NOT NULL,
  title_key     TEXT NOT NULL,
  image         TEXT,
  publisher     TEXT,
  release_date  TEXT,
  product_code  TEXT,
  store_url     TEXT,
  steam_app_id  INTEGER,
  rank          INTEGER,                   -- store popularity order, lower is more popular
  on_sale       INTEGER NOT NULL DEFAULT 0,
  max_discount  INTEGER NOT NULL DEFAULT 0,
  sale_ends_at  TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS games_platform_sale ON games(platform, on_sale);
CREATE INDEX IF NOT EXISTS games_title_key ON games(title_key);
CREATE UNIQUE INDEX IF NOT EXISTS games_steam ON games(steam_app_id) WHERE steam_app_id IS NOT NULL;

-- Nintendo gives a game a different ID in each regional group
CREATE TABLE IF NOT EXISTS game_ids (
  grp           TEXT NOT NULL,             -- americas | europe | japan | hongkong | korea | sea
  nsuid         TEXT NOT NULL,
  game_id       TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  match_method  TEXT NOT NULL,             -- source | product_code | application_id | title_publisher | title_date
  PRIMARY KEY (grp, nsuid)
);
CREATE INDEX IF NOT EXISTS game_ids_game ON game_ids(game_id);

-- A Switch 2 Edition's upgrade pack (its own listing in games, Europe's ID),
-- for people who own the Switch game. The Switch game is found by application ID.
CREATE TABLE IF NOT EXISTS upgrades (
  edition_id    TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  pack_id       TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE
);

-- Japan, Hong Kong and Korea list games in their own languages, so we keep
-- their catalogs here and link games by product code instead of by title
CREATE TABLE IF NOT EXISTS region_catalog (
  grp           TEXT NOT NULL,             -- japan | hongkong | korea | sea
  nsuid         TEXT NOT NULL,
  platform      TEXT NOT NULL,             -- switch2 | switch
  code_key      TEXT NOT NULL,             -- hardware + product code core, e.g. "BEEAAAC"
  title         TEXT NOT NULL,
  release_date  TEXT,
  app_id        TEXT,                      -- from the eShop title page, fetched only when needed
  app_checked_at INTEGER,
  publisher     TEXT,                      -- Southeast Asia and Japan, for games sold only there
  image         TEXT,
  sale_seen_at  INTEGER,                   -- last seen in the store's on-sale list (Southeast Asia, Japan)
  seen_at       INTEGER NOT NULL,
  PRIMARY KEY (grp, nsuid)
);
CREATE INDEX IF NOT EXISTS region_catalog_key ON region_catalog(grp, code_key);
CREATE INDEX IF NOT EXISTS region_catalog_date ON region_catalog(grp, platform, release_date);
CREATE INDEX IF NOT EXISTS region_catalog_app ON region_catalog(grp, app_id) WHERE app_id IS NOT NULL;

-- When each scheduled job last finished, so a restart doesn't reset a daily job's clock
CREATE TABLE IF NOT EXISTS job_runs (
  name          TEXT PRIMARY KEY,
  last_ok       INTEGER NOT NULL
);

-- The latest price we saw for a game in a country
CREATE TABLE IF NOT EXISTS prices (
  game_id       TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  country       TEXT NOT NULL,
  currency      TEXT NOT NULL,
  regular       REAL NOT NULL,
  sale          REAL,
  discount      INTEGER NOT NULL DEFAULT 0,
  sale_ends_at  TEXT,
  checked_at    INTEGER NOT NULL,
  changed_at    INTEGER NOT NULL,
  PRIMARY KEY (game_id, country)
) WITHOUT ROWID;

-- One row each time a price changes, so history stays compact
CREATE TABLE IF NOT EXISTS price_history (
  game_id       TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  country       TEXT NOT NULL,
  t             INTEGER NOT NULL,
  currency      TEXT NOT NULL,
  price         REAL NOT NULL,
  regular       REAL NOT NULL,
  discount      INTEGER NOT NULL,
  PRIMARY KEY (game_id, country, t)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS fx (
  currency      TEXT PRIMARY KEY,
  per_usd       REAL NOT NULL,
  source        TEXT NOT NULL,             -- ecb | market
  as_of         TEXT NOT NULL,
  fetched_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id             TEXT PRIMARY KEY,
  secret_hash    TEXT NOT NULL,
  push_token     TEXT,
  os             TEXT,
  home_region    TEXT NOT NULL DEFAULT 'US',
  currency       TEXT NOT NULL DEFAULT 'USD',
  switch_regions TEXT NOT NULL DEFAULT '[]',
  steam_regions  TEXT NOT NULL DEFAULT '[]',
  tz             TEXT NOT NULL DEFAULT 'UTC',
  quiet_start    INTEGER,                  -- hour 0-23, local time
  quiet_end      INTEGER,
  alerts_enabled INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL,
  last_seen      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS watches (
  device_id     TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  game_id       TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  target        REAL,                      -- in the device's currency
  alerts        TEXT NOT NULL,             -- JSON AlertPrefs
  last_best     REAL,                      -- best price at the last evaluation, device currency
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (device_id, game_id)
);
CREATE INDEX IF NOT EXISTS watches_game ON watches(game_id);

CREATE TABLE IF NOT EXISTS notifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id     TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  game_id       TEXT,
  kind          TEXT NOT NULL,
  dedupe_key    TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  data          TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  send_after    INTEGER NOT NULL,
  expires_at    INTEGER,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | sent | delivered | failed | skipped
  ticket_id     TEXT,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS notifications_due ON notifications(status, send_after);
CREATE INDEX IF NOT EXISTS notifications_device ON notifications(device_id, created_at);

-- Steam doesn't put the currency in every response, so we confirm it daily
CREATE TABLE IF NOT EXISTS steam_currency (
  country       TEXT PRIMARY KEY,
  currency      TEXT NOT NULL,
  checked_at    INTEGER NOT NULL
);

-- How many games each store reports as discounted, at most one reading per hour
CREATE TABLE IF NOT EXISTS sale_counts (
  source        TEXT NOT NULL,             -- switch2 | switch | steam
  t             INTEGER NOT NULL,          -- start of the hour
  count         INTEGER NOT NULL,
  PRIMARY KEY (source, t)
);

-- Store-wide sales, detected when the discounted count jumps well above normal
CREATE TABLE IF NOT EXISTS sale_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  platform      TEXT NOT NULL,
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  baseline      INTEGER NOT NULL,          -- frozen at the start, so a long sale doesn't raise its own bar
  latest        INTEGER NOT NULL,
  peak          INTEGER NOT NULL
);

-- Big deals already sent to a device, so a digest never repeats a game for the same sale
CREATE TABLE IF NOT EXISTS deal_seen (
  device_id     TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  game_id       TEXT NOT NULL,
  sale_key      TEXT NOT NULL,
  at            INTEGER NOT NULL,
  PRIMARY KEY (device_id, game_id, sale_key)
);

CREATE TABLE IF NOT EXISTS source_status (
  source        TEXT PRIMARY KEY,
  last_ok       INTEGER,
  last_error    TEXT,
  last_error_at INTEGER,
  items         INTEGER
);
`;
