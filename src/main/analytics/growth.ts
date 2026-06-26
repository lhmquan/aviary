import { listStatsByAccount, listAllStats, getLastFetchDay } from '../db/analytics'
import { listAccounts, getAccount } from '../db/accounts'
import type { AccountGrowth, DailyStats, GrowthDelta, AnalyticsData } from '../../shared/types'

// Tính delta: so sánh giá trị hiện tại (từ accounts cache, luôn mới nhất) với
// dữ liệu N ngày trước trong analytics.
//
// Logic tìm reference:
// - Tìm row có day GẦN NHẤT với targetDay (N ngày trước). Ưu tiên day <= targetDay
//   (data của ngày đó hoặc trước đó). Nếu không có → fallback về row đầu tiên.
// - Quan trọng: mỗi mốc (1d, 7d, 30d) phải lấy reference KHÁC NHAU để delta khác nhau.
//   delta7d phải >= delta1d (7 ngày bao gồm 1 ngày), delta30d phải >= delta7d.
function computeDelta(
  series: DailyStats[],
  offsetDays: number,
  current: { followers: number | null; following: number | null; posts: number | null }
): GrowthDelta {
  if (series.length === 0) {
    return { followers: null, following: null, posts: null }
  }

  const todayMidnight = midnightOf(Date.now())
  const targetDay = todayMidnight - offsetDays * 86_400_000

  // Tìm row có day <= targetDay (gần nhất trước hoặc đúng ngày mục tiêu).
  let ref: DailyStats | null = null
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].day <= targetDay) {
      ref = series[i]
      break
    }
  }

  // Fallback: chưa đủ data cũ → dùng row ĐẦU TIÊN (sớm nhất có sẵn).
  // Vd: chỉ có 2 ngày data, delta7d không có data 7 ngày trước → dùng ngày đầu tiên.
  // Nhờ đó delta7d > delta1d (vì ngày đầu tiên có giá trị cũ hơn).
  if (!ref) ref = series[0]

  return {
    followers: subSafe(current.followers, ref.followers),
    following: subSafe(current.following, ref.following),
    posts: subSafe(current.posts, ref.statusesCount)
  }
}

function midnightOf(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function subSafe(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null
  return a - b
}

// Tính tăng trưởng cho 1 tài khoản.
// Giá trị "current" lấy từ accounts table (luôn mới nhất sau mỗi lần fetch),
// KHÔNG lấy từ analytics series (vì analytics chỉ giữ giá trị đầu ngày).
function computeGrowth(
  accountId: string,
  series: DailyStats[],
  days = 30
): AccountGrowth {
  const acc = getAccount(accountId)
  const current = {
    followers: acc?.followers ?? null,
    following: acc?.following ?? null,
    posts: acc?.statusesCount ?? null
  }
  const latest = series.length > 0 ? series[series.length - 1] : null

  return {
    accountId,
    accountLabel: acc?.label ?? '(đã xoá)',
    handle: acc?.handle ?? null,
    avatarUrl: acc?.avatarUrl ?? null,
    current: {
      ...current,
      name: latest?.name ?? acc?.label ?? null
    },
    delta1d: computeDelta(series, 1, current),
    delta7d: computeDelta(series, 7, current),
    delta30d: computeDelta(series, days, current),
    series,
    lastError: null
  }
}

// Lấy dữ liệu analytics đầy đủ cho tất cả (hoặc 1) tài khoản.
export function getAnalyticsData(accountId?: string, days = 30): AnalyticsData {
  const lastFetchAt = getLastFetchDay()

  if (accountId) {
    const series = listStatsByAccount(accountId, days)
    return {
      accounts: [computeGrowth(accountId, series, days)],
      lastFetchAt
    }
  }

  // Tất cả tài khoản: lấy list accounts trước (để hiển thị cả account chưa có data)
  // rồi map với analytics data.
  const allAccounts = listAccounts()
  const statsMap = listAllStats(days)

  const accounts: AccountGrowth[] = allAccounts.map((acc) => {
    const series = statsMap.get(acc.id) ?? []
    return computeGrowth(acc.id, series, days)
  })

  return { accounts, lastFetchAt }
}
