import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { rm, readdir, stat } from 'fs/promises'
import {
  IpcChannels,
  type Account,
  type PostResult,
  type DeleteResult,
  type CommentResult,
  type ProgressPayload,
  type DeleteMode
} from '../../shared/types'
import { getAccount, setAccountStatus, decodeCaptionPrefix } from '../db/accounts'
import { getAllSettings } from '../db/settings'
import {
  fetchPostPayload,
  downloadAssets,
  markDone,
  fetchCommentPayload,
  BrokenMediaError
} from '../n8n/N8nConnector'
import { browserManager } from '../browser/BrowserManager'
import { postTweet, deleteTweetsFromProfile, scrollProfileCollectTweetUrls, commentOnTweet } from '../actions/XActions'
import { runInteractSession } from '../actions/InteractSession'
import { insertLog, pruneLogs } from '../db/logs'
import {
  insertCollectedLinks,
  updateLinkStatus,
  listUnprocessedLinks,
  countCommentsToday,
  pruneCommentHistory
} from '../db/comment_history'

// Broadcast tiến trình tới mọi renderer window (dùng chung cho manual + schedule).
export function emitProgress(p: ProgressPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.taskProgress, p)
  }
}

// Dọn download job dirs cũ (>24h) — xử lý rò rỉ khi app crash giữa chừng hoặc
// khi đăng FAIL không xoá được. Quét downloadsRoot/<accountId>/job_*, xoá dir
// nào có mtime > 24h. Chạy 1 lần khi khởi động app.
const DOWNLOAD_RETENTION_HOURS = 24
export async function cleanupOldDownloads(): Promise<void> {
  const { downloadsDir } = getAllSettings()
  const downloadsRoot =
    downloadsDir && downloadsDir.trim() ? downloadsDir : join(app.getPath('userData'), 'downloads')
  const cutoff = Date.now() - DOWNLOAD_RETENTION_HOURS * 3_600_000
  let accountDirs: string[]
  try {
    accountDirs = await readdir(downloadsRoot)
  } catch {
    return // dir chưa tồn tại
  }
  for (const acctId of accountDirs) {
    const acctPath = join(downloadsRoot, acctId)
    let jobDirs: string[]
    try {
      jobDirs = await readdir(acctPath)
    } catch {
      continue
    }
    for (const job of jobDirs) {
      if (!job.startsWith('job_')) continue
      const jobPath = join(acctPath, job)
      try {
        const st = await stat(jobPath)
        if (st.mtimeMs < cutoff) {
          await rm(jobPath, { recursive: true, force: true })
        }
      } catch {
        /* ignore */
      }
    }
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
  id?: string | null,
  sourceUrl?: string | null
): Promise<void> {
  emitProgress({
    accountId: account.id,
    accountLabel: account.label,
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
    url: sourceUrl ?? null,
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
    accountLabel: account.label,
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
  const label = account.label

  emitProgress({ accountId, accountLabel: label, stage: 'prepare', message: 'Đang kiểm tra profile…', busy: true })

  // Nếu profile chưa mở, tự mở theo chế độ headless của account rồi đăng.
  // Ghi nhận openedByUs để luôn đóng profile khi xong (dù thành công hay lỗi) —
  // giải phóng tài nguyên cho lần chạy kế, tránh browser treo vô hạn.
  let openedByUs = false
  let context = browserManager.getContext(accountId)
  if (!context) {
    emitProgress({ accountId, accountLabel: label, stage: 'open', message: 'Đang mở profile…', busy: true })
    await browserManager.openProfile(account)
    setAccountStatus(accountId, 'logged_in')
    context = browserManager.getContext(accountId)
    openedByUs = true
  }
  if (!context) throw new Error('Không mở được profile.')

  let result: PostResult | undefined
  try {
    // Lấy dữ liệu từ n8n. Nếu n8n trả SKIP (link Reddit hỏng, N8N ĐÃ mark trong sheet):
    //   -> KHÔNG gọi markdone (thừa — n8n mark rồi). Gọi lại publish để lấy bài kế, tiếp tục
    //      luồng đăng. Giới hạn MAX_SKIPS để tránh loop khi sheet có nhiều link hỏng liền nhau.
    // markdone(broken) CHỈ gọi khi tải video/ffmpeg lỗi (N8N không phát hiện được link hỏng).
    const MAX_SKIPS = 10
    emitProgress({ accountId, accountLabel: label, stage: 'fetch', message: 'Đang lấy dữ liệu từ n8n…', busy: true })
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
          accountLabel: label,
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
        accountLabel: label,
        stage: 'fetch',
        message: `Bài SKIP (link hỏng, n8n đã mark) — đang lấy bài kế…`,
        busy: true
      })
      payload = await fetchPostPayload(accountId, account.assetUrl)
    }

    // Tải asset về đĩa
    emitProgress({ accountId, accountLabel: label, stage: 'download', message: 'Đang tải video/ảnh…', busy: true })
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
        await handleBrokenAndReport(account, payload.caption ?? '', e.message, logEventType, payload.id, payload.sourceUrl)
        return { ok: false, skipped: true, error: `Bài bị bỏ qua: ${e.message}` }
      }
      throw e
    }

    // Post lên X, xoá file tạm sau khi đăng. Tiền tố + hashtag ghép vào caption KHI
    // ĐĂNG — KHÔNG đưa vào webhook (markDone/fetchPostPayload dùng caption gốc) để n8n
    // nhận diện đúng dòng sheet.
    // Thứ tự: [captionPrefix] + caption + [\n hashtag]
    let fullCaption = payload.caption ?? ''
    const prefix = decodeCaptionPrefix(account.captionPrefix)
    if (prefix) fullCaption = prefix + fullCaption
    if (account.hashtag) fullCaption = `${fullCaption}\n${account.hashtag}`.trim()
    fullCaption = fullCaption.trim()
    emitProgress({ accountId, accountLabel: label, stage: 'post', message: 'Đang đăng bài lên X…', busy: true })
    try {
      result = await postTweet(
        context,
        fullCaption,
        mediaPaths.length > 0 ? mediaPaths : undefined,
        accountId,
        (message) => emitProgress({ accountId, accountLabel: label, stage: 'post', message, busy: true })
      )
    } finally {
      // Luôn xoá jobDir — screenshot lỗi đã được lưu riêng trong logs, không cần
      // giữ media download (10-100MB) lại để tránh rò rỉ ổ đĩa.
      await rm(jobDir, { recursive: true, force: true }).catch(() => {})
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
      // Báo n8n đánh dấu video đã đăng (markdone) kèm title + postUrl + url reddit.
      // title = caption GỐC (không prefix/hashtag) để n8n khớp đúng dòng sheet.
      emitProgress({ accountId, accountLabel: label, stage: 'markdone', message: 'Đang báo n8n đánh dấu done…', busy: true })
      const md = await markDone({
        accountId,
        assetUrl: account.assetUrl,
        id: payload.id,
        title: payload.caption ?? '',
        postUrl: result.url ?? null,
        url: payload.sourceUrl ?? null,
        reason: 'posted'
      })

      emitProgress({
        accountId,
        accountLabel: label,
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
        accountLabel: label,
        stage: 'error',
        message: `Lỗi: ${result?.error ?? 'không xác định'}`,
        busy: false
      })
    }
    return result
  } finally {
    // Luôn đóng profile nếu do pipeline tự mở — giải phóng tài nguyên cho lần chạy kế.
    if (openedByUs) {
      await browserManager.closeProfile(accountId).catch(() => {})
    }
  }
}

