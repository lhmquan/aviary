import type { BrowserContext, Page, Locator } from 'patchright'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { PostResult, DeleteResult, DeleteMode, CommentResult } from '../../shared/types'

export type { PostResult }
export type { DeleteResult }
export type { CommentResult }

// Callback báo tiến trình chi tiết của thao tác browser ra ngoài (statusbar terminal).
// Chỉ cần message — runner.ts sẽ bọc thêm accountId/accountLabel/stage khi emit.
export type StepReporter = (message: string) => void

// No-op mặc định để gọi callback an toàn khi không truyền.
const noop: StepReporter = () => {}

function screenshotPath(accountId: string, prefix = 'post'): string {
  const dir = join(app.getPath('userData'), 'logs')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* ignore */
  }
  return join(dir, `${prefix}_${accountId}_${Date.now()}.png`)
}

// X render nhiều phần tử trùng data-testid cùng lúc:
//  - timeline phía sau có sẵn 1 tweetTextarea_0 (ẩn) + 1 tweetButtonInline,
//  - modal compose phía trên có tweetTextarea_0 (hiện) + tweetButton.
// Ngoài ra có vài <div role="dialog"> ẩn bao ngoài cũng "chứa" textarea theo DOM,
// nên filter theo [role="dialog"] dễ chộp nhầm phần tử ẩn => timeout.
// Cách chắc chắn: neo trực tiếp vào tweetTextarea_0 ĐANG VISIBLE, rồi tìm
// các nút trong cùng form/dialog tổ tiên gần nhất của nó.
function visibleTextarea(page: Page): Locator {
  return page.locator('[data-testid="tweetTextarea_0"]:visible').first()
}

