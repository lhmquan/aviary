import { listStatsByAccount, listAllStats, getLastFetchDay } from '../db/analytics'
import { listAccounts, getAccount } from '../db/accounts'
import type { AccountGrowth, DailyStats, GrowthDelta, AnalyticsData } from '../../shared/types'

// Tính delta TRUNG THỰC: so sánh giá trị hiện tại (snapshot mới nhất) với
// snapshot tham chiếu ở mốc N ngày trước.
//
// Nguyên tắc:
// - Neo theo `latestDay` (ngày snapshot mới nhất), KHÔNG neo theo "hôm nay".
//   Nhờ vậy nếu lỡ vài ngày không fetch, delta vẫn so đúng giữa 2 lần fetch.
// - targetDay = latestDay - offsetDays. Tìm snapshot có day GẦN targetDay nhất
//   trong dung sai cho phép (tránh nhận nhầm điểm quá xa).
// - Nếu KHÔNG có snapshot phù hợp ở mốc đó → trả về { available: false }.
//   KHÔNG fallback bịa số. UI sẽ hiển thị "—" với tooltip giải thích.
//
// Dung sai: cho phép lệch tối đa ~ nửa khoảng (hoặc tối thiểu 1 ngày) để vẫn
// bắt được điểm khi lịch fetch không đều, nhưng không vượt quá để khỏi sai lệch.
function computeDelta(
  series: DailyStats[],
  offsetDays: number,
  current: { followers: number | null; following: number | null; posts: number | null }
): GrowthDelta {
  const NA: GrowthDelta = { followers: null, following: null, posts: null, available: false }
  if (series.length < 2) return NA

  const latestDay = series[series.length - 1].day
  const targetDay = latestDay - offsetDays * 86_400_000

  // Dung sai: tối đa nửa offset, nhưng ít nhất 1 ngày. Vd 1d -> 1 ngày,
  // 7d -> 3 ngày, 30d -> 15 ngày.
  const tolerance = Math.max(1, Math.floor(offsetDays / 2)) * 86_400_000

  // Tìm snapshot có |day - targetDay| nhỏ nhất, trong phạm vi tolerance,
  // và phải CŨ HƠN snapshot mới nhất (day < latestDay) để delta có nghĩa.
  let ref: DailyStats | null = null
  let bestDiff = Infinity
  for (const s of series) {
    if (s.day >= latestDay) continue
    const diff = Math.abs(s.day - targetDay)
    if (diff <= tolerance && diff < bestDiff) {
      bestDiff = diff
      ref = s
    }
  }

  if (!ref) return NA

  return {
    followers: subSafe(current.followers, ref.followers),
    following: subSafe(current.following, ref.following),
    posts: subSafe(current.posts, ref.statusesCount),
    available: true
  }
}

// Tổng thay đổi từ snapshot ĐẦU TIÊN (sớm nhất) tới hiện tại.
// Luôn có ý nghĩa khi có >= 2 snapshot — đây là con số "an toàn" để show
// khi các mốc 1d/7d/30d chưa đủ dữ liệu.
function computeSinceStart(
  series: DailyStats[],
  current: { followers: number | null; following: number | null; posts: number | null }
): GrowthDelta {
  if (series.length < 2) {
    return { followers: null, following: null, posts: null, available: false }
  }
  const first = series[0]
  return {
    followers: subSafe(current.followers, first.followers),
    following: subSafe(current.following, first.following),
    posts: subSafe(current.posts, first.statusesCount),
    available: true
  }
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
    sinceStart: computeSinceStart(series, current),
    trackedDays: series.length,
    firstDay: series.length > 0 ? series[0].day : null,
    latestDay: latest?.day ?? null,
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
