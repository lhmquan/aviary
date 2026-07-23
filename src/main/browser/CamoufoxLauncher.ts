// Launcher cho engine Camoufox (Firefox anti-detect native) — TÁCH RIÊNG khỏi BrowserManager
// để giữ luồng Chromium/patchright cũ nguyên vẹn. Chỉ được gọi khi account.engine === 'camoufox'.
//
// VÌ SAO Camoufox (so với patchright/Chromium):
//   - Canvas NATIVE: toDataURL vẫn [native code], hash ổn định -> KHÔNG bị pixelscan/iphey báo
//     "Masking detected" (JS injection trên Chromium KHÔNG làm được điều này).
//   - WebRTC disabled hẳn (block_webrtc) -> không lộ IP thật.
//   - geoip:true -> tự tính timezone/locale/geolocation/WebRTC theo VÙNG PROXY qua MaxMind
//     GeoLite2 -> browserscan "Proxy: No", authenticity 100% (đã đo thật, xem docs/ANTIDETECT_PROGRESS.md §12d).
//   -> Camoufox tự lo geo/timezone/WebRTC, KHÔNG cần proxyGeo.ts / WebRTC mask thủ công như Chromium.
//
// LƯU Ý TÍCH HỢP:
//   - playwright-core PHẢI pin đúng 1.53.1 (đã pin trong package.json). Bản mới hơn gửi field
//     Juggler (isMobile...) mà Camoufox Firefox 152 không nhận -> lỗi launch. KHÔNG để "*"/"^".
//   - Firefox KHÔNG có CDP -> ảnh dùng `block_images`, video X dùng Playwright route theo host
//     và đuôi HLS/DASH. Route chỉ bật khi user bật chặn media.
//   - os:'windows' GHIM OS spoof = Windows (khớp máy thật + phổ biến nhất, tránh Camoufox random ra
//     Mac -> WebGL Apple lệch máy Windows -> tăng nguy cơ "masking"). 1 account = 1 fingerprint ổn định.

import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { randomInt } from 'crypto'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { screen } from 'electron'
import { execFile } from 'child_process'
import type { BrowserContext, Route } from 'patchright'
import { parseProxy } from './BrowserManager'
import { useSameWindowTaskTabs } from './BrowserPages'

// camoufox-js là ESM-only. App build ra CommonJS (out/main dùng require) -> KHÔNG require() được
// ESM (ERR_REQUIRE_ESM). Phải dùng dynamic import().
// LƯU Ý: với tsconfig module=CommonJS, tsc HẠ CẤP `import()` thành `require()` -> vẫn vỡ. Dùng
// `new Function` để giữ nguyên import() động ở runtime (tsc không đụng vào chuỗi trong Function).
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const importESM = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<unknown>

// Kiểu tối thiểu cho hàm Camoufox export (chỉ cần gọi được + trả Promise).
type CamoufoxFn = (opts: Record<string, unknown>) => Promise<unknown>
type DownloadReporter = (message: string) => void

interface CamoufoxFetcherLike {
  init(): Promise<void>
  url: string
  verstr: string
  extractZip(path: string): Promise<void>
  setVersion(): void
}

interface CamoufoxPackageManager {
  INSTALL_DIR: string | { toString(): string }
  CamoufoxFetcher: new () => CamoufoxFetcherLike
  camoufoxPath(downloadIfMissing?: boolean): string | { toString(): string }
}

interface CamoufoxLocaleManager {
  downloadMMDB(): Promise<void>
  getGeolocation(ip: string): Promise<{ timezone: string }>
}

// Dùng đúng GeoLite2 và code lookup mà Camoufox dùng lúc launch để đối chiếu timezone.
// Nguồn ngoài có thể xếp cùng IP ở bang khác và chỉ nên dùng làm tham khảo.
export async function resolveCamoufoxIpTimezone(ip: string): Promise<string | null> {
  try {
    const locale = await getLocaleManager()
    const location = await locale.getGeolocation(ip)
    return location.timezone || null
  } catch {
    return null
  }
}

