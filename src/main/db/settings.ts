import { getDb } from './index'
import type { AppSettings } from '../../shared/types'

const DEFAULTS: AppSettings = {
  webhookUrl: '',
  webhookSecret: '',
  downloadsDir: '',
  concurrency: 3,
  logRetentionDays: 30,
  analyticsAutoFetch: true
}

export function getAllSettings(): AppSettings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]
  const map = new Map(rows.map((r) => [r.key, r.value]))
  return {
    webhookUrl: map.get('webhookUrl') ?? DEFAULTS.webhookUrl,
    webhookSecret: map.get('webhookSecret') ?? DEFAULTS.webhookSecret,
    downloadsDir: map.get('downloadsDir') ?? DEFAULTS.downloadsDir,
    concurrency: map.has('concurrency') ? Number(map.get('concurrency')) : DEFAULTS.concurrency,
    logRetentionDays: map.has('logRetentionDays')
      ? Number(map.get('logRetentionDays'))
      : DEFAULTS.logRetentionDays,
    analyticsAutoFetch: map.has('analyticsAutoFetch')
      ? map.get('analyticsAutoFetch') === 'true'
      : DEFAULTS.analyticsAutoFetch
  }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const stmt = getDb().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  const tx = getDb().transaction((entries: [string, string][]) => {
    for (const [k, v] of entries) stmt.run(k, v)
  })
  const entries = Object.entries(patch)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => [k, String(v)] as [string, string])
  tx(entries)
  return getAllSettings()
}
