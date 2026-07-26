import { mkdirSync } from 'fs'
import { execSync } from 'child_process'
import { createHash } from 'crypto'
import { chromium, type BrowserContext, type Page } from 'patchright'
import {
  PROXY_LOCAL,
  PROXY_RANDOM,
  type Account,
  type BrowserAuthTokenLoginResult,
  type BrowserFingerprintReport
} from '../../shared/types'
import { resolveProxyString } from '../db/proxies'
import {
  getAccount,
  getAccountFingerprintObservation,
  listAccountFingerprintObservations,
  updateAccountFingerprintObservation
} from '../db/accounts'
import { getAllSettings } from '../db/settings'
import { openTaskPage } from './BrowserPages'

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
  private fingerprintChecks = new Map<string, Promise<BrowserFingerprintReport>>()

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
  async openProfile(
    account: Account,
    opts?: { headlessOverride?: boolean; skipInitialNavigation?: boolean }
  ): Promise<void> {
    if (this.open.has(account.id)) return

    const profileDir = account.profileDir
    mkdirSync(profileDir, { recursive: true })

    // "Chạy ngầm": headless thuần -> ẩn 100% (không cửa sổ, không taskbar icon).
    // Patchright che leak headless nên vẫn khó bị phát hiện. Khi user chủ động mở
    // profile để đăng nhập, ép headful (hiện cửa sổ) bất kể cờ headless của account.
    const headless = opts?.headlessOverride ?? account.headless

    // Proxy: resolve từ account.proxyId ('__local' | '__random' | id). Với __random,
    // mỗi lần mở sẽ pick 1 proxy khác nhau trong kho. Trả về raw string -> parseProxy.
    const proxyString = resolveProxyString(account.proxyId)
    // Không log chuỗi proxy vì có thể chứa username/password.
    console.log(
      `[browser] profile ${account.label}: proxy=${proxyString ? 'configured' : 'local'}`
    )

    // Chặn tải media (nếu bật trong Cài đặt). QUAN TRỌNG — vì sao KHÔNG dùng context.route():
    //   Chỉ cần đăng ký context.route() (dù pattern hẹp) là Playwright/patchright TẮT TOÀN BỘ
    //   HTTP cache của context. Hệ quả: mọi JS bundle nặng + API + font của X phải tải LẠI
    //   qua proxy mỗi lần điều hướng -> home/compose LOAD RẤT LÂU -> timeout, không đăng được.
    //   Băng thông tiết kiệm từ chặn ảnh KHÔNG bù nổi phần mất cache.
    // Cách dùng: chặn ẢNH + VIDEO theo URL qua CDP Network.setBlockedURLs (xem applyMediaBlock).
    //   CDP chặn ở tầng network stack, KHÔNG tắt cache như route() -> trang vẫn load nhanh.
    //   - Ảnh: host pbs.twimg.com + đuôi .jpg/.png/.gif/.webp… (feed không tải ảnh).
    //   - Video: host video.twimg.com + đuôi stream HLS/DASH (.m3u8/.ts/.m4s/.mpd/.mp4).
    // VÌ SAO KHÔNG dùng --blink-settings=imagesEnabled=false (cách cũ, đã BỎ):
    //   Nó tắt engine GIẢI MÃ ẢNH. Khi upload ảnh, X tạo <img> preview cục bộ (blob:) rồi CHỜ
    //   onload để lấy kích thước -> tắt decode thì onload không bắn -> preview XOAY MÃI -> đăng
    //   ảnh lỗi. Chặn theo URL qua CDP không đụng ảnh blob: cục bộ nên upload ảnh vẫn chạy.
    //   (Không dùng addInitScript hook fetch: patchright vô hiệu hoá addInitScript để tránh bị
    //    phát hiện -> script không chạy.)
    // KHÔNG ảnh hưởng upload đăng bài (setInputFiles đọc file cục bộ + preview dùng blob:, không
    // khớp host/đuôi bị chặn; upload endpoint là upload.twitter.com cũng không khớp).
    const blockMedia = getAllSettings().blockMedia

    const launch = (): Promise<BrowserContext> =>
      chromium.launchPersistentContext(profileDir, {
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
      if (/existing browser session|already in use|profile|target page, context or browser has been closed/i.test(msg)) {
        killStaleBrowserHolding(profileDir)
        context = await launch()
      } else {
        throw e
      }
    }

    // Người dùng đóng cửa sổ => gỡ khỏi map + báo UI cập nhật trạng thái.
    context.on('close', () => {
      if (this.open.delete(account.id)) this.emitStatus(account.id, false)
    })

    // Chặn ẢNH + VIDEO (nếu bật): gắn CDP Network.setBlockedURLs cho MỌI page. CDP session gắn
    // theo từng page, nên phải áp cho page hiện có + mọi page mở sau (đọc reply / comment mở
    // page riêng). Lỗi CDP không được làm sập việc mở profile -> bọc try/catch, nuốt lỗi.
    if (blockMedia) {
      for (const p of context.pages()) void applyMediaBlock(context, p)
      context.on('page', (p) => void applyMediaBlock(context, p))
    }

    this.open.set(account.id, context)
    this.emitStatus(account.id, true)

    if (!opts?.skipInitialNavigation) {
      const page = context.pages()[0] ?? (await openTaskPage(context))
      await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' }).catch(() => {
        /* lỗi điều hướng (proxy chết...) không nên làm sập app; trạng thái sẽ phản ánh qua kiểm tra sau */
      })
    }
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

  // auth_token là bearer credential: chỉ trả về main process để IPC ghi thẳng vào clipboard.
  // Không log, lưu DB/file hoặc chuyển giá trị token sang renderer.
  async readXAuthToken(account: Account): Promise<string> {
    // Không override headless: tài khoản bật chạy ngầm sẽ mở ngầm, còn lại hiện cửa sổ như cấu hình.
    if (!this.isOpen(account.id)) await this.openProfile(account)
    const context = this.getContext(account.id)
    if (!context) throw new Error('Không mở được profile để đọc auth token.')

    const cookies = await context.cookies(['https://x.com', 'https://twitter.com'])
    const candidates = cookies.filter(
      (cookie) =>
        cookie.name === 'auth_token' &&
        /(^|\.)((x)|(twitter))\.com$/i.test(cookie.domain) &&
        Boolean(cookie.value)
    )
    const authCookie =
      candidates.find((cookie) => /(^|\.)x\.com$/i.test(cookie.domain)) ?? candidates[0]

    if (!authCookie) {
      throw new Error('Profile chưa có auth token của X. Hãy đăng nhập X trong đúng profile rồi thử lại.')
    }
    return authCookie.value
  }

  async getFingerprint(account: Account, refresh: boolean): Promise<BrowserFingerprintReport> {
    if (!refresh) {
      const cached = getCachedFingerprintReport(account.id)
      if (cached) return enrichCachedNetwork(account.id, cached)
    }
    // React StrictMode hoặc double-click có thể gửi hai request cùng lúc. Dùng chung một
    // promise để chỉ một browser được mở cho mỗi account, tránh hai process tranh profile.
    const running = this.fingerprintChecks.get(account.id)
    if (running) return running

    const check = this.inspectFingerprint(account).catch((error) => {
      throw new Error(formatFingerprintError(error))
    })
    this.fingerprintChecks.set(account.id, check)
    try {
      return await check
    } finally {
      if (this.fingerprintChecks.get(account.id) === check) {
        this.fingerprintChecks.delete(account.id)
      }
    }
  }

  async loginXWithAuthToken(
    account: Account,
    rawAuthToken: string
  ): Promise<BrowserAuthTokenLoginResult> {
    const authToken = extractAuthToken(rawAuthToken)
    if (!authToken) {
      throw new Error(
        'Không tìm thấy auth token hợp lệ. Có thể nhập giá trị token, auth_token=..., hoặc toàn bộ cookie header.'
      )
    }

    // Aviary không ghi token vào DB/cấu hình/log; browser tự lưu cookie phiên trong profile.
    // Mở lại để profile đang chạy không tiếp tục dùng cookie cũ trong lúc thay phiên đăng nhập.
    await this.closeProfile(account.id)
    try {
      await this.openProfile(account, {
        headlessOverride: false,
        skipInitialNavigation: true
      })
      const context = this.getContext(account.id)
      if (!context) throw new Error('Không mở được profile để đăng nhập X.')

      const oldCookies = await context.cookies(['https://x.com', 'https://twitter.com'])
      for (const cookie of oldCookies) {
        if (cookie.name === 'auth_token' || cookie.name === 'ct0') {
          await context.clearCookies({ name: cookie.name, domain: cookie.domain, path: cookie.path })
        }
      }
      await context.addCookies([
        {
          name: 'auth_token',
          value: authToken,
          domain: '.x.com',
          path: '/',
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
          expires: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
        }
      ])

      const page = context.pages()[0] ?? (await openTaskPage(context))
      await page.goto('https://x.com/home', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000
      })
      const loggedIn = await page
        .locator('[data-testid="SideNav_AccountSwitcher_Button"]')
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false)
      if (!loggedIn) {
        const url = page.url()
        throw new Error(
          /\/i\/flow\/login|\/account\/access/i.test(url)
            ? 'X chưa chấp nhận auth token hoặc đang yêu cầu xác minh. Profile vẫn được mở để bạn kiểm tra.'
            : 'Không xác nhận được trạng thái đăng nhập tại X Home. Profile vẫn được mở để bạn kiểm tra.'
        )
      }

      return {
        ok: true,
        destinationUrl: page.url(),
        message: 'Đã đăng nhập X bằng auth token.'
      }
    } catch (error) {
      throw new Error(formatAuthTokenLoginError(error, authToken))
    }
  }

  async inspectFingerprint(account: Account): Promise<BrowserFingerprintReport> {
    const openedForCheck = !this.isOpen(account.id)
    if (openedForCheck) {
      // Dùng headful cho lần check đầu rồi tự đóng; profile đang mở sẵn vẫn dùng context hiện tại.
      await this.openProfile(account, {
        headlessOverride: true,
        skipInitialNavigation: true
      })
    }

    const context = this.getContext(account.id)
    if (!context) throw new Error('Không lấy được browser context để kiểm tra fingerprint')
    const page = await openTaskPage(context)
    try {
      await page.goto('https://api.ipify.org/?format=json', {
        waitUntil: 'domcontentloaded',
        timeout: 20_000
      }).catch(() => {})
      const runtime = (await page.evaluate(`(async () => {
        const hash = (value) => {
          let h = 2166136261
          for (let i = 0; i < value.length; i++) {
            h ^= value.charCodeAt(i)
            h = Math.imul(h, 16777619)
          }
          return (h >>> 0).toString(16).padStart(8, '0')
        }
        let ip = null
        try {
          const body = JSON.parse(document.body.innerText)
          if (typeof body.ip === 'string') ip = body.ip
        } catch {}
        if (!ip) {
          try {
            const response = await fetch('https://api64.ipify.org?format=json', { cache: 'no-store' })
            const body = await response.json()
            if (typeof body.ip === 'string') ip = body.ip
          } catch {}
        }

        const canvas = document.createElement('canvas')
        canvas.width = 320
        canvas.height = 80
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.textBaseline = 'top'
          ctx.font = '16px Arial'
          ctx.fillStyle = '#f60'
          ctx.fillRect(12, 12, 120, 28)
          ctx.fillStyle = '#069'
          ctx.fillText('Aviary fingerprint 1.0', 8, 42)
          ctx.strokeStyle = 'rgba(102, 204, 0, 0.8)'
          ctx.arc(230, 38, 22, 0, Math.PI * 2)
          ctx.stroke()
        }

        let vendor = 'Không khả dụng'
        let renderer = 'Không khả dụng'
        try {
          const gl = document.createElement('canvas').getContext('webgl')
          const ext = gl && gl.getExtension('WEBGL_debug_renderer_info')
          if (gl && ext) {
            vendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL))
            renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
          }
        } catch {}

        let audioHash = null
        try {
          const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext
          if (Offline) {
            const audio = new Offline(1, 4410, 44100)
            const oscillator = audio.createOscillator()
            const compressor = audio.createDynamicsCompressor()
            oscillator.type = 'triangle'
            oscillator.frequency.value = 10000
            oscillator.connect(compressor)
            compressor.connect(audio.destination)
            oscillator.start(0)
            const rendered = await audio.startRendering()
            const samples = rendered.getChannelData(0)
            let sample = ''
            for (let i = 0; i < samples.length; i += 32) sample += samples[i].toFixed(7) + ','
            audioHash = hash(sample)
          }
        } catch {}

        const nav = navigator
        let rtc = 'unknown'
        if (typeof window.RTCPeerConnection === 'undefined') {
          rtc = 'disabled'
        } else {
          try {
            const peer = new RTCPeerConnection()
            peer.createDataChannel('aviary-check')
            await peer.createOffer()
            peer.close()
            rtc = 'available'
          } catch {
            rtc = 'disabled'
          }
        }
        return {
          ip,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Không rõ',
          webrtc: rtc,
          navigator: {
            userAgent: nav.userAgent,
            platform: nav.platform,
            language: nav.language,
            languages: Array.from(nav.languages || []),
            hardwareConcurrency: nav.hardwareConcurrency || 0,
            deviceMemory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
            maxTouchPoints: nav.maxTouchPoints || 0,
            webdriver: Boolean(nav.webdriver)
          },
          screen: {
            width: screen.width,
            height: screen.height,
            availWidth: screen.availWidth,
            availHeight: screen.availHeight,
            colorDepth: screen.colorDepth,
            pixelRatio: window.devicePixelRatio,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight
          },
          graphics: {
            vendor,
            renderer,
            // Hash pixel RGBA thay vì chuỗi PNG. PNG encoder có thể tạo byte metadata khác nhau
            // dù hình render giống hệt, gây cảnh báo canvas thay đổi giả giữa hai lần mở.
            canvasHash: ctx
              ? hash(Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data).join(','))
              : hash(canvas.toDataURL()),
            audioHash
          }
        }
      })()`)) as RuntimeFingerprint

      if (!runtime?.navigator || !runtime.screen || !runtime.graphics) {
        throw new Error('Trình duyệt không trả về dữ liệu fingerprint hợp lệ')
      }
      const ipTimezone = runtime.ip ? await resolveIpTimezone(runtime.ip) : null

      return buildFingerprintReport(
        getAccount(account.id) ?? account,
        runtime,
        openedForCheck,
        ipTimezone
      )
    } finally {
      await page.close().catch(() => {})
      if (openedForCheck) await this.closeProfile(account.id)
    }
  }

}

