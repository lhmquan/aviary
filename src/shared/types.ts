// Types dùng chung giữa main và renderer.

export interface AppInfo {
  name: string
  version: string
}

// Kênh IPC - khai báo tập trung để main và preload dùng chung, tránh gõ sai chuỗi.
export const IpcChannels = {
  getAppInfo: 'app:getInfo'
} as const

// API mà preload expose ra window.aviary cho renderer.
export interface AviaryApi {
  getAppInfo: () => Promise<AppInfo>
}
