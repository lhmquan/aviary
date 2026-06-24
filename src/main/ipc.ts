import { ipcMain, BrowserWindow } from 'electron'
import http from 'http'
import https from 'https'
import { URL } from 'url'
import { rmSync } from 'fs'
import {
  IpcChannels,
  type AccountInput,
  type AppSettings,
  type ProxyInput,
  type ScheduleInput,
  type ProxyCheckResult,
  type LogListParams,
  type XProfileInfo
} from '../shared/types'
import {
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  getAccount,
  setAccountStatus,
  updateAccountStats
} from './db/accounts'
import { getAllSettings, saveSettings } from './db/settings'
import {
  testWebhook
} from './n8n/N8nConnector'
import {
  listProxies,
  createProxy,
  updateProxy,
  deleteProxy,
  bulkCreateProxies,
  clearProxies,
  updateProxyCheck,
  getProxy,
  resolveProxyString
} from './db/proxies'
import { parseProxy } from './browser/BrowserManager'
import {
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  deleteSchedulesByAccount
} from './db/schedules'
import { browserManager } from './browser/BrowserManager'
import { listLogs, clearLogs, deleteLogsByAccount } from './db/logs'
import { deleteAnalyticsByAccount, clearAllAnalytics, pruneAnalytics, getAnalyticsStorageStats } from './db/analytics'
import { runPostForAccount, emitProgress } from './scheduler/runner'
import { acquireSlot, releaseSlot } from './scheduler/index'
import { fetchXProfile, downloadAvatarAsDataUrl } from './x/FetchProfile'
import { fetchAllAccountsStats, fetchAccountStats } from './analytics/fetcher'
import { getAnalyticsData } from './analytics/growth'

// Broadcast trạng thái browser (đóng cửa sổ thủ công...) tới renderer.
function emitBrowserStatus(accountId: string, open: boolean): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.browserStatusChanged, { accountId, open })
  }
}

