import { insertLog } from '../db/logs'
import { listDueSchedules, markRun, ensureNextRun, describeSchedule } from '../db/schedules'
import { getAccount } from '../db/accounts'
import { runPostForAccount, runDeleteForAccount, emitProgress } from './runner'

// Lấy tên tài khoản thật để ghi vào cột "Tài khoản" của nhật ký. Nếu account đã bị xoá,
// fallback về một nhãn dễ hiểu thay vì để trống.
function accountLabelOf(accountId: string): string {
  return getAccount(accountId)?.label ?? '(tài khoản đã xoá)'
}

// Bộ lập lịch đăng/xoá bài. tick 30s: nếu KHÔNG có job nào đang chạy -> chọn lịch đến giờ sớm
// nhất, chạy tuần tự (1 lần 1) rồi tính lại next_run_at. Chạy tuần tự tránh nhiều Chrome
// song song (tải máy + risk bị X flag). Mọi sự kiện (khởi động, kích hoạt, lỗi) ghi log.

let timer: NodeJS.Timeout | null = null

// Cờ toàn cục: pipeline đang bận (đăng hoặc xoá) — cả manual lẫn schedule đều set.
// Scheduler sẽ chờ pipeline xong hẳn rồi mới nhặt lịch tiếp, tránh chồng lên nhau.
let _busy = false

/** Báo hiệu pipeline bắt đầu chạy (manual hoặc schedule). */
export function markBusy(): void { _busy = true }
/** Báo hiệu pipeline đã xong. */
export function markIdle(): void { _busy = false }
/** Kiểm tra pipeline có đang chạy không. */
export function isBusy(): boolean { return _busy }

// Tick: kiểm tra lịch đến giờ. Nếu pipeline đang bận (manual hoặc schedule trước đó chưa xong)
// -> bỏ qua (tick kế xử lý, lịch trễ vài chục giây không đáng kể). Nếu rảnh -> chạy lịch sớm
// nhất rồi đánh dấu lần kế.
async function tick(): Promise<void> {
  if (_busy) return
  const now = Date.now()
  // Khôi phục next_run_at cho lịch enabled nào bị NULL (sau khi khởi động app).
  ensureNextRun(now)
  const due = listDueSchedules(now)
  if (due.length === 0) return

  const s = due[0] // sớm nhất
  const isDelete = s.action === 'delete'
  _busy = true
  try {
    const label = accountLabelOf(s.accountId)
    emitProgress({
      accountId: s.accountId,
      accountLabel: label,
      stage: 'schedule',
      message: `Lịch ${isDelete ? 'xoá' : 'đăng'} kích hoạt: ${describeSchedule(s)}${s.label ? ` (${s.label})` : ''}`,
      busy: true
    })
    insertLog({
      accountId: s.accountId,
      accountLabel: label,
      ts: now,
      ok: true,
      caption: `Lịch ${isDelete ? 'xoá' : 'đăng'} kích hoạt: ${describeSchedule(s)}${s.label ? ` (${s.label})` : ''}`,
      url: null,
      error: null,
      step: 'trigger',
      screenshot: null,
      eventType: isDelete ? 'run_delete' : 'run'
    })
    // Đánh dấu chạy xong + tính next_run NGAY (dù pipeline có lỗi) -> không bị kẹt chạy
    // lại liên tục. Pipeline tự insertLog kết quả (ok/fail/skip).
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
    markRun(s.id, Date.now())
    _busy = false
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