interface CamoufoxFingerprintManager {
  generateFingerprint(
    window: [number, number],
    config: {
      operatingSystems: string[]
      screen: { minWidth: number; maxWidth: number; minHeight: number; maxHeight: number }
    }
  ): Record<string, unknown>
}

interface CamoufoxIpManager {
  publicIP(proxy?: string): Promise<string>
}

interface CamoufoxWebGlManager {
  sampleWebGL(os: 'win' | 'mac' | 'lin'): Promise<Record<string, unknown>>
}

interface StoredCamoufoxFingerprint {
  version: 3
  windowSize: [number, number]
  screenSize: [number, number]
  fingerprint: Record<string, unknown>
  config: {
    'fonts:spacing_seed': number
    'audio:seed': number
    'canvas:seed': number
    'canvas:aaOffset': number
    'canvas:aaCapOffset': boolean
    'window.history.length': number
  }
  webglConfig: [string, string]
}

// Cache module sau lần import đầu (tải binary có thể lâu, nhưng import module thì nhanh).
let camoufoxFnPromise: Promise<CamoufoxFn> | null = null
function getCamoufox(): Promise<CamoufoxFn> {
  if (!camoufoxFnPromise) {
    camoufoxFnPromise = importESM('camoufox-js').then(
      (m) => (m as { Camoufox: CamoufoxFn }).Camoufox
    )
  }
  return camoufoxFnPromise
}

let packageManagerPromise: Promise<CamoufoxPackageManager> | null = null
function getPackageManager(): Promise<CamoufoxPackageManager> {
  if (!packageManagerPromise) {
    packageManagerPromise = importESM('camoufox-js/dist/pkgman.js').then(
      (m) => m as CamoufoxPackageManager
    )
  }
  return packageManagerPromise
}

let localeManagerPromise: Promise<CamoufoxLocaleManager> | null = null
function getLocaleManager(): Promise<CamoufoxLocaleManager> {
  if (!localeManagerPromise) {
    localeManagerPromise = importESM('camoufox-js/dist/locale.js').then(
      (m) => m as CamoufoxLocaleManager
    )
  }
  return localeManagerPromise
}

let fingerprintManagerPromise: Promise<CamoufoxFingerprintManager> | null = null
function getFingerprintManager(): Promise<CamoufoxFingerprintManager> {
  if (!fingerprintManagerPromise) {
    fingerprintManagerPromise = importESM('camoufox-js/dist/fingerprints.js').then(
      (m) => m as CamoufoxFingerprintManager
    )
  }
  return fingerprintManagerPromise
}

let ipManagerPromise: Promise<CamoufoxIpManager> | null = null
function getIpManager(): Promise<CamoufoxIpManager> {
  if (!ipManagerPromise) {
    ipManagerPromise = importESM('camoufox-js/dist/ip.js').then((m) => m as CamoufoxIpManager)
  }
  return ipManagerPromise
}

let webGlManagerPromise: Promise<CamoufoxWebGlManager> | null = null
function getWebGlManager(): Promise<CamoufoxWebGlManager> {
  if (!webGlManagerPromise) {
    webGlManagerPromise = importESM('camoufox-js/dist/webgl/sample.js').then(
      (m) => m as CamoufoxWebGlManager
    )
  }
  return webGlManagerPromise
}

let browserInstallPromise: Promise<void> | null = null
let geoIpInstallPromise: Promise<void> | null = null
const proxyIpCache = new Map<string, string>()

// Cấu hình mở 1 profile Camoufox.
export interface CamoufoxLaunchOpts {
  userDataDir: string
  headless: boolean
  // Chuỗi proxy raw (host:port:user:pass...) hoặc null (dùng IP máy — geoip sẽ TẮT vì cần proxy).
  proxyString: string | null
  proxyIp: string | null
  // Chặn tải ảnh/video (tiết kiệm băng thông proxy).
  blockMedia: boolean
  storedFingerprint: string | null
  onFingerprintCreated: (fingerprint: string) => void
  onDownloadProgress?: DownloadReporter
}

