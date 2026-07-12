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
  // Tiền tố ghép vào ĐẦU caption khi đăng bài (KHÔNG gửi trong webhook).
  captionPrefix: string | null
  // Cấu hình AI sinh bình luận RIÊNG cho tài khoản này (tác vụ Tương tác feed).
  // tone: 'random' | 'friendly' | 'humorous' | 'neutral' | 'concise' ('random' = mỗi bình luận bốc ngẫu nhiên).
  aiCommentTone: string
  // lang: 'auto' (theo bài) | 'vi' | 'en'.
  aiCommentLang: string
  // format: 'random' | 'normal' | 'question' | 'debate' | 'info' ('random' = mỗi bình luận bốc ngẫu nhiên).
  aiCommentFormat: string
  // '__local' (IP máy, mặc định) | '__random' (random mỗi lần chạy) | id proxy cụ thể.
  proxyId: string
  // Thống kê hồ sơ X (tự fetch từ username). null = chưa fetch.
  followers: number | null
  following: number | null
  statusesCount: number | null
  // Avatar X (URL từ pbs.twimg.com). null = chưa fetch hoặc account không có handle.
  avatarUrl: string | null
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
  captionPrefix?: string | null
  aiCommentTone?: string
  aiCommentLang?: string
  aiCommentFormat?: string
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
  avatarUrl?: string | null // URL avatar từ pbs.twimg.com
  error?: string
}

// ---- Lên lịch đăng / xoá bài / bình luận ----
export type ScheduleKind = 'interval' | 'fixed'
export type ScheduleAction = 'post' | 'delete' | 'comment' | 'interact'
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
  // action='comment' — bình luận trên bài của chính tài khoản (trang profile).
  commentCount: number // số bài bình luận trong 1 lần chạy
  commentIntervalSeconds: number // thời gian giữa các lần bình luận trong 1 lần chạy
  commentSourceUrl: string | null // link Google Sheet chứa nội dung bình luận
  // action='interact' — phiên tương tác feed (scroll/like/comment AI/refresh) theo thời lượng.
  interactDurationMinutes: number // thời lượng 1 phiên tương tác (phút)
  // Số bình luận MỤC TIÊU trong 1 phiên tương tác. 0 = tự tính theo thời lượng (như cũ:
  // floor(phút/2.5)). >0 = app phân bổ để đạt đúng số này, giãn đều trong thời lượng.
  interactCommentTarget: number
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
  commentCount?: number
  commentIntervalSeconds?: number
  commentSourceUrl?: string | null
  interactDurationMinutes?: number
  interactCommentTarget?: number
}

