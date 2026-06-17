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

// Kênh IPC - khai báo tập trung để main và preload dùng chung, tránh gõ sai chuỗi.
export const IpcChannels = {
  getAppInfo: 'app:getInfo',
  accountsList: 'accounts:list',
  accountsCreate: 'accounts:create',
  accountsUpdate: 'accounts:update',
  accountsDelete: 'accounts:delete',
  browserOpen: 'browser:open',
  browserClose: 'browser:close',
  browserStatus: 'browser:status'
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
}
