import { randomUUID } from 'crypto'
import { getDb } from './index'
import { insertLog } from './logs'
import { getAccount } from './accounts'
import { getAllSettings } from './settings'
import { getLastFetchDay } from './analytics'
import { isAnalyticsRunning } from '../analytics/scheduler'
import type {
  Schedule,
  ScheduleInput,
  ScheduleKind,
  ScheduleAction,
  DeleteMode,
  CommentContentSource
} from '../../shared/types'

interface ScheduleRow {
  id: string
  account_id: string
  label: string | null
  enabled: number
  action: string
  kind: string
  interval_minutes: number | null
  times: string | null
  jitter_seconds: number
  delete_mode: string | null
  delete_before_date: string | null
  delete_count: number
  comment_count: number
  comment_interval_seconds: number
  comment_source_url: string | null
  comment_newest_count: number
  comment_view_threshold: number
  comment_source: string
  comment_ai_instruction: string | null
  comment_max_words: number
  comment_prefix: string | null
  comment_link: string | null
  interact_duration_minutes: number
  interact_comment_target: number
  last_run_at: number | null
  next_run_at: number | null
  running: number
  created_at: number
  updated_at: number
}

function toSchedule(r: ScheduleRow): Schedule {
  let times: string[] = []
  try {
    if (r.times) times = JSON.parse(r.times)
  } catch {
    times = []
  }
  return {
    id: r.id,
    accountId: r.account_id,
    label: r.label,
    enabled: !!r.enabled,
    action: (r.action ?? 'post') as ScheduleAction,
    kind: r.kind as ScheduleKind,
    intervalMinutes: r.interval_minutes,
    times,
    jitterSeconds: r.jitter_seconds ?? 0,
    deleteMode: (r.delete_mode ?? null) as DeleteMode | null,
    deleteBeforeDate: r.delete_before_date,
    deleteCount: r.delete_count ?? 1,
    commentCount: r.comment_count ?? 1,
    commentIntervalSeconds: r.comment_interval_seconds ?? 60,
    commentSourceUrl: r.comment_source_url ?? null,
    commentNewestCount: r.comment_newest_count ?? 20,
    commentViewThreshold: r.comment_view_threshold ?? 0,
    commentSource: (r.comment_source === 'ai' ? 'ai' : 'n8n') as CommentContentSource,
    commentAiInstruction: r.comment_ai_instruction ?? null,
    commentMaxChars: r.comment_max_words ?? 0,
    commentPrefix: r.comment_prefix ?? null,
    commentLink: r.comment_link ?? null,
    interactDurationMinutes: r.interact_duration_minutes ?? 15,
    interactCommentTarget: r.interact_comment_target ?? 0,
    lastRunAt: r.last_run_at,
    nextRunAt: r.next_run_at,
    running: !!r.running,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export function listSchedules(): Schedule[] {
  const rows = getDb()
    .prepare('SELECT * FROM schedules ORDER BY created_at ASC')
    .all() as ScheduleRow[]
  const schedules = rows.map(toSchedule)
  // Thêm lịch ảo Analytics (tác vụ hệ thống) vào đầu danh sách.
  schedules.unshift(buildAnalyticsSchedule())
  return schedules
}

export function getSchedule(id: string): Schedule | null {
  const row = getDb().prepare('SELECT * FROM schedules WHERE id = ?').get(id) as
    | ScheduleRow
    | undefined
  return row ? toSchedule(row) : null
}

// Validate "HH:MM" (24h). Bỏ dòng sai khi lưu form.
function sanitizeTimes(raw: string[] | undefined): string[] {
  if (!raw) return []
  const out: string[] = []
  for (const t of raw) {
    const m = String(t).trim().match(/^(\d{1,2}):(\d{2})$/)
    if (!m) continue
    const h = Number(m[1])
    const min = Number(m[2])
    if (h > 23 || min > 59) continue
    out.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`)
  }
  // Sắp xếp + dedup.
  return [...new Set(out)].sort()
}

// Ghi sự kiện lịch vào nhật ký (eventType='schedule').
function logScheduleEvent(accountId: string, ok: boolean, message: string): void {
  insertLog({
    accountId,
    accountLabel: getAccount(accountId)?.label ?? '(tài khoản đã xoá)',
    ts: Date.now(),
    ok,
    caption: message,
    url: null,
    error: ok ? null : message,
    step: 'schedule',
    screenshot: null,
    eventType: 'schedule'
  })
}

// Chuẩn hoá TẤT CẢ giá trị cột (delete/comment/interact) từ input theo action. Dùng chung
// cho create + update để không lệch logic. Field không thuộc action hiện tại -> giá trị mặc
// định an toàn (giữ schema NOT NULL hợp lệ).
function computeScheduleCols(input: ScheduleInput): {
  deleteMode: string | null
  deleteBeforeDate: string | null
  deleteCount: number
  commentCount: number
  commentIntervalSeconds: number
  commentSourceUrl: string | null
  commentNewestCount: number
  commentViewThreshold: number
  commentSource: CommentContentSource
  commentAiInstruction: string | null
  commentMaxChars: number
  commentPrefix: string | null
  commentLink: string | null
  interactDurationMinutes: number
  interactCommentTarget: number
} {
  const action = input.action ?? 'post'
  const isComment = action === 'comment'
  const source: CommentContentSource = isComment
    ? input.commentSource === 'ai'
      ? 'ai'
      : 'n8n'
    : 'n8n'
  return {
    deleteMode: action === 'delete' ? (input.deleteMode ?? 'newest') : null,
    deleteBeforeDate:
      action === 'delete' && (input.deleteMode ?? 'newest') === 'by_date'
        ? (input.deleteBeforeDate ?? null)
        : null,
    deleteCount:
      action === 'delete'
        ? Math.max(0, input.deleteCount === undefined ? 1 : Number(input.deleteCount))
        : 1,
    commentCount: isComment
      ? Math.max(1, input.commentCount === undefined ? 1 : Number(input.commentCount))
      : 1,
    commentIntervalSeconds: isComment
      ? Math.max(5, input.commentIntervalSeconds === undefined ? 60 : Number(input.commentIntervalSeconds))
      : 60,
    // Nguồn n8n cần link Sheet; nguồn ai không cần (để null).
    commentSourceUrl: isComment && source === 'n8n' ? (input.commentSourceUrl?.trim() || null) : null,
    commentNewestCount: isComment
      ? Math.max(1, input.commentNewestCount === undefined ? 20 : Math.floor(Number(input.commentNewestCount)))
      : 20,
    commentViewThreshold: isComment
      ? Math.max(0, input.commentViewThreshold === undefined ? 0 : Math.floor(Number(input.commentViewThreshold)))
      : 0,
    commentSource: source,
    commentAiInstruction: isComment && source === 'ai' ? (input.commentAiInstruction?.trim() || null) : null,
    commentMaxChars:
      isComment && source === 'ai'
        ? Math.max(0, input.commentMaxChars === undefined ? 0 : Math.floor(Number(input.commentMaxChars)))
        : 0,
    commentPrefix: isComment ? (input.commentPrefix?.trim() || null) : null,
    commentLink: isComment ? (input.commentLink?.trim() || null) : null,
    interactDurationMinutes:
      action === 'interact'
        ? Math.max(1, input.interactDurationMinutes === undefined ? 15 : Number(input.interactDurationMinutes))
        : 15,
    interactCommentTarget:
      action === 'interact'
        ? Math.max(0, input.interactCommentTarget === undefined ? 0 : Math.floor(Number(input.interactCommentTarget)))
        : 0
  }
}

export function createSchedule(input: ScheduleInput): Schedule {
  validateInput(input)
  const id = randomUUID()
  const now = Date.now()
  const times = sanitizeTimes(input.times)
  const schedule = buildScheduleObject({ ...input, times })
  const nextRunAt = computeNextRun(schedule, now)

  const action = input.action ?? 'post'
  const cols = computeScheduleCols(input)

  getDb()
    .prepare(
      `INSERT INTO schedules (id, account_id, label, enabled, action, kind, interval_minutes, times, jitter_seconds,
        delete_mode, delete_before_date, delete_count, comment_count, comment_interval_seconds, comment_source_url,
        comment_newest_count, comment_view_threshold, comment_source, comment_ai_instruction, comment_max_words,
        comment_prefix, comment_link, interact_duration_minutes, interact_comment_target, last_run_at, next_run_at,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
    )
    .run(
      id,
      input.accountId,
      input.label?.trim() || null,
      input.enabled === false ? 0 : 1,
      action,
      input.kind,
      input.kind === 'interval' ? Number(input.intervalMinutes) || null : null,
      input.kind === 'fixed' ? JSON.stringify(times) : null,
      Number(input.jitterSeconds) || 0,
      cols.deleteMode,
      cols.deleteBeforeDate,
      cols.deleteCount,
      cols.commentCount,
      cols.commentIntervalSeconds,
      cols.commentSourceUrl,
      cols.commentNewestCount,
      cols.commentViewThreshold,
      cols.commentSource,
      cols.commentAiInstruction,
      cols.commentMaxChars,
      cols.commentPrefix,
      cols.commentLink,
      cols.interactDurationMinutes,
      cols.interactCommentTarget,
      nextRunAt,
      now,
      now
    )
  const created = getSchedule(id)!
  logScheduleEvent(
    input.accountId,
    true,
    `Đã tạo lịch "${describeSchedule(created)}"`
  )
  return created
}

export function updateSchedule(id: string, input: Partial<ScheduleInput>): Schedule {
  const existing = getSchedule(id)
  if (!existing) throw new Error(`Lịch không tồn tại: ${id}`)
  // Hợp nhất input vào existing rồi validate.
  const merged: ScheduleInput = {
    accountId: existing.accountId,
    label: existing.label,
    action: existing.action,
    kind: existing.kind,
    intervalMinutes: existing.intervalMinutes,
    times: existing.times,
    jitterSeconds: existing.jitterSeconds,
    enabled: existing.enabled,
    deleteMode: existing.deleteMode,
    deleteBeforeDate: existing.deleteBeforeDate,
    deleteCount: existing.deleteCount,
    commentCount: existing.commentCount,
    commentIntervalSeconds: existing.commentIntervalSeconds,
    commentSourceUrl: existing.commentSourceUrl,
    commentNewestCount: existing.commentNewestCount,
    commentViewThreshold: existing.commentViewThreshold,
    commentSource: existing.commentSource,
    commentAiInstruction: existing.commentAiInstruction,
    commentMaxChars: existing.commentMaxChars,
    commentPrefix: existing.commentPrefix,
    commentLink: existing.commentLink,
    interactDurationMinutes: existing.interactDurationMinutes,
    interactCommentTarget: existing.interactCommentTarget,
    ...input
  }
  validateInput(merged)
  const times = sanitizeTimes(merged.times)
  const schedule = buildScheduleObject({ ...merged, times })
  const nextRunAt = computeNextRun(schedule, Date.now())
  const now = Date.now()

  const action = merged.action ?? 'post'
  const cols = computeScheduleCols(merged)

  getDb()
    .prepare(
      `UPDATE schedules SET account_id = ?, label = ?, enabled = ?, action = ?, kind = ?, interval_minutes = ?,
       times = ?, jitter_seconds = ?, delete_mode = ?, delete_before_date = ?, delete_count = ?,
       comment_count = ?, comment_interval_seconds = ?, comment_source_url = ?, comment_newest_count = ?,
       comment_view_threshold = ?, comment_source = ?, comment_ai_instruction = ?, comment_max_words = ?,
       comment_prefix = ?, comment_link = ?, interact_duration_minutes = ?,
       interact_comment_target = ?, next_run_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(
      merged.accountId,
      merged.label?.trim() || null,
      merged.enabled === false ? 0 : 1,
      action,
      merged.kind,
      merged.kind === 'interval' ? Number(merged.intervalMinutes) || null : null,
      merged.kind === 'fixed' ? JSON.stringify(times) : null,
      Number(merged.jitterSeconds) || 0,
      cols.deleteMode,
      cols.deleteBeforeDate,
      cols.deleteCount,
      cols.commentCount,
      cols.commentIntervalSeconds,
      cols.commentSourceUrl,
      cols.commentNewestCount,
      cols.commentViewThreshold,
      cols.commentSource,
      cols.commentAiInstruction,
      cols.commentMaxChars,
      cols.commentPrefix,
      cols.commentLink,
      cols.interactDurationMinutes,
      cols.interactCommentTarget,
      nextRunAt,
      now,
      id
    )
  const updated = getSchedule(id)!
  logScheduleEvent(
    merged.accountId,
    true,
    `Đã cập nhật lịch "${describeSchedule(updated)}"`
  )
  return updated
}

export function deleteSchedule(id: string): void {
  const existing = getSchedule(id)
  getDb().prepare('DELETE FROM schedules WHERE id = ?').run(id)
  if (existing) {
    logScheduleEvent(existing.accountId, true, `Đã xóa lịch "${describeSchedule(existing)}"`)
  }
}

// Xoá toàn bộ lịch của 1 tài khoản (dùng khi xoá account — tránh schedule mồ côi
// fire mãi mãi vì không có ON DELETE CASCADE).
export function deleteSchedulesByAccount(accountId: string): void {
  getDb().prepare('DELETE FROM schedules WHERE account_id = ?').run(accountId)
}

// Các lịch đã đến giờ (enabled + next_run_at <= now), chưa chạy (running=0),
// sắp xếp theo giờ sớm nhất.
export function listDueSchedules(now = Date.now()): Schedule[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM schedules WHERE enabled = 1 AND running = 0 AND next_run_at IS NOT NULL AND next_run_at <= ?
       ORDER BY next_run_at ASC`
    )
    .all(now) as ScheduleRow[]
  return rows.map(toSchedule)
}

// Thời điểm (ms) sớm nhất mà một lịch enabled, chưa chạy sẽ tới giờ trong TƯƠNG LAI (> now).
// Dùng để hẹn timer scheduler chính xác (thay vì tick cố định) -> lịch tới giờ được nhặt
// gần như tức thì khi còn slot. Trả null nếu không có lịch tương lai nào.
export function nextDueAt(now = Date.now()): number | null {
  const row = getDb()
    .prepare(
      `SELECT MIN(next_run_at) AS next FROM schedules
       WHERE enabled = 1 AND running = 0 AND next_run_at IS NOT NULL AND next_run_at > ?`
    )
    .get(now) as { next: number | null } | undefined
  return row?.next ?? null
}

// Đặt cờ đang chạy (semaphore hàng đợi scheduler).
export function setScheduleRunning(id: string, running: boolean): void {
  getDb()
    .prepare('UPDATE schedules SET running = ? WHERE id = ?')
    .run(running ? 1 : 0, id)
}

// Reset toàn bộ cờ running về 0 (gọi khi khởi động app — khôi phục sau crash).
export function resetAllRunning(): void {
  getDb().prepare('UPDATE schedules SET running = 0').run()
}

// Cập nhật sau khi chạy xong: last_run_at = now, next_run_at = lần kế.
export function markRun(id: string, now = Date.now()): void {
  const existing = getSchedule(id)
  if (!existing) return
  const nextRunAt = computeNextRun(existing, now)
  getDb()
    .prepare(
      'UPDATE schedules SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?'
    )
    .run(now, nextRunAt, now, id)
}

// Đặt next_run_at = thời điểm cụ thể (vd: midnight hôm sau khi chạm limit comment/ngày).
// Không tính theo interval/fixed times — ghi đè thẳng.
export function setScheduleNextRun(id: string, nextRunAt: number, now = Date.now()): void {
  getDb()
    .prepare('UPDATE schedules SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?')
    .run(now, nextRunAt, now, id)
}

// Khôi phục next_run_at cho các lịch enabled mà next_run_at đang NULL (vd: do migrate).
export function ensureNextRun(now = Date.now()): void {
  const rows = getDb()
    .prepare('SELECT * FROM schedules WHERE enabled = 1 AND next_run_at IS NULL')
    .all() as ScheduleRow[]
  for (const r of rows) {
    const s = toSchedule(r)
    const next = computeNextRun(s, now)
    getDb().prepare('UPDATE schedules SET next_run_at = ? WHERE id = ?').run(next, s.id)
  }
}

function validateInput(input: ScheduleInput): void {
  if (!input.accountId?.trim()) throw new Error('Phải chọn tài khoản')

  // Validate tác vụ
  const action = input.action ?? 'post'
  if (action !== 'post' && action !== 'delete' && action !== 'comment' && action !== 'interact') {
    throw new Error('Loại tác vụ không hợp lệ')
  }
  if (action === 'delete') {
    const mode = input.deleteMode ?? 'newest'
    if (mode !== 'newest' && mode !== 'by_date') {
      throw new Error('Chế độ xoá không hợp lệ')
    }
    const count = input.deleteCount === undefined ? 1 : Number(input.deleteCount)
    if (!Number.isFinite(count) || count < 0) {
      throw new Error('Số bài xoá phải ≥ 0')
    }
    if (mode === 'by_date') {
      const date = input.deleteBeforeDate?.trim()
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('Phải chọn ngày xoá hợp lệ (YYYY-MM-DD)')
      }
    }
  }
  if (action === 'comment') {
    const count = input.commentCount === undefined ? 1 : Number(input.commentCount)
    if (!Number.isFinite(count) || count < 1) {
      throw new Error('Số bài bình luận phải ≥ 1')
    }
    const interval = input.commentIntervalSeconds === undefined ? 60 : Number(input.commentIntervalSeconds)
    if (!Number.isFinite(interval) || interval < 5) {
      throw new Error('Thời gian giữa mỗi bình luận phải ≥ 5 giây')
    }
    // N bài mới nhất xét mỗi lần chạy: phải ≥ 1 (và ≥ số bài bình luận để đủ ứng viên).
    const newest = input.commentNewestCount === undefined ? 20 : Number(input.commentNewestCount)
    if (!Number.isFinite(newest) || newest < 1) {
      throw new Error('Số bài mới nhất xét mỗi lần phải ≥ 1')
    }
    if (newest < count) {
      throw new Error('Số bài mới nhất xét mỗi lần phải ≥ số bài bình luận')
    }
    // Ngưỡng lượt xem: ≥ 0 (0 = không lọc theo views).
    const vt = input.commentViewThreshold === undefined ? 0 : Number(input.commentViewThreshold)
    if (!Number.isFinite(vt) || vt < 0) {
      throw new Error('Ngưỡng lượt xem phải ≥ 0')
    }
    // Nguồn nội dung: 'n8n' bắt buộc link Sheet; 'ai' không cần link nhưng phải cấu hình AI.
    const source: CommentContentSource = input.commentSource === 'ai' ? 'ai' : 'n8n'
    if (source === 'n8n') {
      const url = input.commentSourceUrl?.trim() ?? ''
      if (!url) {
        throw new Error('Phải nhập nguồn bình luận (link Google Sheet) khi dùng nguồn n8n')
      }
      if (!/^https?:\/\//i.test(url)) {
        throw new Error('Nguồn bình luận phải là URL hợp lệ (http/https)')
      }
    } else {
      const chars = input.commentMaxChars === undefined ? 0 : Number(input.commentMaxChars)
      if (!Number.isFinite(chars) || chars < 0 || chars > 280) {
        throw new Error('Số ký tự tối đa phải trong khoảng 0–280')
      }
    }
    // Ràng buộc thời gian: tổng thời gian thực thi + buffer ≤ khoảng cách giữa 2 tác vụ.
    validateCommentTiming(input)
  }
  if (action === 'interact') {
    const dur = input.interactDurationMinutes === undefined ? 15 : Number(input.interactDurationMinutes)
    if (!Number.isFinite(dur) || dur < 1) {
      throw new Error('Thời lượng phiên tương tác phải ≥ 1 phút')
    }
    // Phiên tương tác phải xong trước khi tới lịch kế của chính nó (tránh chồng lấn).
    const gap = minGapSeconds(input)
    if (dur * 60 + INTERACT_BUFFER_SECONDS > gap) {
      throw new Error(
        `Thời lượng phiên (${dur} phút) + buffer ≥ khoảng cách giữa 2 lần chạy (${Math.round(gap / 60)} phút). ` +
        `Giảm thời lượng phiên hoặc tăng khoảng cách lịch.`
      )
    }
    // Số bình luận mục tiêu (nếu user đặt >0) phải KHẢ THI trong thời lượng: mỗi bình luận
    // cần tối thiểu ~INTERACT_MIN_COMMENT_GAP_SECONDS (giãn cách chống spam) + thời gian đọc
    // ngữ cảnh. Nếu đặt quá cao, phiên không thể đạt -> báo lỗi để user chỉnh.
    const target = input.interactCommentTarget === undefined ? 0 : Math.floor(Number(input.interactCommentTarget))
    if (target > 0) {
      const maxFeasible = Math.floor((dur * 60) / INTERACT_MIN_COMMENT_GAP_SECONDS)
      if (target > maxFeasible) {
        throw new Error(
          `Số bình luận mục tiêu (${target}) quá cao cho phiên ${dur} phút. ` +
          `Mỗi bình luận cần ~${INTERACT_MIN_COMMENT_GAP_SECONDS}s (giãn cách chống spam) nên tối đa ~${maxFeasible} bình luận. ` +
          `Giảm số bình luận hoặc tăng thời lượng phiên.`
        )
      }
    }
  }

  // Validate thời gian
  if (input.kind === 'interval') {
    const m = Number(input.intervalMinutes)
    if (!m || m < 1) throw new Error('Số phút phải ≥ 1')
  } else if (input.kind === 'fixed') {
    const times = sanitizeTimes(input.times)
    if (times.length === 0) throw new Error('Phải nhập ít nhất 1 giờ (HH:MM)')
  } else {
    throw new Error('Mô hình lịch không hợp lệ')
  }
}

// Khoảng cách nhỏ nhất (giây) giữa 2 lần chạy liên tiếp theo thiết lập lịch.
// interval: intervalMinutes*60. fixed: khoảng cách nhỏ nhất giữa 2 times liên tiếp;
// nếu chỉ 1 time thì là 24h (86400s).
function minGapSeconds(input: ScheduleInput): number {
  if (input.kind === 'interval') {
    return Math.max(1, (Number(input.intervalMinutes) || 0) * 60)
  }
  // fixed
  const times = sanitizeTimes(input.times)
  if (times.length === 0) return 86400
  if (times.length === 1) return 86400
  const minutes = times
    .map((t) => {
      const [h, m] = t.split(':').map(Number)
      return h * 60 + m
    })
    .sort((a, b) => a - b)
  let minGap = (minutes[0] + 1440 - minutes[minutes.length - 1]) % 1440
  for (let i = 1; i < minutes.length; i++) {
    minGap = Math.min(minGap, minutes[i] - minutes[i - 1])
  }
  return Math.max(1, minGap * 60)
}

// Ràng buộc thời gian cho tác vụ bình luận: tổng thời gian thực thi (delay giữa các
// comment) + buffer phải ≤ khoảng cách giữa 2 tác vụ. Tránh tác vụ chưa xong mà lịch
// đã đến giờ chạy kế -> trùng/chen. Buffer 30s chừa cho mở profile, fetch webhook, cuộn.
const COMMENT_BUFFER_SECONDS = 30
// Buffer cho phiên tương tác: chừa thời gian mở profile + đóng profile sau khi hết thời lượng.
const INTERACT_BUFFER_SECONDS = 30
// Giãn cách tối thiểu giữa 2 bình luận trong phiên tương tác (chống spam). PHẢI khớp với
// MIN_COMMENT_GAP_MS trong InteractSession.ts để validate "số bình luận mục tiêu" đúng thực tế.
export const INTERACT_MIN_COMMENT_GAP_SECONDS = 90
export function validateCommentTiming(input: ScheduleInput): void {
  if (input.action !== 'comment') return
  const count = Math.max(1, Number(input.commentCount) || 1)
  const interval = Math.max(5, Number(input.commentIntervalSeconds) || 0)
  // Tổng thời gian thực thi ≈ (count-1)*interval (không tính comment đầu tiên).
  const execTime = count > 1 ? (count - 1) * interval : 0
  const gap = minGapSeconds(input)
  if (execTime + COMMENT_BUFFER_SECONDS > gap) {
    throw new Error(
      `Tổng thời gian bình luận (${execTime}s) + buffer ${COMMENT_BUFFER_SECONDS}s > khoảng cách giữa 2 tác vụ (${gap}s). ` +
      `Giảm số bài, giảm thời gian giữa mỗi bình luận, hoặc tăng khoảng cách lịch.`
    )
  }
}

// Trả về thông tin ràng buộc thời gian cho UI hiển thị cảnh báo realtime (không throw).
export function commentTimingInfo(input: ScheduleInput): {
  execTime: number
  buffer: number
  gap: number
  ok: boolean
} | null {
  if (input.action !== 'comment') return null
  const count = Math.max(1, Number(input.commentCount) || 1)
  const interval = Math.max(5, Number(input.commentIntervalSeconds) || 0)
  const execTime = count > 1 ? (count - 1) * interval : 0
  const gap = minGapSeconds(input)
  return {
    execTime,
    buffer: COMMENT_BUFFER_SECONDS,
    gap,
    ok: execTime + COMMENT_BUFFER_SECONDS <= gap
  }
}

// Build object Schedule (thiếu id/timestamps) đủ dùng cho computeNextRun. Dùng chung
// computeScheduleCols để không lệch logic chuẩn hoá cột với create/update.
function buildScheduleObject(input: ScheduleInput): Schedule {
  const action = input.action ?? 'post'
  const cols = computeScheduleCols(input)
  return {
    id: '',
    accountId: input.accountId,
    label: input.label ?? null,
    enabled: input.enabled !== false,
    action,
    kind: input.kind,
    intervalMinutes: input.kind === 'interval' ? Number(input.intervalMinutes) || null : null,
    times: sanitizeTimes(input.times),
    jitterSeconds: Number(input.jitterSeconds) || 0,
    deleteMode: cols.deleteMode as DeleteMode | null,
    deleteBeforeDate: cols.deleteBeforeDate,
    deleteCount: cols.deleteCount,
    commentCount: cols.commentCount,
    commentIntervalSeconds: cols.commentIntervalSeconds,
    commentSourceUrl: cols.commentSourceUrl,
    commentNewestCount: cols.commentNewestCount,
    commentViewThreshold: cols.commentViewThreshold,
    commentSource: cols.commentSource,
    commentAiInstruction: cols.commentAiInstruction,
    commentMaxChars: cols.commentMaxChars,
    commentPrefix: cols.commentPrefix,
    commentLink: cols.commentLink,
    interactDurationMinutes: cols.interactDurationMinutes,
    interactCommentTarget: cols.interactCommentTarget,
    lastRunAt: null,
    nextRunAt: null,
    running: false,
    createdAt: 0,
    updatedAt: 0
  }
}

// Ngẫu nhiên ±jitter giây (trả về ms, có thể âm).
function jitterMs(jitterSeconds: number): number {
  if (!jitterSeconds || jitterSeconds <= 0) return 0
  return Math.round((Math.random() * 2 - 1) * jitterSeconds * 1000)
}

// Tính lần chạy kế từ một mốc. interval: mốc + interval ± jitter. fixed: giờ cố định tiếp
// theo trong 24h sau mốc (có thể là hôm nay hoặc hôm sau) ± jitter.
export function computeNextRun(schedule: Pick<Schedule, 'kind' | 'intervalMinutes' | 'times' | 'jitterSeconds'>, fromMs: number): number {
  if (schedule.kind === 'interval') {
    const minutes = Number(schedule.intervalMinutes) || 0
    if (minutes <= 0) return fromMs
    return fromMs + minutes * 60_000 + jitterMs(schedule.jitterSeconds)
  }
  // fixed
  const times = schedule.times ?? []
  if (times.length === 0) return fromMs
  const base = new Date(fromMs)
  const todayBase = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  // Chuyển times -> phút từ nửa đêm.
  const minutesInDay = times
    .map((t) => {
      const [h, m] = t.split(':').map(Number)
      return h * 60 + m
    })
    .sort((a, b) => a - b)
  const fromMinutes = base.getHours() * 60 + base.getMinutes()
  // Tìm giờ đầu tiên > now (cộng 1 phút để tránh lặp liên tục nếu chạy đúng giờ).
  const next = minutesInDay.find((mm) => mm > fromMinutes)
  let targetDayOffset = 0
  let targetMinutes: number
  if (next !== undefined) {
    targetMinutes = next
  } else {
    targetMinutes = minutesInDay[0]
    targetDayOffset = 1 // hôm sau
  }
  const target = new Date(todayBase.getTime() + targetDayOffset * 86_400_000 + targetMinutes * 60_000)
  return target.getTime() + jitterMs(schedule.jitterSeconds)
}

// Mô tả lịch dạng text cho log/UI. Bao gồm cả tác vụ (đăng/xoá/bình luận).
export function describeSchedule(s: Pick<Schedule, 'kind' | 'intervalMinutes' | 'times' | 'jitterSeconds'> & Partial<Pick<Schedule, 'action' | 'deleteMode' | 'deleteBeforeDate' | 'deleteCount' | 'commentCount' | 'commentViewThreshold' | 'commentSource' | 'interactDurationMinutes' | 'interactCommentTarget'>>): string {
  const timing =
    s.kind === 'interval'
      ? `Mỗi ${s.intervalMinutes} phút${s.jitterSeconds ? ` ±${s.jitterSeconds}s` : ''}`
      : `${(s.times ?? []).join(', ')}${s.jitterSeconds ? ` ±${s.jitterSeconds}s` : ''}`

  const action = s.action ?? 'post'
  if (action === 'delete') {
    const countText = (s.deleteCount ?? 1) === 0 ? 'tất cả bài khớp' : `${s.deleteCount ?? 1} bài`
    const modeText = s.deleteMode === 'by_date' ? `trước/đến ${s.deleteBeforeDate ?? '?'}` : 'mới nhất'
    return `Xoá ${countText} (${modeText}) · ${timing}`
  }
  if (action === 'comment') {
    const srcText = s.commentSource === 'ai' ? 'AI' : 'n8n'
    const vt = s.commentViewThreshold ?? 0
    const vtText = vt > 0 ? ` · views > ${vt.toLocaleString('en-US')}` : ''
    return `Bình luận ${s.commentCount ?? 1} bài (${srcText})${vtText} · ${timing}`
  }
  if (action === 'interact') {
    const target = s.interactCommentTarget ?? 0
    const cmtText = target > 0 ? `${target} bình luận` : 'bình luận tự động'
    return `Tương tác ${s.interactDurationMinutes ?? 15} phút · ${cmtText} · ${timing}`
  }

  return timing
}

function midnightOf(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// Tính thời điểm 03:00 hôm nay.
function todayFetchTime(): number {
  const now = new Date()
  const today3am = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 3, 0, 0, 0)
  return today3am.getTime()
}

// Build lịch ảo Analytics (tác vụ hệ thống, không lưu DB).
function buildAnalyticsSchedule(): Schedule {
  const now = Date.now()
  const fetch3am = todayFetchTime()
  const last = getLastFetchDay()
  const enabled = getAllSettings().analyticsAutoFetch
  const running = isAnalyticsRunning()

  // lastRunAt: lần fetch cuối (nếu có).
  const lastRunAt = last ?? null

  // nextRunAt: 03:00 hôm nay nếu chưa qua, hoặc 03:00 ngày mai nếu đã qua/đã fetch.
  let nextRunAt: number
  if (now < fetch3am && (last === null || midnightOf(last) < midnightOf(now))) {
    // Chưa qua 03:00 hôm nay và chưa fetch hôm nay -> next = 03:00 hôm nay
    nextRunAt = fetch3am
  } else if (last !== null && midnightOf(last) >= midnightOf(now)) {
    // Đã fetch hôm nay -> next = 03:00 ngày mai
    nextRunAt = fetch3am + 86_400_000
  } else {
    // Đã qua 03:00 hôm nay nhưng chưa fetch -> next = 03:00 hôm nay (sẽ chạy sớm)
    nextRunAt = fetch3am
  }

  return {
    id: '__analytics__',
    accountId: '__system__',
    label: 'Tự động fetch thống kê X',
    enabled,
    action: 'post', // dùng 'post' để không trigger logic delete/comment trong UI
    kind: 'fixed',
    intervalMinutes: null,
    times: ['03:00'],
    jitterSeconds: 0,
    deleteMode: null,
    deleteBeforeDate: null,
    deleteCount: 0,
    commentCount: 0,
    commentIntervalSeconds: 0,
    commentSourceUrl: null,
    commentNewestCount: 20,
    commentViewThreshold: 0,
    commentSource: 'n8n',
    commentAiInstruction: null,
    commentMaxChars: 0,
    commentPrefix: null,
    commentLink: null,
    interactDurationMinutes: 15,
    interactCommentTarget: 0,
    lastRunAt,
    nextRunAt,
    running,
    createdAt: 0,
    updatedAt: 0
  }
}

