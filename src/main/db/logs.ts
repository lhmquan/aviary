import { app } from 'electron'
import { join } from 'path'
import { rmSync } from 'fs'
import { getDb } from './index'
import { getAllSettings } from './settings'
import type { LogEntry } from '../../shared/types'

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
}

function toLog(r: LogRow): LogEntry {
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
    eventType: r.event_type
  }
}

export function insertLog(entry: Omit<LogEntry, 'id'>): void {
  getDb()
    .prepare(
      `INSERT INTO logs (account_id, account_label, ts, ok, caption, url, error, step, screenshot, event_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      entry.eventType ?? null
    )
}

export function listLogs(): LogEntry[] {
  const rows = getDb()
    .prepare('SELECT * FROM logs ORDER BY ts DESC LIMIT 500')
    .all() as LogRow[]
  return rows.map(toLog)
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