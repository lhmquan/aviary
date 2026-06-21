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
  profileDir: string
  fingerprint: string | null
  status: AccountStatus
  assetUrl: string | null
  headless: boolean
  hashtag: string | null
  // '__local' (IP máy, mặc định) | '__random' (random mỗi lần chạy) | id proxy cụ thể.
  proxyId: string
  createdAt: number
  updatedAt: number
}

export interface AccountInput {
  label: string
  handle?: string | null
  proxyId?: string
  assetUrl?: string | null
  headless?: boolean
  hashtag?: string | null
}

// Proxy trong kho chung (tab Proxy).
export interface Proxy {
  id: string
  label: string
  proxyString: string
  kind: string | null
  note: string | null
  createdAt: number
  updatedAt: number
  // Kết quả kiểm tra proxy
  status: 'unchecked' | 'live' | 'dead'
  checkedAt: number | null
  latencyMs: number | null
  country: string | null
  city: string | null
  checkIp: string | null
}

export interface ProxyInput {
  label: string
  proxyString: string
  kind?: string | null
  note?: string | null
}

// Kết quả kiểm tra 1 proxy (live/die + vị trí).
export interface ProxyCheckResult {
  id: string
  status: 'live' | 'dead'
  latencyMs: number | null
  country: string | null
  city: string | null
  checkIp: string | null
  error?: string
}

// Giá trị đặc biệt cho account.proxyId.
export const PROXY_LOCAL = '__local'
export const PROXY_RANDOM = '__random'

// ---- Lịch đăng bài ----
export type ScheduleKind = 'interval' | 'fixed'

export interface Schedule {
  id: string
  accountId: string
  label: string | null
  enabled: boolean
  kind: ScheduleKind
  intervalMinutes: number | null // kind='interval'
  times: string[] // kind='fixed': mảng "HH:MM"
  jitterSeconds: number // ± ngẫu nhiên mỗi lần chạy
  lastRunAt: number | null
  nextRunAt: number | null
  createdAt: number
  updatedAt: number
}

export interface ScheduleInput {
  accountId: string
  label?: string | null
  kind: ScheduleKind
  intervalMinutes?: number | null
  times?: string[]
  jitterSeconds?: number
  enabled?: boolean
}

export interface AppSettings {
  webhookUrl: string
  webhookSecret: string
  downloadsDir: string
  concurrency: number
  logRetentionDays: number
}

// Asset n8n trả về để đăng bài.
export interface VideoSpec {
  videoUrl: string
  audioUrls: string[]
  dashUrl?: string
  hlsUrl?: string
}

export interface PostPayload {
  caption: string
  assets: { url: string; type?: 'image' | 'video' }[]
  // Cho dạng video Reddit có audio tách rời, mỗi item có url chính + audioUrls[].
  videoSpecs?: VideoSpec[]
  // n8n báo bỏ qua bài này (link hỏng) -> app tự lấy bài kế.
  skip?: boolean
  // id link Reddit (ổn định hơn title để markdone khớp đúng dòng sheet).
  id?: string
}

export interface WebhookTestResult {
  ok: boolean
  status?: number
  caption?: string
  assetCount?: number
  hasAudioMerge?: boolean
  assetUrl?: string | null
  accountId?: string | null
  error?: string
}

// Kết quả đăng bài thử
export interface PostResult {
  ok: boolean
  url?: string
  error?: string
  step?: string
  screenshot?: string
  // Bài bị bỏ qua do link hỏng (n8n SKIP hoặc tải 403). Đã markdone, user tự bấm lại.
  skipped?: boolean
}

// Một dòng nhật ký đăng bài (lưu DB, hiển thị ở tab Nhật ký).
export interface LogEntry {
  id: number
  accountId: string
  accountLabel: string
  ts: number
  ok: boolean
  caption: string
  url: string | null
  error: string | null
  step: string | null
  screenshot: string | null
  // 'post' = đăng bài | 'schedule' = sự kiện lịch (tạo/sửa/xóa/toggle) | 'run' = 1 lần chạy do lịch | null = cũ.
  eventType?: string | null
}

// Phân trang nhật ký.
export interface LogListParams {
  page?: number
  pageSize?: number
}

export interface LogListResult {
  rows: LogEntry[]
  total: number
}

