import { app, shell, BrowserWindow, ipcMain, dialog, nativeImage } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { IpcChannels, type AppInfo } from '../shared/types'
import { registerIpc } from './ipc'
import { browserManager } from './browser/BrowserManager'
import { initUpdater, checkForUpdates, installUpdate } from './updater'
import { pruneLogs } from './db/logs'
import { startScheduler, stopScheduler } from './scheduler'
import { cleanupOldDownloads } from './scheduler/runner'
import { startAnalyticsScheduler, stopAnalyticsScheduler } from './analytics/scheduler'
import { pruneAnalytics } from './db/analytics'
import { createTray, getIsQuitting, setIsQuitting } from './tray'
import { getAutoStart, setAutoStart } from './autostart'

let mainWindow: BrowserWindow | null = null

function getAppIcon(): Electron.NativeImage | undefined {
  // Ưu tiên file build/icon.png (từ script generate-icons.js).
  // Khi đóng gói, file nằm trong resources; khi dev, nằm trong build/.
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../build/icon.png')
  if (existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath)
  }
  return undefined
}

function createWindow(): BrowserWindow {
  const icon = getAppIcon()
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Aviary',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => {
    win.maximize()
    win.show()
  })

  // Nhấn X = thu xuống tray (không thoát). Chỉ thoát thật khi isQuitting=true
  // (từ tray "Thoát", relaunch, update install).
  win.on('close', (e) => {
    if (!getIsQuitting()) {
      e.preventDefault()
      win.hide()
    }
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Nút "Back" trên chuột (Windows phát app-command 'browser-backward', không phải DOM event)
  // -> chuyển tiếp về renderer để quay lại section trước.
  win.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') {
      win.webContents.send(IpcChannels.navBack)
    }
  })

  // electron-vite cung cấp ELECTRON_RENDERER_URL khi chạy dev (HMR).
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function registerAppIpc(): void {
  ipcMain.handle(IpcChannels.getAppInfo, (): AppInfo => {
    return { name: 'Aviary', version: app.getVersion() }
  })

  ipcMain.handle(IpcChannels.appRelaunch, async () => {
    setIsQuitting(true)
    await browserManager.closeAll()

    // DEV (electron-vite): renderer chạy qua Vite dev server. Gọi app.relaunch()+exit
    // sẽ khiến electron-vite tắt luôn dev server => cửa sổ mới trắng. Trong dev,
    // code main đã được electron-vite tự restart khi lưu file; nút này chỉ cần
    // reload lại renderer để chắc chắn UI mới nhất.
    if (!app.isPackaged || process.env['ELECTRON_RENDERER_URL']) {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.reloadIgnoringCache()
      }
      return
    }

    // PRODUCTION (đã đóng gói): renderer load từ file => relaunch toàn bộ app an toàn.
    app.relaunch()
    app.exit(0)
  })

  ipcMain.handle(IpcChannels.pickFolder, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })

  ipcMain.handle(IpcChannels.updateCheck, () => checkForUpdates())
  ipcMain.handle(IpcChannels.updateInstall, () => installUpdate())

  // Auto-start cùng Windows.
  ipcMain.handle(IpcChannels.autoStartGet, () => getAutoStart())
  ipcMain.handle(IpcChannels.autoStartSet, (_e, enabled: boolean) => setAutoStart(enabled))
}

app.whenReady().then(() => {
  registerAppIpc()
  registerIpc()

  mainWindow = createWindow()

  // Khởi tạo system tray (thu xuống tray khi nhấn X).
  createTray(mainWindow)

  // Phải gọi initUpdater sau khi window đã tạo để
  // các event listener của autoUpdater có thể broadcast về renderer.
  initUpdater()

  // #5: dọn nhật ký cũ + download job cũ + analytics cũ theo retention ngay khi khởi động.
  try {
    pruneLogs()
  } catch {
    /* ignore */
  }
  try {
    void cleanupOldDownloads()
  } catch {
    /* ignore */
  }
  try {
    pruneAnalytics()
  } catch {
    /* ignore */
  }

  // Khởi động bộ lập lịch đăng bài (tick 30s). Phải sau khi registerIpc để DB sẵn sàng.
  try {
    startScheduler()
  } catch {
    /* ignore */
  }

  // Khởi động scheduler analytics (fetch 1 lần/ngày, tick 30 phút kiểm tra).
  try {
    startAnalyticsScheduler()
  } catch {
    /* ignore */
  }

  app.on('activate', () => {
    // macOS: click dock icon khi cửa sổ đang ẩn → hiện lại.
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    } else {
      mainWindow?.show()
      mainWindow?.focus()
    }
  })
})

app.on('before-quit', async (e) => {
  // dừng scheduler + đảm bảo các profile chromium đóng sạch trước khi quit
  stopScheduler()
  stopAnalyticsScheduler()
  if (browserManager.openCount() > 0) {
    e.preventDefault()
    await browserManager.closeAll()
    app.quit()
  }
})

// KHÔNG tự quit khi tất cả cửa sổ đóng — app chạy nền trên tray.
// Chỉ quit khi user bấm "Thoát" từ tray (isQuitting=true).
app.on('window-all-closed', () => {
  // macOS: không quit (mặc định). Windows/Linux: thu xuống tray, không quit.
})
