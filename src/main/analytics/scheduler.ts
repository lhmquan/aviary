import { getLastFetchDay } from '../db/analytics'
import { getAllSettings } from '../db/settings'
import { fetchAllAccountsStats } from './fetcher'

// Scheduler analytics: fetch thống kê X cho toàn bộ tài khoản 1 lần/ngày.
// Tick 30 phút: kiểm tra nếu hôm nay chưa fetch (lastFetchDay < midnight hôm nay)
// thì trigger. Chạy ngầm, không chặn scheduler đăng bài.

let timer: NodeJS.Timeout | null = null
let running = false

function midnightOf(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

async function tick(): Promise<void> {
  if (running) return
  // Skip nếu user đã tắt auto-fetch (tránh fetch liên tục khi dev tắt/mở app).
  if (!getAllSettings().analyticsAutoFetch) return
  const todayMidnight = midnightOf(Date.now())
  const last = getLastFetchDay()
  // Chưa fetch hôm nay (last null hoặc last < midnight hôm nay).
  if (last !== null && midnightOf(last) >= todayMidnight) return

  running = true
  try {
    await fetchAllAccountsStats()
  } catch {
    /* ignore — sẽ thử lại tick kế */
  } finally {
    running = false
  }
}

export function startAnalyticsScheduler(): void {
  if (timer) return
  // Tick ngay khi khởi động (nếu hôm nay chưa fetch), rồi 30 phút/lần.
  void tick().catch(() => {})
  timer = setInterval(() => {
    void tick().catch(() => {})
  }, 30 * 60 * 1000)
}

export function stopAnalyticsScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
