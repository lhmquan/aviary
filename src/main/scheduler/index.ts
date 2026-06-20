import { insertLog } from '../db/logs'
import { listDueSchedules, markRun, ensureNextRun, describeSchedule } from '../db/schedules'
import { runPostForAccount } from './runner'

// Bộ lập lịch đăng bài. tick 30s: nếu KHÔNG có job nào đang chạy -> chọn lịch đến giờ sớm
// nhất, chạy tuần tự (1 lần 1) rồi tính lại next_run_at. Chạy tuần tự tránh nhiều Chrome
// song song (tải máy + risk bị X flag). Mọi sự kiện (khởi động, kích hoạt, lỗi) ghi log.

let timer: NodeJS.Timeout | null = null
let running = false

// Tick: kiểm tra lịch đến giờ. Nếu đang có job chạy -> bỏ qua (tick kế xử lý, lịch trễ vài
// chục giây không đáng kể). Nếu rảnh -> chạy lịch sớm nhất rồi đánh dấu lần kế.
async function tick(): Promise<void> {
  if (running) return
  const now = Date.now()
  // Khôi phục next_run_at cho lịch enabled nào bị NULL (sau khi khởi động app).
  ensureNextRun(now)
  const due = listDueSchedules(now)
  if (due.length === 0) return

  const s = due[0] // sớm nhất
  running = true
  try {
    insertLog({
      accountId: s.accountId,
      accountLabel: 'Lịch đăng',
      ts: now,
      ok: true,
      caption: `Lịch kích hoạt: ${describeSchedule(s)}${s.label ? ` (${s.label})` : ''}`,
      url: null,
      error: null,
      step: 'trigger',
      screenshot: null,
      eventType: 'run'
    })
    // Đánh dấu chạy xong + tính next_run NGAY (dù pipeline có lỗi) -> không bị kẹt chạy
    // lại liên tục. Pipeline tự insertLog kết quả (ok/fail/skip).
    await runPostForAccount(s.accountId, { source: 'schedule' }).catch((e) => {
      // Lỗi ngoài pipeline (vd account bị xoá giữa chừng) -> vẫn ghi log để user thấy.
      insertLog({
        accountId: s.accountId,
        accountLabel: 'Lịch đăng',
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
  } finally {
    markRun(s.id, Date.now())
    running = false
  }
}

export function startScheduler(): void {
  if (timer) return
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
  // Tick ngay để tính next_run cho lịch mới/khôi phục, rồi 30s/lần.
  tick().catch(() => {})
  timer = setInterval(() => {
    tick().catch(() => {})
  }, 30_000)
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}