export function registerIpc(): void {
  ipcMain.handle(IpcChannels.accountsList, () => listAccounts())

  ipcMain.handle(IpcChannels.accountsCreate, (_e, input: AccountInput) => createAccount(input))

  ipcMain.handle(IpcChannels.accountsUpdate, (_e, id: string, input: Partial<AccountInput>) =>
    updateAccount(id, input)
  )

  // Xoá tài khoản: đóng profile + xoá profile_dir trên ổ đĩa + xoá schedules/logs
  // mồ côi (không có ON DELETE CASCADE trong schema) + xoá row DB.
  ipcMain.handle(IpcChannels.accountsDelete, async (_e, id: string) => {
    await browserManager.closeProfile(id)
    const acc = getAccount(id)
    // Xoá schedules + logs + analytics trước khi xoá row (tránh mồ côi).
    deleteSchedulesByAccount(id)
    deleteLogsByAccount(id)
    deleteAnalyticsByAccount(id)
    deleteAccount(id)
    // Xoá profile_dir trên ổ đĩa (50-200MB mỗi account) — làm sau khi xoá DB để
    // ngay cả nếu rmSync fail, row DB đã mất và không tạo schedule mồ côi.
    if (acc?.profileDir) {
      try {
        rmSync(acc.profileDir, { recursive: true, force: true })
      } catch {
        /* ignore — profile dir có thể đang bị lock */
      }
    }
  })

  // ---- Proxy (kho proxy chung, tab Proxy) ----
  ipcMain.handle(IpcChannels.proxiesList, () => listProxies())
  ipcMain.handle(
    IpcChannels.proxiesBulkCreate,
    (_e, lines: string[], opts: { labelPrefix?: string; kind?: string | null }) =>
      bulkCreateProxies(lines, opts)
  )
  ipcMain.handle(IpcChannels.proxiesCreate, (_e, input: ProxyInput) => createProxy(input))
  ipcMain.handle(IpcChannels.proxiesUpdate, (_e, id: string, input: Partial<ProxyInput>) =>
    updateProxy(id, input)
  )
  ipcMain.handle(IpcChannels.proxiesDelete, (_e, id: string) => deleteProxy(id))
  ipcMain.handle(IpcChannels.proxiesClear, () => {
    clearProxies()
    return undefined
  })

  // Kiểm tra proxy live/die + vị trí. Nhận mảng id, trả mảng ProxyCheckResult.
  // Tuần tự (tránh quá tải mạng), mỗi proxy: HTTP GET qua proxy tới ip-api.com/json/.
  ipcMain.handle(
    IpcChannels.proxiesCheck,
    async (_e, ids: string[]): Promise<ProxyCheckResult[]> => {
      const results: ProxyCheckResult[] = []
      for (const id of ids) {
        const proxy = getProxy(id)
        if (!proxy) {
          results.push({ id, status: 'dead', latencyMs: null, country: null, city: null, checkIp: null, error: 'Không tìm thấy proxy' })
          continue
        }
        const parsed = parseProxy(proxy.proxyString)
        if (!parsed) {
          const r: ProxyCheckResult = { id, status: 'dead', latencyMs: null, country: null, city: null, checkIp: null, error: 'Không parse được proxy' }
          updateProxyCheck(id, r)
          results.push(r)
          continue
        }
        try {
          const result = await checkProxyViaHttp(parsed)
          const r: ProxyCheckResult = {
            id,
            status: result.ok ? 'live' : 'dead',
            latencyMs: result.latencyMs,
            country: result.country ?? null,
            city: result.city ?? null,
            checkIp: result.ip ?? null,
            error: result.ok ? undefined : result.error
          }
          updateProxyCheck(id, r)
          results.push(r)
        } catch (e) {
          const r: ProxyCheckResult = { id, status: 'dead', latencyMs: null, country: null, city: null, checkIp: null, error: (e as Error).message }
          updateProxyCheck(id, r)
          results.push(r)
        }
      }
      return results
    }
  )

  ipcMain.handle(IpcChannels.browserOpen, async (_e, accountId: string) => {
    const account = getAccount(accountId)
    if (!account) throw new Error(`Account không tồn tại: ${accountId}`)
    // #1: user chủ động bấm "Mở profile" -> luôn headful (hiện cửa sổ để đăng nhập),
    // bất kể account.headless. Cờ headless chỉ áp dụng khi đăng bài / lịch đăng.
    await browserManager.openProfile(account, { headlessOverride: false })
    setAccountStatus(accountId, 'logged_in')
  })

  ipcMain.handle(IpcChannels.browserClose, async (_e, accountId: string) => {
    await browserManager.closeProfile(accountId)
  })

  ipcMain.handle(IpcChannels.browserStatus, (_e, accountId: string) => ({
    open: browserManager.isOpen(accountId)
  }))

  ipcMain.handle(IpcChannels.settingsGet, () => getAllSettings())

  ipcMain.handle(IpcChannels.settingsSave, (_e, patch: Partial<AppSettings>) => saveSettings(patch))

  ipcMain.handle(IpcChannels.webhookTest, (_e, accountId?: string) => {
    // Nếu có accountId, gửi kèm assetUrl của profile đó để n8n test đúng asset.
    const account = accountId ? getAccount(accountId) : null
    return testWebhook(accountId, account?.assetUrl ?? null)
  })

  ipcMain.handle(IpcChannels.logsList, (_e, params?: LogListParams) => listLogs(params))
  ipcMain.handle(IpcChannels.logsClear, () => {
    clearLogs()
    return undefined
  })

  ipcMain.handle(IpcChannels.postRunNow, async (_e, accountId: string) => {
    // Pipeline đăng bài dùng chung (runner.ts): mở profile nếu chưa mở -> fetch n8n ->
    // tải -> ghép hashtag -> đăng -> markdone -> nhật ký. Cả nút "Đăng" lẫn scheduler
    // đều gọi chung hàm này -> tránh trùng lặp logic.
    // Chiếm 1 slot trong semaphore đồng thời (manual + schedule chung ngưỡng concurrency).
    // Nếu đủ slot, lệnh sẽ CHỜ tới khi có chỗ trống (báo qua progress).
    emitProgress({
      accountId,
      accountLabel: getAccount(accountId)?.label ?? accountId,
      stage: 'queue',
      message: 'Đang chờ slot trống để chạy…',
      busy: true
    })
    await acquireSlot(accountId)
    try {
      return await runPostForAccount(accountId, { source: 'manual' })
    } finally {
      releaseSlot(accountId)
    }
  })

  // Tra cứu thông tin hồ sơ X từ username (follower/following/số bài + tên + avatar).
  // Dùng proxy của tài khoản (nếu truyền accountId). Cache kết quả vào DB khi thành công.
  // Avatar được tải về thành data URL base64 để hiển thị trực tiếp trong renderer (tránh
  // bị X block hotlink hoặc CSP chặn ảnh ngoài).
  ipcMain.handle(
    IpcChannels.accountsLookupX,
    async (_e, handle: string, accountId?: string): Promise<XProfileInfo> => {
      const username = (handle ?? '').trim().replace(/^@+/, '')
      if (!username) {
        return { name: null, followers: null, following: null, posts: null, avatarUrl: null, error: 'Chưa nhập username' }
      }
      let proxyString: string | null = null
      let cachedAvatarUrl: string | null = null
      if (accountId) {
        const acc = getAccount(accountId)
        if (acc) {
          proxyString = resolveProxyString(acc.proxyId)
          // Nếu handle không đổi và đã có avatar data URL cached -> dùng lại,
          // không cần tải lại (tiết kiệm mạng + DB write).
          if (acc.handle && acc.handle.replace(/^@+/, '') === username && acc.avatarUrl?.startsWith('data:')) {
            cachedAvatarUrl = acc.avatarUrl
          }
        }
      }
      const info = await fetchXProfile(username, proxyString)
      // Tải avatar về base64 data URL để renderer hiển thị được (X block hotlink).
      // Skip nếu đã có cache hợp lệ (handle không đổi).
      if (info.avatarUrl) {
        if (cachedAvatarUrl) {
          info.avatarUrl = cachedAvatarUrl
        } else {
          const dataUrl = await downloadAvatarAsDataUrl(info.avatarUrl, proxyString)
          if (dataUrl) info.avatarUrl = dataUrl
        }
      }
      // Cache vào DB nếu fetch thành công và có account để lưu.
      if (accountId && !info.error) {
        updateAccountStats(accountId, {
          followers: info.followers,
          following: info.following,
          statuses: info.posts,
          avatarUrl: info.avatarUrl ?? null
        })
      }
      return info
    }
  )

  // ---- Lên lịch đăng bài (tab Lên lịch) ----
  ipcMain.handle(IpcChannels.schedulesList, () => listSchedules())
  ipcMain.handle(IpcChannels.schedulesCreate, (_e, input: ScheduleInput) => createSchedule(input))
  ipcMain.handle(IpcChannels.schedulesUpdate, (_e, id: string, input: Partial<ScheduleInput>) =>
    updateSchedule(id, input)
  )
  ipcMain.handle(IpcChannels.schedulesDelete, (_e, id: string) => deleteSchedule(id))

  // #1: bridge sự kiện trạng thái browser từ manager -> renderer.
  browserManager.onStatusChange((accountId, open) => {
    emitBrowserStatus(accountId, open)
  })

  // ---- Analytics (tab Analytics) ----
  // Fetch thủ công toàn bộ tài khoản.
  ipcMain.handle(IpcChannels.analyticsFetchNow, async () => {
    const result = await fetchAllAccountsStats()
    pruneAnalytics()
    return result
  })

  // Fetch thủ công 1 tài khoản (nút fetch riêng trong card).
  ipcMain.handle(IpcChannels.analyticsFetchOne, async (_e, accountId: string) => {
    const result = await fetchAccountStats(accountId)
    pruneAnalytics()
    return result
  })

  // Lấy dữ liệu analytics (tất cả hoặc theo accountId).
  ipcMain.handle(IpcChannels.analyticsList, (_e, accountId?: string, days?: number) => {
    return getAnalyticsData(accountId, days ?? 30)
  })

  // Xoá analytics (theo accountId hoặc tất cả).
  ipcMain.handle(IpcChannels.analyticsDelete, (_e, accountId?: string) => {
    if (accountId) deleteAnalyticsByAccount(accountId)
    else clearAllAnalytics()
  })

  // Thống kê dung lượng analytics.
  ipcMain.handle(IpcChannels.analyticsStorageStats, () => {
    return getAnalyticsStorageStats()
  })
}

