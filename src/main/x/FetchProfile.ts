import https from 'https'
import http from 'http'
import tls from 'tls'
import { URL } from 'url'
import { parseProxy } from '../browser/BrowserManager'
import type { XProfileInfo } from '../../shared/types'

// Lấy follower/following/số bài + tên hiển thị của 1 tài khoản X từ username,
// qua API GraphQL công khai (guest token). Hỗ trợ chạy qua proxy của tài khoản.
//
// Luồng: (1) activate guest token bằng public web bearer -> (2) gọi UserByScreenName.
// Dùng native http/https + CONNECT tunnel (KHÔNG thêm dependency proxy-agent, theo CLAUDE.md).

// Bearer token web công khai của X (không phải secret cá nhân — token client tĩnh dùng cho
// guest API, ai cũng thấy trong JS của twitter.com). KHÔNG phải token tài khoản người dùng.
const PUBLIC_WEB_BEARER =
  'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

// queryId + features cho UserByScreenName (theo schema GraphQL web hiện hành).
const USER_BY_SCREEN_NAME_QUERY_ID = 'G3KGOASz96M-Qu0nwmGXNg'
const USER_BY_SCREEN_NAME_FEATURES = {
  hidden_profile_likes_enabled: true,
  hidden_profile_subscriptions_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  subscriptions_verification_info_is_identity_verified_enabled: true,
  subscriptions_verification_info_verified_since_enabled: true,
  highlights_tweets_tab_ui_enabled: true,
  responsive_web_twitter_article_notes_tab_enabled: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true
}

const TIMEOUT_MS = 12_000

interface HttpResponse {
  status: number
  body: string
}

// Gửi 1 HTTP request tới host HTTPS, trực tiếp hoặc qua proxy (CONNECT tunnel + TLS).
function httpsRequest(
  opts: {
    host: string
    path: string
    method: string
    headers: Record<string, string>
    body?: string
  },
  proxyString?: string | null
): Promise<HttpResponse> {
  const parsedProxy = proxyString ? parseProxy(proxyString) : undefined

  // Không có proxy -> https trực tiếp.
  if (!parsedProxy) {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: opts.host,
          port: 443,
          path: opts.path,
          method: opts.method,
          headers: opts.headers,
          timeout: TIMEOUT_MS
        },
        (res) => {
          let data = ''
          res.on('data', (c) => (data += c.toString()))
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
        }
      )
      req.on('error', reject)
      req.on('timeout', () => {
        req.destroy()
        reject(new Error(`Timeout ${TIMEOUT_MS / 1000}s`))
      })
      if (opts.body) req.write(opts.body)
      req.end()
    })
  }

  // Có proxy -> CONNECT tunnel tới host:443, rồi bọc TLS, rồi viết raw HTTP request.
  return new Promise((resolve, reject) => {
    const proxyUrl = new URL(parsedProxy.server)
    const proxyPort = parseInt(proxyUrl.port) || (proxyUrl.protocol === 'https:' ? 443 : 80)
    const connectReq = http.request({
      host: proxyUrl.hostname,
      port: proxyPort,
      method: 'CONNECT',
      path: `${opts.host}:443`,
      headers: parsedProxy.username
        ? {
            'Proxy-Authorization':
              'Basic ' +
              Buffer.from(`${parsedProxy.username}:${parsedProxy.password ?? ''}`).toString('base64')
          }
        : {},
      timeout: TIMEOUT_MS
    })

    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        reject(new Error(`Proxy CONNECT thất bại (HTTP ${res.statusCode})`))
        return
      }
      // Bọc TLS lên socket tunnel.
      const tlsSocket = tls.connect({ socket, servername: opts.host }, () => {
        const headerLines = Object.entries({
          Host: opts.host,
          ...opts.headers,
          'Content-Length': String(opts.body ? Buffer.byteLength(opts.body) : 0),
          Connection: 'close'
        })
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n')
        const raw = `${opts.method} ${opts.path} HTTP/1.1\r\n${headerLines}\r\n\r\n${opts.body ?? ''}`
        tlsSocket.write(raw)
      })

      let data = ''
      tlsSocket.on('data', (c: Buffer) => (data += c.toString()))
      tlsSocket.on('end', () => {
        const sep = data.indexOf('\r\n\r\n')
        const head = sep !== -1 ? data.slice(0, sep) : data
        let body = sep !== -1 ? data.slice(sep + 4) : ''
        const statusMatch = head.match(/^HTTP\/\d\.\d (\d{3})/)
        const status = statusMatch ? Number(statusMatch[1]) : 0
        // Nếu là chunked transfer-encoding, gỡ chunk size.
        if (/transfer-encoding:\s*chunked/i.test(head)) {
          body = dechunk(body)
        }
        // Trim body để loại bỏ trailing whitespace / artifact từ chunked encoding.
        body = body.trim()
        resolve({ status, body })
      })
      tlsSocket.on('error', reject)
    })

    connectReq.on('error', reject)
    connectReq.on('timeout', () => {
      connectReq.destroy()
      reject(new Error(`Timeout ${TIMEOUT_MS / 1000}s`))
    })
    connectReq.end()
  })
}

