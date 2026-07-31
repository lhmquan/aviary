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
  type DeleteMode,
  type CommentContentSource
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
import {
  postTweet,
  deleteTweetsFromProfile,
  crawlNewestOwnPostUrls,
  readTweetViews,
  commentOnTweet
} from '../actions/XActions'
import { runInteractSession } from '../actions/InteractSession'
import { generateScheduledComment } from '../ai/AiClient'
import { isStopRequested, clearStop } from './cancel'
import { insertLog, pruneLogs } from '../db/logs'
import {
  insertCommentedLink,
  updateLinkStatus,
  listPermanentlySkippedSet,
  countCommentsToday,
  pruneCommentHistory
} from '../db/comment_history'
import { canonicalizeTweetUrl } from '../../shared/url'
import { normalizePostCaption } from '../text/caption'

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
  // Xoá cờ dừng của lần chạy trước (nếu có) để không dừng nhầm lần chạy mới.
  clearStop(accountId)

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
    // Nguồn Reddit/n8n đôi khi trả HTML entity hoặc chuỗi UTF-8 bị decode nhầm
    // (vd `AT&amp;T`, `â€™`, `Ã©`). Vẫn giữ payload gốc cho markDone khớp dữ liệu.
    fullCaption = normalizePostCaption(fullCaption)
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

    // User bấm Dừng khi đang chờ đăng -> bài CHƯA đăng chắc chắn -> KHÔNG markDone (để n8n
    // giữ nguyên, lần sau đăng lại). Ghi log 'stopped', không đánh dấu lỗi đỏ.
    if (result?.stopped) {
      insertLog({
        accountId,
        accountLabel: account.label,
        ts: Date.now(),
        ok: true,
        caption: fullCaption,
        url: null,
        error: null,
        step: 'stopped',
        screenshot: null,
        eventType: logEventType
      })
      pruneLogs()
      emitProgress({
        accountId,
        accountLabel: label,
        stage: 'done',
        message: 'Đã dừng đăng bài theo yêu cầu.',
        busy: false
      })
      return result
    }

    // X từ chối vì video dài quá giới hạn tài khoản (chưa premium). Bài này KHÔNG đăng
    // được với tài khoản hiện tại -> markDone (reason='video_too_long') để n8n đánh dấu
    // trong sheet, KHÔNG lấy lại; ghi log skip; đăng bài kế ở lần chạy sau. Khi lên
    // premium thì video dài đăng được nên không rơi vào nhánh này.
    if (result?.videoTooLong) {
      emitProgress({ accountId, accountLabel: label, stage: 'markdone', message: 'Video quá dài — đang báo n8n đánh dấu bỏ qua…', busy: true })
      const md = await markDone({
        accountId,
        assetUrl: account.assetUrl,
        id: payload.id,
        title: payload.caption ?? '',
        postUrl: null,
        url: payload.sourceUrl ?? null,
        reason: 'video_too_long'
      })
      insertLog({
        accountId,
        accountLabel: account.label,
        ts: Date.now(),
        ok: false,
        caption: fullCaption,
        url: null,
        error: `Bỏ qua (video quá dài — cần Premium)${md.ok ? '' : ` · markdone lỗi: ${md.error}`}`,
        step: 'skipped',
        screenshot: null,
        eventType: logEventType
      })
      pruneLogs()
      emitProgress({
        accountId,
        accountLabel: label,
        stage: 'done',
        message: md.ok
          ? 'Đã bỏ qua bài video quá dài (đã báo n8n). Bấm đăng lại để lấy bài kế.'
          : `Bỏ qua bài video quá dài — báo n8n thất bại: ${md.error}`,
        busy: false
      })
      return { ok: false, skipped: true, videoTooLong: true, error: result.error }
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
  clearStop(accountId)

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

// Ghép tiền tố + link vào câu bình luận CỐ ĐỊNH (nguồn n8n). Tiền tố đứng đầu, link xuống
// dòng cuối. Trống -> giữ nguyên. (Nguồn AI ghép sẵn trong generateScheduledComment.)
function decorateFixedComment(
  body: string,
  prefix?: string | null,
  link?: string | null
): string {
  let out = body.trim()
  const p = (prefix ?? '').trim()
  const l = (link ?? '').trim()
  if (p) out = `${p} ${out}`.trim()
  if (l) out = `${out}\n${l}`.trim()
  return out
}

// Pipeline bình luận trên bài MỚI NHẤT của chính tài khoản. Dùng chung cho nút "Bình luận"
// (manual) và scheduler (schedule). source để phân biệt log (schedule->'run_comment').
//
// THIẾT KẾ (redesign):
//   - Mỗi lần chạy chỉ xét N bài MỚI NHẤT của chính tài khoản (commentNewestCount).
//   - Ứng viên URL: ƯU TIÊN lấy từ nhật ký đăng THÀNH CÔNG (không cần cuộn); chỉ cuộn profile
//     bổ sung khi số URL từ log < N. Lọc bài ghim/quảng cáo/repost/gợi ý ở bước cuộn.
//   - Đọc lượt xem (views) từ ĐÚNG anchor .../analytics (aria-label số nguyên đầy đủ). CHỈ
//     bình luận bài có views > ngưỡng (strict). Bài DƯỚI ngưỡng (hoặc chưa đọc được views)
//     KHÔNG bao giờ cache là đã xử lý -> lần chạy sau vẫn đọc lại nếu còn trong N bài mới nhất.
//   - Bỏ qua VĨNH VIỄN chỉ 2 loại: đã bình luận thành công ('commented') và reply thật
//     ('reply_skip') — cache trong comment_history.
//   - Nội dung bình luận: nguồn 'n8n' (câu cố định từ Sheet, dùng cho MỌI bài) hoặc 'ai'
//     (sinh riêng theo từng bài, dùng chỉ dẫn + số từ + tiền tố + link).
export async function runCommentForAccount(
  accountId: string,
  opts?: {
    source?: 'manual' | 'schedule'
    commentCount?: number
    commentIntervalSeconds?: number
    commentSourceUrl?: string | null
    commentNewestCount?: number
    commentViewThreshold?: number
    commentSource?: CommentContentSource
    commentAiInstruction?: string | null
    commentMaxChars?: number
    commentPrefix?: string | null
    commentLink?: string | null
  }
): Promise<CommentResult> {
  const account = getAccount(accountId)
  if (!account) throw new Error(`Account không tồn tại: ${accountId}`)
  const logEventType = opts?.source === 'schedule' ? 'run_comment' : 'comment'
  const label = account.label
  clearStop(accountId)

  const commentCount = Math.max(1, opts?.commentCount ?? 1)
  const commentIntervalSeconds = Math.max(5, opts?.commentIntervalSeconds ?? 60)
  const sourceUrl = opts?.commentSourceUrl ?? null
  const newestCount = Math.max(1, Math.floor(opts?.commentNewestCount ?? 20))
  const viewThreshold = Math.max(0, Math.floor(opts?.commentViewThreshold ?? 0))
  const contentSource: CommentContentSource = opts?.commentSource === 'ai' ? 'ai' : 'n8n'
  const dailyLimit = getAllSettings().commentDailyLimit

  emitProgress({ accountId, accountLabel: label, stage: 'prepare', message: 'Đang kiểm tra profile…', busy: true })

  // 1. Kiểm tra limit comment/ngày — chạm -> báo, dừng, mai chạy tiếp.
  // countCommentsToday đếm MỌI dòng status='commented' trong ngày -> GỘP CHUNG cả comment
  // từ lịch bình luận LẪN lịch tương tác feed (cả 2 đều ghi insertCommentedLink('commented')).
  // Nhờ vậy 1 tài khoản không vượt tổng giới hạn/ngày dù chạy song song 2 loại lịch.
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

  // 2. Bắt buộc có username X (để vào đúng profile).
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

  // 3. Nếu nguồn = n8n: lấy 1 câu bình luận cố định dùng chung cho mọi bài trong lần chạy.
  //    Nếu nguồn = ai: sinh riêng theo từng bài -> chưa lấy ở đây.
  let fixedComment = ''
  if (contentSource === 'n8n') {
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
    // Ghép tiền tố + link vào câu cố định (n8n) nếu user cấu hình.
    fixedComment = decorateFixedComment(payload.comment, opts?.commentPrefix, opts?.commentLink)
  }

  // 4. Mở profile nếu chưa mở.
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
    // 5. Dựng danh sách N bài MỚI NHẤT của chính tài khoản.
    //    Profile hiện tại là nguồn sự thật duy nhất. Nhật ký chỉ là lịch sử bài Aviary từng
    //    đăng, không phải snapshot timeline; trộn URL từ log có thể đưa bài cũ/đã xoá vào quota
    //    và làm bỏ sót bài mới.
    const candidates: string[] = []
    emitProgress({
      accountId,
      accountLabel: label,
      stage: 'collect',
      message: `Đang quét profile để lấy ${newestCount} bài gốc mới nhất…`,
      busy: true
    })
    const crawled = await crawlNewestOwnPostUrls(
      context,
      handle,
      newestCount,
      accountId,
      (message) => emitProgress({ accountId, accountLabel: label, stage: 'collect', message, busy: true })
    )
    const crawledPosts = new Map(
      crawled.posts.map((post) => [canonicalizeTweetUrl(post.url) ?? post.url, post])
    )
    for (const u of crawled.urls) {
      const canon = canonicalizeTweetUrl(u)
      if (canon) candidates.push(canon)
    }

    if (crawled.error) {
        insertLog({
          accountId,
          accountLabel: label,
          ts: Date.now(),
          ok: false,
          caption: 'Thu thập bài mới nhất lỗi',
          url: null,
          error: crawled.error,
          step: 'collect',
          screenshot: crawled.screenshot ?? null,
          eventType: logEventType
        })
        emitProgress({ accountId, accountLabel: label, stage: 'error', message: `Lỗi: ${crawled.error}`, busy: false })
        return { ok: false, commentedCount: 0, urls: [], error: crawled.error, step: 'collect', screenshot: crawled.screenshot }
    }

    if (candidates.length === 0) {
      emitProgress({
        accountId,
        accountLabel: label,
        stage: 'done',
        message: 'Không tìm thấy bài nào của tài khoản để bình luận — bỏ qua lần chạy.',
        busy: false
      })
      insertLog({
        accountId,
        accountLabel: label,
        ts: Date.now(),
        ok: true,
        caption: 'Bỏ qua — không có bài nào để bình luận',
        url: null,
        error: null,
        step: 'no_match',
        screenshot: null,
        eventType: logEventType
      })
      return { ok: true, commentedCount: 0, urls: [], step: 'no_match' }
    }

    // 6. Loại các bài đã xử lý VĨNH VIỄN (đã bình luận / là reply thật) khỏi ứng viên.
    const permaSkip = listPermanentlySkippedSet(accountId)
    const pending = candidates.filter((u) => !permaSkip.has(u))

    emitProgress({
      accountId,
      accountLabel: label,
      stage: 'comment',
      message: `${pending.length}/${candidates.length} bài mới nhất chờ xét (ngưỡng views > ${viewThreshold.toLocaleString('en-US')}). Cần ${allowedThisRun} bài (đã comment ${countToday}/${dailyLimit} hôm nay).`,
      busy: true
    })

    // 7. Pha 1 — Dùng views đã đọc ngay trên profile trước. Chỉ mở detail khi profile
    //    không có số đầy đủ (bài mới render thiếu analytics hoặc layout X khác).
    //    Bài dưới ngưỡng / không đọc được views -> KHÔNG cache (thử lại lần sau).
    const maxConcurrentTabs = Math.max(1, getAllSettings().maxConcurrentTabs)
    const needsDetail = pending.filter((url) => crawledPosts.get(url)?.views == null)
    emitProgress({
      accountId,
      accountLabel: label,
      stage: 'comment',
      message: needsDetail.length
        ? `Đã đọc view trực tiếp trên profile; mở detail bổ sung cho ${needsDetail.length}/${pending.length} bài…`
        : `Đã đọc view trực tiếp trên profile cho ${pending.length} bài; không cần mở detail để lấy view.`,
      busy: true
    })

    type QualifiedPost = { url: string; views: number; caption: string }
    const qualified: QualifiedPost[] = []
    let belowThreshold = 0
    let stoppedEarly = false

    for (let batchStart = 0; batchStart < pending.length; batchStart += maxConcurrentTabs) {
      if (isStopRequested(accountId)) {
        stoppedEarly = true
        break
      }
      const batch = pending.slice(batchStart, batchStart + maxConcurrentTabs)
      const batchResults = await Promise.all(
        batch.map((url, i) => {
          const idx = batchStart + i + 1
          const inline = crawledPosts.get(url)
          if (inline?.views != null) {
            return Promise.resolve({
              url,
              vr: { views: inline.views, caption: inline.caption },
              idx
            })
          }
          return readTweetViews(context, url, accountId, (msg) =>
            emitProgress({
              accountId,
              accountLabel: label,
              stage: 'comment',
              message: `[${idx}/${pending.length}] ${msg}`,
              busy: true
            })
          ).then((vr) => ({ url, vr, idx }))
        })
      )
      for (const { url, vr, idx } of batchResults) {
        if (vr.views == null) {
          emitProgress({
            accountId,
            accountLabel: label,
            stage: 'comment',
            message: `Bài ${idx}: chưa đọc được lượt xem — bỏ qua lần này (không cache).`,
            busy: true
          })
          continue
        }
        if (!(vr.views > viewThreshold)) {
          belowThreshold++
          emitProgress({
            accountId,
            accountLabel: label,
            stage: 'comment',
            message: `Bài ${idx}: ${vr.views.toLocaleString('en-US')} views ≤ ngưỡng — chưa bình luận (sẽ xét lại sau).`,
            busy: true
          })
          continue
        }
        qualified.push({ url, views: vr.views, caption: vr.caption ?? '' })
      }
    }

    emitProgress({
      accountId,
      accountLabel: label,
      stage: 'comment',
      message: `Xét xong views: ${qualified.length} bài đạt ngưỡng, ${belowThreshold} bài chưa đủ. Bắt đầu bình luận…`,
      busy: true
    })

    // 7b. Pha 2 — Bình luận tuần tự các bài đã đạt ngưỡng views.
    //     Tuần tự để tránh X phát hiện đăng hàng loạt.
    let failCount = 0
    let processedIndex = 0
    for (const { url, views, caption } of qualified) {
      if (commentedCount >= allowedThisRun) break
      if (isStopRequested(accountId)) {
        stoppedEarly = true
        break
      }
      processedIndex++

      // 7c. Chuẩn bị nội dung bình luận cho bài này.
      let commentText = fixedComment
      if (contentSource === 'ai') {
        emitProgress({
          accountId,
          accountLabel: label,
          stage: 'comment',
          message: `Bài ${processedIndex}/${qualified.length}: ${views.toLocaleString('en-US')} views — nhờ AI sinh bình luận…`,
          busy: true
        })
        // Caption đã đọc SẴN trong readTweetViews (cùng lần mở bài) — KHÔNG mở lại để cào reply.
        // Lịch bình luận dùng CHỈ DẪN của user là chính; caption chỉ để AI bám nội dung bài.
        // Bài không có caption (chỉ ảnh/video) -> vẫn sinh theo chỉ dẫn (không bỏ bài).
        const captionForAi = caption.trim()
        const ai = await generateScheduledComment(captionForAi, {
          instruction: opts?.commentAiInstruction ?? null,
          lang: account.aiCommentLang,
          maxChars: opts?.commentMaxChars ?? 0,
          prefix: opts?.commentPrefix ?? null,
          link: opts?.commentLink ?? null
        })
        if (!ai.ok || !ai.comment) {
          // AI lỗi/chưa cấu hình -> bỏ qua bài này (KHÔNG cache), ghi log để user biết.
          insertLog({
            accountId,
            accountLabel: label,
            ts: Date.now(),
            ok: false,
            caption: `AI không sinh được bình luận cho bài ${processedIndex}`,
            url,
            error: ai.error ?? 'AI lỗi',
            step: 'ai',
            screenshot: null,
            eventType: logEventType
          })
          emitProgress({
            accountId,
            accountLabel: label,
            stage: 'comment',
            message: `Bài ${processedIndex}: AI lỗi (${ai.error ?? 'không rõ'}) — bỏ qua.`,
            busy: true
          })
          continue
        }
        commentText = ai.comment
      }

      // 7d. Bình luận. reply thật -> cache reply_skip (vĩnh viễn). ok -> cache commented.
      //     Lỗi khác -> log, KHÔNG cache (thử lại lần sau).
      emitProgress({
        accountId,
        accountLabel: label,
        stage: 'comment',
        message: `Đang bình luận bài ${processedIndex}/${qualified.length} (${views.toLocaleString('en-US')} views)…`,
        busy: true
      })
      const r = await commentOnTweet(context, url, commentText, accountId, (message) =>
        emitProgress({ accountId, accountLabel: label, stage: 'comment', message, busy: true })
      )
      if (r.ok) {
        commentedCount++
        commentedUrls.push(url)
        insertCommentedLink(accountId, url, 'commented')
      } else if (r.skipped) {
        // Reply thật -> bỏ qua VĨNH VIỄN.
        insertCommentedLink(accountId, url, 'reply_skip')
        emitProgress({
          accountId,
          accountLabel: label,
          stage: 'comment',
          message: `Bài ${processedIndex} là reply — bỏ qua vĩnh viễn, thử bài kế…`,
          busy: true
        })
      } else {
        failCount++
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
      // Delay giữa các lần bình luận thành công (không delay sau bài bỏ qua/lỗi cho nhanh).
      if (r.ok && commentedCount < allowedThisRun) {
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

    // 8. Prune history, ghi log tổng, báo status.
    pruneCommentHistory(accountId)
    // Bị dừng giữa chừng -> ghi log 'stopped', trả về số đã bình luận tới lúc đó.
    if (stoppedEarly) {
      insertLog({
        accountId,
        accountLabel: label,
        ts: Date.now(),
        ok: true,
        caption: `Đã dừng — bình luận ${commentedCount}/${allowedThisRun} bài trước khi dừng`,
        url: commentedUrls[0] ?? null,
        error: null,
        step: 'stopped',
        screenshot: null,
        eventType: logEventType,
        urls: commentedUrls
      })
      pruneLogs()
      emitProgress({
        accountId,
        accountLabel: label,
        stage: 'done',
        message: `Đã dừng — đã bình luận ${commentedCount} bài trước khi dừng.`,
        busy: false
      })
      return { ok: true, commentedCount, urls: commentedUrls, step: 'stopped', stopped: true }
    }
    // ok khi không có bài lỗi. Bài dưới ngưỡng views KHÔNG tính là lỗi (chờ xét lại sau).
    const ok = failCount === 0
    const belowText = belowThreshold > 0 ? ` · ${belowThreshold} bài chưa đạt ngưỡng views` : ''
    const caption =
      commentedCount > 0
        ? `Đã bình luận ${commentedCount}/${allowedThisRun} bài${failCount > 0 ? ` (${failCount} lỗi)` : ''}${belowText}`
        : failCount > 0
          ? `Bình luận lỗi — 0 bài thành công${belowText}`
          : `Không bài nào đạt ngưỡng để bình luận${belowText}`
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
        ? `Hoàn thành — đã bình luận ${commentedCount} bài${belowText}`
        : `Hoàn thành (${commentedCount} thành công, ${failCount} lỗi)${belowText}`,
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
  opts?: { source?: 'manual' | 'schedule'; durationMinutes?: number; commentTarget?: number }
): Promise<{ ok: boolean; error?: string }> {
  const account = getAccount(accountId)
  if (!account) throw new Error(`Account không tồn tại: ${accountId}`)
  const logEventType = opts?.source === 'schedule' ? 'run_interact' : 'interact'
  const label = account.label
  const durationMinutes = Math.max(1, opts?.durationMinutes ?? 15)
  // 0 = tự tính theo thời lượng (như cũ); >0 = số bình luận mục tiêu user đặt.
  const commentTarget = Math.max(0, Math.floor(opts?.commentTarget ?? 0))
  clearStop(accountId)

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
      {
        durationMinutes,
        commentTarget,
        aiTone: account.aiCommentTone,
        aiLang: account.aiCommentLang,
        aiFormat: account.aiCommentFormat
      },
      (message) => emitProgress({ accountId, accountLabel: label, stage: 'interact', message, busy: true })
    )

    // Bị dừng giữa chừng -> nhãn "Đã dừng", step 'stopped' (không phải lỗi đỏ).
    const stat = `cuộn ${result.scrolls} · tim ${result.likes} · bình luận ${result.comments} · F5 ${result.refreshes}`
    const caption = result.stopped
      ? `Đã dừng phiên tương tác · ${stat}`
      : result.ok
        ? `Tương tác ${durationMinutes} phút · ${stat}`
        : `Phiên tương tác lỗi`
    insertLog({
      accountId,
      accountLabel: label,
      ts: Date.now(),
      ok: result.ok,
      caption,
      url: null,
      error: result.ok ? null : (result.error ?? 'Lỗi không xác định'),
      step: result.stopped ? 'stopped' : result.ok ? 'done' : 'interact',
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
      message: result.stopped
        ? `Đã dừng — ${stat}`
        : result.ok
          ? `Hoàn thành — ${caption}`
          : `Lỗi: ${result.error ?? 'không xác định'}`,
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
