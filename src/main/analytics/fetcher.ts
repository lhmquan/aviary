import { fetchXProfile, downloadAvatarAsDataUrl } from '../x/FetchProfile'
import { getAccount, updateAccountStats, listAccounts } from '../db/accounts'
import { resolveProxyString } from '../db/proxies'
import { upsertDailyStats } from '../db/analytics'
import { emitProgress } from '../scheduler/runner'
import type { AnalyticsFetchResult, AnalyticsFetchRecord } from '../../shared/types'

// Fetch thống kê X (followers/following/posts/name) cho toàn bộ tài khoản có handle.
// Chạy tuần tự (concurrency 1) + delay giữa mỗi lần fetch để tránh bị X rate-limit
// (429) khi user có nhiều tài khoản. Mỗi fetch thành công: upsert vào
// account_stats_daily + update accounts cache. Trả về kết quả tổng hợp.
// (success/failed/skipped + danh sách lỗi + records đã fetch.)

const CONCURRENCY = 1
// Độ trễ (ms) giữa 2 lần fetch liên tiếp. Đủ lớn để X không đánh giá là bot spam,
// vừa đủ ngắn để user không chờ quá lâu khi có nhiều tài khoản.
const FETCH_DELAY_MS = 2500

export async function fetchAllAccountsStats(): Promise<AnalyticsFetchResult> {
  const accounts = listAccounts().filter((a) => a.handle)
  const total = accounts.length
  const errors: AnalyticsFetchResult['errors'] = []
  const records: AnalyticsFetchRecord[] = []
  let success = 0
  let failed = 0
  let skipped = 0
  let done = 0

  emitProgress({
    accountId: '__system__',
    accountLabel: 'Hệ thống',
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
            if (r.skipped) {
              skipped++
            } else if (r.ok) {
              success++
              if (r.record) records.push(r.record)
            } else {
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
              accountId: '__system__',
              accountLabel: 'Hệ thống',
              stage: 'analytics',
              message: `Analytics ${done}/${total} · OK ${success} · Lỗi ${failed} · Bỏ qua ${skipped}`,
              busy: true
            })
            if (done >= total) resolveAll()
            else if (FETCH_DELAY_MS > 0) {
              // Delay giữa các lần fetch để tránh X rate-limit (429).
              setTimeout(startNext, FETCH_DELAY_MS)
            } else {
              startNext()
            }
          })
      }
    }
    if (total === 0) resolveAll()
    else startNext()
  })

  emitProgress({
    accountId: '__system__',
    accountLabel: 'Hệ thống',
    stage: 'analytics',
    message: `Analytics xong: ${success}/${total} thành công${failed > 0 ? `, ${failed} lỗi` : ''}${skipped > 0 ? `, ${skipped} bỏ qua` : ''}`,
    busy: false
  })

  return { total, success, failed, skipped, errors, records }
}

// Kết quả fetch 1 tài khoản.
export interface AccountFetchResult {
  ok: boolean
  error?: string
  skipped?: boolean
  // Dữ liệu đã fetch (chỉ khi ok=true) — dùng để gửi về n8n qua webhook data_acc.
  record?: AnalyticsFetchRecord
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
    return {
      ok: true,
      record: {
        accountId,
        label: acc.label,
        handle: acc.handle,
        name: info.name,
        followers: info.followers,
        following: info.following,
        posts: info.posts,
        avatarUrl: info.avatarUrl ?? null,
        status: acc.status,
        fetchedAt: now
      }
    }
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
