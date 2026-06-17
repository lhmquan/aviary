import { mkdirSync } from 'fs'
import { chromium, type BrowserContext } from 'patchright'
import type { Account } from '../../shared/types'

// Parse chuỗi proxy dạng host:port hoặc user:pass@host:port (http/socks) sang cấu hình Playwright.
export function parseProxy(raw: string | null): { server: string; username?: string; password?: string } | undefined {
  if (!raw) return undefined
  let s = raw.trim()
  if (!s) return undefined

  let scheme = 'http'
  const schemeMatch = s.match(/^(https?|socks5|socks4):\/\//i)
  if (schemeMatch) {
    scheme = schemeMatch[1].toLowerCase()
    s = s.slice(schemeMatch[0].length)
  }

  let username: string | undefined
  let password: string | undefined
  const at = s.lastIndexOf('@')
  if (at !== -1) {
    const cred = s.slice(0, at)
    s = s.slice(at + 1)
    const ci = cred.indexOf(':')
    if (ci !== -1) {
      username = cred.slice(0, ci)
      password = cred.slice(ci + 1)
    } else {
      username = cred
    }
  }

  return { server: `${scheme}://${s}`, username, password }
}

// Quản lý vòng đời các profile chromium đang mở. Mỗi account = 1 persistent context.
class BrowserManager {
  private open = new Map<string, BrowserContext>()

  isOpen(accountId: string): boolean {
    return this.open.has(accountId)
  }

  openCount(): number {
    return this.open.size
  }

  async openProfile(account: Account): Promise<void> {
    if (this.open.has(account.id)) return

    mkdirSync(account.profileDir, { recursive: true })

    const context = await chromium.launchPersistentContext(account.profileDir, {
      channel: 'chrome',
      headless: false,
      viewport: null,
      proxy: parseProxy(account.proxy),
      args: ['--no-first-run', '--no-default-browser-check']
    })

    // Người dùng đóng cửa sổ => gỡ khỏi map.
    context.on('close', () => {
      this.open.delete(account.id)
    })

    this.open.set(account.id, context)

    const page = context.pages()[0] ?? (await context.newPage())
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' }).catch(() => {
      /* lỗi điều hướng (proxy chết...) không nên làm sập app; trạng thái sẽ phản ánh qua kiểm tra sau */
    })
  }

  async closeProfile(accountId: string): Promise<void> {
    const context = this.open.get(accountId)
    if (!context) return
    this.open.delete(accountId)
    await context.close().catch(() => {})
  }

  async closeAll(): Promise<void> {
    const contexts = [...this.open.values()]
    this.open.clear()
    await Promise.all(contexts.map((c) => c.close().catch(() => {})))
  }
}

export const browserManager = new BrowserManager()
