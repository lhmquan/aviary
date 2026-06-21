import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { rm } from 'fs/promises'
import {
  IpcChannels,
  type Account,
  type PostResult,
  type ProgressPayload
} from '../../shared/types'
import { getAccount, setAccountStatus } from '../db/accounts'
import { getAllSettings } from '../db/settings'
import {
  fetchPostPayload,
  downloadAssets,
  markDone,
  BrokenMediaError
} from '../n8n/N8nConnector'
import { browserManager } from '../browser/BrowserManager'
import { postTweet } from '../actions/XActions'
import { insertLog, pruneLogs } from '../db/logs'

// Broadcast tiến trình tới mọi renderer window (dùng chung cho manual + schedule).
export function emitProgress(p: ProgressPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.taskProgress, p)
  }
}

// Link media tải lỗi (403/404 khi tải video, ffmpeg manifest fail...) — trường hợp N8N
// KHÔNG phát hiện được link hỏng (không trả SKIP). App mới biết qua lỗi tải -> gọi markdone
// (broken) báo n8n mark link đó trong sheet, ghi nhật ký, đóng profile, báo user xử lý sau.
// eventType để cột Loại trong nhật ký đúng nguồn (run=chạy lịch, post=nút Đăng).
// id link Reddit truyền kèm markdone để n8n khớp đúng dòng sheet (ổn định hơn title).
export async function handleBrokenAndReport(
  account: Account,
  title: string,
  reason: string,
  eventType: 'post' | 'run' = 'post',
  id?: string | null
): Promise<void> {
  emitProgress({
    accountId: account.id,
    stage: 'markdone',
    message: 'Link hỏng — đang báo n8n đánh dấu…',
    busy: true
  })
  const md = await markDone({
    accountId: account.id,
    assetUrl: account.assetUrl,
    id,
    title,
    postUrl: null,
    reason: 'broken'
  })

  insertLog({
    accountId: account.id,
    accountLabel: account.label,
    ts: Date.now(),
    ok: false,
    caption: title,
    url: null,
    error: `Bỏ qua (link hỏng): ${reason}${md.ok ? '' : ` · markdone lỗi: ${md.error}`}`,
    step: 'skipped',
    screenshot: null,
    eventType
  })
  pruneLogs()

  await browserManager.closeProfile(account.id).catch(() => {})

  emitProgress({
    accountId: account.id,
    stage: 'error',
    message: md.ok
      ? 'Bài bị bỏ qua (link hỏng) — đã đánh dấu n8n. Bấm đăng lại để lấy bài kế.'
      : `Bài bị bỏ qua (link hỏng) — báo n8n thất bại: ${md.error}`,
    busy: false
  })
}