// Pipeline xoá bài dùng chung cho scheduler. Không gọi n8n / tải / markDone.
// Mở profile, duyệt trang profile X, xoá bài theo chế độ (mới nhất / theo ngày),
// ghi nhật ký, đóng profile.
export async function runDeleteForAccount(
  accountId: string,
  opts?: {
    source?: 'manual' | 'schedule'
    deleteMode?: DeleteMode
    deleteBeforeDate?: string | null
    deleteCount?: number
  }
): Promise<DeleteResult> {
  const account = getAccount(accountId)
  if (!account) throw new Error(`Account không tồn tại: ${accountId}`)
  if (!account.handle) {
    const emptyResult: DeleteResult = {
      ok: false,
      deletedCount: 0,
      urls: [],
      error: 'Tài khoản chưa có username X — không thể mở trang profile để xoá bài.',
      step: 'prepare'
    }
    return emptyResult
  }

  const logEventType = opts?.source === 'schedule' ? 'run_delete' : 'delete'
  const label = account.label

  emitProgress({ accountId, accountLabel: label, stage: 'prepare', message: 'Đang kiểm tra profile…', busy: true })

  // Mở profile nếu chưa mở. Ghi nhận để đóng khi xong (dù thành công hay lỗi).
  let openedByUs = false
  let context = browserManager.getContext(accountId)
  if (!context) {
    emitProgress({ accountId, accountLabel: label, stage: 'open', message: 'Đang mở profile…', busy: true })
    await browserManager.openProfile(account)
    setAccountStatus(accountId, 'logged_in')
    context = browserManager.getContext(accountId)
    openedByUs = true
  }
  if (!context) throw new Error('Không mở được profile.')

  try {
    // Xoá bài từ profile X
    emitProgress({ accountId, accountLabel: label, stage: 'delete', message: 'Đang xoá bài trên X…', busy: true })
    const result = await deleteTweetsFromProfile(
      context,
      account.handle,
      {
        mode: opts?.deleteMode ?? 'newest',
        beforeDate: opts?.deleteBeforeDate ?? null,
        maxCount: opts?.deleteCount ?? 1
      },
      accountId,
      (message) => emitProgress({ accountId, accountLabel: label, stage: 'delete', message, busy: true })
    )

    // Ghi nhật ký: hiển thị link bài đầu tiên (nếu có) + dấu link
    const caption = result.ok
      ? (() => {
          if (result.deletedCount <= 0) return 'Đã xoá 0 bài';
          const firstUrl = result.urls[0] ?? null;
          if (result.deletedCount === 1) {
            return firstUrl ? 'Đã xoá 1 bài 🔗' : 'Đã xoá 1 bài';
          }
          return firstUrl
            ? `Đã xoá ${result.deletedCount} bài 🔗`
            : `Đã xoá ${result.deletedCount} bài`;
        })()
      : `Xoá bài lỗi${result.deletedCount > 0 ? ` (đã xoá ${result.deletedCount} bài trước khi lỗi)` : ''}`;

    insertLog({
      accountId,
      accountLabel: account.label,
      ts: Date.now(),
      ok: result.ok,
      caption,
      url: result.urls[0] ?? null,
      error: result.ok ? (result.error ?? null) : (result.error ?? 'Lỗi không xác định'),
      step: result.step ?? null,
      screenshot: result.screenshot ?? null,
      eventType: logEventType,
      urls: result.urls
    })
    pruneLogs()

    if (result.ok) {
      emitProgress({
        accountId,
        accountLabel: label,
        stage: 'done',
        message: `Hoàn thành — đã xoá ${result.deletedCount} bài`,
        busy: false
      })
    } else {
      emitProgress({
        accountId,
        accountLabel: label,
        stage: 'error',
        message: `Lỗi: ${result.error ?? 'không xác định'}`,
        busy: false
      })
    }
    return result
  } finally {
    // Luôn đóng profile nếu do pipeline tự mở.
    if (openedByUs) {
      await browserManager.closeProfile(accountId).catch(() => {})
    }
  }
}

