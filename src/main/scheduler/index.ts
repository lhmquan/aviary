import { BrowserWindow } from 'electron'
import { insertLog } from '../db/logs'
import {
  listDueSchedules,
  nextDueAt,
  markRun,
  setScheduleNextRun,
  ensureNextRun,
  describeSchedule,
  setScheduleRunning,
  resetAllRunning
} from '../db/schedules'
import { getAccount } from '../db/accounts'
import { getAllSettings } from '../db/settings'
import { IpcChannels } from '../../shared/types'
import { runPostForAccount, runDeleteForAccount, runCommentForAccount, runInteractForAccount, emitProgress } from './runner'

// Lấy tên tài khoản thật để ghi vào cột "Tài khoản" của nhật ký. Nếu account đã bị xoá,
// fallback về một nhãn dễ hiểu thay vì để trống.
function accountLabelOf(accountId: string): string {
  return getAccount(accountId)?.label ?? '(tài khoản đã xoá)'
}

// Bộ lập lịch đăng/xoá bài có HÀNG ĐỢI + giới hạn đồng thời (settings.concurrency).
// tick 30s: chọn các lịch đến giờ sớm nhất, chạy song song tối đa `concurrency` job. Lịch
// đến giờ khi đã đủ slot -> chờ (next_run_at KHÔNG đổi nên countdown "đứng yên" = đang chờ
// hàng đợi) tới tick sau khi có slot trống. Mỗi tài khoản chỉ chạy 1 job 1 lúc.

let timer: NodeJS.Timeout | null = null
// Cờ dừng: chặn rescheduleTimer/kickNow tự hẹn lại sau khi stopScheduler được gọi.
let stopped = true

// Semaphore đồng thời: số job đang chạy + tập accountId đang chạy (chặn cùng 1 account
// chạy 2 job song song). DB cột schedules.running là bản lưu bền (khôi phục sau crash).
let activeRunCount = 0
const activeAccountIds = new Set<string>()

/** Số slot còn trống theo concurrency hiện tại (đọc settings mỗi lần). */
function availableSlots(): number {
  const concurrency = Math.max(1, Number(getAllSettings().concurrency) || 3)
  return concurrency - activeRunCount
}

/** Chiếm 1 slot cho 1 lần chạy thủ công (nút Đăng). Chờ tới khi có slot + account rảnh. */
export async function acquireSlot(accountId: string): Promise<void> {
  // Poll 200ms tới khi đủ slot và account không đang chạy job khác.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (availableSlots() > 0 && !activeAccountIds.has(accountId)) {
      activeRunCount++
      activeAccountIds.add(accountId)
      return
    }
    await sleep(200)
  }
}

/** Trả slot sau khi chạy xong. Nhả xong -> đánh thức scheduler NGAY để nhặt lịch đang chờ
 * slot (thay vì chờ tới tick kế). Nhờ vậy lịch due không bị kẹt "chờ slot trống" oan. */
export function releaseSlot(accountId: string): void {
  if (activeAccountIds.has(accountId)) {
    activeAccountIds.delete(accountId)
    activeRunCount = Math.max(0, activeRunCount - 1)
  }
  kickNow()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Báo renderer hàng đợi/đang-chạy thay đổi để ScheduleView cập nhật cột "Lần kế".
export function emitQueueChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.queueChanged)
  }
}