export const browserManager = new BrowserManager()

interface RuntimeFingerprint {
  ip: string | null
  timezone: string
  webrtc: 'disabled' | 'available' | 'unknown'
  navigator: BrowserFingerprintReport['navigator']
  screen: BrowserFingerprintReport['screen']
  graphics: BrowserFingerprintReport['graphics']
}

const ipTimezoneCache = new Map<string, string | null>()

// v3: report cache mới không còn các field identity riêng của engine cũ.
const FINGERPRINT_OBSERVATION_VERSION = 3

function buildFingerprintReport(
  account: Account,
  runtime: RuntimeFingerprint,
  openedForCheck: boolean,
  ipTimezone: string | null
): BrowserFingerprintReport {
  const stableSnapshot = {
    navigator: runtime.navigator,
    screen: {
      width: runtime.screen.width,
      height: runtime.screen.height,
      availWidth: runtime.screen.availWidth,
      availHeight: runtime.screen.availHeight,
      colorDepth: runtime.screen.colorDepth,
      pixelRatio: runtime.screen.pixelRatio
    },
    graphics: runtime.graphics
  }
  const previousRaw = getAccountFingerprintObservation(account.id)
  const observation = parseJsonRecord(previousRaw)
  const previous = observation?.version === FINGERPRINT_OBSERVATION_VERSION &&
    isPlainRecord(observation.snapshot)
    ? observation.snapshot
    : null
  const changedFields = previous ? findChangedFields(previous, stableSnapshot) : []
  const identityId = shortHash(stableStringify(stableSnapshot))

  const report = withFingerprintQuality({
    accountId: account.id,
    accountLabel: account.label,
    capturedAt: Date.now(),
    openedForCheck,
    identity: {
      id: identityId,
      stability: previous ? (changedFields.length === 0 ? 'match' : 'changed') : 'first_check',
      changedFields
    },
    network: {
      ip: runtime.ip,
      timezone: runtime.timezone,
      ipTimezone,
      timezoneMatch: ipTimezone ? timezonesMatch(runtime.timezone, ipTimezone) : null,
      proxyMode:
        account.proxyId === PROXY_LOCAL
          ? 'local'
          : account.proxyId === PROXY_RANDOM
            ? 'random'
            : 'fixed',
      webrtc: runtime.webrtc
    },
    navigator: runtime.navigator,
    screen: runtime.screen,
    graphics: runtime.graphics
  } as Omit<BrowserFingerprintReport, 'quality'>, account.id)
  updateAccountFingerprintObservation(
    account.id,
    JSON.stringify({ version: FINGERPRINT_OBSERVATION_VERSION, snapshot: stableSnapshot, report })
  )
  return report
}