// Sleep helper — delay giữa các lần bình luận trong 1 tác vụ.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Pipeline bình luận trên bài của chính tài khoản (trang profile). Dùng chung cho
// nút "Bình luận" (manual) và scheduler (schedule).
// source để phân biệt nguồn khi ghi log (eventType: schedule->'run_comment', manual->'comment').
export async function runCommentForAccount(
  accountId: string,
  opts?: {
    source?: 'manual' | 'schedule'
    commentCount?: number
    commentIntervalSeconds?: number
    commentSourceUrl?: string | null
  }
): Promise<CommentResult> {
  const account = getAccount(accountId)
  if (!account) throw new Error(`Account không tồn tại: ${accountId}`)
  const logEventType = opts?.source === 'schedule' ? 'run_comment' : 'comment'
  const label = account.label

  const commentCount = Math.max(1, opts?.commentCount ?? 1)
  const commentIntervalSeconds = Math.max(5, opts?.commentIntervalSeconds ?? 60)
  const sourceUrl = opts?.commentSourceUrl ?? null
  const dailyLimit = getAllSettings().commentDailyLimit

  emitProgress({ accountId, accountLabel: label, stage: 'prepare', message: 'Đang kiểm tra profile…', busy: true })

  // 1. Kiểm tra limit comment/ngày — chạm -> báo, dừng, mai chạy tiếp.
  const countToday = countCommentsToday(accountId)
  if (countToday >= dailyLimit) {
    emitProgress({
      accountId,
      accountLabel: label,
      stage: 'done',
      message: `Đã chạm limit ${dailyLimit} comment/ngày — tạm dừng, mai chạy tiếp.`,
      busy: false
    })
    insertLog({
      accountId,
      accountLabel: label,
      ts: Date.now(),
      ok: true,
      caption: `Bỏ qua — đã chạm limit ${dailyLimit} comment/ngày`,
      url: null,
      error: null,
      step: 'limit',
      screenshot: null,
      eventType: logEventType
    })
    return {
      ok: true,
      commentedCount: 0,
      urls: [],
      step: 'limit',
      limitReached: true
    }
  }
  // Nếu count + commentCount > limit -> chỉ comment số còn lại được phép.
  const allowedThisRun = Math.min(commentCount, dailyLimit - countToday)

  // 2. Lấy nội dung bình luận từ n8n.
  if (!account.handle) {
    emitProgress({ accountId, accountLabel: label, stage: 'error', message: 'Tài khoản chưa có username X.', busy: false })
    return {
      ok: false,
      commentedCount: 0,
      urls: [],
      error: 'Tài khoản chưa có username X — không thể vào profile để bình luận.',
      step: 'prepare'
    }
  }
  const handle = account.handle.replace(/^@+/, '')

  emitProgress({ accountId, accountLabel: label, stage: 'fetch', message: 'Đang lấy nội dung bình luận từ n8n…', busy: true })
  let payload
  try {
    payload = await fetchCommentPayload(handle, sourceUrl)
  } catch (e) {
    insertLog({
      accountId,
      accountLabel: label,
      ts: Date.now(),
      ok: false,
      caption: 'Lấy nội dung bình luận lỗi',
      url: null,
      error: (e as Error).message,
      step: 'fetch',
      screenshot: null,
      eventType: logEventType
    })
    emitProgress({ accountId, accountLabel: label, stage: 'error', message: `Lỗi: ${(e as Error).message}`, busy: false })
    return { ok: false, commentedCount: 0, urls: [], error: (e as Error).message, step: 'fetch' }
  }
  if (payload.skip || !payload.comment) {
    emitProgress({
      accountId,
      accountLabel: label,
      stage: 'done',
      message: 'Không có nội dung bình luận (n8n trả SKIP/trống) — bỏ qua lần chạy.',
      busy: false
    })
    insertLog({
      accountId,
      accountLabel: label,
      ts: Date.now(),
      ok: true,
      caption: 'Bỏ qua — không có nội dung bình luận',
      url: null,
      error: null,
      step: 'no_content',
      screenshot: null,
      eventType: logEventType
    })
    return { ok: true, commentedCount: 0, urls: [], step: 'no_content' }
  }
  const commentText = payload.comment

  // 3. Mở profile nếu chưa mở.
  let openedByUs = false
  let context = browserManager.getContext(accountId)
  if (!context) {
    emitProgress({ accountId, accountLabel: label, stage: 'open', message: 'Đang mở profile…', busy: true })
    await browserManager.openProfile(account)
    setAccountStatus(accountId, 'logged_in')
    context = browserManager.getContext(accountId)
    openedByUs = true
  }
  if (!context) throw new Error('Không mở được profile.')

  const commentedUrls: string[] = []
  let commentedCount = 0

  try {
    // 4. Check link chưa xử lý (status='collected') trong cache từ lần trước.
    //    Nếu còn đủ → KHÔNG cần cuộn profile → xử lý thẳng (tiết kiệm thời gian).
    //    Nếu không đủ → cuộn profile collect thêm → cache → xử lý.
    let unprocessed = listUnprocessedLinks(accountId, 50)

    if (unprocessed.length < allowedThisRun) {
      // 5. Cuộn profile thu thập link bài (collect 20 link, không early-stop).
      const collectCount = 20
      emitProgress({
        accountId,
        accountLabel: label,
        stage: 'collect',
        message: `Cache còn ${unprocessed.length} link, cần thêm — đang cuộn profile…`,
        busy: true
      })
      const collected = await scrollProfileCollectTweetUrls(
        context,
        handle,
        collectCount,
        accountId,
        (message) => emitProgress({ accountId, accountLabel: label, stage: 'collect', message, busy: true })
      )
      if (collected.error) {
        insertLog({
          accountId,
          accountLabel: label,
          ts: Date.now(),
          ok: false,
          caption: 'Thu thập link bài lỗi',
          url: null,
          error: collected.error,
          step: 'collect',
          screenshot: collected.screenshot ?? null,
          eventType: logEventType
        })
        emitProgress({ accountId, accountLabel: label, stage: 'error', message: `Lỗi: ${collected.error}`, busy: false })
        return { ok: false, commentedCount: 0, urls: [], error: collected.error, step: 'collect', screenshot: collected.screenshot }
      }

      // 6. Cache TẤT CẢ link vừa thu thập (status='collected'). Link trùng → IGNORE.
      if (collected.urls.length > 0) {
        insertCollectedLinks(accountId, collected.urls)
      }

      // 7. Lấy lại danh sách chưa xử lý (gồm link mới + link cũ còn dư).
      unprocessed = listUnprocessedLinks(accountId, 50)
    } else {
      emitProgress({
        accountId,
        accountLabel: label,
        stage: 'collect',
        message: `Cache còn ${unprocessed.length} link chưa xử lý — bỏ qua cuộn profile.`,
        busy: true
      })
    }

    if (unprocessed.length === 0) {
      emitProgress({
        accountId,
        accountLabel: label,
        stage: 'done',
        message: 'Không có link mới phù hợp (tất cả đã xử lý trước đó) — bỏ qua lần chạy.',
        busy: false
      })
      insertLog({
        accountId,
        accountLabel: label,
        ts: Date.now(),
        ok: true,
        caption: 'Bỏ qua — không có link mới (tất cả đã xử lý)',
        url: null,
        error: null,
        step: 'no_match',
        screenshot: null,
        eventType: logEventType
      })
      return { ok: true, commentedCount: 0, urls: [], step: 'no_match' }
    }

    emitProgress({
      accountId,
      accountLabel: label,
      stage: 'comment',
      message: `Có ${unprocessed.length} link chờ xử lý. Cần bình luận ${allowedThisRun} bài (đã comment ${countToday}/${dailyLimit} hôm nay).`,
      busy: true
    })

    // 8. Duyệt tuần tự từng link chưa xử lý. Mở tweet -> check reply/gốc -> comment.
    //    Dừng khi đủ target HOẶC hết link. Reply -> update status='reply_skip'.
    //    Gốc -> comment -> update 'commented'. Lỗi -> update 'fail' (thử lại lần sau).
    let failCount = 0
    let processedIndex = 0
    while (commentedCount < allowedThisRun && processedIndex < unprocessed.length) {
      const url = unprocessed[processedIndex]
      processedIndex++
      const isLast = processedIndex >= unprocessed.length || commentedCount + 1 >= allowedThisRun
      emitProgress({
        accountId,
        accountLabel: label,
        stage: 'comment',
        message: `Đang kiểm tra bài ${processedIndex}/${unprocessed.length} (đã comment ${commentedCount}/${allowedThisRun})…`,
        busy: true
      })
      const r = await commentOnTweet(
        context,
        url,
        commentText,
        accountId,
        (message) => emitProgress({ accountId, accountLabel: label, stage: 'comment', message, busy: true })
      )
      if (r.ok) {
        commentedCount++
        commentedUrls.push(url)
        updateLinkStatus(accountId, url, 'commented')
      } else if (r.skipped) {
        updateLinkStatus(accountId, url, 'reply_skip')
        emitProgress({
          accountId,
          accountLabel: label,
          stage: 'comment',
          message: `Bài ${processedIndex} là reply — bỏ qua, thử bài kế…`,
          busy: true
        })
      } else {
        failCount++
        updateLinkStatus(accountId, url, 'fail')
        insertLog({
          accountId,
          accountLabel: label,
          ts: Date.now(),
          ok: false,
          caption: `Bình luận bài ${processedIndex} lỗi`,
          url,
          error: r.error ?? 'Lỗi không xác định',
          step: r.step ?? 'comment',
          screenshot: r.screenshot ?? null,
          eventType: logEventType
        })
      }
      // Delay giữa các bài (trừ bài cuối hoặc đã đủ target).
      if (!isLast && commentedCount < allowedThisRun) {
        emitProgress({
          accountId,
          accountLabel: label,
          stage: 'comment',
          message: `Chờ ${commentIntervalSeconds}s trước bài kế…`,
          busy: true
        })
        await sleep(commentIntervalSeconds * 1000)
      }
    }

    // 9. Prune history, ghi log tổng, báo status.
    pruneCommentHistory(accountId)
    const ok = failCount === 0
    const caption =
      commentedCount > 0
        ? `Đã bình luận ${commentedCount}/${allowedThisRun} bài${failCount > 0 ? ` (${failCount} lỗi)` : ''}`
        : `Bình luận lỗi — 0 bài thành công`
    insertLog({
      accountId,
      accountLabel: label,
      ts: Date.now(),
      ok,
      caption,
      url: commentedUrls[0] ?? null,
      error: ok ? null : `${failCount} bài bình luận lỗi`,
      step: ok ? 'done' : 'partial',
      screenshot: null,
      eventType: logEventType,
      urls: commentedUrls
    })
    pruneLogs()

    emitProgress({
      accountId,
      accountLabel: label,
      stage: ok ? 'done' : 'error',
      message: ok
        ? `Hoàn thành — đã bình luận ${commentedCount} bài`
        : `Hoàn thành (${commentedCount} thành công, ${failCount} lỗi)`,
      busy: false
    })
    return {
      ok,
      commentedCount,
      urls: commentedUrls,
      step: ok ? 'done' : 'partial',
      limitReached: countToday + commentedCount >= dailyLimit
    }
  } finally {
    // Luôn đóng profile nếu do pipeline tự mở.
    if (openedByUs) {
      await browserManager.closeProfile(accountId).catch(() => {})
    }
  }
}

