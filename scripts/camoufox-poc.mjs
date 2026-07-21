// PoC đo số thật Camoufox — KHÔNG commit là dependency app, chỉ để đánh giá.
// Chạy:  $env:TEST_PROXY="host:port:user:pass"; node scripts/camoufox-poc.mjs
// Không có TEST_PROXY -> chạy local (geoip tắt).
//
// BẢO MẬT: proxy TRUYỀN QUA ENV, KHÔNG hardcode vào file. Ảnh chụp (scripts/camoufox-shots/)
// có thể chứa IP/proxy thật trên màn hình → đã .gitignore, KHÔNG commit.
// Cần better-sqlite3 build cho Node (không phải Electron) + pin playwright-core@1.53.1 khớp
// Camoufox binary — xem docs/ANTIDETECT_PROGRESS.md §12.
//
// Mục tiêu: mở Camoufox (Firefox patched native) với proxy + geoip, vào các site test
// fingerprint, chụp màn hình + trích verdict để so với rebrowser+Apify hiện tại.
// Đặc biệt xem canvas/pixelscan có còn báo "masking" không (điểm yếu chí mạng của JS injection).

import { Camoufox } from 'camoufox-js'
import { mkdirSync } from 'fs'
import { join } from 'path'

const OUT = join(process.cwd(), 'scripts', 'camoufox-shots')
mkdirSync(OUT, { recursive: true })

// Parse TEST_PROXY (host:port:user:pass | user:pass@host:port | host:port) -> object Playwright.
function parseProxy(raw) {
  if (!raw) return undefined
  let s = raw.trim()
  const m = s.match(/^(https?|socks5):\/\//i)
  let scheme = 'http'
  if (m) { scheme = m[1].toLowerCase(); s = s.slice(m[0].length) }
  let username, password
  const at = s.lastIndexOf('@')
  if (at !== -1) {
    const cred = s.slice(0, at); s = s.slice(at + 1)
    const ci = cred.indexOf(':')
    if (ci !== -1) { username = cred.slice(0, ci); password = cred.slice(ci + 1) } else username = cred
  } else {
    const parts = s.split(':')
    if (parts.length >= 4) { username = parts[2]; password = parts.slice(3).join(':'); s = `${parts[0]}:${parts[1]}` }
  }
  return { server: `${scheme}://${s}`, username, password }
}

const proxy = parseProxy(process.env.TEST_PROXY)
console.log('[poc] proxy:', proxy ? proxy.server + (proxy.username ? ' (auth)' : '') : 'LOCAL (không proxy)')

// Site test — ưu tiên cái có verdict/điểm rõ.
const SITES = [
  { name: 'rebrowser-bot', url: 'https://bot-detector.rebrowser.net/', wait: 6000 },
  { name: 'iphey',         url: 'https://iphey.com/',                    wait: 9000 },
  { name: 'pixelscan',     url: 'https://pixelscan.net/fingerprint-check', wait: 12000 },
  { name: 'browserscan',   url: 'https://www.browserscan.net/',          wait: 12000 },
  { name: 'creepjs',       url: 'https://abrahamjuliot.github.io/creepjs/', wait: 12000 }
]

import { join as pathJoin } from 'path'
const PROFILE = pathJoin(process.cwd(), 'poc-profile')
mkdirSync(PROFILE, { recursive: true })

// Dùng persistent_context (giống app thật) — Camoufox tự tạo page mặc định, tránh newPage() lỗi schema.
const browser = await Camoufox({
  headless: false,            // headful để nhìn thật + tránh cờ headless
  humanize: true,             // di chuột kiểu người
  persistent_context: true,
  user_data_dir: PROFILE,
  block_webrtc: true,         // chặn hẳn WebRTC (Firefox native) → không lộ IP thật, không cần JS mask
  ...(proxy ? { proxy, geoip: true } : {}),  // geoip: tự set timezone/geo/WebRTC theo proxy
  // KHÔNG block canvas/webgl để đo fingerprint đầy đủ.
})

// persistent_context trả về BrowserContext — lấy page có sẵn hoặc tạo mới.
const page = browser.pages()[0] ?? (await browser.newPage())

// Đọc vài giá trị fingerprint cốt lõi để log (so với máy thật).
async function readCore() {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl')
    const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info')
    // canvas hash nhanh (không phải hash chuẩn, chỉ để so 2 lần đọc có ổn định không)
    const c = document.createElement('canvas'); c.width = 200; c.height = 50
    const ctx = c.getContext('2d')
    ctx.textBaseline = 'top'; ctx.font = '14px Arial'
    ctx.fillStyle = '#f60'; ctx.fillRect(0, 0, 100, 20)
    ctx.fillStyle = '#069'; ctx.fillText('Aviary-PoC-😀', 2, 15)
    const data = c.toDataURL()
    let h = 0; for (let i = 0; i < data.length; i++) { h = (h * 31 + data.charCodeAt(i)) >>> 0 }
    return {
      ua: navigator.userAgent,
      platform: navigator.platform,
      cores: navigator.hardwareConcurrency,
      memory: navigator.deviceMemory,
      lang: navigator.language,
      langs: navigator.languages.join(','),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      webdriver: navigator.webdriver,
      webglVendor: dbg && gl ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
      webglRenderer: dbg && gl ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
      canvasNativeToDataURL: HTMLCanvasElement.prototype.toDataURL.toString().includes('[native code]'),
      canvasHash: h.toString(16),
    }
  })
}

// Vào about:blank trước để đọc core (không phụ thuộc site).
await page.goto('about:blank')
const coreA = await readCore()
const coreB = await readCore()
console.log('\n=== FINGERPRINT CỐT LÕI (Camoufox) ===')
console.log(JSON.stringify(coreA, null, 2))
console.log('canvas toDataURL = [native code]?', coreA.canvasNativeToDataURL, '(true = KHÔNG bị bắt masking)')
console.log('canvas hash ổn định 2 lần?', coreA.canvasHash === coreB.canvasHash, `(${coreA.canvasHash} vs ${coreB.canvasHash})`)

for (const s of SITES) {
  try {
    console.log(`\n[poc] mở ${s.name} ...`)
    await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => console.log('  goto lỗi:', e.message))
    await page.waitForTimeout(s.wait)
    const shot = join(OUT, `${s.name}.png`)
    await page.screenshot({ path: shot, fullPage: true }).catch((e) => console.log('  shot lỗi:', e.message))
    console.log('  đã chụp:', shot)
  } catch (e) {
    console.log(`  ${s.name} lỗi:`, e.message)
  }
}

console.log('\n[poc] Xong. Xem ảnh trong scripts/camoufox-shots/. Đóng browser trong 8s...')
await page.waitForTimeout(8000)
await browser.close()
