import type { BrowserContext, Page, Locator } from 'patchright'
import { scrollDown, commentOnTweet, collectTweetContext, type StepReporter } from './XActions'
import { generateComment } from '../ai/AiClient'
import { getAllSettings } from '../db/settings'
import { countCommentsToday, insertCommentedLink } from '../db/comment_history'
import { isStopRequested } from '../scheduler/cancel'

// Phiên "tương tác feed" mô phỏng người thật: cuộn feed, thỉnh thoảng like/comment/F5.
// Chạy theo NGÂN SÁCH THỜI GIAN — lặp tới khi hết thời lượng, mỗi vòng bốc 1 action
// theo trọng số rồi nghỉ "think-time" ngẫu nhiên.
//   - Không đặt số bình luận mục tiêu (target=0): số comment TỰ NẢY SINH (cap floor(phút/2.5)).
//   - Đặt target>0: app PHÂN BỔ để đạt đúng số bình luận đó, giãn đều trong thời lượng (ép
//     comment khi trễ tiến độ). Các action khác vẫn tự nảy sinh quanh đó.

const noop: StepReporter = () => {}

export interface InteractResult {
  ok: boolean
  scrolls: number
  likes: number
  comments: number
  refreshes: number
  // URL các bài đã bình luận thành công trong phiên (để nhật ký hiển thị chi tiết cho user).
  commentedUrls: string[]
  // Phiên bị user bấm Dừng giữa chừng (không phải lỗi) — dùng để ghi nhật ký đúng loại.
  stopped?: boolean
  error?: string
}

type ActionKind = 'scroll' | 'like' | 'refresh' | 'comment' | 'longpause'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Think-time lệch phải: giá trị nhỏ hay gặp hơn giá trị lớn (rand^1.5).
function thinkTime(minMs: number, maxMs: number): number {
  const r = Math.pow(Math.random(), 1.5)
  return Math.round(minMs + (maxMs - minMs) * r)
}

// Bốc 1 action theo trọng số. weights: { action: trọng_số }.
function weightedPick(weights: Record<ActionKind, number>): ActionKind {
  const entries = Object.entries(weights) as [ActionKind, number][]
  const total = entries.reduce((s, [, w]) => s + w, 0)
  if (total <= 0) return 'scroll'
  let r = Math.random() * total
  for (const [action, w] of entries) {
    r -= w
    if (r < 0) return action
  }
  return entries[entries.length - 1][0]
}

// Đọc ngôn ngữ + trạng thái auto-dịch của 1 tweet trong 1 lần evaluate (nhanh, đúng DOM).
// X gán thuộc tính lang (ISO 639-1) trên tweetText: 'vi'=Việt, 'en'=Anh, 'ja'=Nhật…
// CẢNH BÁO: khi bật tự-động-dịch, X dịch bài nước ngoài sang ngôn ngữ GIAO DIỆN rồi GHI ĐÈ
// lang thành ngôn ngữ ĐÃ DỊCH (bài Nhật hiển thị tiếng Anh -> lang="en"). Lúc đó lang KHÔNG
// phản ánh ngôn ngữ gốc. Nhận diện banner dịch KHÔNG phụ thuộc chữ (chữ "Hiện bản gốc" đổi
// theo ngôn ngữ giao diện): element ngay TRƯỚC tweetText chứa cả icon (svg) + nút (role=button).
async function readTweetLangInfo(
  article: Locator
): Promise<{ lang: string | null; translated: boolean }> {
  return article
    .evaluate((el) => {
      const tt = el.querySelector('[data-testid="tweetText"]')
      if (!tt) return { lang: null, translated: false }
      const prev = tt.previousElementSibling
      const translated = !!(prev && prev.querySelector('svg') && prev.querySelector('[role="button"]'))
      return { lang: tt.getAttribute('lang'), translated }
    })
    .catch(() => ({ lang: null as string | null, translated: false }))
}

