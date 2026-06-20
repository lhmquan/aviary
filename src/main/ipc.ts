import { ipcMain, BrowserWindow } from 'electron'
import {
  IpcChannels,
  type AccountInput,
  type AppSettings,
  type ProxyInput,
  type ScheduleInput
} from '../shared/types'
import {
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  getAccount,
  setAccountStatus
} from './db/accounts'
import { getAllSettings, saveSettings } from './db/settings'
import {
  testWebhook
} from './n8n/N8nConnector'
import { listProxies, createProxy, updateProxy, deleteProxy, bulkCreateProxies } from './db/proxies'
import {
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule
} from './db/schedules'
import { browserManager } from './browser/BrowserManager'
import { listLogs, clearLogs } from './db/logs'
import { runPostForAccount } from './scheduler/runner'

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

  ipcMain.handle(IpcChannels.accountsDelete, async (_e, id: string) => {
    await browserManager.closeProfile(id)
    deleteAccount(id)
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

  ipcMain.handle(IpcChannels.logsList, () => listLogs())
  ipcMain.handle(IpcChannels.logsClear, () => {
    clearLogs()
    return undefined
  })

  ipcMain.handle(IpcChannels.postRunNow, (_e, accountId: string) =>
    // Pipeline đăng bài dùng chung (runner.ts): mở profile nếu chưa mở -> fetch n8n ->
    // tải -> ghép hashtag -> đăng -> markdone -> nhật ký. Cả nút "Đăng" lẫn scheduler
    // đều gọi chung hàm này -> tránh trùng lặp logic.
    runPostForAccount(accountId, { source: 'manual' })
  )

  // ---- Lịch đăng bài (tab Lịch đăng) ----
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
}