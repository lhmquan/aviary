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
  // Thống kê hồ sơ X (tự fetch từ username). null = chưa fetch.
  followers: number | null
  following: number | null
  statusesCount: number | null
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

// Thông tin hồ sơ X tự fetch từ username (GraphQL guest token).
export interface XProfileInfo {
  name: string | null // tên hiển thị
  followers: number | null
  following: number | null
  posts: number | null // số bài (statuses_count)
  error?: string
}

// ---- Lên lịch đăng / xoá bài ----
export type ScheduleKind = 'interval' | 'fixed'
export type ScheduleAction = 'post' | 'delete'
export type DeleteMode = 'newest' | 'by_date'

export interface Schedule {
  id: string
  accountId: string
  label: string | null
  enabled: boolean
  action: ScheduleAction
  kind: ScheduleKind
  intervalMinutes: number | null // kind='interval'
  times: string[] // kind='fixed': mảng "HH:MM"
  jitterSeconds: number // ± ngẫu nhiên mỗi lần chạy
  deleteMode: DeleteMode | null // action='delete': 'newest' | 'by_date'
  deleteBeforeDate: string | null // action='delete' + deleteMode='by_date': "YYYY-MM-DD"
  deleteCount: number // action='delete': số bài xoá mỗi lần (0 = xoá tất cả)
  lastRunAt: number | null
  nextRunAt: number | null
  // Đang chạy (semaphore hàng đợi scheduler). Khi true: countdown dừng, đang chờ/đang chạy.
  running: boolean
  createdAt: number
  updatedAt: number
}

export interface ScheduleInput {
  accountId: string
  label?: string | null
  action?: ScheduleAction
  kind: ScheduleKind
  intervalMinutes?: number | null
  times?: string[]
  jitterSeconds?: number
  enabled?: boolean
  deleteMode?: DeleteMode | null
  deleteBeforeDate?: string | null
  deleteCount?: number
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

// Kết quả xoá bài trên X
export interface DeleteResult {
  ok: boolean
  deletedCount: number
  urls: string[]
  error?: string
  step?: string
  screenshot?: string
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
  // Danh sách URL các bài đã xoá (chỉ có ở log loại 'delete'/'run_delete').
  // Dùng để hiển thị chi tiết cho user kiểm tra. Có thể ít hơn số bài đã xoá
  // (bài không lấy được link sẽ không nằm trong đây).
  urls?: string[]
  // 'post' = đăng bài thủ công | 'delete' = xoá bài thủ công |
  // 'schedule' = sự kiện lịch (tạo/sửa/xóa/toggle) | 'run' = 1 lần chạy đăng do lịch |
  // 'run_delete' = 1 lần chạy xoá do lịch | null = cũ.
  eventType?: string | null
}

// Phân trang nhật ký.
export interface LogListParams {
  page?: number
  pageSize?: number
  // Lọc theo loại sự kiện (event_type). 'post' gồm cả log cũ (event_type = NULL).
  // Bỏ trống / null = lấy tất cả.
  eventType?: string | null
}

export interface LogListResult {
  rows: LogEntry[]
  total: number
}

// Trạng thái tiến trình 1 tác vụ (main -> renderer, hiển thị thanh trạng thái).
export interface ProgressPayload {
  accountId?: string
  // Tên tài khoản (label) để statusbar hiển thị mà không cần lookup lại bên renderer.
  accountLabel?: string
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
  accountsLookupX: 'accounts:lookupX',
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
  queueChanged: 'queue:changed',
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
    // Fetch follower/following/số bài + tên hiển thị từ username X.
    // accountId (nếu có) dùng để chọn proxy của tài khoản khi gọi.
    lookup: (handle: string, accountId?: string) => Promise<XProfileInfo>
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
    // Báo hàng đợi scheduler thay đổi (để ScheduleView cập nhật "đang chờ/đang chạy").
    onQueueChanged: (cb: () => void) => () => void
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