// Mở persistent context Camoufox. Trả về BrowserContext (kiểu Playwright chuẩn — camoufox-js
// dùng playwright-core nên tương thích type patchright/Playwright, XActions/InteractSession dùng được).
export async function launchCamoufox(opts: CamoufoxLaunchOpts): Promise<BrowserContext> {
  await ensureCamoufoxInstalled(Boolean(opts.proxyString), opts.onDownloadProgress)
  await ensureAviaryCheckBookmarks()
  await ensureCamoufoxChromeUi()
  const proxy = opts.proxyString ? parseProxy(opts.proxyString) : undefined
  const Camoufox = await getCamoufox()
  const display = screen.getPrimaryDisplay()
  // Electron trả workAreaSize theo DIP, còn Firefox --width/--height và surface Camoufox
  // dùng pixel vật lý. Nếu Windows scale 125%, truyền 1536 cho màn 1920 sẽ tạo dải đen
  // ~384px bên phải khi maximize. Quy đổi sang physical pixel để hai lớp khớp nhau.
  const width = Math.round(display.workAreaSize.width * display.scaleFactor)
  const height = Math.round(display.workAreaSize.height * display.scaleFactor)
  const screenWidth = Math.round(display.bounds.width * display.scaleFactor)
  const screenHeight = Math.round(display.bounds.height * display.scaleFactor)
  const identity = await resolveFingerprint(
    opts.storedFingerprint,
    [width, height],
    [screenWidth, screenHeight],
    opts.onFingerprintCreated
  )
  let geoip: string | undefined
  if (proxy) {
    const proxyUrl = proxyAsUrl(proxy)
    geoip = opts.proxyIp ?? proxyIpCache.get(proxyUrl)
    if (!geoip) {
      opts.onDownloadProgress?.('Đang xác định IP và vị trí proxy…')
      const ip = await getIpManager()
      geoip = await ip.publicIP(proxyUrl)
    }
    proxyIpCache.set(proxyUrl, geoip)
  }

  // Camoufox() trả về Browser (persistent context). Ép kiểu về BrowserContext của patchright:
  // cùng shape Playwright (pages()/newPage()/route()/close()...), chỉ khác nhãn type package.
  const browser = (await Camoufox({
    // Persistent Camoufox trên Windows tự thoát khi dùng headless native. Chế độ ngầm dùng
    // browser headful rồi ẩn cửa sổ native sau launch, vẫn giữ đầy đủ session/fingerprint.
    headless: false,
    persistent_context: true, // 1 account = 1 profile cố định (giống Chromium).
    user_data_dir: opts.userDataDir,
    os: 'windows', // GHIM Windows — fingerprint ổn định, khớp máy thật.
    fingerprint: identity.fingerprint,
    webgl_config: identity.webglConfig,
    config: {
      ...identity.config,
      // Ẩn overlay con trỏ đỏ. Humanize vẫn bật mức nhẹ bên dưới để click không quá máy móc.
      showcursor: false
    },
    // Bắt buộc: nếu bỏ, Playwright-Firefox khóa viewport mặc định 1280x720 dù cửa sổ
    // native đã maximize 1920x1020 -> phần surface còn lại thành dải đen.
    viewport: null,
    humanize: 0.25,
    block_webrtc: true, // tắt WebRTC hẳn -> không lộ IP thật.
    // Aviary tự chặn media nên không cần uBlock Origin chạy thêm một extension process cho
    // từng profile. Giới hạn content process và cache RAM nhưng vẫn giữ disk cache + history
    // để Back hoạt động và X không phải tải lại toàn bộ bundle sau mỗi lần điều hướng.
    exclude_addons: ['UBO'],
    firefox_user_prefs: {
      'dom.ipc.processCount': 2,
      'dom.ipc.processCount.webIsolated': 2,
      'browser.tabs.unloadOnLowMemory': true,
      // Mọi page automation phải tiếp tục chạy khi tab ở nền, cửa sổ bị che hoặc bị ẩn.
      'dom.min_background_timeout_value': 0,
      'dom.min_background_timeout_value_without_budget_throttling': 0,
      'dom.timeout.enable_budget_timer_throttling': false,
      'layout.testing.top-level-always-active': true,
      'focusmanager.testmode': true,
      'widget.windows.window_occlusion_tracking.enabled': false,
      // window.open từ action phải thành tab trong cửa sổ hiện tại, không tạo native window.
      'browser.link.open_newwindow': 3,
      'browser.link.open_newwindow.restriction': 0,
      'browser.link.open_newwindow.override.external': 3,
      'browser.toolbars.bookmarks.visibility': 'always',
      'browser.sessionhistory.max_entries': 10,
      'browser.sessionhistory.max_total_viewers': 1,
      'browser.cache.memory.capacity': 65_536,
      'media.memory_cache_max_size': 16_384,
      'network.prefetch-next': false,
      'network.predictor.enabled': false,
      'network.http.speculative-parallel-limit': 0
    },
    // Camoufox mặc định tắt cache VÀ giới hạn session history. Luôn bật để nút Back hoạt động
    // và trang đã ghé mở nhanh hơn. Các pref phía trên ghi đè phần cache RAM không giới hạn
    // của preset này. Playwright route có thể vô hiệu network cache khi chặn media, nhưng các
    // pref session history vẫn cần thiết.
    enable_cache: true,
    // geoip CHỈ bật khi có proxy (cần IP proxy để tra vùng). Local thì bỏ -> tránh lệch.
    ...(proxy ? { proxy, geoip } : {}),
    // Chặn ảnh ở tầng Camoufox native (thay cho CDP của Chromium).
    ...(opts.blockMedia ? { block_images: true } : {})
  })) as unknown as BrowserContext
  useSameWindowTaskTabs(browser)

  if (opts.blockMedia) {
    await browser.route('**/*', blockXVideo)
  }
  await setCamoufoxWindowMode(opts.userDataDir, opts.headless ? 'hidden' : 'maximized')
  if (!opts.headless) {
    const page = browser.pages()[0]
    const dimensions = await page
      ?.evaluate(() => {
        const w = globalThis as unknown as {
          innerWidth: number
          innerHeight: number
          outerWidth: number
          outerHeight: number
          screen: { width: number; height: number }
          devicePixelRatio: number
        }
        return {
          innerWidth: w.innerWidth,
          innerHeight: w.innerHeight,
          outerWidth: w.outerWidth,
          outerHeight: w.outerHeight,
          screenWidth: w.screen.width,
          screenHeight: w.screen.height,
          devicePixelRatio: w.devicePixelRatio
        }
      })
      .catch(() => null)
    console.log('[camoufox] kích thước sau maximize:', dimensions)
  }

  return browser
}

