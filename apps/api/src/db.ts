import Database from "better-sqlite3";

const DEFAULT_DB_PATH = new URL("../../../weekly_social_update.db", import.meta.url).pathname;

export type SqliteDatabase = Database.Database;

export function createDatabase(filename = process.env.WEEKLY_DB_PATH ?? DEFAULT_DB_PATH): SqliteDatabase {
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS datasets (
      id TEXT PRIMARY KEY,
      cache_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      fetch_window_json TEXT NOT NULL,
      source_config_json TEXT NOT NULL,
      scoring_weights_json TEXT NOT NULL,
      warnings_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_items (
      id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      item_key TEXT NOT NULL,
      json TEXT NOT NULL,
      FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_activity_items_dataset ON activity_items(dataset_id);
    CREATE INDEX IF NOT EXISTS idx_activity_items_key ON activity_items(item_key);

    CREATE TABLE IF NOT EXISTS activity_excerpts (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      rank INTEGER NOT NULL,
      json TEXT NOT NULL,
      FOREIGN KEY (item_id) REFERENCES activity_items(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_activity_excerpts_item ON activity_excerpts(item_id);

    CREATE TABLE IF NOT EXISTS dataset_item_state (
      item_id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      reviewed INTEGER NOT NULL DEFAULT 0,
      selected INTEGER NOT NULL DEFAULT 0,
      included_in_generated_prompt INTEGER NOT NULL DEFAULT 0,
      posted INTEGER NOT NULL DEFAULT 0,
      selection_order INTEGER,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES activity_items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS posted_markers (
      id TEXT PRIMARY KEY,
      item_key TEXT NOT NULL,
      dataset_id TEXT NOT NULL,
      posted_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_posted_markers_key ON posted_markers(item_key, posted_at DESC);
  `);

  return db;
}