// So khớp ngôn ngữ bài với thiết đặt tài khoản (aiCommentLang). 'auto'/rỗng = không lọc.
// Khi đang lọc: (1) bài đã AUTO-DỊCH bị bỏ qua (lang đã dịch, gốc là ngôn ngữ khác — không tin
// được), (2) bài không có text (lang=null) bị bỏ qua, chỉ khớp bài CHƯA dịch có lang đúng.
function langMatches(info: { lang: string | null; translated: boolean }, filterLang: string): boolean {
  if (!filterLang || filterLang === 'auto') return true
  if (info.translated) return false
  return info.lang === filterLang
}

// Like 1 tweet đang hiển thị chưa like. Chống trùng qua Set href đã thao tác.
// filterLang: lọc theo ngôn ngữ bài trước khi like ('auto' = không lọc).
// Trả về true nếu like được 1 bài mới.
async function likeVisibleTweet(
  page: Page,
  likedHrefs: Set<string>,
  filterLang: string
): Promise<boolean> {
  const articles = page.locator('article[data-testid="tweet"]')
  const count = await articles.count().catch(() => 0)
  if (count === 0) return false
  // Duyệt các article đang hiển thị, tìm nút like chưa bấm.
  const start = Math.floor(Math.random() * count)
  for (let i = 0; i < count; i++) {
    const idx = (start + i) % count
    const article = articles.nth(idx)
    if (!(await article.isVisible().catch(() => false))) continue
    // href định danh bài (để chống like trùng trong 1 phiên).
    const href = await article
      .locator('a[href*="/status/"]')
      .first()
      .getAttribute('href')
      .catch(() => null)
    if (href && likedHrefs.has(href)) continue
    // Lọc ngôn ngữ: chỉ like bài đúng ngôn ngữ thiết đặt ('auto' = không lọc).
    // Bỏ qua bài X đã auto-dịch (lang đã bị đổi sang ngôn ngữ dịch, không tin được).
    if (!langMatches(await readTweetLangInfo(article), filterLang)) continue
    const likeBtn = article.locator('[data-testid="like"]').first()
    if (!(await likeBtn.isVisible().catch(() => false))) continue
    await likeBtn.scrollIntoViewIfNeeded().catch(() => {})
    const clicked = await likeBtn.click({ timeout: 3000 }).then(() => true).catch(() => false)
    if (clicked) {
      if (href) likedHrefs.add(href)
      return true
    }
  }
  return false
}

// Đọc text + link của 1 tweet đang hiển thị chưa comment (để AI sinh bình luận).
async function readCommentableTweet(
  page: Page,
  handledHrefs: Set<string>,
  filterLang: string
): Promise<{ text: string; url: string } | null> {
  const articles = page.locator('article[data-testid="tweet"]')
  const count = await articles.count().catch(() => 0)
  if (count === 0) return null
  const start = Math.floor(Math.random() * count)
  for (let i = 0; i < count; i++) {
    const idx = (start + i) % count
    const article = articles.nth(idx)
    if (!(await article.isVisible().catch(() => false))) continue
    const rawHref = await article
      .locator('a[href*="/status/"]')
      .first()
      .getAttribute('href')
      .catch(() => null)
    if (!rawHref) continue
    // Article chứa NHIỀU link /status/: permalink (timestamp), /analytics, /photo/1…
    // Cắt về đúng permalink gốc ".../status/<id>" để không mở nhầm trang analytics
    // (trang analytics không có ô reply -> click timeout + 0 reply).
    const m = rawHref.match(/^(.*\/status\/\d+)/)
    if (!m) continue
    const href = m[1]
    if (handledHrefs.has(href)) continue
    // Lọc ngôn ngữ: chỉ comment bài đúng ngôn ngữ thiết đặt ('auto' = không lọc).
    // Bỏ qua bài X đã auto-dịch (lang đã bị đổi sang ngôn ngữ dịch, không tin được).
    if (!langMatches(await readTweetLangInfo(article), filterLang)) continue
    const text = await article
      .locator('[data-testid="tweetText"]')
      .first()
      .innerText()
      .catch(() => '')
    if (!text.trim()) continue
    // Chuẩn hoá href -> URL đầy đủ.
    const url = href.startsWith('http') ? href : `https://x.com${href}`
    return { text: text.trim(), url }
  }
  return null
}

// F5 feed: luôn về x.com/home. KHÔNG dùng /explore vì trang đó chỉ có gợi ý follow +
// hashtag trend, không có bài để tương tác -> lãng phí lượt.
async function refreshFeed(page: Page): Promise<void> {
  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
}