const AVIARY_CHROME_START = '/* AVIARY_CHROME_UI_START */'
const AVIARY_CHROME_END = '/* AVIARY_CHROME_UI_END */'
const AVIARY_CHROME_CSS = `${AVIARY_CHROME_START}
/* Khôi phục thao tác tab chuẩn; chỉ tác động giao diện Firefox, không tác động trang web. */
#TabsToolbar {
  -moz-window-dragging: drag !important;
}
.tabbrowser-tab,
.tabbrowser-tab *,
.tab-content,
.tab-stack {
  -moz-window-dragging: no-drag !important;
}
.tabbrowser-tab[fadein] {
  min-width: 120px !important;
  max-width: 240px !important;
}
.tab-content {
  pointer-events: auto !important;
}
.tab-close-button {
  display: flex !important;
  visibility: visible !important;
  opacity: 0.7 !important;
  pointer-events: auto !important;
}
.tab-close-button:hover {
  opacity: 1 !important;
  background-color: color-mix(in srgb, currentColor 16%, transparent) !important;
}
.tabbrowser-tab .tab-background {
  background-color: color-mix(in srgb, currentColor 7%, transparent) !important;
  border-inline: 1px solid color-mix(in srgb, currentColor 12%, transparent) !important;
}
.tabbrowser-tab:hover .tab-background {
  background-color: color-mix(in srgb, currentColor 14%, transparent) !important;
}
.tabbrowser-tab[selected="true"] .tab-background {
  background-color: color-mix(in srgb, AccentColor 24%, transparent) !important;
  box-shadow: inset 0 -2px 0 AccentColor !important;
}
.tabbrowser-tab[selected="true"] .tab-label {
  font-weight: 600 !important;
}
#tabs-newtab-button,
#new-tab-button,
#TabsToolbar #tabs-newtab-button.toolbarbutton-1,
#TabsToolbar #new-tab-button.toolbarbutton-1 {
  display: flex !important;
  visibility: visible !important;
  pointer-events: auto !important;
  -moz-window-dragging: no-drag !important;
}
.titlebar-buttonbox-container {
  width: auto !important;
  min-width: 138px !important;
  flex: 0 0 138px !important;
  margin-inline-start: 8px !important;
  position: relative !important;
  z-index: 20 !important;
}
.titlebar-buttonbox,
.titlebar-button {
  -moz-window-dragging: no-drag !important;
  pointer-events: auto !important;
}
.titlebar-buttonbox {
  display: flex !important;
}
#PersonalToolbar {
  display: flex !important;
  visibility: visible !important;
  min-height: 28px !important;
}
${AVIARY_CHROME_END}`

