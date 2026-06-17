import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { IpcChannels, type AppInfo } from '../shared/types'
import { registerIpc } from './ipc'
import { browserManager } from './browser/BrowserManager'

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
}

app.whenReady().then(() => {
  registerAppIpc()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', async (e) => {
  // đảm bảo các profile chromium đóng sạch trước khi quit
  if (browserManager.openCount() > 0) {
    e.preventDefault()
    await browserManager.closeAll()
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
