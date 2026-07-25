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
  ZapOff
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

export default function AnalyticsView(): JSX.Element {
  const { confirm } = useUiFeedback()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [storage, setStorage] = useState<AnalyticsStorageStats | null>(null)
  const [fetching, setFetching] = useState(false)
  const [fetchResult, setFetchResult] = useState<AnalyticsFetchResult | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showDeleteMenu, setShowDeleteMenu] = useState(false)
  const [autoFetch, setAutoFetch] = useState(true)
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

  useEffect(() => {
    refresh()
    // Force render mỗi 30s để cập nhật "lần fetch cuối" relative time.
    const iv = setInterval(() => force((n) => n + 1), 30_000)
    // Refresh khi analytics fetch xong (auto hoặc thủ công) → cập nhật delta + series.
    const off = window.aviary.post.onProgress((p) => {
      if (p.stage === 'analytics' && !p.busy) {
        void refresh()
      }
    })
    return () => {
      clearInterval(iv)
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
                onToggle={() => setExpandedId(expandedId === a.accountId ? null : a.accountId)}
                onDelete={() => handleDeleteAccount(a.accountId, a.accountLabel)}
                onFetched={refresh}
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
                    onFetched={refresh}
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
  onToggle: () => void
  onDelete: () => void
  onFetched: () => void | Promise<void>
}): JSX.Element {
  const { growth, expanded, onToggle, onDelete, onFetched } = props
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
        {g.handle && <span className="muted small">@{g.handle.replace(/^@/, '')}</span>}
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
      </div>

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
  onFetched: () => void | Promise<void>
}): JSX.Element {
  const { growth, onFetched } = props
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
        <button
          className="btn icon-only ghost analytics-card-fetch"
          title="Fetch dữ liệu cho tài khoản này"
          disabled={fetching || !growth.handle}
          onClick={handleFetch}
        >
          {fetching ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
        </button>
      </div>
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