// Gỡ định dạng chunked transfer-encoding thành body thuần.
// Xử lý cả trailer headers sau chunk cuối (size=0).
function dechunk(s: string): string {
  let out = ''
  let i = 0
  while (i < s.length) {
    const nl = s.indexOf('\r\n', i)
    if (nl === -1) break
    const size = parseInt(s.slice(i, nl).trim(), 16)
    if (!Number.isFinite(size)) break
    i = nl + 2
    if (size <= 0) break // chunk cuối (0) — dừng, bỏ qua trailer headers phía sau
    out += s.slice(i, i + size)
    i += size + 2 // bỏ qua \r\n cuối chunk
  }
  return out || s
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// Tải ảnh avatar từ URL (pbs.twimg.com) về thành data URL base64.
// Trả về null nếu lỗi. Ảnh nhỏ (~3KB) nên base64 nằm gọn trong DB, không cần file.
// Dùng chung logic proxy CONNECT tunnel với httpsRequest nhưng nhận binary Buffer.
export async function downloadAvatarAsDataUrl(
  imageUrl: string,
  proxyString?: string | null
): Promise<string | null> {
  try {
    const parsedUrl = new URL(imageUrl)
    const host = parsedUrl.hostname
    const path = parsedUrl.pathname + parsedUrl.search
    const buf = await downloadBinary(host, path, proxyString)
    if (!buf || buf.length === 0) return null
    // Xác định mime từ đuôi file (.jpg/.png/.webp).
    const ext = parsedUrl.pathname.split('.').pop()?.toLowerCase() ?? 'jpg'
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

// Tải binary từ HTTPS, trả về Buffer. Hỗ trợ proxy CONNECT tunnel.
function downloadBinary(host: string, path: string, proxyString?: string | null): Promise<Buffer> {
  const parsedProxy = proxyString ? parseProxy(proxyString) : undefined

  if (!parsedProxy) {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host,
          port: 443,
          path,
          method: 'GET',
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: TIMEOUT_MS
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (c: Buffer) => chunks.push(c))
          res.on('end', () => resolve(Buffer.concat(chunks)))
        }
      )
      req.on('error', reject)
      req.on('timeout', () => {
        req.destroy()
        reject(new Error(`Timeout ${TIMEOUT_MS / 1000}s`))
      })
      req.end()
    })
  }

  return new Promise((resolve, reject) => {
    const proxyUrl = new URL(parsedProxy.server)
    const proxyPort = parseInt(proxyUrl.port) || (proxyUrl.protocol === 'https:' ? 443 : 80)
    const connectReq = http.request({
      host: proxyUrl.hostname,
      port: proxyPort,
      method: 'CONNECT',
      path: `${host}:443`,
      headers: parsedProxy.username
        ? {
            'Proxy-Authorization':
              'Basic ' +
              Buffer.from(`${parsedProxy.username}:${parsedProxy.password ?? ''}`).toString('base64')
          }
        : {},
      timeout: TIMEOUT_MS
    })

    connectReq.on('connect', (_res, socket) => {
      const tlsSocket = tls.connect({ socket, servername: host }, () => {
        const headerLines = Object.entries({
          Host: host,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Connection: 'close'
        })
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n')
        tlsSocket.write(`GET ${path} HTTP/1.1\r\n${headerLines}\r\n\r\n`)
      })

      const chunks: Buffer[] = []
      tlsSocket.on('data', (c: Buffer) => chunks.push(c))
      tlsSocket.on('end', () => {
        const all = Buffer.concat(chunks)
        const sep = all.indexOf('\r\n\r\n')
        if (sep !== -1) resolve(all.subarray(sep + 4))
        else resolve(all)
      })
      tlsSocket.on('error', reject)
    })

    connectReq.on('error', reject)
    connectReq.on('timeout', () => {
      connectReq.destroy()
      reject(new Error(`Timeout ${TIMEOUT_MS / 1000}s`))
    })
    connectReq.end()
  })
}

