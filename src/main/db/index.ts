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
  // Thống kê hồ sơ X (tự fetch từ username): follower / following / số bài. Cũ = NULL.
  addColumnIfMissing(d, 'accounts', 'followers', 'INTEGER')
  addColumnIfMissing(d, 'accounts', 'following', 'INTEGER')
  addColumnIfMissing(d, 'accounts', 'statuses', 'INTEGER')
  // Avatar X (URL pbs.twimg.com). null = chưa fetch hoặc không có handle.
  addColumnIfMissing(d, 'accounts', 'avatar_url', 'TEXT')

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

  // Bảng lên lịch đăng bài (tab Lên lịch).
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
  // JSON mảng URL các bài đã xoá (log loại delete/run_delete). Cũ = NULL.
  addColumnIfMissing(d, 'logs', 'urls_json', 'TEXT')

  // Cột kết quả kiểm tra proxy: status (unchecked/live/dead), vị trí, latency.
  addColumnIfMissing(d, 'proxies', 'status', "TEXT NOT NULL DEFAULT 'unchecked'")
  addColumnIfMissing(d, 'proxies', 'checked_at', 'INTEGER')
  addColumnIfMissing(d, 'proxies', 'latency_ms', 'INTEGER')
  addColumnIfMissing(d, 'proxies', 'country', 'TEXT')
  addColumnIfMissing(d, 'proxies', 'city', 'TEXT')
  addColumnIfMissing(d, 'proxies', 'check_ip', 'TEXT')

  // Cột mở rộng cho lịch xoá bài (action='delete').
  addColumnIfMissing(d, 'schedules', 'action', "TEXT NOT NULL DEFAULT 'post'")
  addColumnIfMissing(d, 'schedules', 'delete_mode', 'TEXT')
  addColumnIfMissing(d, 'schedules', 'delete_before_date', 'TEXT')
  addColumnIfMissing(d, 'schedules', 'delete_count', 'INTEGER NOT NULL DEFAULT 1')
  // Cờ đang chạy (semaphore hàng đợi scheduler). Reset về 0 khi khởi động app.
  addColumnIfMissing(d, 'schedules', 'running', 'INTEGER NOT NULL DEFAULT 0')

  // Bảng Analytics: snapshot thống kê X theo ngày cho từng tài khoản.
  // 1 row/account/day (upsert qua unique index). Retention 30 ngày.
  d.exec(`
    CREATE TABLE IF NOT EXISTS account_stats_daily (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id      TEXT NOT NULL,
      day             INTEGER NOT NULL,
      captured_at     INTEGER NOT NULL,
      followers       INTEGER,
      following       INTEGER,
      statuses_count  INTEGER,
      name            TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stats_acct_day ON account_stats_daily (account_id, day);
    CREATE INDEX IF NOT EXISTS idx_stats_day ON account_stats_daily (day);
  `)
}

function addColumnIfMissing(d: Database.Database, table: string, col: string, decl: string): void {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === col)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`)
  }
}