// Camoufox kèm chrome.css tối giản nhưng vô hiệu pointer-events trên tab, ẩn nút đóng và
// ẩn bookmark bar. Gắn block có marker ở cuối file để override an toàn và không nhân bản.
async function ensureCamoufoxChromeUi(): Promise<void> {
  const pkg = await getPackageManager()
  const launchPath = pkg.camoufoxPath(false).toString()
  const browserDir = existsSync(join(launchPath, 'camoufox.exe')) ? launchPath : dirname(launchPath)
  const cssPath = join(browserDir, 'chrome.css')
  const current = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : ''
  const pattern = new RegExp(
    `${escapeRegex(AVIARY_CHROME_START)}[\\s\\S]*?${escapeRegex(AVIARY_CHROME_END)}`
  )
  const next = pattern.test(current)
    ? current.replace(pattern, AVIARY_CHROME_CSS)
    : `${current.trimEnd()}\n\n${AVIARY_CHROME_CSS}\n`
  if (next !== current) writeFileSync(cssPath, next, 'utf8')
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const CHECK_BOOKMARK_FOLDER = 'Aviary Checks'
const CHECK_BOOKMARKS = [
  { Title: 'BrowserLeaks · Tổng quan', URL: 'https://browserleaks.com/' },
  { Title: 'CreepJS · Fingerprint', URL: 'https://abrahamjuliot.github.io/creepjs/' },
  { Title: 'Pixelscan · Fingerprint', URL: 'https://pixelscan.net/' },
  { Title: 'BrowserScan · Anti-detect', URL: 'https://www.browserscan.net/' },
  { Title: 'IPhey · Browser profile', URL: 'https://iphey.com/' },
  { Title: 'IPLeak · IP/WebRTC/DNS', URL: 'https://ipleak.net/' },
  { Title: 'Cloudflare · Bot check', URL: 'https://www.cloudflare.com/cdn-cgi/trace' },
  { Title: 'Sannysoft · WebDriver', URL: 'https://bot.sannysoft.com/' }
] as const

// Firefox Enterprise Policy tạo đúng một thư mục trên bookmark bar và tự áp dụng cho mọi
// profile Camoufox. Merge với policy hiện có, chỉ quản lý các entry thuộc Aviary Checks.
async function ensureAviaryCheckBookmarks(): Promise<void> {
  const pkg = await getPackageManager()
  const launchPath = pkg.camoufoxPath(false).toString()
  // camoufox-js 0.11 trả về thư mục `Cache`, không phải file camoufox.exe.
  // Hỗ trợ cả hai dạng để policy luôn nằm cạnh executable theo chuẩn Firefox.
  const browserDir = existsSync(join(launchPath, 'camoufox.exe')) ? launchPath : dirname(launchPath)
  const distributionDir = join(browserDir, 'distribution')
  const policyPath = join(distributionDir, 'policies.json')
  let root: { policies?: Record<string, unknown> } = {}
  if (existsSync(policyPath)) {
    try {
      root = JSON.parse(readFileSync(policyPath, 'utf8')) as { policies?: Record<string, unknown> }
    } catch {
      // Policy hỏng/không phải JSON: thay bằng policy tối thiểu hợp lệ để Firefox vẫn mở được.
    }
  }

  const policies = root.policies ?? {}
  const current = Array.isArray(policies.Bookmarks)
    ? (policies.Bookmarks as Record<string, unknown>[])
    : []
  const otherBookmarks = current.filter((item) => item.Folder !== CHECK_BOOKMARK_FOLDER)
  const aviaryBookmarks = CHECK_BOOKMARKS.map((bookmark) => ({
    ...bookmark,
    Placement: 'toolbar',
    Folder: CHECK_BOOKMARK_FOLDER
  }))
  const next = {
    ...root,
    policies: {
      ...policies,
      DisplayBookmarksToolbar: 'always',
      Bookmarks: [...otherBookmarks, ...aviaryBookmarks]
    }
  }

  mkdirSync(distributionDir, { recursive: true })
  const serialized = JSON.stringify(next, null, 2) + '\n'
  if (!existsSync(policyPath) || readFileSync(policyPath, 'utf8') !== serialized) {
    writeFileSync(policyPath, serialized, 'utf8')
  }
}

// Firefox xử lý --width/--height theo DIP trong khi Camoufox surface dùng pixel vật lý,
// gây dải đen ở scale 125%. Maximize cửa sổ native sau launch để Windows tự tính DPI đúng,
// trước khi BrowserManager điều hướng tới X.
async function setCamoufoxWindowMode(
  profileDir: string,
  mode: 'hidden' | 'maximized'
): Promise<void> {
  const encodedProfile = Buffer.from(profileDir, 'utf16le').toString('base64')
  const showCommand = mode === 'hidden' ? 0 : 3
  const script = [
    'Add-Type -Namespace Aviary -Name Win32 -MemberDefinition',
    `'[DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);'`,
    ';',
    `$profile=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodedProfile}'));`,
    '$deadline=(Get-Date).AddSeconds(5);',
    'do {',
    '  $ids=Get-CimInstance Win32_Process -Filter "Name = \'camoufox.exe\'" -ErrorAction SilentlyContinue | Where-Object {$_.CommandLine -and $_.CommandLine.Contains($profile)} | ForEach-Object {$_.ProcessId};',
    '  $wins=$ids | ForEach-Object {Get-Process -Id $_ -ErrorAction SilentlyContinue} | Where-Object {$_.MainWindowHandle -ne 0};',
    `  if ($wins) { $wins | ForEach-Object {[Aviary.Win32]::ShowWindowAsync($_.MainWindowHandle,${showCommand}) | Out-Null}; break }`,
    '  Start-Sleep -Milliseconds 100',
    '} while ((Get-Date) -lt $deadline)'
  ].join(' ')

  await new Promise<void>((resolve) => {
    execFile('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, () => resolve())
  })
}

function proxyAsUrl(proxy: { server: string; username?: string; password?: string }): string {
  const url = new URL(proxy.server)
  if (proxy.username) url.username = proxy.username
  if (proxy.password) url.password = proxy.password
  return url.href
}

async function resolveFingerprint(
  stored: string | null,
  windowSize: [number, number],
  screenSize: [number, number],
  persist: (fingerprint: string) => void
): Promise<StoredCamoufoxFingerprint> {
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Partial<StoredCamoufoxFingerprint>
      if (
        parsed.version === 3 &&
        Array.isArray(parsed.windowSize) &&
        parsed.windowSize[0] === windowSize[0] &&
        parsed.windowSize[1] === windowSize[1] &&
        Array.isArray(parsed.screenSize) &&
        parsed.screenSize[0] === screenSize[0] &&
        parsed.screenSize[1] === screenSize[1] &&
        parsed.fingerprint &&
        parsed.config &&
        typeof parsed.config['canvas:seed'] === 'number' &&
        typeof parsed.config['audio:seed'] === 'number' &&
        typeof parsed.config['fonts:spacing_seed'] === 'number'
      ) {
        const current = parsed as StoredCamoufoxFingerprint
        let upgraded = false
        if (typeof current.config['canvas:aaOffset'] !== 'number') {
          current.config['canvas:aaOffset'] = randomInt(-50, 51)
          upgraded = true
        }
        if (typeof current.config['canvas:aaCapOffset'] !== 'boolean') {
          current.config['canvas:aaCapOffset'] = true
          upgraded = true
        }
        if (typeof current.config['window.history.length'] !== 'number') {
          current.config['window.history.length'] = randomInt(1, 6)
          upgraded = true
        }
        if (!Array.isArray(current.webglConfig)) {
          current.webglConfig = await sampleWebGlIdentity()
          upgraded = true
        }
        if (Array.isArray(current.webglConfig)) {
          if (upgraded) persist(JSON.stringify(current))
          return current
        }
      }
    } catch {
      // Fingerprint cũ thuộc engine/định dạng khác -> sinh identity Camoufox mới một lần.
    }
  }

  const generator = await getFingerprintManager()
  const fingerprint = generator.generateFingerprint(windowSize, {
    operatingSystems: ['windows'],
    screen: {
      minWidth: screenSize[0],
      maxWidth: screenSize[0],
      minHeight: screenSize[1],
      maxHeight: screenSize[1]
    }
  })
  const identity: StoredCamoufoxFingerprint = {
    version: 3,
    windowSize,
    screenSize,
    fingerprint,
    config: {
      'fonts:spacing_seed': randomInt(1, 4_294_967_296),
      'audio:seed': randomInt(1, 4_294_967_296),
      'canvas:seed': randomInt(1, 4_294_967_296),
      'canvas:aaOffset': randomInt(-50, 51),
      'canvas:aaCapOffset': true,
      'window.history.length': randomInt(1, 6)
    },
    webglConfig: await sampleWebGlIdentity()
  }
  persist(JSON.stringify(identity))
  return identity
}

