import { app } from 'electron'
import { join } from 'path'
import { rmSync } from 'fs'
import { getDb } from './index'
import { getAllSettings } from './settings'
import type { LogEntry, LogListParams, LogListResult } from '../../shared/types'

interface LogRow {
  id: number
  account_id: string
  account_label: string
  ts: number
  ok: number
  caption: string
  url: string | null
  error: string | null
  step: string | null
  screenshot: string | null
  event_type: string | null
  urls_json: string | null
}

function toLog(r: LogRow): LogEntry {
  let urls: string[] | undefined
  if (r.urls_json) {
    try {
      const parsed = JSON.parse(r.urls_json)
      if (Array.isArray(parsed)) urls = parsed.filter((u): u is string => typeof u === 'string')
    } catch {
      /* JSON hỏng → bỏ qua */
    }
  }
  return {
    id: r.id,
    accountId: r.account_id,
    accountLabel: r.account_label,
    ts: r.ts,
    ok: !!r.ok,
    caption: r.caption,
    url: r.url,
    error: r.error,
    step: r.step,
    screenshot: r.screenshot,
    eventType: r.event_type,
    urls
  }
}

export function insertLog(entry: Omit<LogEntry, 'id'>): void {
  getDb()
    .prepare(
      `INSERT INTO logs (account_id, account_label, ts, ok, caption, url, error, step, screenshot, event_type, urls_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entry.accountId,
      entry.accountLabel,
      entry.ts,
      entry.ok ? 1 : 0,
      entry.caption,
      entry.url,
      entry.error,
      entry.step,
      entry.screenshot,
      entry.eventType ?? null,
      entry.urls && entry.urls.length > 0 ? JSON.stringify(entry.urls) : null
    )
}

export function listLogs(params?: LogListParams): LogListResult {
  const page = Math.max(1, params?.page ?? 1)
  const pageSize = Math.max(1, Math.min(200, params?.pageSize ?? 50))
  const offset = (page - 1) * pageSize
  const eventType = params?.eventType ?? null

  const db = getDb()

  // Xây dựng WHERE clause động theo eventType filter.
  let where = ''
  const args: any[] = []
  if (eventType === 'post') {
    // Đăng: bao gồm cả log cũ (event_type NULL) và log có event_type = 'post'.
    where = 'WHERE (event_type IS NULL OR event_type = ?)'
    args.push('post')
  } else if (eventType) {
    where = 'WHERE event_type = ?'
    args.push(eventType)
  }
  // eventType null/undefined: lấy tất cả (không có WHERE)

  const totalSql = `SELECT COUNT(*) as c FROM logs ${where}`
  const total = (db.prepare(totalSql).get(...args) as { c: number }).c

  const rowsSql = `SELECT * FROM logs ${where} ORDER BY ts DESC LIMIT ? OFFSET ?`
  const rows = db.prepare(rowsSql).all(...args, pageSize, offset) as LogRow[]
  return { rows: rows.map(toLog), total }
}

// Xoá log cũ hơn retentionDays; xoá luôn file screenshot trên đĩa.
export function pruneLogs(): void {
  const { logRetentionDays } = getAllSettings()
  if (!logRetentionDays || logRetentionDays <= 0) return
  const cutoff = Date.now() - logRetentionDays * 24 * 60 * 60 * 1000

  const old = getDb()
    .prepare('SELECT screenshot FROM logs WHERE ts < ? AND screenshot IS NOT NULL')
    .all(cutoff) as { screenshot: string }[]
  for (const r of old) {
    if (r.screenshot) {
      try {
        rmSync(r.screenshot, { force: true })
      } catch {
        /* ignore */
      }
    }
  }

  getDb().prepare('DELETE FROM logs WHERE ts < ?').run(cutoff)
}

export function clearLogs(): void {
  const shots = getDb().prepare('SELECT screenshot FROM logs WHERE screenshot IS NOT NULL').all() as {
    screenshot: string
  }[]
  for (const r of shots) {
    if (r.screenshot) {
      try {
        rmSync(r.screenshot, { force: true })
      } catch {
        /* ignore */
      }
    }
  }
  getDb().prepare('DELETE FROM logs').run()
}

// Xoá toàn bộ log + screenshot của 1 tài khoản (dùng khi xoá account).
export function deleteLogsByAccount(accountId: string): void {
  const shots = getDb()
    .prepare('SELECT screenshot FROM logs WHERE account_id = ? AND screenshot IS NOT NULL')
    .all(accountId) as { screenshot: string }[]
  for (const r of shots) {
    if (r.screenshot) {
      try {
        rmSync(r.screenshot, { force: true })
      } catch {
        /* ignore */
      }
    }
  }
  getDb().prepare('DELETE FROM logs WHERE account_id = ?').run(accountId)
}