// Tick: nhặt các lịch đến giờ, lấp đầy slot còn trống (tối đa concurrency). Mỗi job chạy
// fire-and-forget; khi xong mới markRun (tính next_run kế) + nhả slot. Lịch chưa được nhặt
// vẫn giữ nguyên next_run_at (countdown đứng yên = đang chờ hàng đợi).
async function tick(): Promise<void> {
  const now = Date.now()
  // Khôi phục next_run_at cho lịch enabled nào bị NULL (sau khi khởi động app).
  ensureNextRun(now)

  let slots = availableSlots()
  if (slots > 0) {
    const due = listDueSchedules(now) // đã lọc running=0, sắp xếp sớm nhất trước
    for (const s of due) {
      if (slots <= 0) break
      // Bỏ qua nếu account này đang chạy job khác (giữ slot cho lịch của account khác).
      if (activeAccountIds.has(s.accountId)) continue

      // Chiếm slot + đánh dấu running NGAY (đồng bộ) để tick kế / lần lặp kế không nhặt lại.
      activeRunCount++
      activeAccountIds.add(s.accountId)
      setScheduleRunning(s.id, true)
      slots--
      emitQueueChanged()

      // Fire-and-forget: chạy job, không await trong vòng lặp để các job chạy song song.
      void runScheduledJob(s)
    }
  }

  // Hẹn lần thức kế chính xác = thời điểm lịch tương lai gần nhất. Nhờ vậy lịch tới giờ
  // được nhặt gần như tức thì (không chờ tick cố định 30s -> hết cảnh "chờ slot trống" oan).
  rescheduleTimer()
}

// Hẹn timer one-shot tới đúng thời điểm lịch tương lai gần nhất (nextDueAt). Chặn trên
// MAX_TICK_MS để vẫn re-check định kỳ (đổi concurrency, account mới, lịch ảo Analytics).
const MIN_TICK_MS = 250
const MAX_TICK_MS = 30_000
function rescheduleTimer(): void {
  if (stopped) return
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const now = Date.now()
  const next = nextDueAt(now)
  let delay = MAX_TICK_MS
  if (next !== null) {
    delay = Math.min(MAX_TICK_MS, Math.max(MIN_TICK_MS, next - now))
  }
  timer = setTimeout(() => {
    tick().catch(() => {})
  }, delay)
}

// Đánh thức scheduler chạy tick gần như ngay (debounce 50ms gộp nhiều lần nhả slot liên tiếp).
let kickTimer: NodeJS.Timeout | null = null
function kickNow(): void {
  if (stopped) return
  if (kickTimer) return
  kickTimer = setTimeout(() => {
    kickTimer = null
    tick().catch(() => {})
  }, 50)
}