function getCachedFingerprintReport(accountId: string): BrowserFingerprintReport | null {
  const cached = parseJsonRecord(getAccountFingerprintObservation(accountId))
  if (!isPlainRecord(cached?.report)) return null
  const report = cached.report as unknown as BrowserFingerprintReport
  if (report.accountId !== accountId || typeof report.capturedAt !== 'number') return null
  // Cache v1 hash toàn bộ PNG nên có thể báo canvas đổi giả. Không mang cảnh báo này sang v2;
  // lần refresh kế tiếp sẽ tạo baseline pixel hash mới.
  const compatibleReport = cached.version === FINGERPRINT_OBSERVATION_VERSION
    ? report
    : {
        ...report,
        identity: { ...report.identity, stability: 'first_check' as const, changedFields: [] }
      }
  return withFingerprintQuality(compatibleReport, accountId)
}

async function enrichCachedNetwork(
  accountId: string,
  report: BrowserFingerprintReport
): Promise<BrowserFingerprintReport> {
  if (!report.network.ip || report.network.ipTimezone !== undefined) return report
  const ipTimezone = await resolveIpTimezone(report.network.ip)
  const enriched = withFingerprintQuality(
    {
      ...report,
      network: {
        ...report.network,
        ipTimezone,
        timezoneMatch: ipTimezone ? timezonesMatch(report.network.timezone, ipTimezone) : null
      }
    },
    accountId
  )
  const cached = parseJsonRecord(getAccountFingerprintObservation(accountId))
  if (cached) {
    updateAccountFingerprintObservation(accountId, JSON.stringify({ ...cached, report: enriched }))
  }
  return enriched
}