export async function runInteractSession(
  context: BrowserContext,
  accountId: string,
  opts: {
    durationMinutes: number
    aiTone: string
    aiLang: string
    aiFormat: string
    // Số bình luận MỤC TIÊU. 0 = tự tính theo thời lượng (như cũ). >0 = phân bổ để đạt đúng số này.
    commentTarget?: number
  },
  report: StepReporter = noop
): Promise<InteractResult> {
  const durationMs = Math.max(1, opts.durationMinutes) * 60_000
  const sessionEnd = Date.now() + durationMs

  let scrolls = 0
  let likes = 0
  let comments = 0
  let refreshes = 0

  const likedHrefs = new Set<string>()
  const commentedHrefs = new Set<string>()
  const commentedUrls: string[] = []

  const MIN_COMMENT_GAP_MS = 90_000 // tối thiểu 90s giữa 2 comment (chống spam)
  // Cap + nhịp comment:
  //   - target = 0 (tự tính): cap = floor(phút/2.5), tối thiểu 1; nhịp = MIN_COMMENT_GAP_MS.
  //   - target > 0 (user đặt): cap = target; nhịp = giãn ĐỀU trong thời lượng (durationMs/target)
  //     nhưng không nhỏ hơn MIN_COMMENT_GAP_MS. Nhờ vậy comment rải đều cả phiên thay vì dồn cục.
  const targetMode = (opts.commentTarget ?? 0) > 0
  const commentCap = targetMode
    ? Math.max(1, Math.floor(opts.commentTarget as number))
    : Math.max(1, Math.floor(opts.durationMinutes / 2.5))
  const commentGapMs = targetMode
    ? Math.max(MIN_COMMENT_GAP_MS, Math.floor(durationMs / commentCap))
    : MIN_COMMENT_GAP_MS
  let lastCommentAt = 0
  const dailyLimit = getAllSettings().commentDailyLimit

  // Mở/lấy page feed rồi vào home.
  const page = context.pages()[0] ?? (await context.newPage())
  report('Đang mở feed X…')
  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
  await sleep(2500)

  // Session hết hạn -> bị đẩy về login.
  if (page.url().includes('/login') || page.url().includes('/i/flow/login')) {
    return {
      ok: false,
      scrolls,
      likes,
      comments,
      refreshes,
      commentedUrls,
      error: 'Session hết hạn — bị chuyển về trang đăng nhập. Hãy mở profile và đăng nhập lại.'
    }
  }

  while (Date.now() < sessionEnd) {
    // User bấm Dừng -> thoát phiên ngay (không phải lỗi).
    if (isStopRequested(accountId)) {
      report('Đã dừng phiên theo yêu cầu.')
      return { ok: true, scrolls, likes, comments, refreshes, commentedUrls, stopped: true }
    }
    // Xác định có được phép comment ở vòng này không.
    const nowMs = Date.now()
    const commentedToday = countCommentsToday(accountId)
    const underCap = comments < commentCap && commentedToday < dailyLimit
    const gapPassed = nowMs - lastCommentAt >= commentGapMs

    // targetMode: nếu ĐANG TRỄ tiến độ (số comment thực tế < kỳ vọng theo thời gian đã trôi)
    // thì ÉP comment. Khi trễ, BỎ QUA ràng buộc giãn cách (gap chỉ để rải đều lúc thong thả,
    // không nên cản khi đã trễ) — vẫn giữ giãn cách tối thiểu MIN_COMMENT_GAP_MS chống spam.
    // Nhờ vậy phiên "bắt kịp" và đạt đủ số bình luận mục tiêu dù mỗi comment tốn thời gian thực.
    let forceComment = false
    if (targetMode && underCap) {
      const elapsedRatio = (nowMs - (sessionEnd - durationMs)) / durationMs
      const expected = Math.min(commentCap, Math.floor(elapsedRatio * commentCap) + 1)
      const minGapPassed = nowMs - lastCommentAt >= MIN_COMMENT_GAP_MS
      if (comments < expected && minGapPassed) forceComment = true
    }

    const canComment = underCap && gapPassed

    // Trọng số hành vi: scroll 60 / like 22 / refresh 8 / comment 6 / nghỉ-dài 4.
    const weights: Record<ActionKind, number> = {
      scroll: 60,
      like: 22,
      refresh: 8,
      comment: canComment ? 6 : 0,
      longpause: 4
    }
    const action: ActionKind = forceComment ? 'comment' : weightedPick(weights)

    const remainMin = Math.max(0, Math.ceil((sessionEnd - Date.now()) / 60_000))

    try {
      if (action === 'scroll') {
        await scrollDown(page)
        scrolls++
        report(`Cuộn feed (${scrolls}) · còn ~${remainMin} phút`)
        await sleep(thinkTime(2000, 5000))
      } else if (action === 'like') {
        const liked = await likeVisibleTweet(page, likedHrefs, opts.aiLang)
        if (liked) {
          likes++
          report(`Thả tim 1 bài (${likes}) · còn ~${remainMin} phút`)
        } else {
          // Không tìm được bài để like -> cuộn thêm cho có bài mới.
          await scrollDown(page)
          scrolls++
        }
        await sleep(thinkTime(1000, 2500))
      } else if (action === 'refresh') {
        await refreshFeed(page)
        refreshes++
        report(`Làm mới feed (F5) · còn ~${remainMin} phút`)
        await sleep(thinkTime(2000, 5000))
      } else if (action === 'longpause') {
        report(`Nghỉ giây lát · còn ~${remainMin} phút`)
        await sleep(thinkTime(8000, 15000))
      } else if (action === 'comment') {
        const target = await readCommentableTweet(page, commentedHrefs, opts.aiLang)
        if (!target) {
          // Không có bài phù hợp -> cuộn thêm.
          await scrollDown(page)
          scrolls++
          await sleep(thinkTime(2000, 5000))
        } else {
          commentedHrefs.add(target.url)
          // Thu thập ngữ cảnh: mở bài viết, đọc caption đầy đủ + tối đa 20 reply CÓ NGHĨA
          // (khớp đúng số reply AiClient dùng làm ngữ cảnh — thu nhiều hơn chỉ tổ chậm mỗi
          // comment mà AI không dùng tới). Cuộn + bấm "Show more replies" + khử trùng permalink.
          // Lỗi đọc reply không chặn: fallback về caption từ feed.
          report('Đang đọc bài viết + reply để lấy ngữ cảnh…')
          const ctx = await collectTweetContext(context, target.url, 20, accountId, (m) =>
            report(m)
          )
          const captionForAi = ctx.caption?.trim() ? ctx.caption : target.text
          report('Đang nhờ AI sinh bình luận…')
          const ai = await generateComment(captionForAi, {
            tone: opts.aiTone,
            lang: opts.aiLang,
            format: opts.aiFormat,
            replies: ctx.replies
          })
          if (ai.ok && ai.comment) {
            const r = await commentOnTweet(context, target.url, ai.comment, accountId, (m) =>
              report(m)
            )
            if (r.ok) {
              comments++
              lastCommentAt = Date.now()
              commentedUrls.push(target.url)
              insertCommentedLink(accountId, target.url, 'commented')
              report(`Đã bình luận 1 bài (${comments}/${commentCap}) · còn ~${remainMin} phút`)
            } else {
              // Comment lỗi/skip -> bỏ qua, phiên tiếp tục.
              report(`Bỏ qua bình luận: ${r.error ?? 'không comment được'}`)
            }
          } else {
            // AI lỗi/chưa cấu hình -> bỏ qua comment này.
            report(`Bỏ qua bình luận (AI): ${ai.error ?? 'không sinh được nội dung'}`)
          }
          // Sau khi comment mở page riêng, quay lại feed để tiếp tục cuộn.
          await page.bringToFront().catch(() => {})
          await sleep(thinkTime(3000, 8000))
        }
      }
    } catch (e) {
      // Lỗi 1 vòng không làm hỏng cả phiên — nghỉ ngắn rồi tiếp.
      report(`Lỗi thao tác: ${(e as Error).message} — tiếp tục.`)
      await sleep(1500)
    }
  }

  return { ok: true, scrolls, likes, comments, refreshes, commentedUrls }
}
