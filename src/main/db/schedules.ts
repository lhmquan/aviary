import { randomUUID } from 'crypto'
import { getDb } from './index'
import { insertLog } from './logs'
import { getAccount } from './accounts'
import type { Schedule, ScheduleInput, ScheduleKind, ScheduleAction, DeleteMode } from '../../shared/types'

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
  return rows.map(toSchedule)
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

export function createSchedule(input: ScheduleInput): Schedule {
  validateInput(input)
  const id = randomUUID()
  const now = Date.now()
  const times = sanitizeTimes(input.times)
  const schedule = buildScheduleObject({ ...input, times })
  const nextRunAt = computeNextRun(schedule, now)

  // Tính giá trị cột delete
  const action = input.action ?? 'post'
  const deleteMode = action === 'delete' ? (input.deleteMode ?? 'newest') : null
  const deleteBeforeDate = action === 'delete' && deleteMode === 'by_date' ? (input.deleteBeforeDate ?? null) : null
  const deleteCount = action === 'delete'
    ? Math.max(0, input.deleteCount === undefined ? 1 : Number(input.deleteCount))
    : 1

  getDb()
    .prepare(
      `INSERT INTO schedules (id, account_id, label, enabled, action, kind, interval_minutes, times, jitter_seconds,
        delete_mode, delete_before_date, delete_count, last_run_at, next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
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
      deleteMode,
      deleteBeforeDate,
      deleteCount,
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
    ...input
  }
  validateInput(merged)
  const times = sanitizeTimes(merged.times)
  const schedule = buildScheduleObject({ ...merged, times })
  const nextRunAt = computeNextRun(schedule, Date.now())
  const now = Date.now()

  // Tính giá trị cột delete
  const action = merged.action ?? 'post'
  const deleteMode = action === 'delete' ? (merged.deleteMode ?? 'newest') : null
  const deleteBeforeDate = action === 'delete' && deleteMode === 'by_date' ? (merged.deleteBeforeDate ?? null) : null
  const deleteCount = action === 'delete'
    ? Math.max(0, merged.deleteCount === undefined ? 1 : Number(merged.deleteCount))
    : 1

  getDb()
    .prepare(
      `UPDATE schedules SET account_id = ?, label = ?, enabled = ?, action = ?, kind = ?, interval_minutes = ?,
       times = ?, jitter_seconds = ?, delete_mode = ?, delete_before_date = ?, delete_count = ?,
       next_run_at = ?, updated_at = ? WHERE id = ?`
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
      deleteMode,
      deleteBeforeDate,
      deleteCount,
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
  if (action !== 'post' && action !== 'delete') {
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

// Build object Schedule (thiếu id/timestamps) đủ dùng cho computeNextRun.
function buildScheduleObject(input: ScheduleInput): Schedule {
  const action = input.action ?? 'post'
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
    deleteMode: action === 'delete' ? (input.deleteMode ?? 'newest') : null,
    deleteBeforeDate: action === 'delete' && input.deleteMode === 'by_date' ? (input.deleteBeforeDate ?? null) : null,
    deleteCount: action === 'delete'
      ? Math.max(0, input.deleteCount === undefined ? 1 : Number(input.deleteCount))
      : 1,
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

// Mô tả lịch dạng text cho log/UI. Bao gồm cả tác vụ (đăng/xoá).
export function describeSchedule(s: Pick<Schedule, 'kind' | 'intervalMinutes' | 'times' | 'jitterSeconds'> & Partial<Pick<Schedule, 'action' | 'deleteMode' | 'deleteBeforeDate' | 'deleteCount'>>): string {
  const timing =
    s.kind === 'interval'
      ? `Mỗi ${s.intervalMinutes} phút${s.jitterSeconds ? ` ±${s.jitterSeconds}s` : ''}`
      : `${(s.times ?? []).join(', ')}${s.jitterSeconds ? ` ±${s.jitterSeconds}s` : ''}`

  if ((s.action ?? 'post') === 'delete') {
    const countText = (s.deleteCount ?? 1) === 0 ? 'tất cả bài khớp' : `${s.deleteCount ?? 1} bài`
    const modeText = s.deleteMode === 'by_date' ? `trước/đến ${s.deleteBeforeDate ?? '?'}` : 'mới nhất'
    return `Xoá ${countText} (${modeText}) · ${timing}`
  }

  return timing
}