// Form/dialog tổ tiên gần nhất của textarea visible — chứa nút media + Post.
function composeScope(page: Page): Locator {
  return page
    .locator('[role="dialog"]:visible, form')
    .filter({ has: page.locator('[data-testid="tweetTextarea_0"]:visible') })
    .last()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Cuộn timeline X xuống. X cuộn theo WINDOW (không phải container con) nên window.scrollBy
// đáng tin cậy hơn page.mouse.wheel — wheel bắn ở vị trí con trỏ (mặc định 0,0) thường
// không nằm trên vùng cuộn nên trang đứng yên (đó là lý do app "không cuộn" để tìm bài).
async function scrollDown(page: Page): Promise<void> {
  // Truyền dạng STRING để TS không type-check biến trình duyệt (window) theo lib node.
  await page
    .evaluate('window.scrollBy(0, Math.round(window.innerHeight * 0.9))')
    .catch(() => {})
}

export async function postTweet(
  context: BrowserContext,
  caption: string,
  mediaPaths?: string[],
  accountId?: string,
  report: StepReporter = noop
): Promise<PostResult> {
  let page: Page | null = null
  const acc = accountId ?? 'unknown'

  try {
    page = await context.newPage()

    // 1. Vào trang compose
    report('Đang mở trang soạn bài (compose)…')
    await page.goto('https://x.com/compose/post', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    })
    await sleep(2000) // Delay để trang ổn định

    // Session hết hạn => bị đẩy về login
    if (page.url().includes('/login') || page.url().includes('/i/flow/login')) {
      const shot = screenshotPath(acc, 'post')
      await page.screenshot({ path: shot }).catch(() => {})
      return {
        ok: false,
        error: 'Session hết hạn — bị chuyển về trang đăng nhập. Hãy mở profile và đăng nhập lại.',
        step: 'goto',
        screenshot: existsSync(shot) ? shot : undefined
      }
    }

    // 2. Neo vào textarea đang hiển thị của modal compose
    report('Đang chờ ô soạn bài hiển thị…')
    const composeBox = visibleTextarea(page)
    await composeBox.waitFor({ timeout: 15_000, state: 'visible' })
    await composeBox.click()
    await sleep(1000) // Delay sau khi click textarea
    report('Đang nhập nội dung bài viết…')
    await page.keyboard.type(caption, { delay: 50 }) // Tăng delay typing từ 5ms lên 50ms

    // Scope chứa nút media + Post (tính sau khi textarea đã hiện)
    const scope = composeScope(page)

    // 3. Upload media nếu có
    if (mediaPaths && mediaPaths.length > 0) {
      const validPaths = mediaPaths.filter((p) => existsSync(p))
      if (validPaths.length === 0) {
        return { ok: false, error: 'File media không tồn tại', step: 'check_media' }
      }
      report(`Đang tải ${validPaths.length} media lên X…`)

      // X có sẵn <input type="file" accept="image/*,video/*"> (ẩn) trong form compose.
      // setInputFiles hoạt động với input ẩn => KHÔNG chờ visible, KHÔNG cần filechooser.
      // Ưu tiên input nhận media; tránh chộp input khác (vd avatar) ở nơi khác trên page.
      let uploaded = false
      const mediaInput = page
        .locator(
          'input[type="file"][accept*="image"], input[type="file"][accept*="video"], input[data-testid="fileInput"]'
        )
        .first()
      try {
        await mediaInput.waitFor({ timeout: 8_000, state: 'attached' })
        await mediaInput.setInputFiles(validPaths)
        uploaded = true
      } catch {
        /* thử fallback bên dưới */
      }

      // Fallback: bấm nút ảnh trong toolbar rồi bắt filechooser.
      // Nút có thể KHÔNG :visible (X ẩn bằng opacity/clip) nên chờ 'attached', không chờ 'visible'.
      if (!uploaded) {
        const uploadBtn = scope
          .locator('[data-testid="mediaUploadButton"], button[aria-label="Add photos or video"]')
          .first()
        await uploadBtn.waitFor({ timeout: 8_000, state: 'attached' })
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 10_000 }),
          uploadBtn.click({ force: true })
        ])
        await fileChooser.setFiles(validPaths)
        uploaded = true
      }

      // Chờ preview hiển thị (video có thể đang encode). BẮT BUỘC phải thấy
      // attachments — nếu không, không được đăng bài thiếu media => báo lỗi rõ ràng.
      report('Đang chờ X xử lý media (encode video)…')
      await scope
        .locator('[data-testid="attachments"]:visible')
        .first()
        .waitFor({ timeout: 90_000, state: 'visible' })
        .catch(() => {
          throw new Error(
            'Đã chọn file nhưng X không hiển thị media preview — không đăng bài thiếu ảnh/video.'
          )
        })
      await sleep(2000) // Delay sau khi upload media xong
    }

    // 4. Bấm Post — nút trong modal là tweetButton, fallback tweetButtonInline
    report('Đang chờ nút Post sẵn sàng…')
    const postBtn = scope
      .locator('[data-testid="tweetButton"]:visible, [data-testid="tweetButtonInline"]:visible')
      .first()
    await postBtn.waitFor({ timeout: 90_000, state: 'visible' })

    // Khi còn upload/encode video, nút Post bị aria-disabled="true". Chờ tới khi bật.
    await page
      .waitForFunction(
        (el: { getAttribute?: (n: string) => string | null } | null) =>
          !!el &&
          typeof el.getAttribute === 'function' &&
          el.getAttribute('aria-disabled') !== 'true',
        await postBtn.elementHandle(),
        { timeout: 120_000 }
      )
      .catch(() => {})

    // X thường phủ 1 <div> overlay lên nút Post (gradient/loading) chặn click chuột thật
    // ("subtree intercepts pointer events" -> timeout 30s), đặc biệt khi proxy chậm. Nên
    // thử click thường trước (giống thao tác người, tàng hình); nếu bị overlay chặn trong
    // 8s thì fallback dispatchEvent('click') bắn sự kiện thẳng vào nút (bypass overlay).
    try {
      report('Đang bấm nút Post…')
      await postBtn.click({ timeout: 8_000 })
    } catch {
      report('Nút Post bị overlay che — bắn click trực tiếp…')
      await postBtn.dispatchEvent('click')
    }
    await sleep(2000) // Delay sau khi click Post để đợi xử lý

    // Navigate thẳng sang trang tweet sau khi đăng (compose/post hay làm vậy).
    if (page.url().includes('/status/')) {
      report('Đăng thành công ✓')
      return { ok: true, url: page.url() }
    }

    // Tín hiệu đăng thành công: KHÔNG còn dialog nào hiện (modal compose đóng). Proxy
    // chậm nên cho timeout dài (45s). :visible lọc sẵn dialog ẩn vốn tồn tại trong DOM.
    report('Đang chờ X xác nhận đăng bài…')
    const dialog = page.locator('[role="dialog"]:visible').first()
    const posted = await dialog
      .waitFor({ state: 'hidden', timeout: 45_000 })
      .then(() => true)
      .catch(() => false)

    if (page.url().includes('/status/')) {
      return { ok: true, url: page.url() }
    }

    if (posted) {
      // Modal đóng = đã đăng. Thử lấy link tweet mới trong timeline.
      const tweetLink = page.locator('a[href*="/status/"]').first()
      try {
        await tweetLink.waitFor({ state: 'visible', timeout: 20_000 })
        const href = await tweetLink.getAttribute('href')
        if (href) return { ok: true, url: `https://x.com${href}` }
      } catch {
        /* link chưa kịp render -> vẫn coi là đã đăng do modal đã đóng */
      }
      return { ok: true, url: undefined }
    }

    // Không có tín hiệu thành công nào -> báo thất bại rõ để user kiểm tra (tránh đánh
    // dấu n8n done nhầm khi thực ra chưa đăng).
    return {
      ok: false,
      error:
        'Đã bấm Post nhưng modal chưa đóng sau thời gian chờ (overlay/đường truyền chậm hoặc X báo lỗi). Vui lòng kiểm tra lại trên X trước khi thử lại.',
      step: 'post'
    }
  } catch (e) {
    const err = e as Error
    const url = page?.url() ?? ''
    const step = url.includes('/login')
      ? 'login_redirect'
      : url.includes('/compose')
        ? 'compose'
        : 'unknown'
    const shot = screenshotPath(acc, 'post')
    await page?.screenshot({ path: shot }).catch(() => {})
    return {
      ok: false,
      error: err.message,
      step,
      screenshot: existsSync(shot) ? shot : undefined
    }
  } finally {
    if (page && !page.isClosed()) {
      await page.close().catch(() => {})
    }
  }
}

