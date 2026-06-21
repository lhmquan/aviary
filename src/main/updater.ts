import { autoUpdater } from 'electron-updater'
import { app, BrowserWindow } from 'electron'
import { IpcChannels, type UpdateStatusPayload } from '../shared/types'
import { browserManager } from './browser/BrowserManager'
import { setIsQuitting } from './tray'

let wired = false

function broadcast(payload: UpdateStatusPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.updateStatus, payload)
  }
}

// Gắn listener cho autoUpdater. Chỉ chạy thật khi app đã đóng gói (có app-update.yml).
export function initUpdater(): void {
  if (wired) return
  wired = true

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    broadcast({ state: 'available', version: info.version })
  )
  autoUpdater.on('update-not-available', () => broadcast({ state: 'none' }))
  autoUpdater.on('download-progress', (p) =>
    broadcast({ state: 'downloading', percent: Math.round(p.percent) })
  )
  autoUpdater.on('update-downloaded', (info) =>
    broadcast({ state: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', (err) => broadcast({ state: 'error', error: err.message }))
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    // Dev mode không có app-update.yml; báo "none" để UI không treo.
    broadcast({ state: 'none' })
    return
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    broadcast({ state: 'error', error: (e as Error).message })
  }
}

export async function installUpdate(): Promise<void> {
  // Đánh dấu đang thoát thật (không thu tray) trước khi cài + khởi động lại.
  setIsQuitting(true)
  await browserManager.closeAll()
  autoUpdater.quitAndInstall()
}