function withFingerprintQuality(
  report: Omit<BrowserFingerprintReport, 'quality'> | BrowserFingerprintReport,
  accountId: string
): BrowserFingerprintReport {
  const checks: BrowserFingerprintReport['quality']['checks'] = []
  const add = (
    label: string,
    pass: boolean,
    detail: string,
    maxPoints: number,
    warnPoints = 0
  ): void => {
    checks.push({
      label,
      status: pass ? 'pass' : 'warn',
      detail,
      points: pass ? maxPoints : warnPoints,
      maxPoints
    })
  }

  const collisions = findFingerprintCollisions(accountId, report.identity.id)
  add(
    'Khác biệt giữa account',
    collisions.length === 0,
    collisions.length === 0
      ? 'Chưa trùng mã runtime với account đã kiểm tra khác'
      : `Trùng mã runtime với ${collisions.length} account khác`,
    30
  )
  add(
    'Che dấu automation',
    !report.navigator.webdriver,
    report.navigator.webdriver ? 'navigator.webdriver đang bật' : 'navigator.webdriver = false',
    25
  )
  // Fingerprint ổn định giữa các lần mở: X coi thiết bị đổi liên tục là tín hiệu đáng ngờ.
  const stableIdentity = report.identity.stability !== 'changed'
  add(
    'Fingerprint ổn định',
    stableIdentity,
    report.identity.stability === 'match'
      ? 'Fingerprint không đổi so với lần kiểm tra trước'
      : report.identity.stability === 'first_check'
        ? 'Lần kiểm tra đầu, đã lưu mốc so sánh cho lần sau'
        : `Đã đổi ${report.identity.changedFields.length} đặc tính so với lần trước`,
    15,
    report.identity.stability === 'first_check' ? 10 : 0
  )
  const webrtcSafe = report.network.webrtc === 'disabled'
  add(
    'Chống rò rỉ WebRTC',
    webrtcSafe,
    webrtcSafe
      ? 'WebRTC đã tắt'
      : report.network.proxyMode === 'local'
        ? 'WebRTC có sẵn; đang dùng IP máy'
        : 'WebRTC có sẵn khi dùng proxy; có nguy cơ lộ IP thật',
    15,
    report.network.proxyMode === 'local' ? 10 : 0
  )
  const plausiblePlatform = /Windows/i.test(report.navigator.userAgent) &&
    /^Win/i.test(report.navigator.platform)
  const plausibleGraphics = Boolean(report.graphics.vendor && report.graphics.renderer) &&
    !/không khả dụng/i.test(`${report.graphics.vendor} ${report.graphics.renderer}`)
  const plausibleScreen = report.screen.width >= 800 && report.screen.height >= 600 &&
    report.screen.colorDepth >= 24
  add(
    'Tính hợp lý tổng thể',
    plausiblePlatform && plausibleGraphics && plausibleScreen,
    plausiblePlatform && plausibleGraphics && plausibleScreen
      ? 'UA, platform, WebGL và màn hình không mâu thuẫn rõ ràng'
      : 'Có tín hiệu UA/platform/WebGL/màn hình cần kiểm tra',
    5,
    Math.round(
      ([plausiblePlatform, plausibleGraphics, plausibleScreen].filter(Boolean).length / 3) * 5
    )
  )
  add(
    'Bề mặt fingerprint',
    Boolean(report.graphics.canvasHash && report.graphics.audioHash),
    report.graphics.audioHash
      ? 'Có canvas, audio và WebGL để tạo identity riêng'
      : 'Thiếu audio fingerprint',
    5,
    report.graphics.canvasHash ? 3 : 0
  )
  const timezoneMatch = report.network.timezoneMatch
  add(
    'Múi giờ khớp IP',
    timezoneMatch === true,
    timezoneMatch === true
      ? `${report.network.timezone} khớp múi giờ của IP`
      : timezoneMatch === false
        ? `Browser: ${report.network.timezone} · IP: ${report.network.ipTimezone}`
        : 'Chưa tra được múi giờ theo IP',
    5,
    timezoneMatch === null && report.network.ip ? 3 : 0
  )

  const score = checks.reduce((sum, check) => sum + check.points, 0)
  const grade: BrowserFingerprintReport['quality']['grade'] =
    score >= 90 ? 'excellent' : score >= 75 ? 'good' : score >= 60 ? 'fair' : 'risk'
  return { ...report, quality: { score, grade, checks } }
}