// Pipeline phiên tương tác feed (scroll/like/comment AI/refresh) theo thời lượng.
// BLOCKING tới hết phiên — giữ slot suốt thời lượng (nhả slot chỉ sau khi return).
// Nhờ đó lịch khác của CÙNG account phải chờ (activeAccountIds trong scheduler).
export async function runInteractForAccount(
  accountId: string,
  opts?: { source?: 'manual' | 'schedule'; durationMinutes?: number }
): Promise<{ ok: boolean; error?: string }> {
  const account = getAccount(accountId)
  if (!account) throw new Error(`Account không tồn tại: ${accountId}`)
  const logEventType = opts?.source === 'schedule' ? 'run_interact' : 'interact'
  const label = account.label
  const durationMinutes = Math.max(1, opts?.durationMinutes ?? 15)

  emitProgress({ accountId, accountLabel: label, stage: 'prepare', message: 'Đang kiểm tra profile…', busy: true })

  // Mở profile nếu chưa mở. Ghi nhận để đóng khi xong (dù thành công hay lỗi).
  let openedByUs = false
  let context = browserManager.getContext(accountId)
  if (!context) {
    emitProgress({ accountId, accountLabel: label, stage: 'open', message: 'Đang mở profile…', busy: true })
    await browserManager.openProfile(account)
    setAccountStatus(accountId, 'logged_in')
    context = browserManager.getContext(accountId)
    openedByUs = true
  }
  if (!context) throw new Error('Không mở được profile.')

  try {
    emitProgress({
      accountId,
      accountLabel: label,
      stage: 'interact',
      message: `Bắt đầu phiên tương tác ${durationMinutes} phút…`,
      busy: true
    })
    const result = await runInteractSession(
      context,
      accountId,
      { durationMinutes },
      (message) => emitProgress({ accountId, accountLabel: label, stage: 'interact', message, busy: true })
    )

    const caption = result.ok
      ? `Tương tác ${durationMinutes} phút · cuộn ${result.scrolls} · tim ${result.likes} · bình luận ${result.comments} · F5 ${result.refreshes}`
      : `Phiên tương tác lỗi`
    insertLog({
      accountId,
      accountLabel: label,
      ts: Date.now(),
      ok: result.ok,
      caption,
      url: null,
      error: result.ok ? null : (result.error ?? 'Lỗi không xác định'),
      step: result.ok ? 'done' : 'interact',
      screenshot: null,
      eventType: logEventType,
      // Link các bài đã bình luận trong phiên — hiển thị chi tiết (gập/mở) ở Nhật ký.
      urls: result.commentedUrls
    })
    pruneLogs()

    emitProgress({
      accountId,
      accountLabel: label,
      stage: result.ok ? 'done' : 'error',
      message: result.ok ? `Hoàn thành — ${caption}` : `Lỗi: ${result.error ?? 'không xác định'}`,
      busy: false
    })
    return { ok: result.ok, error: result.error }
  } finally {
    // Luôn đóng profile nếu do pipeline tự mở.
    if (openedByUs) {
      await browserManager.closeProfile(accountId).catch(() => {})
    }
  }
}