import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import Database from 'better-sqlite3'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  const dir = join(app.getPath('userData'), 'db')
  mkdirSync(dir, { recursive: true })
  db = new Database(join(dir, 'aviary.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id          TEXT PRIMARY KEY,
      label       TEXT NOT NULL,
      handle      TEXT,
      proxy       TEXT,
      profile_dir TEXT NOT NULL,
      fingerprint TEXT,
      status      TEXT NOT NULL DEFAULT 'new',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id    TEXT NOT NULL,
      account_label TEXT NOT NULL,
      ts            INTEGER NOT NULL,
      ok            INTEGER NOT NULL,
      caption       TEXT NOT NULL DEFAULT '',
      url           TEXT,
      error         TEXT,
      step          TEXT,
      screenshot    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs (ts);
  `)

  // Migration cột mới cho accounts (an toàn nếu đã tồn tại).
  addColumnIfMissing(d, 'accounts', 'asset_url', 'TEXT')
  addColumnIfMissing(d, 'accounts', 'headless', 'INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(d, 'accounts', 'hashtag', 'TEXT')
  // proxy_id: '__local' (mặc định, IP máy) | '__random' (random mỗi lần) | id proxy.
  addColumnIfMissing(d, 'accounts', 'proxy_id', "TEXT NOT NULL DEFAULT '__local'")

  // Bảng kho proxy chung (tab Proxy).
  d.exec(`
    CREATE TABLE IF NOT EXISTS proxies (
      id           TEXT PRIMARY KEY,
      label        TEXT NOT NULL,
      proxy_string TEXT NOT NULL,
      kind         TEXT,
      note         TEXT,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );
  `)

  // Bảng lịch đăng bài (tab Lịch đăng).
  d.exec(`
    CREATE TABLE IF NOT EXISTS schedules (
      id               TEXT PRIMARY KEY,
      account_id       TEXT NOT NULL,
      label            TEXT,
      enabled          INTEGER NOT NULL DEFAULT 1,
      kind             TEXT NOT NULL,
      interval_minutes INTEGER,
      times            TEXT,
      jitter_seconds   INTEGER NOT NULL DEFAULT 0,
      last_run_at      INTEGER,
      next_run_at      INTEGER,
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_schedules_next ON schedules (next_run_at);
  `)

  // Cột phân loại sự kiện trong logs: 'post' | 'schedule' | 'run'. Cũ = NULL (= post).
  addColumnIfMissing(d, 'logs', 'event_type', 'TEXT')
}

function addColumnIfMissing(d: Database.Database, table: string, col: string, decl: string): void {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === col)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`)
  }
}
