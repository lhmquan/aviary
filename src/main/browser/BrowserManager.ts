import { mkdirSync } from 'fs'
import { execSync } from 'child_process'
import { chromium, type BrowserContext } from 'patchright'
import type { Account } from '../../shared/types'
import { resolveProxyString } from '../db/proxies'
import { getAllSettings } from '../db/settings'

// Parse chuỗi proxy sang cấu hình Playwright. Chấp nhận nhiều định dạng phổ biến:
//   - host:port                         (không auth)
//   - user:pass@host:port               (dạng URL-auth)
//   - host:port:user:pass               (d dạng IP:port:user:pass — rất phổ biến từ các nhà cung cấp)
//   - socks5://user:pass@host:port      (kèm scheme)
// Tách scheme trước, rồi ưu tiên '@' (URL-auth). Nếu không có '@' mà nhiều hơn 2 dấu ':'
// -> xem như host:port:user:pass.
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

  // Dạng user:pass@host:port.
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
  } else {
    // Không có '@'. Tách theo ':' để phân biệt host:port với host:port:user:pass.
    const parts = s.split(':')
    if (parts.length >= 4) {
      // host:port:user:pass (hoặc host:port:user:pass:extra) -> ghép phần sau user.
      username = parts[2]
      password = parts.slice(3).join(':')
      s = `${parts[0]}:${parts[1]}`
    }
    // parts.length === 1 -> chỉ có host (không port) -> vẫn trả server nguyên; parts.length
    // === 2 hoặc 3 (host:port / host:port:user không pass) -> để nguyên.
  }

  return { server: `${scheme}://${s}`, username, password }
}

// Quản lý vòng đời các profile chromium đang mở. Mỗi account = 1 persistent context.
class BrowserManager {
  private open = new Map<string, BrowserContext>()
  private statusListeners = new Set<(accountId: string, open: boolean) => void>()

  isOpen(accountId: string): boolean {
    return this.open.has(accountId)
  }

  openCount(): number {
    return this.open.size
  }

  // Renderer đăng ký để nhận thay đổi trạng thái (đóng cửa sổ thủ công...).
  onStatusChange(cb: (accountId: string, open: boolean) => void): () => void {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }

  private emitStatus(accountId: string, open: boolean): void {
    for (const cb of this.statusListeners) cb(accountId, open)
  }

