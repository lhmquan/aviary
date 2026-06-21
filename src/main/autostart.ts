import { app } from 'electron'

// Khởi động cùng Windows — dùng Electron built-in API.
// State nằm ở OS, không cần lưu DB.

export function getAutoStart(): boolean {
  return app.getLoginItemSettings().openAtLogin
}

export function setAutoStart(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: app.getPath('exe')
  })
}