async function sampleWebGlIdentity(): Promise<[string, string]> {
  const webgl = await getWebGlManager()
  const sampled = await webgl.sampleWebGL('win')
  const vendor = sampled['webGl:vendor']
  const renderer = sampled['webGl:renderer']
  if (typeof vendor !== 'string' || typeof renderer !== 'string') {
    throw new Error('Camoufox không sinh được WebGL identity hợp lệ')
  }
  return [vendor, renderer]
}

// camoufox-js tự gọi install kiểu fire-and-forget khi thiếu binary, tạo race với launch.
// Aviary tải có await thật, ghi thẳng ra file tạm (không giữ file ~470MB trong RAM), rồi
// mới giải nén và cho phép mở profile. Binary dùng chung cho mọi tài khoản trên máy.
async function ensureCamoufoxInstalled(
  needsGeoIp: boolean,
  report: DownloadReporter = () => {}
): Promise<void> {
  if (!browserInstallPromise) {
    browserInstallPromise = ensureBrowserBinary(report).catch((error) => {
      browserInstallPromise = null
      throw error
    })
  }
  await browserInstallPromise

  if (needsGeoIp) {
    if (!geoIpInstallPromise) {
      geoIpInstallPromise = ensureGeoIp(report).catch((error) => {
        geoIpInstallPromise = null
        throw error
      })
    }
    await geoIpInstallPromise
  }
}

