import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  RefreshCw,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  Trash2,
  BarChart3,
  Users as UsersIcon,
  UserCheck,
  FileText,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Database,
  Clock,
  Zap,
  ZapOff,
  ExternalLink,
  Power,
  MonitorCheck,
  Activity
} from 'lucide-react'
import type {
  AnalyticsData,
  AnalyticsFetchResult,
  AnalyticsStorageStats,
  AccountGrowth,
  AppSettings
} from '@shared/types'
import Sparkline from '../components/Sparkline'
import GrowthChart from '../components/GrowthChart'
import { useUiFeedback } from '../components/UiFeedback'

function fmtNum(n: number | null): string {
  if (n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function fmtDayShort(ts: number): string {
  return new Date(ts).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
}

function fmtRelative(ts: number | null): string {
  if (!ts) return 'chưa fetch'
  const diff = Date.now() - ts
  if (diff < 60_000) return 'vừa xong'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} phút trước`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} giờ trước`
  return new Date(ts).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// Pill hiển thị delta. `available=false` -> mốc chưa đủ dữ liệu tham chiếu,
// hiện "—" mờ (KHÁC với số 0 nghĩa là có data nhưng không đổi).
function DeltaBadge({
  delta,
  available,
  suffix,
  unavailableHint
}: {
  delta: number | null
  available: boolean
  suffix?: string
  unavailableHint?: string
}): JSX.Element {
  if (!available || delta === null) {
    return (
      <span className="delta-badge na" title={unavailableHint ?? 'Chưa đủ dữ liệu để tính mốc này'}>
        <Minus size={11} /> —
      </span>
    )
  }
  if (delta > 0) return <span className="delta-badge up"><TrendingUp size={11} /> +{fmtNum(delta)}{suffix}</span>
  if (delta < 0) return <span className="delta-badge down"><TrendingDown size={11} /> {fmtNum(delta)}{suffix}</span>
  return <span className="delta-badge neutral"><Minus size={11} /> 0</span>
}

// Tác vụ đang chạy của 1 tài khoản (lấy từ ProgressPayload realtime).
type RunningTask = { stage: string; message: string }

// Tác vụ có THỰC SỰ dùng profile browser hay không.
// Fetch analytics chỉ gọi HTTP qua proxy (fetchXProfile) — không mở profile, nên
// mở profile lúc đó vô hại. Các stage còn lại đều thuộc pipeline đăng/bình
// luận/xoá/tương tác — pipeline này mở và điều khiển profile.
function profileBusyTask(task: RunningTask | null): RunningTask | null {
  return task && task.stage !== 'analytics' ? task : null
}

// Hai nút dùng chung cho cả card có dữ liệu và card chưa có dữ liệu:
// mở x.com ở browser ngoài + mở profile Chromium của tài khoản.
function ProfileActions(props: {
  handle: string | null
  profileOpen: boolean
  task: RunningTask | null
  opening: boolean
  onOpenX: () => void
  onOpenProfile: () => void
}): JSX.Element {
  const { handle, profileOpen, task, opening, onOpenX, onOpenProfile } = props
  const clean = (handle ?? '').replace(/^@+/, '')
  const busyTask = profileBusyTask(task)
  const profileTitle = opening
    ? 'Đang mở profile…'
    : profileOpen && busyTask
      ? `Profile đang được tác vụ ngầm dùng (${busyTask.message})`
      : profileOpen
        ? 'Profile đang mở sẵn — bấm để xem thông báo'
        : busyTask
          ? `Đang chạy tác vụ ngầm (${busyTask.message}) — bấm để mở profile, sẽ hỏi xác nhận`
          : 'Mở profile Chromium của tài khoản này'
  return (
    <>
      <button
        className="btn icon-only ghost"
        title={clean ? `Mở x.com/${clean} bằng browser mặc định` : 'Chưa có username X — không mở được trang x.com'}
        disabled={!clean}
        onClick={onOpenX}
      >
        <ExternalLink size={14} />
      </button>
      <button
        className={`btn icon-only ghost ${busyTask ? 'running' : profileOpen ? 'active' : ''}`}
        title={profileTitle}
        disabled={opening}
        onClick={onOpenProfile}
      >
        {opening ? (
          <Loader2 size={14} className="spin" />
        ) : busyTask ? (
          <Activity size={14} />
        ) : profileOpen ? (
          <MonitorCheck size={14} />
        ) : (
          <Power size={14} />
        )}
      </button>
    </>
  )
}

// Ghi chú trạng thái profile ngay trên card — user thấy trước khi bấm nút.
function ProfileStateNote(props: { profileOpen: boolean; task: RunningTask | null }): JSX.Element | null {
  const { profileOpen, task } = props
  if (!profileOpen && !task) return null
  const busyTask = profileBusyTask(task)
  const parts: string[] = []
  if (profileOpen) parts.push('Profile đang mở sẵn')
  if (busyTask) parts.push(`${profileOpen ? 'đ' : 'Đ'}ang chạy tác vụ ngầm: ${busyTask.message}`)
  else if (task) parts.push(`${profileOpen ? 'đ' : 'Đ'}ang fetch analytics (không dùng profile)`)
  const tone = busyTask ? 'running' : profileOpen ? 'open' : 'info'
  return (
    <div className={`analytics-profile-note ${tone}`}>
      {busyTask ? <Activity size={13} /> : profileOpen ? <MonitorCheck size={13} /> : <RefreshCw size={13} />}
      <span>{parts.join(' · ')}.</span>
    </div>
  )
}

export default function AnalyticsView(): JSX.Element {
  const { confirm, toast } = useUiFeedback()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [storage, setStorage] = useState<AnalyticsStorageStats | null>(null)
  const [fetching, setFetching] = useState(false)
  const [fetchResult, setFetchResult] = useState<AnalyticsFetchResult | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showDeleteMenu, setShowDeleteMenu] = useState(false)
  const [autoFetch, setAutoFetch] = useState(true)
  // Trạng thái profile browser của từng tài khoản (đang mở hay không) + tác vụ
  // đang chạy ngầm — dùng để cảnh báo trước khi mở profile từ tab này.
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  const [runningMap, setRunningMap] = useState<Record<string, RunningTask>>({})
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [, force] = useState(0)

  const refresh = useCallback(async () => {
    const [d, s, settings] = await Promise.all([
      window.aviary.analytics.list(),
      window.aviary.analytics.storageStats(),
      window.aviary.settings.get()
    ])
    setData(d)
    setAutoFetch(settings.analyticsAutoFetch)
    setStorage(s)
  }, [])

  // Danh sách accountId (chuỗi ổn định) — chỉ đổi khi thêm/xoá tài khoản.
  const accountIdsKey = (data?.accounts ?? []).map((a) => a.accountId).join(',')

  // Nạp trạng thái profile 1 lần cho mỗi bộ tài khoản. KHÔNG gộp vào refresh():
  // fetch analytics bắn progress cho từng tài khoản -> refresh() chạy nhiều lần,
  // sẽ nhân số lời gọi IPC status lên bình phương số tài khoản.
  useEffect(() => {
    const ids = accountIdsKey ? accountIdsKey.split(',') : []
    if (ids.length === 0) return
    let cancelled = false
    void (async () => {
      const entries = await Promise.all(
        ids.map(async (id) => [id, (await window.aviary.browser.status(id)).open] as const)
      )
      if (!cancelled) setOpenMap(Object.fromEntries(entries))
    })()
    return () => {
      cancelled = true
    }
  }, [accountIdsKey])

  useEffect(() => {
    refresh()
    // Force render mỗi 30s để cập nhật "lần fetch cuối" relative time.
    const iv = setInterval(() => force((n) => n + 1), 30_000)
    // Cập nhật realtime khi profile được mở/đóng (kể cả user tự tắt cửa sổ browser).
    const offStatus = window.aviary.browser.onStatusChanged((accountId, open) => {
      setOpenMap((m) => ({ ...m, [accountId]: open }))
    })
    // Refresh khi analytics fetch xong (auto hoặc thủ công) → cập nhật delta + series.
    // Đồng thời theo dõi tài khoản nào đang chạy tác vụ ngầm để cảnh báo khi mở profile.
    const off = window.aviary.post.onProgress((p) => {
      if (p.stage === 'analytics' && !p.busy) {
        void refresh()
      }
      if (!p.accountId || p.accountId === '__system__') return
      const id = p.accountId
      setRunningMap((prev) => {
        if (!p.busy) {
          if (!(id in prev)) return prev // không đổi -> giữ nguyên reference
          const next = { ...prev }
          delete next[id]
          return next
        }
        const cur = prev[id]
        if (cur && cur.stage === p.stage && cur.message === p.message) return prev
        return { ...prev, [id]: { stage: p.stage, message: p.message } }
      })
    })
    return () => {
      clearInterval(iv)
      offStatus()
      off()
    }
  }, [refresh])

  async function handleFetchNow(): Promise<void> {
    setFetching(true)
    setFetchResult(null)
    try {
      const result = await window.aviary.analytics.fetchNow()
      setFetchResult(result)
      await refresh()
    } catch (e) {
      setFetchResult({
        total: 0,
        success: 0,
        failed: 1,
        skipped: 0,
        errors: [{ accountId: '', accountLabel: '', error: (e as Error).message }],
        records: []
      })
    } finally {
      setFetching(false)
    }
  }

  async function handleDeleteAll(): Promise<void> {
    setShowDeleteMenu(false)
    await confirm({ title: 'Xóa toàn bộ dữ liệu Analytics?', description: `Toàn bộ ${storage?.rowCount ?? 0} mẫu theo dõi sẽ bị xóa vĩnh viễn.`, confirmLabel: 'Xóa dữ liệu', tone: 'danger', action: async () => { await window.aviary.analytics.remove(); await refresh() } })
  }

  async function handleDeleteAccount(accountId: string, label: string): Promise<void> {
    await confirm({ title: `Xóa Analytics của “${label}”?`, description: 'Toàn bộ lịch sử và biểu đồ tăng trưởng của tài khoản này sẽ bị xóa.', confirmLabel: 'Xóa dữ liệu', tone: 'danger', action: async () => { await window.aviary.analytics.remove(accountId); await refresh() } })
  }

  async function handleToggleAutoFetch(): Promise<void> {
    const next = !autoFetch
    setAutoFetch(next)
    await window.aviary.settings.save({ analyticsAutoFetch: next })
  }

  // Mở trang x.com của tài khoản bằng browser mặc định của hệ điều hành.
  // Main process bắt window.open qua setWindowOpenHandler -> shell.openExternal.
  function handleOpenX(g: AccountGrowth): void {
    const handle = (g.handle ?? '').replace(/^@+/, '')
    if (!handle) {
      toast({
        title: 'Chưa có username X',
        description: `“${g.accountLabel}” chưa có username nên không mở được trang x.com.`,
        tone: 'warning'
      })
      return
    }
    window.open(`https://x.com/${handle}`, '_blank')
  }

  // Mở profile Chromium của tài khoản ngay từ tab Analytics.
  // - Profile đã mở sẵn: main process return sớm nên không mở lại -> chỉ thông báo.
  //   Lưu ý: khi pipeline đang chạy ở chế độ ngầm, profile VẪN tính là "đang mở"
  //   (context có thật) nhưng không có cửa sổ hiện ra -> phải nói rõ để user không
  //   đi tìm cửa sổ trên taskbar.
  // - Đang chạy tác vụ dùng profile nhưng chưa mở (chờ slot / gọi n8n): hỏi xác nhận,
  //   vì pipeline sẽ tự mở rồi tự đóng profile (openedByUs) và có thể bị gián đoạn.
  async function handleOpenProfile(g: AccountGrowth): Promise<void> {
    const id = g.accountId
    const busyTask = profileBusyTask(runningMap[id] ?? null)
    if (openMap[id]) {
      toast(
        busyTask
          ? {
              title: 'Profile đang được tác vụ ngầm sử dụng',
              description: `“${g.accountLabel}” đang chạy: ${busyTask.message}. Nếu tài khoản bật chế độ chạy ngầm thì không có cửa sổ nào hiện ra — chờ tác vụ xong rồi mở lại.`,
              tone: 'warning'
            }
          : {
              title: 'Profile đang mở sẵn',
              description: `Cửa sổ browser của “${g.accountLabel}” đã mở — kiểm tra trên thanh taskbar.`,
              tone: 'info'
            }
      )
      return
    }
    if (busyTask) {
      const ok = await confirm({
        title: `“${g.accountLabel}” đang chạy tác vụ ngầm`,
        description: `Tác vụ hiện tại: ${busyTask.message}. Tác vụ này dùng chính profile của tài khoản và sẽ tự đóng profile khi xong — mở profile lúc này có thể làm gián đoạn.`,
        confirmLabel: 'Vẫn mở profile',
        tone: 'warning'
      })
      if (!ok) return
    }
    setOpeningId(id)
    try {
      await window.aviary.browser.open(id)
      setOpenMap((m) => ({ ...m, [id]: true }))
      toast({
        title: 'Đã mở profile',
        description: `Cửa sổ browser của “${g.accountLabel}” đang được mở.`,
        tone: 'success'
      })
    } catch (e) {
      toast({ title: 'Không mở được profile', description: (e as Error).message, tone: 'danger' })
    } finally {
      setOpeningId(null)
    }
  }

  // Overview — tổng hợp tất cả tài khoản.
  const overview = useMemo(() => {
    if (!data || data.accounts.length === 0) return null
    const totalFollowers = data.accounts.reduce((sum, a) => sum + (a.current.followers ?? 0), 0)
    const totalFollowing = data.accounts.reduce((sum, a) => sum + (a.current.following ?? 0), 0)
    const totalPosts = data.accounts.reduce((sum, a) => sum + (a.current.posts ?? 0), 0)

    // Tăng trưởng followers/tuần: chỉ cộng các account thật sự có dữ liệu 7d.
    // Nếu CHƯA account nào đủ 7 ngày → fallback sang "từ khi theo dõi" (sinceStart)
    // để con số vẫn có nghĩa, kèm cờ để UI đổi nhãn cho đúng.
    let weekGrowth = 0
    let weekAvailable = false
    let sinceStartGrowth = 0
    let sinceStartAvailable = false
    for (const a of data.accounts) {
      if (a.delta7d.available && a.delta7d.followers !== null) {
        weekGrowth += a.delta7d.followers
        weekAvailable = true
      }
      if (a.sinceStart.available && a.sinceStart.followers !== null) {
        sinceStartGrowth += a.sinceStart.followers
        sinceStartAvailable = true
      }
    }

    // Phạm vi số ngày đang theo dõi (chỉ tính account đã có data).
    const tracked = data.accounts.map((a) => a.trackedDays).filter((n) => n > 0)
    const maxTrackedDays = tracked.length > 0 ? Math.max(...tracked) : 0

    return {
      totalFollowers,
      totalFollowing,
      totalPosts,
      weekGrowth,
      weekAvailable,
      sinceStartGrowth,
      sinceStartAvailable,
      maxTrackedDays,
      accountCount: data.accounts.length
    }
  }, [data])

  const accountsWithData = data?.accounts.filter((a) => a.series.length > 0) ?? []
  const accountsNoData = data?.accounts.filter((a) => a.series.length === 0) ?? []
  const errorAccounts = fetchResult?.errors ?? []

  return (
    <div className="view">
      <div className="toolbar">
        <button
          className="btn primary"
          onClick={handleFetchNow}
          disabled={fetching}
        >
          {fetching ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
          {fetching ? 'Đang fetch…' : 'Fetch ngay'}
        </button>

        <span className="muted small">
          <Clock size={13} /> Lần cuối: {fmtRelative(data?.lastFetchAt ?? null)}
        </span>

        <button
          className={`btn icon-label ${autoFetch ? 'accent' : ''}`}
          onClick={handleToggleAutoFetch}
          title={
            autoFetch
              ? 'Auto-fetch đang BẬT — app tự fetch 1 lần/ngày. Bấm để tắt (khi đang dev).'
              : 'Auto-fetch đang TẮT — app không tự fetch. Bấm để bật.'
          }
        >
          {autoFetch ? <Zap size={15} /> : <ZapOff size={15} />}
          Auto-fetch: {autoFetch ? 'Bật' : 'Tắt'}
        </button>

        {storage && (
          <span className="badge count-badge" title="Dung lượng Analytics ước tính">
            <Database size={12} />
            {fmtBytes(storage.estimatedBytes)} · {storage.rowCount} mẫu · {storage.accountCount} tài khoản
          </span>
        )}

        {storage && storage.rowCount > 0 && (
          <div className="analytics-delete-menu">
            <button
              className="btn icon-label danger"
              onClick={() => setShowDeleteMenu((v) => !v)}
              title="Xoá dữ liệu Analytics"
            >
              <Trash2 size={15} />
              Xoá dữ liệu
            </button>
            {showDeleteMenu && (
              <div className="action-menu-dropdown analytics-delete-dropdown">
                <button
                  className="action-menu-item danger"
                  onClick={handleDeleteAll}
                >
                  <Trash2 size={15} />
                  <span>Xoá tất cả ({storage.rowCount} mẫu)</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Kết quả fetch — hiển thị lỗi rõ ràng */}
      {fetchResult && (
        <div className={`analytics-fetch-result ${fetchResult.failed > 0 ? 'has-errors' : 'all-ok'}`}>
          <div className="fetch-result-summary">
            <BarChart3 size={16} />
            <span>
              Fetch xong: {fetchResult.success}/{fetchResult.total} thành công
              {fetchResult.failed > 0 && ` · ${fetchResult.failed} lỗi`}
              {fetchResult.skipped > 0 && ` · ${fetchResult.skipped} bỏ qua (chưa có username)`}
            </span>
          </div>
          {fetchResult.errors.length > 0 && (
            <div className="fetch-errors">
              <AlertCircle size={14} />
              <span>Tài khoản lỗi:</span>
              {fetchResult.errors.map((e, i) => (
                <span key={i} className="fetch-error-item">
                  {e.accountLabel || '(không rõ)'}: {e.error}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {data && data.accounts.length === 0 ? (
        <div className="empty-state">
          <BarChart3 size={36} />
          <p>Chưa có tài khoản nào</p>
          <span>Thêm tài khoản ở tab Tài khoản để bắt đầu theo dõi analytics.</span>
        </div>
      ) : accountsWithData.length === 0 && !fetching ? (
        <div className="empty-state">
          <BarChart3 size={36} />
          <p>Chưa có dữ liệu Analytics</p>
          <span>Bấm "Fetch ngay" để bắt đầu theo dõi sự tăng trưởng của các tài khoản.</span>
        </div>
      ) : (
        <>
          {/* Overview — 4 summary cards */}
          {overview && (
            <div className="analytics-overview">
              <div className="analytics-summary-card">
                <UsersIcon size={18} className="summary-icon accent" />
                <div>
                  <div className="summary-value">{overview.accountCount}</div>
                  <div className="summary-label">tài khoản theo dõi</div>
                </div>
              </div>
              <div className="analytics-summary-card">
                <UsersIcon size={18} className="summary-icon blue" />
                <div>
                  <div className="summary-value">{fmtNum(overview.totalFollowers)}</div>
                  <div className="summary-label">tổng followers</div>
                </div>
              </div>
              <div className="analytics-summary-card">
                <UserCheck size={18} className="summary-icon success" />
                <div>
                  <div className="summary-value">{fmtNum(overview.totalFollowing)}</div>
                  <div className="summary-label">tổng following</div>
                </div>
              </div>
              <div className="analytics-summary-card">
                <FileText size={18} className="summary-icon warn" />
                <div>
                  <div className="summary-value">{fmtNum(overview.totalPosts)}</div>
                  <div className="summary-label">tổng bài viết</div>
                </div>
              </div>
              <div className="analytics-summary-card">
                <TrendingUp size={18} className="summary-icon success" />
                <div>
                  {overview.weekAvailable ? (
                    <>
                      <div className="summary-value">
                        {overview.weekGrowth > 0 ? '+' : ''}
                        {fmtNum(overview.weekGrowth)}
                      </div>
                      <div className="summary-label">followers tăng/tuần</div>
                    </>
                  ) : overview.sinceStartAvailable ? (
                    <>
                      <div className="summary-value">
                        {overview.sinceStartGrowth > 0 ? '+' : ''}
                        {fmtNum(overview.sinceStartGrowth)}
                      </div>
                      <div className="summary-label" title="Chưa đủ 7 ngày dữ liệu — đang hiển thị tổng từ khi bắt đầu theo dõi">
                        followers tăng từ đầu
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="summary-value">—</div>
                      <div className="summary-label" title="Cần ít nhất 2 ngày dữ liệu để tính tăng trưởng">
                        followers tăng/tuần
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Ghi chú khi dữ liệu còn mỏng (chưa đủ để các mốc 7d/30d có nghĩa) */}
          {overview && overview.maxTrackedDays > 0 && overview.maxTrackedDays < 7 && (
            <div className="analytics-thin-data-note">
              <AlertCircle size={14} />
              <span>
                Đang theo dõi {overview.maxTrackedDays} ngày. Các mốc 7d/30d sẽ hiện khi
                tích luỹ đủ dữ liệu — fetch đều mỗi ngày để biểu đồ và tăng trưởng chính xác.
              </span>
            </div>
          )}

          {/* Per-account analytics cards */}
          <div className="account-grid">
            {accountsWithData.map((a) => (
              <AccountAnalyticsCard
                key={a.accountId}
                growth={a}
                expanded={expandedId === a.accountId}
                profileOpen={openMap[a.accountId] === true}
                task={runningMap[a.accountId] ?? null}
                opening={openingId === a.accountId}
                onToggle={() => setExpandedId(expandedId === a.accountId ? null : a.accountId)}
                onDelete={() => handleDeleteAccount(a.accountId, a.accountLabel)}
                onFetched={refresh}
                onOpenX={() => handleOpenX(a)}
                onOpenProfile={() => handleOpenProfile(a)}
              />
            ))}
          </div>

          {/* Tài khoản chưa có data */}
          {accountsNoData.length > 0 && (
            <div className="analytics-no-data-section">
              <p className="muted small">
                {accountsNoData.length} tài khoản chưa có dữ liệu (chưa fetch hoặc không có username X)
              </p>
              <div className="account-grid">
                {accountsNoData.map((a) => (
                  <NoDataAccountCard
                    key={a.accountId}
                    growth={a}
                    profileOpen={openMap[a.accountId] === true}
                    task={runningMap[a.accountId] ?? null}
                    opening={openingId === a.accountId}
                    onFetched={refresh}
                    onOpenX={() => handleOpenX(a)}
                    onOpenProfile={() => handleOpenProfile(a)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---- Card analytics cho 1 tài khoản ----
function AccountAnalyticsCard(props: {
  growth: AccountGrowth
  expanded: boolean
  profileOpen: boolean
  task: RunningTask | null
  opening: boolean
  onToggle: () => void
  onDelete: () => void
  onFetched: () => void | Promise<void>
  onOpenX: () => void
  onOpenProfile: () => void
}): JSX.Element {
  const { growth, expanded, profileOpen, task, opening, onToggle, onDelete, onFetched, onOpenX, onOpenProfile } = props
  const g = growth
  const statusKey = 'logged_in'
  const initial = (g.accountLabel.charAt(0) || '?').toUpperCase()
  const [fetchingOne, setFetchingOne] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Dữ liệu sparkline: followers theo ngày (bỏ null).
  const sparkData = useMemo(() => {
    return g.series.map((s) => s.followers ?? 0).filter((v) => v > 0)
  }, [g.series])

  async function handleFetchOne(): Promise<void> {
    setFetchingOne(true)
    setFetchError(null)
    try {
      const r = await window.aviary.analytics.fetchOne(g.accountId)
      if (!r.ok && !r.skipped) {
        setFetchError(r.error ?? 'Lỗi không xác định')
      }
      await onFetched()
    } catch (e) {
      setFetchError((e as Error).message)
    } finally {
      setFetchingOne(false)
    }
  }

  function MetricRow(props: {
    icon: JSX.Element
    label: string
    current: number | null
    delta1d: { value: number | null; available: boolean }
    delta7d: { value: number | null; available: boolean }
    delta30d: { value: number | null; available: boolean }
  }): JSX.Element {
    const { icon, label, current, delta1d, delta7d, delta30d } = props
    const hint = (period: string, hasData: boolean): string =>
      hasData
        ? `So với ${period}`
        : `Chưa đủ dữ liệu cho mốc ${period} — đang theo dõi ${g.trackedDays} ngày`
    return (
      <div className="analytics-metric-row">
        <span className="metric-icon">{icon}</span>
        <span className="metric-label">{label}</span>
        <span className="metric-value">{fmtNum(current)}</span>
        <div className="metric-deltas">
          <span className="delta-group" title={hint('hôm qua (1 ngày)', delta1d.available)}>
            <span className="delta-label">1d</span>
            <DeltaBadge
              delta={delta1d.value}
              available={delta1d.available}
              unavailableHint={hint('hôm qua (1 ngày)', false)}
            />
          </span>
          <span className="delta-group" title={hint('7 ngày trước', delta7d.available)}>
            <span className="delta-label">7d</span>
            <DeltaBadge
              delta={delta7d.value}
              available={delta7d.available}
              unavailableHint={hint('7 ngày trước', false)}
            />
          </span>
          <span className="delta-group" title={hint('30 ngày trước', delta30d.available)}>
            <span className="delta-label">30d</span>
            <DeltaBadge
              delta={delta30d.value}
              available={delta30d.available}
              unavailableHint={hint('30 ngày trước', false)}
            />
          </span>
        </div>
      </div>
  )
}

  return (
    <div className="account-card analytics-card">
      {/* Header */}
      <div className="account-card-header">
        <span className={`avatar-status ${statusKey}`} title={g.accountLabel}>
          {g.avatarUrl ? (
            <img src={g.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <span className="avatar-fallback">{initial}</span>
          )}
        </span>
        <span className="account-name" title={g.accountLabel}>{g.accountLabel}</span>
        {g.handle && (
          <span className="muted small analytics-card-handle" title={`@${g.handle.replace(/^@/, '')}`}>
            @{g.handle.replace(/^@/, '')}
          </span>
        )}
        <span className="analytics-card-actions">
          <ProfileActions
            handle={g.handle}
            profileOpen={profileOpen}
            task={task}
            opening={opening}
            onOpenX={onOpenX}
            onOpenProfile={onOpenProfile}
          />
          <button
            className="btn icon-only ghost analytics-card-fetch"
            title="Fetch dữ liệu mới nhất cho tài khoản này"
            disabled={fetchingOne || !g.handle}
            onClick={handleFetchOne}
          >
            {fetchingOne ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
          </button>
          <button
            className="btn icon-only ghost analytics-card-delete"
            title="Xoá dữ liệu Analytics của tài khoản này"
            onClick={onDelete}
          >
            <Trash2 size={14} />
          </button>
        </span>
      </div>

      {/* Cảnh báo trạng thái profile — hiển thị ngay trên card để user biết trước khi bấm */}
      <ProfileStateNote profileOpen={profileOpen} task={task} />

      {/* Lỗi fetch riêng cho tài khoản này */}
      {fetchError && (
        <div className="analytics-card-error">
          <AlertCircle size={13} />
          <span>Fetch lỗi: {fetchError}</span>
        </div>
      )}

      {/* Dòng thông tin: đang theo dõi bao lâu + từ ngày nào */}
      <div className="analytics-track-info muted small" title="Số ngày đã có dữ liệu snapshot cho tài khoản này">
        <Clock size={12} />
        {g.trackedDays >= 1 && g.firstDay
          ? `Đang theo dõi ${g.trackedDays} ngày · từ ${fmtDayShort(g.firstDay)}`
          : 'Chưa có dữ liệu theo dõi'}
      </div>

      {/* Metrics */}
      <div className="analytics-metrics">
        <MetricRow
          icon={<UsersIcon size={14} />}
          label="Followers"
          current={g.current.followers}
          delta1d={{ value: g.delta1d.followers, available: g.delta1d.available }}
          delta7d={{ value: g.delta7d.followers, available: g.delta7d.available }}
          delta30d={{ value: g.delta30d.followers, available: g.delta30d.available }}
        />
        <MetricRow
          icon={<UserCheck size={14} />}
          label="Following"
          current={g.current.following}
          delta1d={{ value: g.delta1d.following, available: g.delta1d.available }}
          delta7d={{ value: g.delta7d.following, available: g.delta7d.available }}
          delta30d={{ value: g.delta30d.following, available: g.delta30d.available }}
        />
        <MetricRow
          icon={<FileText size={14} />}
          label="Bài viết"
          current={g.current.posts}
          delta1d={{ value: g.delta1d.posts, available: g.delta1d.available }}
          delta7d={{ value: g.delta7d.posts, available: g.delta7d.available }}
          delta30d={{ value: g.delta30d.posts, available: g.delta30d.available }}
        />
      </div>

      {/* Tổng tăng trưởng từ khi bắt đầu theo dõi (luôn có nghĩa khi >= 2 snapshot) */}
      {g.sinceStart.available && (
        <div className="analytics-since-start" title="Thay đổi so với lần fetch đầu tiên">
          <span className="since-start-label">Từ khi theo dõi:</span>
          <span className="since-start-metric">
            <UsersIcon size={12} />
            <DeltaBadge delta={g.sinceStart.followers} available suffix=" fl" />
          </span>
          <span className="since-start-metric">
            <FileText size={12} />
            <DeltaBadge delta={g.sinceStart.posts} available suffix=" bài" />
          </span>
        </div>
      )}

      {/* Sparkline */}
      <div className="analytics-sparkline-row">
        <span className="muted small">Xu hướng followers (30 ngày)</span>
        <Sparkline data={sparkData} />
      </div>

      {/* Expand button */}
      <button className="analytics-expand-btn" onClick={onToggle}>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {expanded ? 'Thu gọn' : 'Xem biểu đồ chi tiết'}
      </button>

      {/* Expanded chart */}
      {expanded && (
        <div className="analytics-chart-section">
          <GrowthChart series={g.series} />
        </div>
      )}
    </div>
  )
}

// ---- Card cho tài khoản chưa có dữ liệu (có nút fetch riêng) ----
function NoDataAccountCard(props: {
  growth: AccountGrowth
  profileOpen: boolean
  task: RunningTask | null
  opening: boolean
  onFetched: () => void | Promise<void>
  onOpenX: () => void
  onOpenProfile: () => void
}): JSX.Element {
  const { growth, profileOpen, task, opening, onFetched, onOpenX, onOpenProfile } = props
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const initial = (growth.accountLabel.charAt(0) || '?').toUpperCase()

  async function handleFetch(): Promise<void> {
    setFetching(true)
    setError(null)
    try {
      const r = await window.aviary.analytics.fetchOne(growth.accountId)
      if (!r.ok && !r.skipped) setError(r.error ?? 'Lỗi không xác định')
      await onFetched()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setFetching(false)
    }
  }

  return (
    <div className="account-card analytics-no-data-card">
      <div className="account-card-header">
        <span className="avatar-status new">
          <span className="avatar-fallback">{initial}</span>
        </span>
        <span className="account-name" title={growth.accountLabel}>{growth.accountLabel}</span>
        <span className="analytics-card-actions">
          <ProfileActions
            handle={growth.handle}
            profileOpen={profileOpen}
            task={task}
            opening={opening}
            onOpenX={onOpenX}
            onOpenProfile={onOpenProfile}
          />
          <button
            className="btn icon-only ghost analytics-card-fetch"
            title="Fetch dữ liệu cho tài khoản này"
            disabled={fetching || !growth.handle}
            onClick={handleFetch}
          >
            {fetching ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
          </button>
        </span>
      </div>
      <ProfileStateNote profileOpen={profileOpen} task={task} />
      <div className="muted small">
        {growth.handle
          ? `@${growth.handle.replace(/^@/, '')} — bấm ↻ để fetch ngay`
          : 'chưa có username X — không thể fetch'}
      </div>
      {error && (
        <div className="analytics-card-error">
          <AlertCircle size={13} />
          <span>Fetch lỗi: {error}</span>
        </div>
      )}
    </div>
  )
}