// ---- Xoá bài trên X ----

// Giới hạn an toàn: số lần cuộn LIÊN TIẾP không thấy bài mới (coi như đã chạm đáy timeline),
// số bài xoá tối đa khi deleteCount=0 (xoá tất cả), và trần tổng số vòng lặp (chặn loop vô hạn
// khi account có rất nhiều repost/bài cần bỏ qua).
const MAX_EMPTY_SCROLLS = 20
const MAX_DELETE_ALL_PER_RUN = 100
const MAX_ITERATIONS = 2000

// Chuẩn hoá handle (bỏ @ đầu).
function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, '')
}

// Ngày dạng "YYYY-MM-DD" → mốc cuối ngày (23:59:59.999) theo giờ local.
function endOfLocalDateMs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime()
}

/**
 * Xoá tweet từ profile của tài khoản trên X.
 *
 * @param context  Browser context đã mở (có session X)
 * @param handle   Username X (có thể kèm @)
 * @param opts     Tuỳ chọn xoá: mode (newest/by_date), beforeDate (YYYY-MM-DD), maxCount (0 = tất cả)
 * @param accountId  ID tài khoản (dùng cho screenshot)
 * @returns DeleteResult với số bài đã xoá, URL, lỗi (nếu có)
 */
export async function deleteTweetsFromProfile(
  context: BrowserContext,
  handle: string,
  opts?: {
    mode?: DeleteMode
    beforeDate?: string | null
    maxCount?: number
  },
  accountId?: string,
  report: StepReporter = noop
): Promise<DeleteResult> {
  const acc = accountId ?? 'unknown'
  const mode: DeleteMode = opts?.mode ?? 'newest'
  const beforeDate = opts?.beforeDate ?? null
  const rawMaxCount = opts?.maxCount ?? 1
  // 0 = xoá tất cả (có giới hạn an toàn)
  const targetCount = rawMaxCount === 0 ? MAX_DELETE_ALL_PER_RUN : rawMaxCount
  const cutoffMs = mode === 'by_date' && beforeDate ? endOfLocalDateMs(beforeDate) : Infinity

  let page: Page | null = null
  const deletedUrls: string[] = []
  let deletedCount = 0

  try {
    page = await context.newPage()

    // 1. Vào trang profile
    const cleanHandle = normalizeHandle(handle)
    report(`Đang mở trang profile @${cleanHandle}…`)
    await page.goto(`https://x.com/${cleanHandle}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    })
    await sleep(2000)

    // Session hết hạn => bị đẩy về login
    if (page.url().includes('/login') || page.url().includes('/i/flow/login')) {
      const shot = screenshotPath(acc, 'delete')
      await page.screenshot({ path: shot }).catch(() => {})
      return {
        ok: false,
        deletedCount: 0,
        urls: [],
        error: 'Session hết hạn — bị chuyển về trang đăng nhập. Hãy mở profile và đăng nhập lại.',
        step: 'goto',
        screenshot: existsSync(shot) ? shot : undefined
      }
    }

    // 2. Chờ timeline render. Dùng CSS :has() (native, nhanh) thay vì .filter({ has: }).
    //
    // QUAN TRỌNG (case-insensitive): X giữ ĐÚNG casing gốc của username trong href permalink
    // (vd "/Candy19904/status/…"), nhưng handle lưu trong app có thể khác hoa-thường
    // ("candy19904"). CSS attribute selector mặc định PHÂN BIỆT hoa-thường -> selector không
    // khớp bài nào -> waitFor timeout 30s rồi cuộn mãi không xoá (đúng triệu chứng tài khoản
    // candy19904). Dùng cờ `i` trong attribute selector để khớp không phân biệt hoa-thường.
    const statusHref = `a[href*="/${cleanHandle}/status/" i]`
    report('Đang chờ timeline tải bài viết…')
    const tweetSelector = `article[data-testid="tweet"]:visible:has(${statusHref})`
    const firstArticle = page.locator(tweetSelector).first()
    await firstArticle.waitFor({ timeout: 30_000, state: 'visible' }).catch(() => {})

    // 3. Duyệt và xoá bài.
    // skippedHrefs: các bài KHÔNG xoá được/không nên xoá (repost, bài mới hơn mốc by_date,
    // bài không có menu Delete). Nhớ lại để vòng lặp bỏ qua, tránh kẹt mãi ở 1 bài.
    //
    // QUAN TRỌNG về điều kiện dừng: KHÔNG dùng tổng số lần cuộn làm ngân sách dừng — vì mỗi
    // lần bỏ qua repost cũng phải cuộn, account nhiều repost sẽ cạn ngân sách TRƯỚC khi tới
    // bài xoá được (=> 0 bài xoá, app tắt sớm). Thay vào đó:
    //   - stuckScrolls: số lần cuộn LIÊN TIẾP mà trang KHÔNG dài thêm và KHÔNG lộ href mới
    //     -> chạm đáy timeline thật.
    //   - iterations: trần an toàn tổng vòng lặp, chỉ để chặn loop vô hạn.
    let iterations = 0
    // stuckScrolls: số lần cuộn LIÊN TIẾP mà trang KHÔNG dài thêm và KHÔNG lộ href mới ->
    // coi như chạm đáy timeline. Điều kiện dừng này KHÔNG dựa vào "có article hiển thị hay
    // không" (ở cuối feed vẫn còn vài bài skippable hiển thị nên cách cũ cuộn mãi không dừng).
    let stuckScrolls = 0
    const skippedHrefs = new Set<string>() // bài đã quyết bỏ qua (repost / mới hơn mốc / không có menu Xoá)
    const seenHrefs = new Set<string>() // mọi href từng thấy -> biết cuộn có lộ thêm bài mới không

    // Phát hiện repost qua socialContext ("You reposted" / "Bạn đã đăng lại" / "Retweet").
    // Repost KHÔNG có menu Delete (chỉ "Undo repost") nên phải bỏ qua — nếu không sẽ ném lỗi
    // và thoát giữa chừng (0 bài xoá). Bài ghim ("Pinned"/"Đã ghim") không khớp regex -> vẫn xoá.
    async function isRepostArticle(a: Locator): Promise<boolean> {
      const socialContext = a.locator('[data-testid="socialContext"]').first()
      const hasContext = await socialContext.isVisible().catch(() => false)
      if (!hasContext) return false
      const ctx = await socialContext.textContent({ timeout: 300 }).catch(() => null)
      return ctx ? /repost|reposted|đăng lại|retweet/i.test(ctx) : false
    }

    // Đọc href permalink + thời điểm đăng của 1 article. QUAN TRỌNG: đọc <time> từ CHÍNH
    // anchor permalink (a[href="<permalink>"]) của bài, KHÔNG dùng a.locator('time').first()
    // — vì article có thể nhúng quote-tweet (cũng có <time> riêng) khiến đọc nhầm ngày của
    // bài được trích dẫn -> phân loại sai mốc by_date (đây là lý do bài 2019 bị bỏ qua nhầm).
    async function readArticleMeta(a: Locator): Promise<{ href: string | null; tweetMs: number }> {
      const href = await a
        .locator(statusHref)
        .first()
        .getAttribute('href')
        .catch(() => null)
      let dt: string | null = null
      if (href) {
        dt = await a.locator(`a[href="${href}"] time`).first().getAttribute('datetime').catch(() => null)
      }
      if (!dt) {
        dt = await a.locator('time').first().getAttribute('datetime').catch(() => null)
      }
      return { href, tweetMs: dt ? Date.parse(dt) : NaN }
    }

    // Đọc [scrollY, scrollHeight] để biết cuộn có thực sự tiến triển không (chạm đáy feed).
    async function scrollMetrics(): Promise<[number, number]> {
      const r = await page!
        .evaluate('[window.scrollY, document.documentElement.scrollHeight]')
        .catch(() => [0, 0])
      return Array.isArray(r) ? [Number(r[0]) || 0, Number(r[1]) || 0] : [0, 0]
    }

    while (deletedCount < targetCount && iterations < MAX_ITERATIONS) {
      iterations++

      // Quét TẤT CẢ article đang render (không chỉ .first()). X virtualize timeline: bài cũ
      // ngoài màn hình bị gỡ khỏi DOM, còn vài bài mới hơn có thể "kẹt" ở mép trên. Nếu chỉ
      // nhìn .first() sẽ lệch khỏi bài user thấy -> bỏ qua nhầm bài hợp lệ ở dưới. Duyệt theo
      // thứ tự DOM (= thứ tự timeline, mới -> cũ) và lấy bài ĐẦU TIÊN đủ điều kiện xoá.
      let article: Locator | null = null
      let href: string | null = null

      const articles = await page.locator(tweetSelector).all()
      for (const a of articles) {
        const fh = await a
          .locator(statusHref)
          .first()
          .getAttribute('href')
          .catch(() => null)
        if (fh) seenHrefs.add(fh)

        // Đã quyết bỏ qua trước đó (repost / mới hơn mốc / không có menu Xoá) -> next.
        if (fh && skippedHrefs.has(fh)) continue

        // Repost: không có menu Delete -> bỏ qua vĩnh viễn.
        if (await isRepostArticle(a)) {
          if (fh) skippedHrefs.add(fh)
          continue
        }

        // by_date: bài MỚI HƠN mốc -> bỏ qua (không xoá). KHÔNG dừng vì bài cũ hơn (cần xoá)
        // nằm BÊN DƯỚI trong timeline; chỉ skip rồi duyệt/cuộn tiếp.
        if (mode === 'by_date') {
          const { tweetMs } = await readArticleMeta(a)
          if (!isNaN(tweetMs) && tweetMs > cutoffMs) {
            if (fh) skippedHrefs.add(fh)
            continue
          }
        }

        article = a
        href = fh
        break
      }

      // Không có ứng viên trong các article đang render -> cuộn nạp thêm. Phát hiện đáy feed
      // bằng TIẾN TRIỂN CUỘN THẬT (scrollY/scrollHeight tăng) + có lộ href mới hay không —
      // KHÔNG dựa vào "có article hiển thị" (ở cuối feed vẫn còn bài skippable hiển thị nên
      // cách cũ cuộn mãi không dừng).
      if (!article) {
        const [, hBefore] = await scrollMetrics()
        const seenBefore = seenHrefs.size
        report(`Đang cuộn tìm bài… (đáy ${stuckScrolls}/${MAX_EMPTY_SCROLLS})`)
        await scrollDown(page)
        await sleep(1200)
        const [yAfter, hAfter] = await scrollMetrics()
        const grew = hAfter > hBefore + 4
        const revealed = seenHrefs.size > seenBefore
        if (grew || revealed) {
          stuckScrolls = 0
        } else {
          stuckScrolls++
          if (stuckScrolls >= MAX_EMPTY_SCROLLS) {
            report('Đã chạm đáy timeline — không còn bài phù hợp.')
            break
          }
        }
        // Nếu đang ở rất gần đáy (scrollY gần scrollHeight) và không lộ thêm gì -> cũng tính
        // là stuck nhanh hơn (tránh chờ đủ 20 lần khi rõ ràng đã hết).
        void yAfter
        continue
      }

      const tweetUrl = href ? (href.startsWith('http') ? href : `https://x.com${href}`) : null

      // 3a. Click caret menu (...)
      report('Đang mở menu (…) của bài viết…')
      const caret = article.locator('[data-testid="caret"]:visible').first()
      await caret.waitFor({ timeout: 5_000, state: 'visible' }).catch(() => {})
      try {
        await caret.click({ timeout: 3_000 })
      } catch {
        // Fallback: thử aria-label
        const moreBtn = article.locator('button[aria-label="More"]:visible, div[aria-label="More"]:visible').first()
        await moreBtn.click({ timeout: 3_000 }).catch(() => {})
      }
      await sleep(300)

      // 3b. Tìm menu item Delete (EN "Delete" hoặc VI "Xóa"/"Xoá"). Nếu KHÔNG có (repost lọt lưới,
      //     bài quảng cáo, bài người khác...) → đóng menu (Escape), đánh dấu skip, cuộn tiếp.
      //     KHÔNG ném lỗi để tránh thoát giữa chừng làm 0 bài được xoá.
      //
      // Lưu ý dấu tiếng Việt: menu là "Xóa" (dấu sắc trên chữ O = "ó") HOẶC "Xoá" (dấu trên
      // chữ A = "á") tuỳ bộ gõ/phiên bản. Phải khớp CẢ HAI: X[oó][aá]. Dùng ^...$ (đã trim) để
      // KHÔNG dính nhầm "Thêm/xóa khỏi Danh sách" (Add/remove from Lists) cũng chứa chữ "xóa".
      const deleteItem = page
        .locator('[role="menuitem"]:visible')
        .filter({ hasText: /^\s*(delete|x[oó][aá])\s*$/i })
        .first()
      const hasDelete = await deleteItem
        .waitFor({ timeout: 3_000, state: 'visible' })
        .then(() => true)
        .catch(() => false)
      if (!hasDelete) {
        report('Không thấy menu Xoá — bỏ qua bài này…')
        await page.keyboard.press('Escape').catch(() => {})
        await sleep(200)
        if (href) skippedHrefs.add(href)
        await scrollDown(page)
        await sleep(500)
        continue
      }
      report('Đang chọn Xoá…')
      await deleteItem.click()
      await sleep(300)

      // 3c. Click nút xác nhận xoá
      report('Đang xác nhận xoá…')
      const confirmBtn = page
        .locator('[data-testid="confirmationSheetConfirm"]:visible')
        .first()
      try {
        await confirmBtn.waitFor({ timeout: 4_000, state: 'visible' })
        await confirmBtn.click()
      } catch {
        // Fallback: tìm nút Delete trong dialog xác nhận
        const fallbackBtn = page
          .locator('[role="dialog"]:visible button:visible')
          .filter({ hasText: /Delete|Xóa|Xoá/i })
          .first()
        await fallbackBtn.waitFor({ timeout: 4_000, state: 'visible' })
        await fallbackBtn.click()
      }
      await sleep(500)

      // 3d. Xác nhận bài đã bị xoá: link bài biến mất
      if (href) {
        await page
          .locator(`a[href="${href}"]:visible`)
          .first()
          .waitFor({ state: 'hidden', timeout: 5_000 })
          .catch(() => {})
      }

      // Đếm bài đã xoá
      deletedCount++
      if (tweetUrl) deletedUrls.push(tweetUrl)
      report(`Đã xoá ${deletedCount}/${rawMaxCount === 0 ? 'tất cả' : targetCount} bài ✓`)

      // Vừa xoá 1 bài (DOM thay đổi) -> reset đếm cuộn "đáy" để tiếp tục duyệt bình thường.
      stuckScrolls = 0

      // Chờ DOM ổn định trước khi tìm bài tiếp
      await sleep(500)
    }

    // Nếu xoá 0 bài (không tìm thấy bài phù hợp) → vẫn báo ok (đã chạy thành công, chỉ không có bài)
    return {
      ok: true,
      deletedCount,
      urls: deletedUrls,
      error: deletedCount === 0 ? 'Không tìm thấy bài phù hợp để xoá' : undefined,
      step: deletedCount === 0 ? 'no_match' : undefined
    }
  } catch (e) {
    const err = e as Error
    const shot = screenshotPath(acc, 'delete')
    await page?.screenshot({ path: shot }).catch(() => {})
    return {
      ok: false,
      deletedCount,
      urls: deletedUrls,
      error: err.message,
      step: 'delete',
      screenshot: existsSync(shot) ? shot : undefined
    }
  } finally {
    if (page && !page.isClosed()) {
      await page.close().catch(() => {})
    }
  }
}