async function ensureBrowserBinary(report: DownloadReporter): Promise<void> {
  const pkg = await getPackageManager()
  try {
    // `launchPath()` của package gọi cài đặt fire-and-forget khi thiếu binary. Dùng
    // camoufoxPath(false) để chỉ kiểm tra, tránh chạy hai downloader cùng lúc.
    pkg.camoufoxPath(false)
    return
  } catch {
    // Chưa cài / version cũ -> tải bản tương thích bên dưới.
  }

  const fetcher = new pkg.CamoufoxFetcher()
  report('Đang tìm phiên bản Camoufox tương thích…')
  await fetcher.init()

  const installDir = pkg.INSTALL_DIR.toString()
  const stagingDir = join(tmpdir(), `aviary-camoufox-${process.pid}-${Date.now()}`)
  const zipPath = join(stagingDir, 'camoufox.zip')
  mkdirSync(stagingDir, { recursive: true })

  try {
    report(`Đang tải Camoufox ${fetcher.verstr}…`)
    const response = await fetch(fetcher.url)
    if (!response.ok || !response.body) {
      throw new Error(`Tải Camoufox thất bại: HTTP ${response.status}`)
    }

    const total = Number(response.headers.get('content-length')) || 0
    let received = 0
    let lastPercent = -1
    const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
    body.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (total > 0) {
        const percent = Math.floor((received / total) * 100)
        if (percent >= lastPercent + 2 || percent === 100) {
          lastPercent = percent
          report(`Đang tải Camoufox… ${percent}%`)
        }
      }
    })
    await pipeline(body, createWriteStream(zipPath))

    report('Đang cài đặt Camoufox…')
    rmSync(installDir, { recursive: true, force: true })
    mkdirSync(installDir, { recursive: true })
    await fetcher.extractZip(zipPath)
    fetcher.setVersion()
    report('Đã cài Camoufox, đang mở profile…')
  } catch (error) {
    rmSync(installDir, { recursive: true, force: true })
    throw error
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
  }
}