// Trạng thái tiến trình 1 tác vụ (main -> renderer, hiển thị thanh trạng thái).
export interface ProgressPayload {
  accountId?: string
  stage: string
  message: string
  busy: boolean
}

// Trạng thái auto-update gửi từ main -> renderer
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'none'
  | 'error'

export interface UpdateStatusPayload {
  state: UpdateState
  version?: string
  percent?: number
  error?: string
}

// Kênh IPC - khai báo tập trung để main và preload dùng chung, tránh gõ sai chuỗi.
export const IpcChannels = {
  getAppInfo: 'app:getInfo',
  appRelaunch: 'app:relaunch',
  pickFolder: 'app:pickFolder',
  accountsList: 'accounts:list',
  accountsCreate: 'accounts:create',
  accountsUpdate: 'accounts:update',
  accountsDelete: 'accounts:delete',
  proxiesList: 'proxies:list',
  proxiesBulkCreate: 'proxies:bulkCreate',
  proxiesCreate: 'proxies:create',
  proxiesUpdate: 'proxies:update',
  proxiesDelete: 'proxies:delete',
  proxiesClear: 'proxies:clear',
  proxiesCheck: 'proxies:check',
  schedulesList: 'schedules:list',
  schedulesCreate: 'schedules:create',
  schedulesUpdate: 'schedules:update',
  schedulesDelete: 'schedules:delete',
  browserOpen: 'browser:open',
  browserClose: 'browser:close',
  browserStatus: 'browser:status',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  webhookTest: 'webhook:test',
  postRunNow: 'post:runNow',
  browserStatusChanged: 'browser:statusChanged',
  taskProgress: 'task:progress',
  logsList: 'logs:list',
  logsClear: 'logs:clear',
  logsCount: 'logs:count',
  updateCheck: 'update:check',
  updateInstall: 'update:install',
  updateStatus: 'update:status',
  autoStartGet: 'app:autoStart:get',
  autoStartSet: 'app:autoStart:set'
} as const

// API mà preload expose ra window.aviary cho renderer.
export interface AviaryApi {
  getAppInfo: () => Promise<AppInfo>
  relaunch: () => Promise<void>
  pickFolder: () => Promise<string | null>
  accounts: {
    list: () => Promise<Account[]>
    create: (input: AccountInput) => Promise<Account>
    update: (id: string, input: Partial<AccountInput>) => Promise<Account>
    remove: (id: string) => Promise<void>
  }
  proxies: {
    list: () => Promise<Proxy[]>
    bulkCreate: (
      lines: string[],
      opts: { labelPrefix?: string; kind?: string | null }
    ) => Promise<{ added: number; skipped: string[] }>
    create: (input: ProxyInput) => Promise<Proxy>
    update: (id: string, input: Partial<ProxyInput>) => Promise<Proxy>
    remove: (id: string) => Promise<void>
    clear: () => Promise<void>
    check: (ids: string[]) => Promise<ProxyCheckResult[]>
  }
  schedules: {
    list: () => Promise<Schedule[]>
    create: (input: ScheduleInput) => Promise<Schedule>
    update: (id: string, input: Partial<ScheduleInput>) => Promise<Schedule>
    remove: (id: string) => Promise<void>
  }
  browser: {
    open: (accountId: string) => Promise<void>
    close: (accountId: string) => Promise<void>
    status: (accountId: string) => Promise<{ open: boolean }>
    onStatusChanged: (cb: (accountId: string, open: boolean) => void) => () => void
  }
  settings: {
    get: () => Promise<AppSettings>
    save: (patch: Partial<AppSettings>) => Promise<AppSettings>
  }
  webhook: {
    test: (accountId?: string) => Promise<WebhookTestResult>
  }
  post: {
    runNow: (accountId: string) => Promise<PostResult>
    onProgress: (cb: (p: ProgressPayload) => void) => () => void
  }
  logs: {
    list: (params?: LogListParams) => Promise<LogListResult>
    clear: () => Promise<void>
  }
  update: {
    check: () => Promise<void>
    install: () => Promise<void>
    onStatus: (cb: (status: UpdateStatusPayload) => void) => () => void
  }
  autoStart: {
    get: () => Promise<boolean>
    set: (enabled: boolean) => Promise<void>
  }
}