// ---- Bình luận trên bài viết của chính tài khoản (trang profile) ----

// Giới hạn an toàn: số lần cuộn LIÊN TIẾP không thấy href mới (chạm đáy timeline profile).
const MAX_EMPTY_SCROLLS_COLLECT = 20

/**
 * Cuộn trang profile của chính tài khoản để thu thập link permalink của `count` bài viết.
 * Bỏ qua repost (bài đăng lại) và bài ghim — chỉ lấy bài gốc của tài khoản.
 *
 * @param context  Browser context đã mở (có session X)
 * @param handle   Username X (không kèm @)
 * @param count    Số link bài cần thu thập
 * @param accountId  ID tài khoản (dùng cho screenshot nếu lỗi)
 * @returns Danh sách URL đầy đủ (https://x.com/<handle>/status/<id>)
 */
export async function scrollProfileCollectTweetUrls(
  context: BrowserContext,
  handle: string,
  count: number,
  accountId?: string,
  report: StepReporter = noop,
  // Danh sách link đã xử lý (cache). Khi cuộn thấy 1 link đã có trong cache -> coi như
  // đã chạm vùng bài cũ -> DỪNG thu thập sớm (không cần cuộn thêm). Tiết kiệm thời gian
  // vì profile sắp xếp mới->cũ: gặp link cũ = phần còn lại đều cũ.
  knownUrls?: Set<string>
): Promise<{ urls: string[]; error?: string; screenshot?: string }> {
  const acc = accountId ?? 'unknown'
  const cleanHandle = normalizeHandle(handle)
  let page: Page | null = null
  const urls: string[] = []
  const seenHrefs = new Set<string>()
  const cache = knownUrls ?? new Set<string>()

  try {
    page = await context.newPage()
    report(`Đang mở trang profile @${cleanHandle}…`)
    await page.goto(`https://x.com/${cleanHandle}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    })
    await sleep(2000)

    // Session hết hạn => bị đẩy về login
    if (page.url().includes('/login') || page.url().includes('/i/flow/login')) {
      const shot = screenshotPath(acc, 'comment_collect')
      await page.screenshot({ path: shot }).catch(() => {})
      return {
        urls: [],
        error: 'Session hết hạn — bị chuyển về trang đăng nhập. Hãy mở profile và đăng nhập lại.',
        screenshot: existsSync(shot) ? shot : undefined
      }
    }

    // Selector link permalink của chính tài khoản (case-insensitive).
    const statusHref = `a[href*="/${cleanHandle}/status/" i]`
    const tweetSelector = `article[data-testid="tweet"]:visible:has(${statusHref})`

    // Phát hiện repost (bỏ qua — không bình luận lên bài đăng lại).
    async function isRepostArticle(a: Locator): Promise<boolean> {
      const socialContext = a.locator('[data-testid="socialContext"]').first()
      const hasContext = await socialContext.isVisible().catch(() => false)
      if (!hasContext) return false
      const ctx = await socialContext.textContent({ timeout: 300 }).catch(() => null)
      return ctx ? /repost|reposted|đăng lại|retweet/i.test(ctx) : false
    }

    // Phát hiện bài ghim ("Pinned by you" / "Đã ghim") — bỏ qua.
    async function isPinnedArticle(a: Locator): Promise<boolean> {
      const socialContext = a.locator('[data-testid="socialContext"]').first()
      const hasContext = await socialContext.isVisible().catch(() => false)
      if (!hasContext) return false
      const ctx = await socialContext.textContent({ timeout: 300 }).catch(() => null)
      return ctx ? /pinned|đã ghim|ghim/i.test(ctx) : false
    }

    let stuckScrolls = 0
    let iterations = 0
    const MAX_ITERATIONS_COLLECT = 500

    while (urls.length < count && iterations < MAX_ITERATIONS_COLLECT) {
      iterations++
      const articles = await page.locator(tweetSelector).all()
      let foundNew = false

      for (const a of articles) {
        if (urls.length >= count) break
        const href = await a
          .locator(statusHref)
          .first()
          .getAttribute('href')
          .catch(() => null)
        if (!href || seenHrefs.has(href)) continue
        seenHrefs.add(href)

        const fullUrl = href.startsWith('http') ? href : `https://x.com${href}`

        // Gặp link đã có trong cache -> phần còn lại đều bài cũ -> DỪNG sớm.
        if (cache.has(fullUrl)) {
          report(`Gặp link cũ trong cache — dừng thu thập (${urls.length} link mới).`)
          return { urls }
        }

        // Bỏ qua repost và bài ghim — KHÔNG lọc reply ở đây vì trên trang profile
        // tất cả article đều có tabindex="0" (không phân biệt được gốc/reply).
        // Reply sẽ bị phát hiện khi mở từng tweet để bình luận (commentOnTweet).
        if (await isRepostArticle(a)) continue
        if (await isPinnedArticle(a)) continue

        urls.push(fullUrl)
        foundNew = true
        report(`Đã thu thập ${urls.length}/${count} link bài…`)
      }

      if (urls.length >= count) break

      // Cuộn thêm để nạp bài cũ hơn
      const hBefore = await page
        .evaluate<number>('document.documentElement.scrollHeight')
        .catch(() => 0)
      const seenBefore = seenHrefs.size
      report(`Đang cuộn tìm thêm bài… (đáy ${stuckScrolls}/${MAX_EMPTY_SCROLLS_COLLECT})`)
      await scrollDown(page)
      await sleep(1200)
      const hAfter = await page
        .evaluate<number>('document.documentElement.scrollHeight')
        .catch(() => 0)
      const grew = hAfter > hBefore + 4
      const revealed = seenHrefs.size > seenBefore
      if (grew || revealed || foundNew) {
        stuckScrolls = 0
      } else {
        stuckScrolls++
        if (stuckScrolls >= MAX_EMPTY_SCROLLS_COLLECT) {
          report('Đã chạm đáy timeline profile — không còn bài mới.')
          break
        }
      }
    }

    return { urls }
  } catch (e) {
    const shot = screenshotPath(acc, 'comment_collect')
    await page?.screenshot({ path: shot }).catch(() => {})
    return {
      urls,
      error: (e as Error).message,
      screenshot: existsSync(shot) ? shot : undefined
    }
  } finally {
    if (page && !page.isClosed()) {
      await page.close().catch(() => {})
    }
  }
}