async function ensureGeoIp(report: DownloadReporter): Promise<void> {
  const pkg = await getPackageManager()
  const mmdbPath = join(pkg.INSTALL_DIR.toString(), 'GeoLite2-City.mmdb')
  if (existsSync(mmdbPath)) return

  report('Đang tải dữ liệu GeoIP cho Camoufox…')
  const locale = await getLocaleManager()
  await locale.downloadMMDB()
  report('Đã chuẩn bị GeoIP, đang mở profile…')
}

// X phát video qua video.twimg.com và các segment HLS/DASH thường mang resourceType
// fetch/xhr, nên chỉ kiểm tra resourceType='media' là chưa đủ. Không chặn blob preview
// hoặc upload.twitter.com để đăng ảnh/video vẫn hoạt động.
async function blockXVideo(route: Route): Promise<void> {
  const url = route.request().url()
  let shouldBlock = false
  try {
    const parsed = new URL(url)
    shouldBlock =
      parsed.hostname === 'video.twimg.com' ||
      /\.(?:mp4|m3u8|m4s|mpd|ts)(?:$|[?#])/i.test(parsed.pathname + parsed.search)
  } catch {
    // URL nội bộ không parse được (vd blob:) không phải request video mạng cần chặn.
  }

  if (shouldBlock) await route.abort('blockedbyclient')
  else await route.continue()
}
