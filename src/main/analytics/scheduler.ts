import { getLastFetchDay, setLastFetchDay } from '../db/analytics'
import { getAllSettings } from '../db/settings'
import { fetchAllAccountsStats } from './fetcher'
import { acquireSlot, releaseSlot, emitQueueChanged } from '../scheduler'

// Scheduler analytics: fetch thống kê X cho toàn bộ tài khoản 1 lần/ngày vào 03:00.
// Tick 5 phút: kiểm tra nếu đã qua 03:00 hôm nay và chưa fetch thì chạy.
// Tích hợp vào hàng đợi scheduler (acquireSlot/releaseSlot) để user theo dõi.

let timer: NodeJS.Timeout | null = null
let running = false
export const ANALYTICS_ACCOUNT_ID = '__analytics__'
const FETCH_HOUR = 3 // 03:00 sáng

function midnightOf(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// Tính thời điểm 03:00 hôm nay. Nếu hiện tại đã qua 03:00 thì trả về 03:00 hôm nay,
// nếu chưa qua thì trả về 03:00 hôm qua (để logic "đã qua 03:00 chưa fetch" hoạt động).
function todayFetchTime(): number {
  const now = new Date()
  const today3am = new Date(now.getFullYear(), now.getMonth(), now.getDate(), FETCH_HOUR, 0, 0, 0)
  return today3am.getTime()
}

async function tick(): Promise<void> {
  if (running) return
  if (!getAllSettings().analyticsAutoFetch) return

  const now = Date.now()
  const fetch3am = todayFetchTime()
  const last = getLastFetchDay()

  // Chỉ chạy khi: (1) đã qua 03:00 hôm nay, (2) chưa fetch hôm nay.
  if (now < fetch3am) return
  if (last !== null && midnightOf(last) >= midnightOf(now)) return

  running = true
  try {
    // Chiếm slot trong hàng đợi scheduler (để user thấy "Analytics đang chờ/chạy").
    await acquireSlot(ANALYTICS_ACCOUNT_ID)
    emitQueueChanged()
    await fetchAllAccountsStats()
    setLastFetchDay(now)
  } catch {
    /* ignore — sẽ thử lại tick kế */
  } finally {
    releaseSlot(ANALYTICS_ACCOUNT_ID)
    emitQueueChanged()
    running = false
  }
}

export function isAnalyticsRunning(): boolean {
  return running
}

export function startAnalyticsScheduler(): void {
  if (timer) return
  // Tick ngay khi khởi động (nếu đã qua 03:00 hôm nay và chưa fetch), rồi 5 phút/lần.
  void tick().catch(() => {})
  timer = setInterval(() => {
    void tick().catch(() => {})
  }, 5 * 60 * 1000)
}

export function stopAnalyticsScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
