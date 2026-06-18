import type { BrowserContext, Page } from 'patchright'
import { existsSync } from 'fs'

export interface PostResult {
  ok: boolean
  url?: string
  error?: string
  step?: string
}

export async function postTweet(
  context: BrowserContext,
  caption: string,
  mediaPaths?: string[]
): Promise<PostResult> {
  let page: Page | null = null

  try {
    page = await context.newPage()
    await page.goto('https://x.com/compose/post', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    })

    // Chờ compose box (contenteditable div)
    const composeLocator = page.locator('[data-testid="tweetTextarea_0"]')
    await composeLocator.waitFor({ timeout: 15_000 })
    await composeLocator.click()
    await page.keyboard.type(caption, { delay: 5 })

    // Upload media nếu có
    if (mediaPaths && mediaPaths.length > 0) {
      const validPaths = mediaPaths.filter(p => existsSync(p))
      if (validPaths.length === 0) {
        return { ok: false, error: 'File media không tồn tại', step: 'check_media' }
      }

      const mediaBtn = page.locator('[data-testid="mediaUploadButton"]')
      await mediaBtn.waitFor({ timeout: 8_000 })

      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 10_000 }),
        mediaBtn.click()
      ])
      await fileChooser.setFiles(validPaths)

      // Chờ media preview hiển thị + nút Post enable trở lại (video encode)
      await page.locator('[data-testid="attachments"]').waitFor({ timeout: 45_000 })
      await page.locator('[data-testid="tweetButtonInline"]').waitFor({
        state: 'attached',
        timeout: 60_000
      })
    }

    // Bấm Post
    const postBtn = page.locator('[data-testid="tweetButtonInline"]')
    await postBtn.waitFor({ timeout: 10_000, state: 'visible' })
    await postBtn.click()

    // Chờ thành công: nút "View post" hoặc URL về home
    const viewPostHref = await Promise.race([
      page.locator('a[href*="/status/"]').first().getAttribute('href').catch(() => null),
      page.waitForURL('https://x.com/home', { timeout: 15_000 }).then(() => null).catch(() => null)
    ])

    if (viewPostHref) {
      return { ok: true, url: `https://x.com${viewPostHref}` }
    }

    return { ok: true, url: page.url().includes('/status/') ? page.url() : undefined }
  } catch (e) {
    return {
      ok: false,
      error: (e as Error).message,
      step: page?.url() || 'unknown'
    }
  } finally {
    if (page && !page.isClosed()) {
      await page.close().catch(() => {})
    }
  }
}
