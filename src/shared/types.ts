// Types dùng chung giữa main và renderer.

export interface AppInfo {
  name: string
  version: string
}

export type AccountStatus = 'new' | 'logged_in' | 'checkpoint' | 'banned' | 'disabled'

export interface Account {
  id: string
  label: string
  handle: string | null
  proxy: string | null
  profileDir: string
  fingerprint: string | null
  status: AccountStatus
  createdAt: number
  updatedAt: number
}

export interface AccountInput {
  label: string
  handle?: string | null
  proxy?: string | null
}

export interface AppSettings {
  webhookUrl: string
  webhookSecret: string
  downloadsDir: string
  concurrency: number
}

// Asset n8n trả về để đăng bài.
export interface PostPayload {
  caption: string
  assets: { url: string; type?: 'image' | 'video' }[]
}

export interface WebhookTestResult {
  ok: boolean
  status?: number
  caption?: string
  assetCount?: number
  error?: string
}

// Kênh IPC - khai báo tập trung để main và preload dùng chung, tránh gõ sai chuỗi.
export const IpcChannels = {
  getAppInfo: 'app:getInfo',
  accountsList: 'accounts:list',
  accountsCreate: 'accounts:create',
  accountsUpdate: 'accounts:update',
  accountsDelete: 'accounts:delete',
  browserOpen: 'browser:open',
  browserClose: 'browser:close',
  browserStatus: 'browser:status',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  webhookTest: 'webhook:test'
} as const

// API mà preload expose ra window.aviary cho renderer.
export interface AviaryApi {
  getAppInfo: () => Promise<AppInfo>
  accounts: {
    list: () => Promise<Account[]>
    create: (input: AccountInput) => Promise<Account>
    update: (id: string, input: Partial<AccountInput>) => Promise<Account>
    remove: (id: string) => Promise<void>
  }
  browser: {
    open: (accountId: string) => Promise<void>
    close: (accountId: string) => Promise<void>
    status: (accountId: string) => Promise<{ open: boolean }>
  }
  settings: {
    get: () => Promise<AppSettings>
    save: (patch: Partial<AppSettings>) => Promise<AppSettings>
  }
  webhook: {
    test: (accountId?: string) => Promise<WebhookTestResult>
  }
}