export interface AppSettings {
  webhookUrl: string
  webhookSecret: string
  downloadsDir: string
  concurrency: number
  logRetentionDays: number
  // Số ngày giữ dữ liệu Analytics (snapshot follower/following/bài theo ngày). Tách RIÊNG
  // khỏi logRetentionDays: nhật ký thường giữ ngắn, còn analytics cần giữ dài để vẽ chart
  // xu hướng. 0 = giữ mãi.
  analyticsRetentionDays: number
  // Bật/tắt fetch analytics tự động 1 lần/ngày (tắt khi đang dev để không fetch liên tục).
  analyticsAutoFetch: boolean
  // Giới hạn số comment tối đa/ngày cho 1 tài khoản (chạm -> tạm dừng, mai chạy tiếp).
  commentDailyLimit: number
  // ---- AI sinh bình luận (OpenAI-compatible: OpenAI thật hoặc proxy bên thứ 3) ----
  aiBaseUrl: string // vd https://api.openai.com/v1 hoặc https://api.vietapi.tech/v1
  aiApiKey: string // sk-... (lưu DB, không log)
  aiModel: string // vd gpt-4o-mini | gpt
  // Độ dài bình luận tối đa (ký tự). X cho tối đa 280. Giọng điệu/ngôn ngữ/định dạng
  // đã chuyển sang cấu hình RIÊNG từng tài khoản (Account.aiCommentTone/Lang/Format).
  aiCommentMaxLen: number
  // Chặn tải media (ảnh/video/font) khi Chromium mở trang X. Tiết kiệm băng thông proxy +
  // load nhanh hơn, giảm lỗi do delay. KHÔNG ảnh hưởng upload khi đăng (upload đọc file
  // cục bộ, không phải request tải xuống).
  blockMedia: boolean
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
  // URL reddit gốc (permalink đầy đủ) — đính kèm markdone để n8n ghi vào sheet.
  sourceUrl?: string | null
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

// Kết quả test webhook bình luận — hiển thị nội dung bình luận n8n trả về.
export interface CommentTestResult {
  ok: boolean
  status?: number
  handle?: string
  comment?: string
  error?: string
}

// Kết quả test AI sinh bình luận (OpenAI-compatible) — hiển thị câu AI trả về.
export interface AiTestResult {
  ok: boolean
  comment?: string
  error?: string
  status?: number
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
  // X từ chối vì video dài quá giới hạn tài khoản (không premium). Bài này KHÔNG đăng được
  // với tài khoản hiện tại -> runner sẽ markDone để bỏ qua, đăng bài kế. Đổi lên premium
  // thì video dài đăng được nên không set cờ này.
  videoTooLong?: boolean
  // User bấm Dừng giữa chừng -> KHÔNG markDone (bài chưa đăng), ghi log 'stopped'.
  stopped?: boolean
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

// Payload n8n trả về cho event 'comments' — nội dung bình luận theo handle.
// Mỗi tài khoản 1 nội dung cố định (lấy từ Google Sheet qua n8n).
export interface CommentPayload {
  handle: string
  // Nội dung bình luận dùng cho mọi bài trong lần chạy. Trống/skip -> bỏ qua lần chạy.
  comment: string
  skip?: boolean
}

// Kết quả bình luận trên X cho 1 lần chạy.
export interface CommentResult {
  ok: boolean
  commentedCount: number
  urls: string[]
  error?: string
  step?: string
  screenshot?: string
  // Đã chạm limit comment/ngày -> tạm dừng, mai chạy tiếp.
  limitReached?: boolean
  // Tweet là reply (không phải bài gốc) -> bỏ qua, không bình luận.
  skipped?: boolean
  // User bấm Dừng giữa chừng -> ghi log 'stopped', trả về số bài đã bình luận tới lúc đó.
  stopped?: boolean
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
  // Chỉ lấy các dòng LỖI (ok = 0). Kết hợp AND với eventType nếu có.
  onlyErrors?: boolean
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
  webhookTestComments: 'webhook:testComments',
  aiTest: 'ai:test',
  postRunNow: 'post:runNow',
  commentRunNow: 'comment:runNow',
  browserStatusChanged: 'browser:statusChanged',
  taskProgress: 'task:progress',
  taskStop: 'task:stop',
  queueChanged: 'queue:changed',
  logsList: 'logs:list',
  logsClear: 'logs:clear',
  logsCount: 'logs:count',
  updateCheck: 'update:check',
  updateInstall: 'update:install',
  updateStatus: 'update:status',
  autoStartGet: 'app:autoStart:get',
  autoStartSet: 'app:autoStart:set',
  analyticsFetchNow: 'analytics:fetchNow',
  analyticsFetchOne: 'analytics:fetchOne',
  analyticsList: 'analytics:list',
  analyticsDelete: 'analytics:delete',
  analyticsStorageStats: 'analytics:storageStats'
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
    testComments: (handle: string, sourceUrl?: string | null) => Promise<CommentTestResult>
  }
  ai: {
    // Test cấu hình AI: gửi 1 đoạn text mẫu -> nhận câu bình luận AI sinh.
    test: (sampleText: string) => Promise<AiTestResult>
  }
  post: {
    runNow: (accountId: string) => Promise<PostResult>
    // Dừng đột ngột phiên đang chạy của 1 tài khoản (mọi action). Đóng profile + báo
    // các vòng lặp dài thoát sớm.
    stop: (accountId: string) => Promise<void>
    onProgress: (cb: (p: ProgressPayload) => void) => () => void
    // Báo hàng đợi scheduler thay đổi (để ScheduleView cập nhật "đang chờ/đang chạy").
    onQueueChanged: (cb: () => void) => () => void
  }
  comments: {
    runNow: (accountId: string) => Promise<CommentResult>
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
  analytics: {
    fetchNow: () => Promise<AnalyticsFetchResult>
    fetchOne: (accountId: string) => Promise<{ ok: boolean; error?: string; skipped?: boolean }>
    list: (accountId?: string, days?: number) => Promise<AnalyticsData>
    remove: (accountId?: string) => Promise<void>
    storageStats: () => Promise<AnalyticsStorageStats>
  }
}

// ---- Analytics ----

// 1 điểm dữ liệu theo ngày (snapshot thống kê X).
export interface DailyStats {
  accountId: string
  day: number
  capturedAt: number
  followers: number | null
  following: number | null
  statusesCount: number | null
  name: string | null
}

// Delta tăng trưởng cho 1 khoảng thời gian (1d/7d/30d/từ đầu).
// `null` ở đây mang ý nghĩa CHÍNH XÁC: "chưa đủ dữ liệu để tính" (không có
// snapshot tham chiếu ở mốc đó), KHÁC với số 0 (có dữ liệu nhưng không đổi).
// `available` = true khi tìm được snapshot tham chiếu thật cho mốc này.
export interface GrowthDelta {
  followers: number | null
  following: number | null
  posts: number | null
  available: boolean
}

// Tăng trưởng đầy đủ cho 1 tài khoản.
export interface AccountGrowth {
  accountId: string
  accountLabel: string
  handle: string | null
  avatarUrl: string | null
  current: {
    followers: number | null
    following: number | null
    posts: number | null
    name: string | null
  }
  delta1d: GrowthDelta
  delta7d: GrowthDelta
  delta30d: GrowthDelta
  // Tổng thay đổi từ snapshot đầu tiên (luôn có ý nghĩa khi >= 2 snapshot).
  sinceStart: GrowthDelta
  // Số ngày đã có snapshot (distinct days) — để UI cho biết theo dõi bao lâu.
  trackedDays: number
  // Ngày snapshot sớm nhất / mới nhất (ms, nửa đêm local). null nếu chưa có data.
  firstDay: number | null
  latestDay: number | null
  series: DailyStats[]
  // Lỗi fetch gần nhất (nếu có) — hiển thị trên UI để user kiểm tra.
  lastError: string | null
}

// 1 mẫu dữ liệu analytics đã fetch được cho 1 tài khoản (snapshot tại thời điểm fetch).
// Dùng để gửi về n8n qua webhook event 'data_acc' khi user bấm "Fetch ngay".
export interface AnalyticsFetchRecord {
  accountId: string
  label: string
  handle: string | null
  name: string | null
  followers: number | null
  following: number | null
  posts: number | null
  avatarUrl: string | null
  status: string
  fetchedAt: number
}

// Kết quả 1 lần fetch tất cả tài khoản.
export interface AnalyticsFetchResult {
  total: number
  success: number
  failed: number
  skipped: number
  errors: { accountId: string; accountLabel: string; error: string }[]
  // Danh sách mẫu đã fetch thành công (chỉ những tài khoản OK) — gửi về n8n.
  records: AnalyticsFetchRecord[]
}

// Dữ liệu trả về cho analytics:list.
export interface AnalyticsData {
  accounts: AccountGrowth[]
  lastFetchAt: number | null
}

// Thống kê dung lượng analytics.
export interface AnalyticsStorageStats {
  rowCount: number
  accountCount: number
  estimatedBytes: number
  retentionDays: number
}
