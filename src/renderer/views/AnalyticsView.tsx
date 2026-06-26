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

function fmtRelative(ts: number | null): string {
  if (!ts) return 'chưa fetch'
  const diff = Date.now() - ts
  if (diff < 60_000) return 'vừa xong'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} phút trước`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} giờ trước`
  return new Date(ts).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// Pill hiển thị delta (+12 / -3 / —).
function DeltaBadge({ delta, suffix }: { delta: number | null; suffix?: string }): JSX.Element {
  if (delta === null) return <span className="delta-badge neutral"><Minus size={11} /> —</span>
  if (delta > 0) return <span className="delta-badge up"><TrendingUp size={11} /> +{fmtNum(delta)}{suffix}</span>
  if (delta < 0) return <span className="delta-badge down"><TrendingDown size={11} /> {fmtNum(delta)}{suffix}</span>
  return <span className="delta-badge neutral"><Minus size={11} /> 0</span>
}

export default function AnalyticsView(): JSX.Element {
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
    if (!confirm('Xoá toàn bộ dữ liệu Analytics? Hành động này không thể hoàn tác.')) return
    await window.aviary.analytics.remove()
    setShowDeleteMenu(false)
    await refresh()
  }

  async function handleDeleteAccount(accountId: string, label: string): Promise<void> {
    if (!confirm(`Xoá dữ liệu Analytics của "${label}"?`)) return
    await window.aviary.analytics.remove(accountId)
    await refresh()
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
    const weekFollowersGrowth = data.accounts.reduce((sum, a) => sum + (a.delta7d.followers ?? 0), 0)
    return { totalFollowers, totalFollowing, totalPosts, weekFollowersGrowth, accountCount: data.accounts.length }
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
                  <div className="summary-value">
                    {overview.weekFollowersGrowth > 0 ? '+' : ''}
                    {fmtNum(overview.weekFollowersGrowth)}
                  </div>
                  <div className="summary-label">followers tăng/tuần</div>
                </div>
              </div>
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
    delta1d: number | null
    delta7d: number | null
    delta30d: number | null
  }): JSX.Element {
    const { icon, label, current, delta1d, delta7d, delta30d } = props
    return (
      <div className="analytics-metric-row">
        <span className="metric-icon">{icon}</span>
        <span className="metric-label">{label}</span>
        <span className="metric-value">{fmtNum(current)}</span>
        <div className="metric-deltas">
          <span className="delta-group" title="So với dữ liệu gần nhất (trong ngày)">
            <span className="delta-label">1d</span>
            <DeltaBadge delta={delta1d} />
          </span>
          <span className="delta-group" title="So với 7 ngày trước">
            <span className="delta-label">7d</span>
            <DeltaBadge delta={delta7d} />
          </span>
          <span className="delta-group" title="So với 30 ngày trước">
            <span className="delta-label">30d</span>
            <DeltaBadge delta={delta30d} />
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

      {/* Metrics */}
      <div className="analytics-metrics">
        <MetricRow
          icon={<UsersIcon size={14} />}
          label="Followers"
          current={g.current.followers}
          delta1d={g.delta1d.followers}
          delta7d={g.delta7d.followers}
          delta30d={g.delta30d.followers}
        />
        <MetricRow
          icon={<UserCheck size={14} />}
          label="Following"
          current={g.current.following}
          delta1d={g.delta1d.following}
          delta7d={g.delta7d.following}
          delta30d={g.delta30d.following}
        />
        <MetricRow
          icon={<FileText size={14} />}
          label="Bài viết"
          current={g.current.posts}
          delta1d={g.delta1d.posts}
          delta7d={g.delta7d.posts}
          delta30d={g.delta30d.posts}
        />
      </div>

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