  // Mở profile. `headlessOverride` (nếu truyền) quyết định chế độ hiển thị cho lần mở
  // này, ưu tiên hơn account.headless:
  //  - user bấm "Mở profile" -> truyền false (headful, hiện cửa sổ để user đăng nhập).
  //  - đăng bài / lịch đăng -> không truyền -> dùng account.headless (thường ngầm).
  async openProfile(account: Account, opts?: { headlessOverride?: boolean }): Promise<void> {
    if (this.open.has(account.id)) return

    mkdirSync(account.profileDir, { recursive: true })

    // "Chạy ngầm": headless thuần -> ẩn 100% (không cửa sổ, không taskbar icon).
    // Patchright che leak headless nên vẫn khó bị phát hiện. Khi user chủ động mở
    // profile để đăng nhập, ép headful (hiện cửa sổ) bất kể cờ headless của account.
    const headless = opts?.headlessOverride ?? account.headless

    // Proxy: resolve từ account.proxyId ('__local' | '__random' | id). Với __random,
    // mỗi lần mở sẽ pick 1 proxy khác nhau trong kho. Trả về raw string -> parseProxy.
    const proxyString = resolveProxyString(account.proxyId)
    console.log(`[browser] profile ${account.label}: proxy=${account.proxyId} -> ${proxyString ?? 'local'}`)

    const launch = (): Promise<BrowserContext> =>
      chromium.launchPersistentContext(account.profileDir, {
        channel: 'chrome',
        headless,
        viewport: null,
        proxy: parseProxy(proxyString),
        args: [
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-infobars',
          '--test-type'
        ]
      })

    // Profile có thể bị khóa bởi tiến trình Chrome cũ/zombie ("Opening in existing
    // browser session"). Thử mở; nếu lỗi session -> kill tiến trình đang giữ profile
    // rồi retry đúng 1 lần.
    let context: BrowserContext
    try {
      context = await launch()
    } catch (e) {
      const msg = (e as Error).message ?? ''
      if (/existing browser session|already in use|profile/i.test(msg)) {
        killStaleChromeHolding(account.profileDir)
        context = await launch()
      } else {
        throw e
      }
    }

    // Người dùng đóng cửa sổ => gỡ khỏi map + báo UI cập nhật trạng thái.
    context.on('close', () => {
      if (this.open.delete(account.id)) this.emitStatus(account.id, false)
    })

    // Chặn tải media (nếu bật trong Cài đặt): huỷ mọi request ảnh/video/font/media để tiết
    // kiệm băng thông proxy + load nhanh hơn. KHÔNG ảnh hưởng upload đăng bài (setInputFiles
    // đọc file cục bộ + preview dùng blob: nội bộ, không qua network). Áp cho toàn context
    // -> mọi page (kể cả page mở khi collect reply / comment).
    if (getAllSettings().blockMedia) {
      // QUAN TRỌNG: chỉ đăng route cho ĐÚNG các URL media (regex), KHÔNG dùng '**/*'.
      // Nếu route('**/*') thì patchright pause MỌI request rồi từng cái phải vòng qua Node
      // để continue() -> với X (hàng trăm request) qua proxy, độ trễ cộng dồn làm chậm hẳn,
      // compose/home có thể timeout. Đăng route hẹp -> chỉ media bị chặn, request khác chạy thẳng.
      //   - host pbs.twimg.com / video.twimg.com -> ảnh + video (kể cả HLS/DASH fetch qua xhr).
      //   - đuôi ảnh/video/font -> bắt luôn các CDN khác (card, emoji, font woff).
      // KHÔNG khớp upload (upload.twitter.com/i/media/upload.json) nên upload đăng bài an toàn.
      const mediaUrl =
        /(?:\/\/(?:pbs|video)\.twimg\.com\/)|(?:\.(?:jpg|jpeg|png|gif|webp|svg|ico|mp4|m3u8|ts|m4s|mpd|woff2?|ttf|otf)(?:$|\?))/i
      await context.route(mediaUrl, (route) => route.abort().catch(() => {})).catch(() => {})
    }

    this.open.set(account.id, context)
    this.emitStatus(account.id, true)

    const page = context.pages()[0] ?? (await context.newPage())
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' }).catch(() => {
      /* lỗi điều hướng (proxy chết...) không nên làm sập app; trạng thái sẽ phản ánh qua kiểm tra sau */
    })
  }

  async closeProfile(accountId: string): Promise<void> {
    const context = this.open.get(accountId)
    if (!context) return
    this.open.delete(accountId)
    this.emitStatus(accountId, false)
    await context.close().catch(() => {})
  }

  async closeAll(): Promise<void> {
    const contexts = [...this.open.values()]
    this.open.clear()
    await Promise.all(contexts.map((c) => c.close().catch(() => {})))
  }

  getContext(accountId: string): BrowserContext | undefined {
    return this.open.get(accountId)
  }
}

export const browserManager = new BrowserManager()

// Kill các tiến trình chrome.exe đang giữ profileDir (qua --user-data-dir).
// Chỉ nhắm đúng tiến trình dùng profile này, không động Chrome thường của user.
// Windows: dùng wmic lấy commandline + taskkill. An toàn nếu wmic vắng thì bỏ qua.
function killStaleChromeHolding(profileDir: string): void {
  try {
    const normalized = profileDir.replace(/\\/g, '\\\\')
    // Lấy danh sách ProcessId có commandline chứa --user-data-dir=<profileDir>.
    const out = execSync(
      `wmic process where "name='chrome.exe' and CommandLine like '%--user-data-dir=${normalized}%'" get ProcessId /format:value`,
      { windowsHide: true, timeout: 8000 }
    ).toString()
    const pids = [...out.matchAll(/ProcessId=(\d+)/g)].map((m) => m[1]).filter(Boolean)
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { windowsHide: true, timeout: 5000 })
      } catch {
        /* ignore từng pid */
      }
    }
  } catch {
    /* wmic vắng / không có tiến trình -> bỏ qua, để launch retry tự báo lỗi */
  }
}
