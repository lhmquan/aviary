import { getDb } from './index'
import { canonicalizeTweetUrl } from '../../shared/url'

interface CommentHistoryRow {
  id: number
  account_id: string
  tweet_url: string
  commented_at: number
  status: string | null
}

// Thêm 1 link vào cache.
// status: 'collected' = đã thu thập từ profile, chưa mở check;
//         'commented' = đã bình luận thành công;
//         'reply_skip' = tweet là reply, đã bỏ qua;
//         'fail' = lỗi comment, sẽ thử lại.
export function insertCommentedLink(
  accountId: string,
  tweetUrl: string,
  status: 'collected' | 'commented' | 'reply_skip' | 'fail' = 'commented',
  at = Date.now()
): void {
  const canonical = canonicalizeTweetUrl(tweetUrl)
  if (!canonical) return
  getDb()
    .prepare(
      'INSERT OR IGNORE INTO comment_history (account_id, tweet_url, commented_at, status) VALUES (?, ?, ?, ?)'
    )
    .run(accountId, canonical, at, status)
  getDb()
    .prepare('UPDATE comment_history SET status = ?, commented_at = ? WHERE account_id = ? AND tweet_url = ?')
    .run(status, at, accountId, canonical)
}

// Thêm hàng loạt link vào cache (status='collected'). Bỏ qua link đã có (tránh trùng).
export function insertCollectedLinks(accountId: string, urls: string[], at = Date.now()): void {
  const stmt = getDb().prepare(
    'INSERT OR IGNORE INTO comment_history (account_id, tweet_url, commented_at, status) VALUES (?, ?, ?, ?)'
  )
  const tx = getDb().transaction((rows: [string, string, number, string][]) => {
    for (const r of rows) stmt.run(...r)
  })
  tx(urls.map((u) => [accountId, u, at, 'collected'] as [string, string, number, string]))
}

// Cập nhật status cho 1 link đã có trong cache (vd: 'collected' -> 'commented').
export function updateLinkStatus(
  accountId: string,
  tweetUrl: string,
  status: 'collected' | 'commented' | 'reply_skip' | 'fail'
): void {
  getDb()
    .prepare(
      'UPDATE comment_history SET status = ?, commented_at = ? WHERE account_id = ? AND tweet_url = ?'
    )
    .run(status, Date.now(), accountId, tweetUrl)
}

// Lấy danh sách link chưa xử lý (status='collected') — đã thu thập từ profile nhưng
// chưa mở check reply/gốc. Dùng để tiếp tục xử lý ở lần chạy kế nếu chưa đủ target.
export function listUnprocessedLinks(accountId: string, limit = 50): string[] {
  const rows = getDb()
    .prepare(
      `SELECT tweet_url FROM comment_history
       WHERE account_id = ? AND status = 'collected'
       ORDER BY commented_at DESC LIMIT ?`
    )
    .all(accountId, limit) as Pick<CommentHistoryRow, 'tweet_url'>[]
  return rows.map((r) => r.tweet_url)
}

// Lấy TẤT CẢ link đã xử lý (mọi status) — dùng cho early-stop khi cuộn profile.
// Gặp link đã có trong cache (bất kỳ status) -> phần còn lại đều cũ -> dừng cuộn.
export function listAllCachedLinks(accountId: string, count = 100): string[] {
  const rows = getDb()
    .prepare(
      'SELECT tweet_url FROM comment_history WHERE account_id = ? ORDER BY commented_at DESC LIMIT ?'
    )
    .all(accountId, count) as Pick<CommentHistoryRow, 'tweet_url'>[]
  return rows.map((r) => r.tweet_url)
}

// Lấy danh sách link đã COMMENT THÀNH CÔNG (không gồm reply_skip/collected/fail).
export function listCommentedLinksOnly(accountId: string, count = 100): string[] {
  const rows = getDb()
    .prepare(
      `SELECT tweet_url FROM comment_history
       WHERE account_id = ? AND status = 'commented'
       ORDER BY commented_at DESC LIMIT ?`
    )
    .all(accountId, count) as Pick<CommentHistoryRow, 'tweet_url'>[]
  return rows.map((r) => r.tweet_url)
}

// Tập URL đã xử lý VĨNH VIỄN cho 1 tài khoản: chỉ 'commented' (đã bình luận thành công) và
// 'reply_skip' (bài là reply thật). Đây là 2 trạng thái DUY NHẤT được bỏ qua vĩnh viễn theo
// thiết kế mới. Bài dưới ngưỡng views KHÔNG nằm ở đây (không được cache) nên sẽ được xét lại.
// Dùng Set để tra O(1) khi lọc danh sách N bài mới nhất mỗi lần chạy.
export function listPermanentlySkippedSet(accountId: string, count = 500): Set<string> {
  const rows = getDb()
    .prepare(
      `SELECT tweet_url FROM comment_history
       WHERE account_id = ? AND status IN ('commented', 'reply_skip')
       ORDER BY commented_at DESC LIMIT ?`
    )
    .all(accountId, count) as Pick<CommentHistoryRow, 'tweet_url'>[]
  return new Set(rows.map((r) => r.tweet_url))
}

// Đếm số comment đã thực hiện trong ngày hôm nay (chỉ status='commented').
export function countCommentsToday(accountId: string, now = Date.now()): number {
  const d = new Date(now)
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as c FROM comment_history
       WHERE account_id = ? AND commented_at >= ? AND status = 'commented'`
    )
    .get(accountId, midnight) as { c: number }
  return row.c
}

// Prune: chỉ giữ lại N link gần nhất cho mỗi tài khoản.
export function pruneCommentHistory(accountId: string, keepCount = 100): void {
  const db = getDb()
  const row = db
    .prepare(
      'SELECT commented_at FROM comment_history WHERE account_id = ? ORDER BY commented_at DESC LIMIT 1 OFFSET ?'
    )
    .get(accountId, keepCount) as { commented_at: number } | undefined
  if (!row) return
  db.prepare('DELETE FROM comment_history WHERE account_id = ? AND commented_at < ?').run(
    accountId,
    row.commented_at
  )
}

// Xoá toàn bộ history của 1 tài khoản.
export function deleteCommentHistoryByAccount(accountId: string): void {
  getDb().prepare('DELETE FROM comment_history WHERE account_id = ?').run(accountId)
}
