import type { BrowserContext, Page } from 'patchright'
import { scrollDown, commentOnTweet, type StepReporter } from './XActions'
import { generateComment } from '../ai/AiClient'
import { getAllSettings } from '../db/settings'
import { countCommentsToday, insertCommentedLink } from '../db/comment_history'

// Phiên "tương tác feed" mô phỏng người thật: cuộn feed, thỉnh thoảng like/comment/F5.
// Chạy theo NGÂN SÁCH THỜI GIAN — lặp tới khi hết thời lượng, mỗi vòng bốc 1 action
// theo trọng số rồi nghỉ "think-time" ngẫu nhiên. Số lượng mỗi action tự nảy sinh.

const noop: StepReporter = () => {}

export interface InteractResult {
  ok: boolean
  scrolls: number
  likes: number
  comments: number
  refreshes: number
  // URL các bài đã bình luận thành công trong phiên (để nhật ký hiển thị chi tiết cho user).
  commentedUrls: string[]
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

// Like 1 tweet đang hiển thị chưa like. Chống trùng qua Set href đã thao tác.
// Trả về true nếu like được 1 bài mới.
async function likeVisibleTweet(page: Page, likedHrefs: Set<string>): Promise<boolean> {
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
  handledHrefs: Set<string>
): Promise<{ text: string; url: string } | null> {
  const articles = page.locator('article[data-testid="tweet"]')
  const count = await articles.count().catch(() => 0)
  if (count === 0) return null
  const start = Math.floor(Math.random() * count)
  for (let i = 0; i < count; i++) {
    const idx = (start + i) % count
    const article = articles.nth(idx)
    if (!(await article.isVisible().catch(() => false))) continue
    const href = await article
      .locator('a[href*="/status/"]')
      .first()
      .getAttribute('href')
      .catch(() => null)
    if (!href || handledHrefs.has(href)) continue
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

// F5 feed: về x.com/home hoặc x.com/explore ngẫu nhiên.
async function refreshFeed(page: Page): Promise<void> {
  const target = Math.random() < 0.7 ? 'https://x.com/home' : 'https://x.com/explore'
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
}

export async function runInteractSession(
  context: BrowserContext,
  accountId: string,
  opts: { durationMinutes: number },
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

  // Cap comment theo thời lượng: tối đa floor(phút/2.5), tối thiểu 1.
  const commentCap = Math.max(1, Math.floor(opts.durationMinutes / 2.5))
  const MIN_COMMENT_GAP_MS = 90_000 // tối thiểu 90s giữa 2 comment
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
    // Xác định có được phép comment ở vòng này không.
    const nowMs = Date.now()
    const commentedToday = countCommentsToday(accountId)
    const canComment =
      comments < commentCap &&
      commentedToday < dailyLimit &&
      nowMs - lastCommentAt >= MIN_COMMENT_GAP_MS

    // Trọng số hành vi: scroll 60 / like 22 / refresh 8 / comment 6 / nghỉ-dài 4.
    const weights: Record<ActionKind, number> = {
      scroll: 60,
      like: 22,
      refresh: 8,
      comment: canComment ? 6 : 0,
      longpause: 4
    }
    const action = weightedPick(weights)

    const remainMin = Math.max(0, Math.ceil((sessionEnd - Date.now()) / 60_000))

    try {
      if (action === 'scroll') {
        await scrollDown(page)
        scrolls++
        report(`Cuộn feed (${scrolls}) · còn ~${remainMin} phút`)
        await sleep(thinkTime(2000, 5000))
      } else if (action === 'like') {
        const liked = await likeVisibleTweet(page, likedHrefs)
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
        const target = await readCommentableTweet(page, commentedHrefs)
        if (!target) {
          // Không có bài phù hợp -> cuộn thêm.
          await scrollDown(page)
          scrolls++
          await sleep(thinkTime(2000, 5000))
        } else {
          commentedHrefs.add(target.url)
          report('Đang nhờ AI sinh bình luận…')
          const ai = await generateComment(target.text)
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
