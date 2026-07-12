import { getDb } from './index'
import { getAllSettings } from './settings'

// ---- Analytics: snapshot thống kê X theo ngày cho từng tài khoản ----
// 1 row/account/day. Upsert qua unique index (account_id, day).
// Retention theo settings.analyticsRetentionDays (mặc định 90 ngày, 0 = giữ mãi).

interface StatsRow {
  id: number
  account_id: string
  day: number
  captured_at: number
  followers: number | null
  following: number | null
  statuses_count: number | null
  name: string | null
}

export interface DailyStats {
  accountId: string
  day: number
  capturedAt: number
  followers: number | null
  following: number | null
  statusesCount: number | null
  name: string | null
}

function toStats(r: StatsRow): DailyStats {
  return {
    accountId: r.account_id,
    day: r.day,
    capturedAt: r.captured_at,
    followers: r.followers ?? null,
    following: r.following ?? null,
    statusesCount: r.statuses_count ?? null,
    name: r.name ?? null
  }
}

// Nửa đêm của ngày chứa timestamp (local time). Dùng làm khoá `day` để upsert.
function midnightOf(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// Upsert: nếu đã có row cho (accountId, day) thì CẬP NHẬT toàn bộ stats
// (followers, following, statuses_count, name) + captured_at.
// Giữ giá trị MỚI NHẤT trong ngày để delta chính xác: delta1d = current - yesterday_latest,
// delta7d = current - 7days_ago_latest. Nếu dùng giá trị đầu ngày, các ngày liên tiếp
// có thể trùng giá trị -> 3 mốc delta đều bằng nhau (bug).
export function upsertDailyStats(
  accountId: string,
  ts: number,
  stats: { followers: number | null; following: number | null; statusesCount: number | null; name: string | null }
): void {
  const day = midnightOf(ts)
  getDb()
    .prepare(
      `INSERT INTO account_stats_daily (account_id, day, captured_at, followers, following, statuses_count, name)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, day) DO UPDATE SET
         captured_at = excluded.captured_at,
         followers = excluded.followers,
         following = excluded.following,
         statuses_count = excluded.statuses_count,
         name = excluded.name`
    )
    .run(accountId, day, ts, stats.followers, stats.following, stats.statusesCount, stats.name)
}

// Lấy toàn bộ dữ liệu 30 ngày gần nhất cho 1 tài khoản (cho chart + delta).
export function listStatsByAccount(accountId: string, days = 30): DailyStats[] {
  const cutoff = midnightOf(Date.now()) - days * 86_400_000
  const rows = getDb()
    .prepare(
      'SELECT * FROM account_stats_daily WHERE account_id = ? AND day >= ? ORDER BY day ASC'
    )
    .all(accountId, cutoff) as StatsRow[]
  return rows.map(toStats)
}

// Lấy dữ liệu cho tất cả tài khoản (cho Overview + grid). Trả về map accountId -> DailyStats[].
export function listAllStats(days = 30): Map<string, DailyStats[]> {
  const cutoff = midnightOf(Date.now()) - days * 86_400_000
  const rows = getDb()
    .prepare('SELECT * FROM account_stats_daily WHERE day >= ? ORDER BY day ASC')
    .all(cutoff) as StatsRow[]
  const map = new Map<string, DailyStats[]>()
  for (const r of rows) {
    const arr = map.get(r.account_id)
    if (arr) arr.push(toStats(r))
    else map.set(r.account_id, [toStats(r)])
  }
  return map
}

// Prune: xoá row cũ hơn retention. Retention đọc từ settings (logRetentionDays
// dùng chung — 30 ngày mặc định). Trả về số row đã xoá.
export function pruneAnalytics(): number {
  const retentionDays = getAllSettings().analyticsRetentionDays
  // 0 = giữ mãi (không prune). Analytics dùng retention RIÊNG (analyticsRetentionDays),
  // không dùng chung logRetentionDays — nhật ký giữ ngắn, chart cần giữ dài.
  if (!retentionDays || retentionDays <= 0) return 0
  const cutoff = midnightOf(Date.now()) - retentionDays * 86_400_000
  const info = getDb().prepare('DELETE FROM account_stats_daily WHERE day < ?').run(cutoff)
  return info.changes
}

// Xoá toàn bộ analytics của 1 tài khoản (cascade delete khi xoá account).
export function deleteAnalyticsByAccount(accountId: string): void {
  getDb().prepare('DELETE FROM account_stats_daily WHERE account_id = ?').run(accountId)
}

// Xoá toàn bộ analytics (tất cả tài khoản).
export function clearAllAnalytics(): void {
  getDb().prepare('DELETE FROM account_stats_daily').run()
}

// Thống kê dung lượng: số row, số tài khoản, dung lượng ước tính.
export interface AnalyticsStorageStats {
  rowCount: number
  accountCount: number
  estimatedBytes: number
  retentionDays: number
}

export function getAnalyticsStorageStats(): AnalyticsStorageStats {
  const row = getDb()
    .prepare('SELECT COUNT(*) as cnt, COUNT(DISTINCT account_id) as acct FROM account_stats_daily')
    .get() as { cnt: number; acct: number }
  // Ước tính: ~60 bytes/row (followers+following+statuses+name+timestamps).
  const estimatedBytes = row.cnt * 60
  return {
    rowCount: row.cnt,
    accountCount: row.acct,
    estimatedBytes,
    retentionDays: getAllSettings().analyticsRetentionDays
  }
}

// Đọc/ghi ngày fetch cuối (lưu trong settings) cho scheduler.
export function getLastFetchDay(): number | null {
  const raw = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('analytics:lastFetchDay') as
    | { value: string }
    | undefined
  return raw ? Number(raw.value) : null
}

export function setLastFetchDay(ts: number): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('analytics:lastFetchDay', String(ts))
}