function findFingerprintCollisions(accountId: string, identityId: string): string[] {
  const collisions: string[] = []
  for (const row of listAccountFingerprintObservations()) {
    if (row.accountId === accountId) continue
    const parsed = parseJsonRecord(row.observation)
    const cachedReport = isPlainRecord(parsed?.report) ? parsed.report : null
    const otherIdentity = cachedReport?.identity
    if (isPlainRecord(otherIdentity) && otherIdentity.id === identityId) {
      collisions.push(row.accountId)
    }
  }
  return collisions
}

// Tra múi giờ theo IP để so với múi giờ trình duyệt. Nguồn ngoài có thể lệch cấp bang/thành phố
// nên chỉ dùng để cảnh báo lệch rõ ràng, không dùng để chấm điểm nặng.
async function resolveIpTimezone(ip: string): Promise<string | null> {
  const cached = ipTimezoneCache.get(ip)
  if (cached !== undefined) return cached
  let timezone: string | null = null
  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,timezone`, {
      signal: AbortSignal.timeout(8_000)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = (await response.json()) as {
      success?: boolean
      timezone?: { id?: unknown } | string
    }
    timezone = typeof data.timezone === 'string'
      ? data.timezone
      : typeof data.timezone?.id === 'string'
        ? data.timezone.id
        : null
    if (data.success === false) timezone = null
  } catch {
    timezone = null
  }
  ipTimezoneCache.set(ip, timezone)
  return timezone
}

function timezonesMatch(browserTimezone: string, ipTimezone: string): boolean {
  return canonicalTimezone(browserTimezone) === canonicalTimezone(ipTimezone)
}

function canonicalTimezone(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions().timeZone
  } catch {
    return timezone
  }
}

function formatFingerprintError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/already running|not responding|profile.*(?:use|lock)|target page, context or browser has been closed/i.test(message)) {
    return 'Profile Chromium đang được một tiến trình khác giữ. Hãy đóng cửa sổ Chromium của tài khoản này, chờ vài giây rồi bấm Kiểm tra lại.'
  }
  if (/timeout|timed out/i.test(message)) {
    return 'Kiểm tra quá thời gian chờ. Hãy kiểm tra lại proxy hoặc mở profile trước rồi thử lại.'
  }
  // Không đưa browser logs/command line dài (có thể chứa IP hoặc dữ liệu nhạy cảm) ra UI.
  const firstLine = message.split(/\r?\n|Browser logs:|Call log:/)[0].trim()
  return firstLine || 'Không đọc được fingerprint từ trình duyệt.'
}

function formatAuthTokenLoginError(error: unknown, authToken: string): string {
  const message = error instanceof Error ? error.message : String(error)
  const firstLine = message
    .replaceAll(authToken, '[auth_token]')
    .split(/\r?\n|Browser logs:|Call log:/)[0]
    .trim()
  return firstLine || 'Không đăng nhập được X bằng auth token.'
}

function extractAuthToken(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const input = raw.trim()
  if (!input) return null

  // Nhận cookie header như "auth_token=...; ct0=..." và chuỗi export từ DevTools.
  const named = input.match(
    /(?:^|[;,\s{])["']?auth_token["']?\s*[=:]\s*(?:"([^"]+)"|'([^']+)'|([^;\s,}]+))/i
  )
  const devtoolsRow = input.match(/(?:^|\s)auth_token\s+(?:"([^"]+)"|'([^']+)'|([^;\s,}]+))/i)
  const candidate = named
    ? named[1] ?? named[2] ?? named[3]
    : devtoolsRow
      ? devtoolsRow[1] ?? devtoolsRow[2] ?? devtoolsRow[3]
      : input.replace(/^["']|["']$/g, '')

  const token = candidate.trim()
  return token && !/[\s;,}]/.test(token) ? token : null
}

function parseJsonRecord(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

function findChangedFields(
  previous: Record<string, unknown>,
  current: Record<string, unknown>,
  prefix = ''
): string[] {
  const ignored = new Set(['capturedAt', 'identityId'])
  const changed: string[] = []
  for (const key of new Set([...Object.keys(previous), ...Object.keys(current)])) {
    if (ignored.has(key)) continue
    const path = prefix ? `${prefix}.${key}` : key
    const before = previous[key]
    const after = current[key]
    if (isPlainRecord(before) && isPlainRecord(after)) {
      changed.push(...findChangedFields(before, after, path))
    } else if (stableStringify(before) !== stableStringify(after)) {
      changed.push(path)
    }
  }
  return changed
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isPlainRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function shortHash(value: string): string {
  const hash = createHash('sha256').update(value).digest('hex').slice(0, 16).toUpperCase()
  return `${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}-${hash.slice(12)}`
}

// Danh sách pattern URL media của X để chặn qua CDP Network.setBlockedURLs.
//   - ẢNH: host pbs.twimg.com (ảnh feed, avatar, card…) + đuôi ảnh phổ biến.
//   - VIDEO: host video.twimg.com + đuôi stream HLS/DASH (.m3u8/.ts/.m4s/.mpd) + .mp4.
// (kèm ?query nên có cả biến thể '*?*'.) KHÔNG khớp:
//   - blob: (preview upload cục bộ) -> upload ảnh/video khi đăng bài vẫn chạy.
//   - upload.twitter.com (endpoint upload) -> đăng media bình thường.
const MEDIA_BLOCK_URLS = [
  '*pbs.twimg.com*',
  '*video.twimg.com*',
  '*.jpg', '*.jpg?*', '*.jpeg', '*.jpeg?*',
  '*.png', '*.png?*', '*.gif', '*.gif?*',
  '*.webp', '*.webp?*',
  '*.mp4', '*.mp4?*', '*.m3u8', '*.m3u8?*',
  '*.ts', '*.ts?*', '*.m4s', '*.m4s?*', '*.mpd', '*.mpd?*'
]

// Gắn CDP block media cho 1 page. CDP Network.setBlockedURLs chặn ở tầng network stack mà
// KHÔNG tắt HTTP cache (khác context.route). Lỗi (page đã đóng, CDP không khả dụng) -> nuốt,
// không làm sập luồng mở profile / mở page.
async function applyMediaBlock(context: BrowserContext, page: Page): Promise<void> {
  try {
    const client = await context.newCDPSession(page)
    await client.send('Network.enable')
    await client.send('Network.setBlockedURLs', { urls: MEDIA_BLOCK_URLS })
  } catch {
    /* page đóng sớm / CDP lỗi -> bỏ qua, không chặn được media page này nhưng không sập app */
  }
}

// Dọn process browser mồ côi đang giữ đúng profileDir sau khi Aviary restart/crash.
// Chỉ nhắm command line có đường dẫn profile của account này, không động browser cá nhân
// hoặc profile tài khoản khác.
function killStaleBrowserHolding(profileDir: string): void {
  try {
    const encodedName = Buffer.from('chrome.exe', 'utf16le').toString('base64')
    const encodedProfile = Buffer.from(profileDir, 'utf16le').toString('base64')
    // Truyền dữ liệu qua base64 để đường dẫn/ký tự đặc biệt không thể phá câu lệnh PowerShell.
    const script = [
      `$name=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodedName}'));`,
      `$profile=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodedProfile}'));`,
      'Get-CimInstance Win32_Process |',
      'Where-Object { $_.Name -eq $name -and $_.CommandLine -and $_.CommandLine.Contains($profile) } |',
      'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'
    ].join(' ')
    execSync(`pwsh -NoProfile -NonInteractive -Command "${script}"`, {
      windowsHide: true,
      timeout: 8000,
      stdio: 'ignore'
    })
  } catch {
    /* không có tiến trình / không đủ quyền -> để launch retry tự báo lỗi ngắn gọn */
  }
}
