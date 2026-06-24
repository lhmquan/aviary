import { fetchXProfile, downloadAvatarAsDataUrl } from '../x/FetchProfile'
import { getAccount, updateAccountStats } from '../db/accounts'
import { resolveProxyString } from '../db/proxies'
import { upsertDailyStats, setLastFetchDay } from '../db/analytics'
import { listAccounts } from '../db/accounts'
import { emitProgress } from '../scheduler/runner'
import type { AnalyticsFetchResult } from '../../shared/types'

// Fetch thống kê X (followers/following/posts/name) cho toàn bộ tài khoản có handle.
// Chạy với concurrency 3 (không dùng slot của post scheduler — đây là job nhẹ, riêng).
// Mỗi fetch thành công: upsert vào account_stats_daily + update accounts cache.
// Trả về kết quả tổng hợp (success/failed/skipped + danh sách lỗi).

const CONCURRENCY = 3

export async function fetchAllAccountsStats(): Promise<AnalyticsFetchResult> {
  const accounts = listAccounts().filter((a) => a.handle)
  const total = accounts.length
  const errors: AnalyticsFetchResult['errors'] = []
  let success = 0
  let failed = 0
  let skipped = 0
  let done = 0

  emitProgress({
    stage: 'analytics',
    message: `Bắt đầu fetch analytics cho ${total} tài khoản…`,
    busy: true
  })

  // Semaphore đơn giản: chạy tối đa CONCURRENCY song song.
  let running = 0
  let cursor = 0

  await new Promise<void>((resolveAll) => {
    const startNext = (): void => {
      while (running < CONCURRENCY && cursor < accounts.length) {
        const idx = cursor++
        const acc = accounts[idx]
        running++
        void fetchAccountStats(acc.id)
          .then((r) => {
            if (r.skipped) skipped++
            else if (r.ok) success++
            else {
              failed++
              errors.push({
                accountId: acc.id,
                accountLabel: acc.label,
                error: r.error ?? 'Lỗi không xác định'
              })
            }
          })
          .finally(() => {
            running--
            done++
            emitProgress({
              stage: 'analytics',
              message: `Analytics ${done}/${total} · OK ${success} · Lỗi ${failed} · Bỏ qua ${skipped}`,
              busy: true
            })
            if (done >= total) resolveAll()
            else startNext()
          })
      }
    }
    if (total === 0) resolveAll()
    else startNext()
  })

  // Lưu ngày fetch cuối (nửa đêm hôm nay).
  setLastFetchDay(Date.now())

  emitProgress({
    stage: 'analytics',
    message: `Analytics xong: ${success}/${total} thành công${failed > 0 ? `, ${failed} lỗi` : ''}${skipped > 0 ? `, ${skipped} bỏ qua` : ''}`,
    busy: false
  })

  return { total, success, failed, skipped, errors }
}

// Kết quả fetch 1 tài khoản.
export interface AccountFetchResult {
  ok: boolean
  error?: string
  skipped?: boolean
}

// Fetch 1 tài khoản. Dùng cho cả fetchAll (concurrency) và nút fetch riêng trong UI.
export async function fetchAccountStats(accountId: string): Promise<AccountFetchResult> {
  const acc = getAccount(accountId)
  if (!acc || !acc.handle) return { ok: false, skipped: true, error: 'Tài khoản không có username X' }

  emitProgress({
    accountId,
    accountLabel: acc.label,
    stage: 'analytics',
    message: `Đang fetch analytics cho ${acc.label}…`,
    busy: true
  })

  const proxyString = resolveProxyString(acc.proxyId)
  const username = acc.handle.replace(/^@+/, '')

  try {
    const info = await fetchXProfile(username, proxyString)
    if (info.error) {
      emitProgress({
        accountId,
        accountLabel: acc.label,
        stage: 'analytics',
        message: `Fetch ${acc.label} lỗi: ${info.error}`,
        busy: false
      })
      return { ok: false, error: info.error }
    }

    // Tải avatar nếu chưa có cache (skip nếu đã có data: URL hợp lệ).
    if (info.avatarUrl) {
      const hasCachedAvatar = acc.avatarUrl?.startsWith('data:')
      if (!hasCachedAvatar) {
        const dataUrl = await downloadAvatarAsDataUrl(info.avatarUrl, proxyString)
        if (dataUrl) info.avatarUrl = dataUrl
        else info.avatarUrl = acc.avatarUrl // giữ avatar cũ nếu download fail
      } else {
        info.avatarUrl = acc.avatarUrl
      }
    }

    const now = Date.now()
    // Update cache trong accounts (followers/following/statuses/avatar).
    updateAccountStats(accountId, {
      followers: info.followers,
      following: info.following,
      statuses: info.posts,
      avatarUrl: info.avatarUrl ?? null
    })
    // Upsert vào analytics daily.
    upsertDailyStats(accountId, now, {
      followers: info.followers,
      following: info.following,
      statusesCount: info.posts,
      name: info.name
    })
    emitProgress({
      accountId,
      accountLabel: acc.label,
      stage: 'analytics',
      message: `Fetch ${acc.label} OK — ${info.followers ?? '?'} followers, ${info.posts ?? '?'} bài`,
      busy: false
    })
    return { ok: true }
  } catch (e) {
    emitProgress({
      accountId,
      accountLabel: acc.label,
      stage: 'analytics',
      message: `Fetch ${acc.label} lỗi: ${(e as Error).message}`,
      busy: false
    })
    return { ok: false, error: (e as Error).message }
  }
}