// Pipeline đăng bài dùng chung cho nút "Đăng" (manual) và scheduler (schedule).
// source để phân biệt nguồn khi ghi log (eventType: schedule->'run', manual->'post').
export async function runPostForAccount(
  accountId: string,
  opts?: { source?: 'manual' | 'schedule' }
): Promise<PostResult> {
  const account = getAccount(accountId)
  if (!account) throw new Error(`Account không tồn tại: ${accountId}`)
  const logEventType = opts?.source === 'schedule' ? 'run' : 'post'

  emitProgress({ accountId, stage: 'prepare', message: 'Đang kiểm tra profile…', busy: true })

  // Nếu profile chưa mở, tự mở theo chế độ headless của account rồi đăng.
  let context = browserManager.getContext(accountId)
  if (!context) {
    emitProgress({ accountId, stage: 'open', message: 'Đang mở profile…', busy: true })
    await browserManager.openProfile(account)
    setAccountStatus(accountId, 'logged_in')
    context = browserManager.getContext(accountId)
  }
  if (!context) throw new Error('Không mở được profile.')

  // Lấy dữ liệu từ n8n. Nếu n8n trả SKIP (link Reddit hỏng, N8N ĐÃ mark trong sheet):
  //   -> KHÔNG gọi markdone (thừa — n8n mark rồi). Gọi lại publish để lấy bài kế, tiếp tục
  //      luồng đăng. Giới hạn MAX_SKIPS để tránh loop khi sheet có nhiều link hỏng liền nhau.
  // markdone(broken) CHỈ gọi khi tải video/ffmpeg lỗi (N8N không phát hiện được link hỏng).
  const MAX_SKIPS = 10
  emitProgress({ accountId, stage: 'fetch', message: 'Đang lấy dữ liệu từ n8n…', busy: true })
  let payload = await fetchPostPayload(accountId, account.assetUrl)
  let skips = 0
  while (payload.skip) {
    skips++
    // Ghi log informational: n8n đã xử lý link này, app lấy bài kế.
    insertLog({
      accountId,
      accountLabel: account.label,
      ts: Date.now(),
      ok: true,
      caption: payload.caption || '(không tiêu đề)',
      url: null,
      error: null,
      step: 'skipped',
      screenshot: null,
      eventType: logEventType
    })
    if (skips >= MAX_SKIPS) {
      // Quá nhiều SKIP liên tiếp -> sheet có vẻ toàn link hỏng. Dừng, báo user kiểm tra.
      // KHÔNG markdone (n8n đã mark từng cái). User xử lý sheet rồi thử lại.
      emitProgress({
        accountId,
        stage: 'error',
        message: `Đã bỏ qua ${MAX_SKIPS} bài SKIP liên tiếp — sheet có vẻ hết bài tốt. Vui lòng kiểm tra lại.`,
        busy: false
      })
      insertLog({
        accountId,
        accountLabel: account.label,
        ts: Date.now(),
        ok: false,
        caption: `Hủy sau ${MAX_SKIPS} bài SKIP liên tiếp`,
        url: null,
        error: 'Quá nhiều bài SKIP liên tiếp — kiểm tra sheet Reddit',
        step: 'skipped',
        screenshot: null,
        eventType: logEventType
      })
      return {
        ok: false,
        skipped: true,
        error: `Hủy sau ${MAX_SKIPS} bài SKIP liên tiếp — sheet có vẻ hết bài tốt`
      }
    }
    emitProgress({
      accountId,
      stage: 'fetch',
      message: `Bài SKIP (link hỏng, n8n đã mark) — đang lấy bài kế…`,
      busy: true
    })
    payload = await fetchPostPayload(accountId, account.assetUrl)
  }

  // Tải asset về đĩa
  emitProgress({ accountId, stage: 'download', message: 'Đang tải video/ảnh…', busy: true })
  const jobId = `job_${Date.now()}`
  const { downloadsDir } = getAllSettings()
  const downloadsRoot =
    downloadsDir && downloadsDir.trim() ? downloadsDir : join(app.getPath('userData'), 'downloads')
  const jobDir = join(downloadsRoot, accountId, jobId)
  let mediaPaths: string[]
  try {
    mediaPaths = await downloadAssets(payload, accountId, jobId)
  } catch (e) {
    await rm(jobDir, { recursive: true, force: true }).catch(() => {})
    // Link Reddit hỏng (403/404 khi tải/ffmpeg) mà N8N không phát hiện -> app mới biết.
    // Đây là case markdone: báo n8n mark link đó trong sheet, log, đóng profile.
    if (e instanceof BrokenMediaError) {
      await handleBrokenAndReport(account, payload.caption ?? '', e.message, logEventType, payload.id)
      return { ok: false, skipped: true, error: `Bài bị bỏ qua: ${e.message}` }
    }
    throw e
  }

  // Post lên X, xoá file tạm sau khi đăng thành công. Hashtag ghép vào cuối caption KHI
  // ĐĂNG — KHÔNG đưa vào webhook (markDone/fetchPostPayload dùng caption gốc) để n8n
  // nhận diện đúng dòng sheet.
  const fullCaption = account.hashtag
    ? `${payload.caption}\n${account.hashtag}`.trim()
    : payload.caption
  emitProgress({ accountId, stage: 'post', message: 'Đang đăng bài lên X…', busy: true })
  let result: PostResult | undefined
  try {
    result = await postTweet(
      context,
      fullCaption,
      mediaPaths.length > 0 ? mediaPaths : undefined,
      accountId
    )
  } finally {
    if (result?.ok) {
      await rm(jobDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  // Lưu nhật ký (DB) + prune. fullCaption (có hashtag) để user thấy đúng nội dung đã đăng.
  // eventType theo nguồn: manual='post', schedule='run' -> badge Nhật ký đúng loại.
  insertLog({
    accountId,
    accountLabel: account.label,
    ts: Date.now(),
    ok: result?.ok ?? false,
    caption: fullCaption,
    url: result?.url ?? null,
    error: result?.ok ? null : result?.error ?? 'Lỗi không xác định',
    step: result?.step ?? null,
    screenshot: result?.screenshot ?? null,
    eventType: logEventType
  })
  pruneLogs()

  if (result?.ok) {
    // Báo n8n đánh dấu video đã đăng (markdone) kèm title + postUrl. title = caption GỐC
    // (không hashtag) để n8n khớp đúng dòng sheet.
    emitProgress({ accountId, stage: 'markdone', message: 'Đang báo n8n đánh dấu done…', busy: true })
    const md = await markDone({
      accountId,
      assetUrl: account.assetUrl,
      id: payload.id,
      title: payload.caption ?? '',
      postUrl: result.url ?? null,
      reason: 'posted'
    })

    // Tự đóng profile sau khi đăng thành công để giải phóng tài nguyên.
    await browserManager.closeProfile(accountId).catch(() => {})

    emitProgress({
      accountId,
      stage: 'done',
      message: md.ok
        ? result.url
          ? `Hoàn thành ✓ — ${result.url}`
          : 'Hoàn thành ✓'
        : `Hoàn thành ✓ (báo n8n done thất bại: ${md.error})`,
      busy: false
    })
  } else {
    emitProgress({
      accountId,
      stage: 'error',
      message: `Lỗi: ${result?.error ?? 'không xác định'}`,
      busy: false
    })
  }
  return result
}