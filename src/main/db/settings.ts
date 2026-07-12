import { getDb } from './index'
import type { AppSettings } from '../../shared/types'

const DEFAULTS: AppSettings = {
  webhookUrl: '',
  webhookSecret: '',
  downloadsDir: '',
  concurrency: 3,
  logRetentionDays: 30,
  analyticsRetentionDays: 90,
  analyticsAutoFetch: true,
  // Giới hạn số comment tối đa/ngày cho 1 tài khoản (chạm -> tạm dừng, mai chạy tiếp).
  commentDailyLimit: 30,
  // AI sinh bình luận (OpenAI-compatible). Trống = chưa cấu hình -> phiên tương tác bỏ qua comment.
  aiBaseUrl: '',
  aiApiKey: '',
  aiModel: '',
  // Độ dài bình luận tối đa (ký tự). Tone/ngôn ngữ/định dạng đã chuyển per-account.
  aiCommentMaxLen: 200,
  // Mặc định TẮT: giữ nguyên hành vi cũ (hiện đầy đủ ảnh/video). User bật để tiết kiệm proxy.
  blockMedia: false
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
    analyticsRetentionDays: map.has('analyticsRetentionDays')
      ? Number(map.get('analyticsRetentionDays'))
      : DEFAULTS.analyticsRetentionDays,
    analyticsAutoFetch: map.has('analyticsAutoFetch')
      ? map.get('analyticsAutoFetch') === 'true'
      : DEFAULTS.analyticsAutoFetch,
    commentDailyLimit: map.has('commentDailyLimit')
      ? Number(map.get('commentDailyLimit'))
      : DEFAULTS.commentDailyLimit,
    aiBaseUrl: map.get('aiBaseUrl') ?? DEFAULTS.aiBaseUrl,
    aiApiKey: map.get('aiApiKey') ?? DEFAULTS.aiApiKey,
    aiModel: map.get('aiModel') ?? DEFAULTS.aiModel,
    aiCommentMaxLen: map.has('aiCommentMaxLen')
      ? Number(map.get('aiCommentMaxLen'))
      : DEFAULTS.aiCommentMaxLen,
    blockMedia: map.has('blockMedia') ? map.get('blockMedia') === 'true' : DEFAULTS.blockMedia
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