// Bước 1: lấy guest token.
async function activateGuestToken(proxyString?: string | null): Promise<string> {
  const res = await httpsRequest(
    {
      host: 'api.x.com',
      path: '/1.1/guest/activate.json',
      method: 'POST',
      headers: {
        Authorization: PUBLIC_WEB_BEARER,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    },
    proxyString
  )
  if (res.status !== 200) throw new Error(`Không lấy được guest token (HTTP ${res.status})`)
  const json = JSON.parse(res.body)
  if (!json.guest_token) throw new Error('Phản hồi guest token không hợp lệ')
  return String(json.guest_token)
}

// Bước 2: gọi UserByScreenName.
async function fetchUserByScreenName(
  username: string,
  guestToken: string,
  proxyString?: string | null
): Promise<HttpResponse> {
  const variables = { screen_name: username, withSafetyModeUserFields: true }
  const path =
    `/graphql/${USER_BY_SCREEN_NAME_QUERY_ID}/UserByScreenName` +
    `?variables=${encodeURIComponent(JSON.stringify(variables))}` +
    `&features=${encodeURIComponent(JSON.stringify(USER_BY_SCREEN_NAME_FEATURES))}`
  return httpsRequest(
    {
      host: 'api.x.com',
      path,
      method: 'GET',
      headers: {
        Authorization: PUBLIC_WEB_BEARER,
        'x-guest-token': guestToken,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    },
    proxyString
  )
}

// Parse JSON an toàn: trim body, xử lý dữ liệu thừa sau JSON (chunked artifact).
// Nếu JSON.parse thất bại vì dữ liệu thừa phía sau, thử cắt đến vị trí kết thúc JSON.
function safeJsonParse(body: string): unknown {
  const trimmed = body.trim()
  if (!trimmed) throw new Error('Body rỗng')
  try {
    return JSON.parse(trimmed)
  } catch {
    // Có thể có dữ liệu thừa sau JSON — tìm vị trí kết thúc của object/array đầu tiên.
    const firstChar = trimmed[0]
    if (firstChar === '{') {
      let depth = 0
      let inString = false
      let escape = false
      for (let i = 0; i < trimmed.length; i++) {
        const ch = trimmed[i]
        if (escape) { escape = false; continue }
        if (ch === '\\' && inString) { escape = true; continue }
        if (ch === '"') { inString = !inString; continue }
        if (inString) continue
        if (ch === '{') depth++
        else if (ch === '}') {
          depth--
          if (depth === 0) return JSON.parse(trimmed.slice(0, i + 1))
        }
      }
    }
    throw new Error(`Không parse được JSON: ${trimmed.slice(0, 200)}…`)
  }
}

// Nâng chất lượng avatar: thay đuôi _normal (48x48) bằng _bigger (73x73) cho nét hơn ở card.
// Nếu không có đuôi _normal thì giữ nguyên URL.
function upgradeAvatarUrl(url: string): string {
  return url.replace(/_normal\./, '_bigger.')
}

export async function fetchXProfile(
  username: string,
  proxyString?: string | null
): Promise<XProfileInfo> {
  const clean = username.trim().replace(/^@+/, '')
  if (!clean) return { name: null, followers: null, following: null, posts: null, avatarUrl: null, error: 'Chưa nhập username' }

  try {
    const guestToken = await activateGuestToken(proxyString)
    let res = await fetchUserByScreenName(clean, guestToken, proxyString)

    // 429 -> thử lại 1 lần sau 2s.
    if (res.status === 429) {
      await sleep(2000)
      const token2 = await activateGuestToken(proxyString)
      res = await fetchUserByScreenName(clean, token2, proxyString)
    }

    if (res.status !== 200) {
      return { name: null, followers: null, following: null, posts: null, avatarUrl: null, error: `Lỗi máy chủ X (HTTP ${res.status})` }
    }

    const json = safeJsonParse(res.body) as {
      data?: { user?: { result?: Record<string, unknown> } }
    } | null
    const result = json?.data?.user?.result
    if (!result) {
      return { name: null, followers: null, following: null, posts: null, avatarUrl: null, error: 'Không tìm thấy tài khoản' }
    }
    if (result.__typename === 'UserUnavailable') {
      return {
        name: null,
        followers: null,
        following: null,
        posts: null,
        avatarUrl: null,
        error: (typeof result.message === 'string' && result.message) || 'Tài khoản không khả dụng (bị khoá/treo)'
      }
    }
    const legacy = (result.legacy ?? {}) as Record<string, unknown>
    const core = (result.core ?? {}) as Record<string, unknown>
    const followers = legacy.followers_count
    const following = legacy.friends_count
    const posts = legacy.statuses_count
    // Avatar: ưu tiên legacy.profile_image_url_https, fallback core.profile_image.url
    const rawAvatar =
      (typeof legacy.profile_image_url_https === 'string' ? legacy.profile_image_url_https : null) ??
      (typeof (core.profile_image as Record<string, unknown> | undefined)?.url === 'string'
        ? (core.profile_image as Record<string, unknown>).url as string
        : null)
    return {
      name: (typeof legacy.name === 'string' ? legacy.name : null) ?? (typeof core.name === 'string' ? core.name : null),
      followers: typeof followers === 'number' ? followers : null,
      following: typeof following === 'number' ? following : null,
      posts: typeof posts === 'number' ? posts : null,
      avatarUrl: rawAvatar ? upgradeAvatarUrl(rawAvatar) : null
    }
  } catch (e) {
    return { name: null, followers: null, following: null, posts: null, avatarUrl: null, error: (e as Error).message }
  }
}
