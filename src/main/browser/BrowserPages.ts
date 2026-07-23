import type { BrowserContext, Page } from 'patchright'

const sameWindowTabContexts = new WeakSet<BrowserContext>()

export function useSameWindowTaskTabs(context: BrowserContext): void {
  sameWindowTabContexts.add(context)
}

// Firefox có thể biến BrowserContext.newPage() thành một cửa sổ native mới. Mở từ page đang
// tồn tại để browser áp dụng chính sách link vào tab của cùng cửa sổ; fallback chỉ dùng khi
// context chưa có page nào (lúc đó browser buộc phải tạo cửa sổ đầu tiên).
export async function openTaskPage(context: BrowserContext): Promise<Page> {
  // Chromium vốn tạo đúng tab bằng newPage(); không đổi luồng ổn định hiện có của engine này.
  if (!sameWindowTabContexts.has(context)) return context.newPage()

  const source = context.pages().find((page) => !page.isClosed())
  if (!source) return context.newPage()

  const [, page] = await Promise.all([
    source.evaluate("window.open('about:blank', '_blank')"),
    context.waitForEvent('page', { timeout: 10_000 })
  ])
  return page
}