// Chạy 1 lịch đã được cấp slot. THỨ TỰ finally bắt buộc:
//   markRun -> setScheduleRunning(false) -> releaseSlot -> emitQueueChanged.
// markRun PHẢI trước setRunning(false): khi running về 0, nếu next_run_at chưa kịp dời thì
// tick kế sẽ nhặt lại lịch này (double-run).
async function runScheduledJob(s: ReturnType<typeof listDueSchedules>[number]): Promise<void> {
  const isDelete = s.action === 'delete'
  const isComment = s.action === 'comment'
  const isInteract = s.action === 'interact'
  const actionLabel = isDelete ? 'xoá' : isComment ? 'bình luận' : isInteract ? 'tương tác' : 'đăng'
  const runEventType = isDelete ? 'run_delete' : isComment ? 'run_comment' : isInteract ? 'run_interact' : 'run'
  const startedAt = Date.now()
  const label = accountLabelOf(s.accountId)
  // Khi chạm limit comment/ngày -> ghi midnight hôm sau vào map -> dùng trong finally
  // thay vì markRun (tính nextRun theo interval/fixed).
  const limitNextRunMap = new Map<string, number>()
  try {
    emitProgress({
      accountId: s.accountId,
      accountLabel: label,
      stage: 'schedule',
      message: `Lịch ${actionLabel} kích hoạt: ${describeSchedule(s)}${s.label ? ` (${s.label})` : ''}`,
      busy: true
    })
    insertLog({
      accountId: s.accountId,
      accountLabel: label,
      ts: startedAt,
      ok: true,
      caption: `Lịch ${actionLabel} kích hoạt: ${describeSchedule(s)}${s.label ? ` (${s.label})` : ''}`,
      url: null,
      error: null,
      step: 'trigger',
      screenshot: null,
      eventType: runEventType
    })

    if (isDelete) {
      await runDeleteForAccount(s.accountId, {
        source: 'schedule',
        deleteMode: s.deleteMode ?? 'newest',
        deleteBeforeDate: s.deleteBeforeDate,
        deleteCount: s.deleteCount
      }).catch((e) => {
        insertLog({
          accountId: s.accountId,
          accountLabel: accountLabelOf(s.accountId),
          ts: Date.now(),
          ok: false,
          caption: `Lịch xoá chạy lỗi: ${(e as Error).message}`,
          url: null,
          error: (e as Error).message,
          step: 'scheduler',
          screenshot: null,
          eventType: 'run_delete'
        })
      })
    } else if (isComment) {
      const result = await runCommentForAccount(s.accountId, {
        source: 'schedule',
        commentCount: s.commentCount,
        commentIntervalSeconds: s.commentIntervalSeconds,
        commentSourceUrl: s.commentSourceUrl,
        commentNewestCount: s.commentNewestCount,
        commentViewThreshold: s.commentViewThreshold,
        commentSource: s.commentSource,
        commentAiInstruction: s.commentAiInstruction,
        commentMaxChars: s.commentMaxChars,
        commentPrefix: s.commentPrefix,
        commentLink: s.commentLink
      }).catch((e) => {
        insertLog({
          accountId: s.accountId,
          accountLabel: accountLabelOf(s.accountId),
          ts: Date.now(),
          ok: false,
          caption: `Lịch bình luận chạy lỗi: ${(e as Error).message}`,
          url: null,
          error: (e as Error).message,
          step: 'scheduler',
          screenshot: null,
          eventType: 'run_comment'
        })
        return null
      })
      // Chạm limit comment/ngày -> dời nextRunAt sang midnight hôm sau.
      if (result?.limitReached) {
        const d = new Date()
        const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 5, 0, 0).getTime()
        limitNextRunMap.set(s.id, midnight)
      }
    } else if (isInteract) {
      await runInteractForAccount(s.accountId, {
        source: 'schedule',
        durationMinutes: s.interactDurationMinutes,
        commentTarget: s.interactCommentTarget
      }).catch((e) => {
        insertLog({
          accountId: s.accountId,
          accountLabel: accountLabelOf(s.accountId),
          ts: Date.now(),
          ok: false,
          caption: `Lịch tương tác chạy lỗi: ${(e as Error).message}`,
          url: null,
          error: (e as Error).message,
          step: 'scheduler',
          screenshot: null,
          eventType: 'run_interact'
        })
      })
    } else {
      await runPostForAccount(s.accountId, { source: 'schedule' }).catch((e) => {
        // Lỗi ngoài pipeline (vd account bị xoá giữa chừng) -> vẫn ghi log để user thấy.
        insertLog({
          accountId: s.accountId,
          accountLabel: accountLabelOf(s.accountId),
          ts: Date.now(),
          ok: false,
          caption: `Lịch chạy lỗi: ${(e as Error).message}`,
          url: null,
          error: (e as Error).message,
          step: 'scheduler',
          screenshot: null,
          eventType: 'run'
        })
      })
    }
  } finally {
    // Nếu chạm limit -> dời sang midnight. Không thì markRun bình thường.
    const limitNext = limitNextRunMap.get(s.id)
    if (limitNext !== undefined) {
      setScheduleNextRun(s.id, limitNext)
    } else {
      // markRun TRƯỚC khi clear running (xem ghi chú trên về double-run).
      markRun(s.id, Date.now())
    }
    setScheduleRunning(s.id, false)
    releaseSlot(s.accountId)
    emitQueueChanged()
  }
}

export function startScheduler(): void {
  if (!stopped) return
  stopped = false
  // Khôi phục sau crash: xoá mọi cờ running còn sót (không có job nào thực sự chạy lúc khởi động).
  resetAllRunning()
  insertLog({
    accountId: '__system__',
    accountLabel: 'Hệ thống',
    ts: Date.now(),
    ok: true,
    caption: 'Bộ lập lịch đã khởi động',
    url: null,
    error: null,
    step: 'scheduler',
    screenshot: null,
    eventType: 'schedule'
  })
  // Tick ngay để tính next_run + nhặt lịch due; tick() tự hẹn lần thức kế (rescheduleTimer).
  tick().catch(() => {})
}

export function stopScheduler(): void {
  stopped = true
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (kickTimer) {
    clearTimeout(kickTimer)
    kickTimer = null
  }
}
