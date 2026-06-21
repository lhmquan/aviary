import { app, Tray, Menu, nativeImage, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

let tray: Tray | null = null

// Flag toàn cục: true khi app thực sự thoát (từ tray "Thoát", relaunch, update).
// Giúp phân biệt "nhấn X = thu tray" vs "thoát thật".
let isQuitting = false

export function getIsQuitting(): boolean {
  return isQuitting
}

export function setIsQuitting(v: boolean): void {
  isQuitting = v
}

// Lấy icon tray — resize từ icon.png (256x256) xuống 16x16.
// Fallback: tạo icon đơn giản từ code nếu không tìm thấy file.
function createTrayIcon(): Electron.NativeImage {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../build/icon.png')
  if (existsSync(iconPath)) {
    const full = nativeImage.createFromPath(iconPath)
    return full.resize({ width: 16, height: 16 })
  }

  // Fallback: icon 16x16 tạo từ code (gradient xanh-tím).
  const size = 16
  const pixels = Buffer.alloc(size * size * 4, 0)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const inBorder =
        x >= 2 && x < size - 2 && y >= 2 && y < size - 2 &&
        !(x === 2 && y === 2) && !(x === 2 && y === size - 3) &&
        !(x === size - 3 && y === 2) && !(x === size - 3 && y === size - 3)
      if (inBorder) {
        const t = (y - 2) / (size - 5)
        const r = Math.round(91 + (167 - 91) * t)
        const g = Math.round(124 + (139 - 124) * t)
        const b = 250
        pixels[i] = r
        pixels[i + 1] = g
        pixels[i + 2] = b
        pixels[i + 3] = 255
      }
    }
  }
  return nativeImage.createFromBuffer(pixels, {
    width: size,
    height: size,
    scaleFactor: 1.0
  })
}

export function createTray(mainWindow: BrowserWindow): void {
  if (tray) return

  const icon = createTrayIcon()
  tray = new Tray(icon)
  tray.setToolTip('Aviary')

  // Click chuột trái → hiện cửa sổ.
  tray.on('click', () => {
    mainWindow.show()
    mainWindow.focus()
  })

  // Chuột phải → context menu.
  const buildMenu = (): Menu => {
    return Menu.buildFromTemplate([
      { label: `Aviary v${app.getVersion()}`, enabled: false },
      { type: 'separator' },
      {
        label: 'Hiện cửa sổ',
        click: () => {
          mainWindow.show()
          mainWindow.focus()
        }
      },
      { type: 'separator' },
      {
        label: 'Thoát',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  }

  tray.setContextMenu(buildMenu())

  // Cập nhật menu khi version thay đổi (không cần lắm, nhưng an toàn).
  app.on('before-quit', () => {
    // Đảm bảo isQuitting flag đúng khi quit từ các nguồn khác (relaunch, update).
    if (!isQuitting) isQuitting = true
  })
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
