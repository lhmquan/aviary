import { randomUUID } from 'crypto'
import { app } from 'electron'
import { join } from 'path'
import { getDb } from './index'
import type { Account, AccountInput, AccountStatus } from '../../shared/types'
import { PROXY_LOCAL } from '../../shared/types'

interface AccountRow {
  id: string
  label: string
  handle: string | null
  proxy_id: string
  profile_dir: string
  status: string
  asset_url: string | null
  headless: number
  hashtag: string | null
  caption_prefix: string | null
  ai_comment_tone: string | null
  ai_comment_lang: string | null
  ai_comment_format: string | null
  followers: number | null
  following: number | null
  statuses: number | null
  avatar_url: string | null
  created_at: number
  updated_at: number
}

function toAccount(r: AccountRow): Account {
  return {
    id: r.id,
    label: r.label,
    handle: r.handle,
    proxyId: r.proxy_id || PROXY_LOCAL,
    profileDir: r.profile_dir,
    status: r.status as AccountStatus,
    assetUrl: r.asset_url,
    headless: !!r.headless,
    hashtag: r.hashtag,
    captionPrefix: r.caption_prefix ?? null,
    aiCommentTone: r.ai_comment_tone ?? 'random',
    aiCommentLang: r.ai_comment_lang ?? 'en',
    aiCommentFormat: r.ai_comment_format ?? 'random',
    followers: r.followers ?? null,
    following: r.following ?? null,
    statusesCount: r.statuses ?? null,
    avatarUrl: r.avatar_url ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export function listAccounts(): Account[] {
  const rows = getDb()
    .prepare('SELECT * FROM accounts ORDER BY created_at DESC')
    .all() as AccountRow[]
  return rows.map(toAccount)
}

export function getAccount(id: string): Account | null {
  const row = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id) as
    | AccountRow
    | undefined
  return row ? toAccount(row) : null
}

export function createAccount(input: AccountInput): Account {
  const id = randomUUID()
  const now = Date.now()
  const profileDir = join(app.getPath('userData'), 'profiles', id)
  getDb()
    .prepare(
      // Các cột identity legacy không còn được app sử dụng.
      `INSERT INTO accounts (id, label, handle, proxy_id, profile_dir, status, asset_url, headless, hashtag, caption_prefix, ai_comment_tone, ai_comment_lang, ai_comment_format, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.label,
      input.handle ?? null,
      normalizeProxyId(input.proxyId),
      profileDir,
      input.assetUrl ?? null,
      input.headless ? 1 : 0,
      normalizeHashtag(input.hashtag),
      input.captionPrefix ?? null,
      input.aiCommentTone ?? 'random',
      input.aiCommentLang ?? 'en',
      input.aiCommentFormat ?? 'random',
      now,
      now
    )
  return getAccount(id)!
}

export function updateAccount(id: string, input: Partial<AccountInput>): Account {
  const existing = getAccount(id)
  if (!existing) throw new Error(`Account không tồn tại: ${id}`)
  const next = {
    label: input.label ?? existing.label,
    handle: input.handle !== undefined ? input.handle : existing.handle,
    proxyId: input.proxyId !== undefined ? input.proxyId : existing.proxyId,
    assetUrl: input.assetUrl !== undefined ? input.assetUrl : existing.assetUrl,
    headless: input.headless !== undefined ? input.headless : existing.headless,
    hashtag: input.hashtag !== undefined ? input.hashtag : existing.hashtag,
    captionPrefix: input.captionPrefix !== undefined ? input.captionPrefix : existing.captionPrefix,
    aiCommentTone: input.aiCommentTone !== undefined ? input.aiCommentTone : existing.aiCommentTone,
    aiCommentLang: input.aiCommentLang !== undefined ? input.aiCommentLang : existing.aiCommentLang,
    aiCommentFormat:
      input.aiCommentFormat !== undefined ? input.aiCommentFormat : existing.aiCommentFormat,
  }
  getDb()
    .prepare(
      'UPDATE accounts SET label = ?, handle = ?, proxy_id = ?, asset_url = ?, headless = ?, hashtag = ?, caption_prefix = ?, ai_comment_tone = ?, ai_comment_lang = ?, ai_comment_format = ?, updated_at = ? WHERE id = ?'
    )
    .run(
      next.label,
      next.handle,
      normalizeProxyId(next.proxyId),
      next.assetUrl,
      next.headless ? 1 : 0,
      normalizeHashtag(next.hashtag),
      next.captionPrefix ?? null,
      next.aiCommentTone,
      next.aiCommentLang,
      next.aiCommentFormat,
      Date.now(),
      id
    )
  return getAccount(id)!
}

// Cập nhật thống kê hồ sơ X (cache sau khi fetch). Không đụng tới các cột khác.
export function updateAccountStats(
  id: string,
  stats: { followers: number | null; following: number | null; statuses: number | null; avatarUrl?: string | null }
): void {
  if (stats.avatarUrl !== undefined) {
    getDb()
      .prepare(
        'UPDATE accounts SET followers = ?, following = ?, statuses = ?, avatar_url = ?, updated_at = ? WHERE id = ?'
      )
      .run(stats.followers, stats.following, stats.statuses, stats.avatarUrl, Date.now(), id)
  } else {
    getDb()
      .prepare(
        'UPDATE accounts SET followers = ?, following = ?, statuses = ?, updated_at = ? WHERE id = ?'
      )
      .run(stats.followers, stats.following, stats.statuses, Date.now(), id)
  }
}

export function getAccountFingerprintObservation(id: string): string | null {
  const row = getDb()
    .prepare('SELECT fingerprint_observation FROM accounts WHERE id = ?')
    .get(id) as { fingerprint_observation: string | null } | undefined
  return row?.fingerprint_observation ?? null
}

export function updateAccountFingerprintObservation(id: string, observation: string): void {
  getDb()
    .prepare('UPDATE accounts SET fingerprint_observation = ? WHERE id = ?')
    .run(observation, id)
}

export function listAccountFingerprintObservations(): Array<{
  accountId: string
  observation: string
}> {
  const rows = getDb()
    .prepare(
      `SELECT id, fingerprint_observation
       FROM accounts
       WHERE fingerprint_observation IS NOT NULL`
    )
    .all() as Array<{
      id: string
      fingerprint_observation: string
    }>
  return rows.map((row) => ({
    accountId: row.id,
    observation: row.fingerprint_observation
  }))
}

// Chuẩn hoá proxyId: rỗng/null -> '__local' (IP máy, mặc định).
export function normalizeProxyId(raw: string | null | undefined): string {
  const v = (raw ?? '').trim()
  return v || PROXY_LOCAL
}

// Chuẩn hoá hashtag user nhập: tách theo khoảng trắng/dòng/phẩy, bỏ ký tự lạ, thêm '#'
// nếu thiếu, gộp lại thành 1 chuỗi cách nhau bởi khoảng trắng. VD "f1, #việt " => "#f1 #việt".
export function normalizeHashtag(raw: string | null | undefined): string | null {
  if (!raw) return null
  const tokens = raw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
  if (tokens.length === 0) return null
  const cleaned = tokens.map((t) => (t.startsWith('#') ? t : `#${t}`))
  return cleaned.join(' ')
}

// Giải mã escape sequence trong tiền tố caption: \n -> newline, \t -> tab, \\ -> \.
// Giữ nguyên dấu cách đầu/cuối (KHÔNG trim) để user chủ động định dạng khoảng cách
// giữa prefix và caption khi ghép. Trả về null nếu rỗng/sau khi decode trắng.
export function decodeCaptionPrefix(raw: string | null | undefined): string | null {
  if (!raw) return null
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch !== '\\' || i === raw.length - 1) {
      out += ch
      continue
    }
    const next = raw[++i]
    switch (next) {
      case 'n':
        out += '\n'
        break
      case 't':
        out += '\t'
        break
      case 'r':
        out += '\r'
        break
      case '\\':
        out += '\\'
        break
      default:
        out += '\\' + next
    }
  }
  return out.length > 0 ? out : null
}

export function setAccountStatus(id: string, status: AccountStatus): void {
  getDb()
    .prepare('UPDATE accounts SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, Date.now(), id)
}

export function deleteAccount(id: string): void {
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id)
}