/**
 * Bình luận trên 1 tweet cụ thể. Mở URL tweet, tìm reply box, gõ nội dung, bấm Reply.
 *
 * @param context  Browser context đã mở (có session X)
 * @param tweetUrl  URL đầy đủ của tweet cần bình luận
 * @param text   Nội dung bình luận
 * @param accountId  ID tài khoản (dùng cho screenshot nếu lỗi)
 * @returns CommentResult với ok + url của tweet đã bình luận
 */
export async function commentOnTweet(
  context: BrowserContext,
  tweetUrl: string,
  text: string,
  accountId?: string,
  report: StepReporter = noop
): Promise<CommentResult> {
  const acc = accountId ?? 'unknown'
  let page: Page | null = null

  try {
    page = await context.newPage()
    report(`Đang mở bài viết ${tweetUrl}…`)
    await page.goto(tweetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await sleep(2000)

    // Session hết hạn => bị đẩy về login
    if (page.url().includes('/login') || page.url().includes('/i/flow/login')) {
      const shot = screenshotPath(acc, 'comment')
      await page.screenshot({ path: shot }).catch(() => {})
      return {
        ok: false,
        commentedCount: 0,
        urls: [],
        error: 'Session hết hạn — bị chuyển về trang đăng nhập. Hãy mở profile và đăng nhập lại.',
        step: 'goto',
        screenshot: existsSync(shot) ? shot : undefined
      }
    }

    // Phát hiện reply: trên trang tweet detail, bài chính có tabindex="-1".
    // Nếu có article nào nằm TRƯỚC bài tabindex="-1" trong DOM → tweet này là reply
    // (tweet gốc hiện ở trên làm context). Bỏ qua, không bình luận lên reply.
    const allArticles = page.locator('article[data-testid="tweet"]')
    const mainTweet = page.locator('article[data-testid="tweet"][tabindex="-1"]').first()
    const mainVisible = await mainTweet.waitFor({ timeout: 10_000, state: 'visible' }).then(() => true).catch(() => false)
    if (mainVisible) {
      const totalArticles = await allArticles.count()
      // Đếm article trước bài chính: duyệt từng article, check tabindex.
      let articlesBefore = 0
      for (let i = 0; i < totalArticles; i++) {
        const tab = await allArticles.nth(i).getAttribute('tabindex').catch(() => null)
        if (tab === '-1') break // đến bài chính → dừng
        articlesBefore++
      }
      if (articlesBefore > 0) {
        report('Bài này là reply — bỏ qua.')
        return {
          ok: false,
          commentedCount: 0,
          urls: [],
          error: 'Bài này là reply — bỏ qua không bình luận.',
          step: 'skip_reply',
          skipped: true
        }
      }
    }

    // Tìm reply box. X render nhiều textarea ẩn; neo vào [data-testid="tweetTextarea_0"]
    // đang VISIBLE trong vùng reply. Trên trang tweet chi tiết, reply box đầu tiên có thể
    // là ô collapsed (placeholder) -> click để mở rộng thành form đầy đủ có nút Reply.
    report('Đang chờ ô bình luận hiển thị…')
    const replyBox = page.locator('[data-testid="tweetTextarea_0"]:visible').first()
    await replyBox.waitFor({ timeout: 15_000, state: 'visible' })
    await replyBox.click()
    await sleep(1000)
    // Click lần nữa để chắc form reply đã mở rộng (X đôi khi cần 2 click).
    await replyBox.click().catch(() => {})
    await sleep(500)

    // Gõ nội dung bình luận. Dùng fill() để trigger input event đúng cách X cần
    // (keyboard.type đôi khi không kích hoạt state React -> nút Reply stayed disabled).
    // Fallback keyboard.type nếu fill không được (textarea contenteditable).
    report('Đang nhập nội dung bình luận…')
    try {
      await replyBox.fill(text, { timeout: 5_000 })
    } catch {
      await replyBox.click()
      await page.keyboard.type(text, { delay: 50 })
    }
    await sleep(1200)

    // Tìm nút Reply trên TOÀN PAGE (không giới hạn scope) — trên trang tweet chi tiết,
    // nút Reply có data-testid="tweetButton" nhưng nằm ngoài form tổ tiên textarea.
    // Lọc visible + không disabled, chọn nút phù hợp nhất.
    report('Đang chờ nút Reply sẵn sàng…')
    const replyBtnCandidates = page.locator(
      '[data-testid="tweetButton"]:visible, [data-testid="tweetButtonInline"]:visible'
    )
    // Chờ ít nhất 1 nút visible.
    await replyBtnCandidates.first().waitFor({ timeout: 15_000, state: 'visible' }).catch(() => {})

    // Đếm số nút visible + chọn nút không disabled. Nút Post ở sidebar compose cũng khớp
    // selector -> cần chọn nút KHÔNG disabled (nút Reply sau khi gõ text sẽ enabled).
    const count = await replyBtnCandidates.count()
    let replyBtn: Locator | null = null
    for (let i = 0; i < count; i++) {
      const btn = replyBtnCandidates.nth(i)
      const disabled = await btn.getAttribute('aria-disabled').catch(() => null)
      if (disabled !== 'true') {
        replyBtn = btn
        break
      }
    }
    // Nếu tất cả đều disabled -> chờ thêm rồi thử lại (X đang xử lý input).
    if (!replyBtn) {
      report('Nút Reply đang disabled — chờ X xử lý nội dung…')
      const pageRef = page
      // Dùng string evaluation để tránh TS complain về document/HTMLElement (lib node).
      await page
        .waitForFunction(
          `() => {
            const btns = document.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]');
            for (const b of btns) {
              if (b instanceof HTMLElement && b.offsetParent !== null && b.getAttribute('aria-disabled') !== 'true') {
                return true;
              }
            }
            return false;
          }`,
          { timeout: 15_000 }
        )
        .then(() => {
          replyBtn = replyBtnCandidates
            .filter({ hasNot: pageRef.locator('[aria-disabled="true"]') })
            .first()
        })
        .catch(() => {})
    }
    if (!replyBtn) {
      // Chụp screenshot để user xem lý do nút không tìm thấy.
      const shot = screenshotPath(acc, 'comment_nobutton')
      await page.screenshot({ path: shot }).catch(() => {})
      return {
        ok: false,
        commentedCount: 0,
        urls: [],
        error:
          'Không tìm thấy nút Reply enabled sau khi nhập nội dung. Có thể X chưa nhận text hoặc layout đổi. Xem screenshot để kiểm tra.',
        step: 'reply_button',
        screenshot: existsSync(shot) ? shot : undefined
      }
    }

    // Bấm Reply — thử click thường trước, fallback dispatchEvent nếu overlay chặn.
    try {
      report('Đang bấm nút Reply…')
      await replyBtn.click({ timeout: 8_000 })
    } catch {
      report('Nút Reply bị overlay che — bắn click trực tiếp…')
      await replyBtn.dispatchEvent('click')
    }
    await sleep(2000)

    // Tín hiệu thành công: dialog đóng (modal reply ẩn).
    report('Đang chờ X xác nhận bình luận…')
    const dialog = page.locator('[role="dialog"]:visible').first()
    const done = await dialog
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .then(() => true)
      .catch(() => false)

    if (done) {
      report('Bình luận thành công ✓')
      return { ok: true, commentedCount: 1, urls: [tweetUrl] }
    }

    // Fallback: nếu URL đổi sang /status/ (một số trường hợp X navigate).
    if (page.url().includes('/status/')) {
      report('Bình luận thành công ✓')
      return { ok: true, commentedCount: 1, urls: [tweetUrl] }
    }

    // Không có tín hiệu thành công -> báo thất bại rõ.
    return {
      ok: false,
      commentedCount: 0,
      urls: [],
      error:
        'Đã bấm Reply nhưng modal chưa đóng sau thời gian chờ. Vui lòng kiểm tra lại trên X.',
      step: 'comment'
    }
  } catch (e) {
    const err = e as Error
    const shot = screenshotPath(acc, 'comment')
    await page?.screenshot({ path: shot }).catch(() => {})
    return {
      ok: false,
      commentedCount: 0,
      urls: [],
      error: err.message,
      step: 'comment',
      screenshot: existsSync(shot) ? shot : undefined
    }
  } finally {
    if (page && !page.isClosed()) {
      await page.close().catch(() => {})
    }
  }
}
