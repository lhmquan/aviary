import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { IpcChannels, type AppInfo } from '../shared/types'
import { registerIpc } from './ipc'
import { browserManager } from './browser/BrowserManager'
import { initUpdater, checkForUpdates, installUpdate } from './updater'
import { pruneLogs } from './db/logs'
import { startScheduler, stopScheduler } from './scheduler'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Aviary',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // electron-vite cung cấp ELECTRON_RENDERER_URL khi chạy dev (HMR).
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerAppIpc(): void {
  ipcMain.handle(IpcChannels.getAppInfo, (): AppInfo => {
    return { name: 'Aviary', version: app.getVersion() }
  })

  ipcMain.handle(IpcChannels.appRelaunch, async () => {
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
}

app.whenReady().then(() => {
  registerAppIpc()
  registerIpc()
  createWindow()

  // Phải gọi initUpdater sau khi window đã tạo để
  // các event listener của autoUpdater có thể broadcast về renderer.
  initUpdater()

  // #5: dọn nhật ký cũ theo retention ngay khi khởi động app.
  try {
    pruneLogs()
  } catch {
    /* ignore */
  }

  // Khởi động bộ lập lịch đăng bài (tick 30s). Phải sau khi registerIpc để DB sẵn sàng.
  try {
    startScheduler()
  } catch {
    /* ignore */
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', async (e) => {
  // dừng scheduler + đảm bảo các profile chromium đóng sạch trước khi quit
  stopScheduler()
  if (browserManager.openCount() > 0) {
    e.preventDefault()
    await browserManager.closeAll()
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
