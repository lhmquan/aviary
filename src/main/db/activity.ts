import { getDb } from './index'
import type { AccountActivity, AccountHealth } from '../../shared/types'

// Tổng hợp "hoạt động gần nhất" + "sức khoẻ" mỗi tài khoản, suy ra từ:
//   - Nhật ký (logs): hoạt động cuối, số lỗi trong 10 hoạt động gần nhất, caption trùng lặp.
//   - Analytics (account_stats_daily): số bài có tăng đều không (khi có lịch đăng hằng ngày).
//   - Lịch (schedules): tài khoản nào đang bật lịch ĐĂNG BÀI.
// Trả về 1 mảng để renderer hiển thị chấm màu + dòng hoạt động ở tab Tài khoản.

// Chuẩn hoá event_type -> loại hoạt động hiển thị. Sự kiện 'schedule' (hệ thống) đã bị
// loại khỏi truy vấn nên không tới đây.
function normalizeKind(eventType: string | null): string {
  switch (eventType) {
    case 'delete':
    case 'run_delete':
      return 'delete'
    case 'comment':
    case 'run_comment':
      return 'comment'
    case 'interact':
    case 'run_interact':
      return 'interact'
    default:
      return 'post' // 'post' | 'run' | null (log cũ)
  }
}

function midnightDaysAgo(n: number): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime() - n * 86_400_000
}

export function getAccountActivities(): AccountActivity[] {
  const db = getDb()

  // 1) 10 KẾT QUẢ hoạt động gần nhất mỗi tài khoản. Loại:
  //    - Sự kiện hệ thống 'schedule' (tạo/sửa lịch).
  //    - Dòng 'trigger' (Lịch X kích hoạt) — chỉ là mốc BẮT ĐẦU 1 lần chạy, không phải kết quả.
  //    (step có thể NULL ở log cũ nên phải OR IS NULL.)
  const actRows = db
    .prepare(
      `SELECT account_id, ok, event_type, ts FROM (
         SELECT account_id, ok, event_type, ts,
           ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY ts DESC) AS rn
         FROM logs
         WHERE (event_type IS NULL OR event_type != 'schedule')
           AND (step IS NULL OR step != 'trigger')
       ) WHERE rn <= 10`
    )
    .all() as { account_id: string; ok: number; event_type: string | null; ts: number }[]

  // 2) 10 bài ĐĂNG THÀNH CÔNG gần nhất mỗi tài khoản (để phát hiện caption trùng 100%).
  //    Chỉ tính bài THỰC SỰ đăng: ok=1 + có url (link tweet). Loại dòng 'trigger'/'skip'/lỗi
  //    (các dòng này có caption trùng nhau như "Lịch đăng kích hoạt…" gây báo nhầm bất thường).
  const postRows = db
    .prepare(
      `SELECT account_id, caption FROM (
         SELECT account_id, caption, ts,
           ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY ts DESC) AS rn
         FROM logs
         WHERE (event_type IS NULL OR event_type IN ('post', 'run'))
           AND ok = 1 AND url IS NOT NULL
       ) WHERE rn <= 10`
    )
    .all() as { account_id: string; caption: string | null }[]

  // 3) Số bài (statuses_count) theo ngày gần đây (≤4 ngày) — check tăng trưởng.
  const statsRows = db
    .prepare(
      `SELECT account_id, statuses_count FROM account_stats_daily
       WHERE day >= ? AND statuses_count IS NOT NULL
       ORDER BY account_id, day ASC`
    )
    .all(midnightDaysAgo(4)) as { account_id: string; statuses_count: number }[]

  // 4) Tài khoản đang bật lịch ĐĂNG BÀI (để biết số bài "nên" tăng mỗi ngày).
  const schedRows = db
    .prepare(`SELECT DISTINCT account_id FROM schedules WHERE enabled = 1 AND action = 'post'`)
    .all() as { account_id: string }[]
  const postScheduled = new Set(schedRows.map((r) => r.account_id))

  // Gom theo account_id.
  const actByAcct = new Map<string, { ok: number; event_type: string | null; ts: number }[]>()
  for (const r of actRows) {
    const arr = actByAcct.get(r.account_id)
    if (arr) arr.push(r)
    else actByAcct.set(r.account_id, [r])
  }
  const capsByAcct = new Map<string, string[]>()
  for (const r of postRows) {
    const cap = (r.caption ?? '').trim()
    if (!cap) continue
    const arr = capsByAcct.get(r.account_id)
    if (arr) arr.push(cap)
    else capsByAcct.set(r.account_id, [cap])
  }
  const statsByAcct = new Map<string, number[]>()
  for (const r of statsRows) {
    const arr = statsByAcct.get(r.account_id)
    if (arr) arr.push(r.statuses_count)
    else statsByAcct.set(r.account_id, [r.statuses_count])
  }

  const accountIds = (db.prepare('SELECT id FROM accounts').all() as { id: string }[]).map(
    (r) => r.id
  )

  const out: AccountActivity[] = []
  for (const id of accountIds) {
    const acts = actByAcct.get(id) ?? []
    const first = acts[0]
    const last = first
      ? { ok: !!first.ok, kind: normalizeKind(first.event_type), ts: first.ts }
      : null
    const errorCount = acts.reduce((n, a) => n + (a.ok ? 0 : 1), 0)

    // Caption trùng 100% ở 2 bài LIỀN KỀ nhau (trong 10 bài đăng gần nhất). Chỉ tính trùng
    // liền kề: ở các ngách repost (ảnh người nổi tiếng…), trùng caption RẢI RÁC là bình thường
    // và tự hết khi bài mới đè lên. Chỉ khi 2+ bài liên tiếp cùng caption mới là dấu hiệu kẹt
    // (đăng lại đúng 1 nội dung). caps đã sắp theo thời gian giảm dần nên phần tử liền kề = bài liền kề.
    const caps = capsByAcct.get(id) ?? []
    let hasDuplicate = false
    for (let i = 1; i < caps.length; i++) {
      if (caps[i] === caps[i - 1]) {
        hasDuplicate = true
        break
      }
    }

    // Có lịch đăng hằng ngày nhưng số bài không tăng (latest ≤ earliest trong cửa sổ) -> bất thường.
    let noGrowth = false
    if (postScheduled.has(id)) {
      const s = statsByAcct.get(id) ?? []
      if (s.length >= 2 && s[s.length - 1] <= s[0]) noGrowth = true
    }

    let health: AccountHealth = 'ok'
    let reason: string | null = null
    if (errorCount >= 2) {
      health = 'error'
      reason = `${errorCount} lỗi trong 10 hoạt động gần nhất`
    } else if (hasDuplicate) {
      health = 'abnormal'
      reason = 'Có caption trùng lặp 100% trong 10 bài đăng gần nhất'
    } else if (noGrowth) {
      health = 'abnormal'
      reason = 'Số bài không tăng dù có lịch đăng hằng ngày — kiểm tra Nhật ký'
    }

    out.push({ accountId: id, last, errorCount, health, reason })
  }

  return out
}
