import type { BrowserContext, Page, Locator } from 'patchright'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { PostResult } from '../../shared/types'

export type { PostResult }

function screenshotPath(accountId: string): string {
  const dir = join(app.getPath('userData'), 'logs')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* ignore */
  }
  return join(dir, `post_${accountId}_${Date.now()}.png`)
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

export async function postTweet(
  context: BrowserContext,
  caption: string,
  mediaPaths?: string[],
  accountId?: string
): Promise<PostResult> {
  let page: Page | null = null
  const acc = accountId ?? 'unknown'

  try {
    page = await context.newPage()

    // 1. Vào trang compose
    await page.goto('https://x.com/compose/post', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    })
    await sleep(2000) // Delay để trang ổn định

    // Session hết hạn => bị đẩy về login
    if (page.url().includes('/login') || page.url().includes('/i/flow/login')) {
      const shot = screenshotPath(acc)
      await page.screenshot({ path: shot }).catch(() => {})
      return {
        ok: false,
        error: 'Session hết hạn — bị chuyển về trang đăng nhập. Hãy mở profile và đăng nhập lại.',
        step: 'goto',
        screenshot: existsSync(shot) ? shot : undefined
      }
    }

    // 2. Neo vào textarea đang hiển thị của modal compose
    const composeBox = visibleTextarea(page)
    await composeBox.waitFor({ timeout: 15_000, state: 'visible' })
    await composeBox.click()
    await sleep(1000) // Delay sau khi click textarea
    await page.keyboard.type(caption, { delay: 50 }) // Tăng delay typing từ 5ms lên 50ms

    // Scope chứa nút media + Post (tính sau khi textarea đã hiện)
    const scope = composeScope(page)

    // 3. Upload media nếu có
    if (mediaPaths && mediaPaths.length > 0) {
      const validPaths = mediaPaths.filter((p) => existsSync(p))
      if (validPaths.length === 0) {
        return { ok: false, error: 'File media không tồn tại', step: 'check_media' }
      }

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
      await postBtn.click({ timeout: 8_000 })
    } catch {
      await postBtn.dispatchEvent('click')
    }
    await sleep(2000) // Delay sau khi click Post để đợi xử lý

    // Navigate thẳng sang trang tweet sau khi đăng (compose/post hay làm vậy).
    if (page.url().includes('/status/')) {
      return { ok: true, url: page.url() }
    }

    // Tín hiệu đăng thành công: KHÔNG còn dialog nào hiện (modal compose đóng). Proxy
    // chậm nên cho timeout dài (45s). :visible lọc sẵn dialog ẩn vốn tồn tại trong DOM.
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
    const shot = screenshotPath(acc)
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