// Kiểm tra proxy qua HTTP: gửi GET http://ip-api.com/json/ qua proxy.
// Trả về latency (ms) + vị trí (country, city, ip) nếu live, hoặc error nếu dead.
function checkProxyViaHttp(
  proxy: { server: string; username?: string; password?: string }
): Promise<{ ok: boolean; latencyMs: number | null; country?: string; city?: string; ip?: string; error?: string }> {
  return new Promise((resolve) => {
    const timeout = 10000
    const targetUrl = new URL('http://ip-api.com/json/')

    // Parse proxy server URL
    const proxyUrl = new URL(proxy.server)
    const proxyPort = parseInt(proxyUrl.port) || (proxyUrl.protocol === 'https:' ? 443 : 80)
    const proxyHost = proxyUrl.hostname

    const start = Date.now()

    const req = http.request({
      host: proxyHost,
      port: proxyPort,
      method: 'CONNECT',
      path: `${targetUrl.hostname}:80`,
      headers: proxy.username ? { 'Proxy-Authorization': 'Basic ' + Buffer.from(`${proxy.username}:${proxy.password ?? ''}`).toString('base64') } : {},
      timeout
    })

    req.on('connect', (_res, socket) => {
      // Proxy trả CONNECT 200 -> gửi GET tới target qua tunnel.
      const getRequest = `GET /json/ HTTP/1.1\r\nHost: ${targetUrl.hostname}\r\nConnection: close\r\n\r\n`
      socket.write(getRequest)

      let data = ''
      socket.on('data', (chunk: Buffer) => { data += chunk.toString() })
      socket.on('end', () => {
        const latency = Date.now() - start
        // Parse HTTP response body (sau \r\n\r\n)
        const bodyStart = data.indexOf('\r\n\r\n')
        const body = bodyStart !== -1 ? data.slice(bodyStart + 4) : data
        try {
          const json = JSON.parse(body)
          if (json.status === 'success') {
            resolve({ ok: true, latencyMs: latency, country: json.countryCode ?? json.country, city: json.city, ip: json.query })
          } else {
            resolve({ ok: true, latencyMs: latency, country: undefined, city: undefined, ip: json.query, error: json.message })
          }
        } catch {
          // Có thể response không phải JSON — vẫn tính live nếu CONNECT thành công
          resolve({ ok: true, latencyMs: latency, country: undefined, city: undefined, ip: undefined })
        }
      })
      socket.on('error', (e: Error) => {
        resolve({ ok: false, latencyMs: null, error: e.message })
      })
    })

    req.on('error', (e: Error) => {
      resolve({ ok: false, latencyMs: null, error: e.message })
    })

    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, latencyMs: null, error: 'Timeout 10s' })
    })

    req.end()
  })
}