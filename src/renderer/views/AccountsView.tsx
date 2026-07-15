import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import {
  Plus,
  Pencil,
  Trash2,
  Power,
  PowerOff,
  Send,
  Loader2,
  ExternalLink,
  UserPlus,
  Zap,
  CheckCircle2,
  XCircle,
  Globe,
  X,
  Clock,
  Eye,
  EyeOff,
  ExternalLink as ExternalLinkIcon,
  MoreVertical,
  Users as UsersIcon,
  UserCheck,
  FileText,
  Search,
  AlertTriangle,
  AlertCircle
} from 'lucide-react'
import type { Account, AccountInput, AccountActivity, AccountHealth, Proxy, Schedule, WebhookTestResult, XProfileInfo } from '@shared/types'
import { PROXY_LOCAL, PROXY_RANDOM } from '@shared/types'

const STATUS_LABEL: Record<Account['status'], string> = {
  new: 'Mới',
  logged_in: 'Đã đăng nhập',
  checkpoint: 'Checkpoint',
  banned: 'Bị khóa',
  disabled: 'Tắt'
}

// Nhãn loại hoạt động hiển thị ở dòng "Hoạt động gần nhất".
const KIND_LABEL: Record<string, string> = {
  post: 'Đăng bài',
  delete: 'Xoá bài',
  comment: 'Bình luận',
  interact: 'Tương tác'
}

// Thời gian đã trôi kể từ mốc ts tới hiện tại, dạng ngắn gọn (s/m/h/d).
function timeSince(ts: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - ts) / 1000))
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  return `${Math.floor(hr / 24)}d`
}

export default function AccountsView(props: {
  onNavigateToLogs?: (accountId: string, accountLabel: string) => void
}): JSX.Element {
  const { onNavigateToLogs } = props
  const [accounts, setAccounts] = useState<Account[]>([])
  const [proxies, setProxies] = useState<Proxy[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  // Hoạt động gần nhất + sức khoẻ mỗi tài khoản (map theo accountId), lấy realtime từ nhật ký.
  const [activityMap, setActivityMap] = useState<Record<string, AccountActivity>>({})
  // Nhịp đồng hồ (ms) để dòng "(Ns)" tự đếm lên mỗi giây mà không cần fetch lại.
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [posting, setPosting] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [proxyBusy, setProxyBusy] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ accountId: string; result: WebhookTestResult } | null>(
    null
  )
  // Tài khoản đang chạy tác vụ (đăng/lịch...) — theo dõi qua onProgress để cảnh báo khi đóng.
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set())
  // Tài khoản đang chờ xác nhận đóng (vì đang chạy tác vụ). null = không có modal.
  const [confirmClose, setConfirmClose] = useState<Account | null>(null)
  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [showBulkProxy, setShowBulkProxy] = useState(false)
  // Tìm kiếm + lọc
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [tagFilters, setTagFilters] = useState<Set<'scheduled' | 'headless'>>(new Set())
  // Lọc theo sức khoẻ tài khoản (từ activityMap): 'all' | 'ok' | 'error' | 'abnormal'.
  const [healthFilter, setHealthFilter] = useState<string>('all')

  const refresh = useCallback(async () => {
    const [list, proxList, schedList, activity] = await Promise.all([
      window.aviary.accounts.list(),
      window.aviary.proxies.list(),
      window.aviary.schedules.list(),
      window.aviary.accounts.activity()
    ])
    setAccounts(list)
    setProxies(proxList)
    setSchedules(schedList)
    setActivityMap(Object.fromEntries(activity.map((a) => [a.accountId, a])))
    const entries = await Promise.all(
      list.map(async (a) => [a.id, (await window.aviary.browser.status(a.id)).open] as const)
    )
    setOpenMap(Object.fromEntries(entries))
  }, [])

  // Chỉ tải lại hoạt động + sức khoẻ (nhẹ hơn refresh đầy đủ) — gọi khi có tác vụ hoàn thành.
  const refreshActivity = useCallback(async () => {
    const activity = await window.aviary.accounts.activity()
    setActivityMap(Object.fromEntries(activity.map((a) => [a.accountId, a])))
  }, [])

  useEffect(() => {
    refresh()
    // #1: cập nhật realtime khi user đóng cửa sổ browser thủ công.
    const off = window.aviary.browser.onStatusChanged((accountId, open) => {
      setOpenMap((m) => ({ ...m, [accountId]: open }))
    })
    // #2: theo dõi tài khoản nào đang chạy tác vụ (busy) để cảnh báo trước khi đóng.
    const offProgress = window.aviary.post.onProgress((p) => {
      if (!p.accountId || p.accountId === '__system__') return
      const id = p.accountId
      // Tác vụ vừa hoàn thành (busy -> false) -> tải lại hoạt động gần nhất realtime.
      if (!p.busy) void refreshActivity()
      setRunningIds((prev) => {
        const has = prev.has(id)
        if (p.busy === has) return prev // không đổi -> giữ nguyên reference
        const next = new Set(prev)
        if (p.busy) next.add(id)
        else next.delete(id)
        return next
      })
    })
    return () => {
      off()
      offProgress()
    }
  }, [refresh, refreshActivity])

  // Đồng hồ 1s để dòng "(Ns)" tự đếm lên (thời gian kể từ hoạt động gần nhất).
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Khi danh sách account thay đổi (xoá...), xoá selectedIds không còn tồn tại.
  useEffect(() => {
    setSelectedIds((prev) => {
      const next = new Set<string>()
      for (const id of prev) {
        if (accounts.some((a) => a.id === id)) next.add(id)
      }
      return next.size === prev.size ? prev : next
    })
  }, [accounts])

  async function handleOpen(a: Account): Promise<void> {
    setBusy(a.id)
    try {
      await window.aviary.browser.open(a.id)
      await refresh()
    } catch (e) {
      alert('Không mở được profile: ' + (e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  // Bấm Đóng: nếu tài khoản đang chạy tác vụ -> mở modal xác nhận; ngược lại đóng luôn.
  function requestClose(a: Account): void {
    if (runningIds.has(a.id)) {
      setConfirmClose(a)
      return
    }
    void handleClose(a)
  }

  async function handleClose(a: Account): Promise<void> {
    setConfirmClose(null)
    setBusy(a.id)
    try {
      await window.aviary.browser.close(a.id)
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  async function handleDelete(a: Account): Promise<void> {
    if (!confirm(`Xóa tài khoản "${a.label}"? Profile, session, lịch và nhật ký sẽ bị xoá hết.`)) return
    await window.aviary.accounts.remove(a.id)
    await refresh()
  }

  async function handlePostNow(a: Account): Promise<void> {
    if (!confirm(`Đăng bài cho "${a.label}"? Nếu profile chưa mở sẽ tự mở (chạy ngầm nếu đã bật).`))
      return
    setPosting(a.id)
    try {
      await window.aviary.post.runNow(a.id)
      // Kết quả hiển thị trong Nhật ký + thanh trạng thái, không còn popup.
    } catch (e) {
      alert('Đăng bài lỗi: ' + (e as Error).message)
    } finally {
      setPosting(null)
    }
  }

  // Test webhook kèm accountId + assetUrl của profile này để n8n nhận đúng asset.
  async function handleTestWebhook(a: Account): Promise<void> {
    setTesting(a.id)
    setTestResult(null)
    try {
      const result = await window.aviary.webhook.test(a.id)
      setTestResult({ accountId: a.id, result })
    } catch (e) {
      setTestResult({ accountId: a.id, result: { ok: false, error: (e as Error).message } })
    } finally {
      setTesting(null)
    }
  }

  // Đổi proxy ngay tại dòng (Local / Random / proxy cụ thể) -> lưu tức thì, không cần Sửa.
  async function handleProxyChange(a: Account, nextProxyId: string): Promise<void> {
    if (nextProxyId === a.proxyId) return
    setProxyBusy(a.id)
    try {
      await window.aviary.accounts.update(a.id, { proxyId: nextProxyId })
      await refresh()
    } catch (e) {
      alert('Đổi proxy lỗi: ' + (e as Error).message)
    } finally {
      setProxyBusy(null)
    }
  }

  // Bật/tắt nhanh chế độ chạy ngầm (headless) ngay tại dòng — lưu tức thì, không cần mở Sửa.
  // Lưu ý: thay đổi chỉ áp dụng cho lần MỞ profile kế tiếp; profile đang mở không đổi chế độ.
  async function handleToggleHeadless(a: Account): Promise<void> {
    setBusy(a.id)
    try {
      await window.aviary.accounts.update(a.id, { headless: !a.headless })
      await refresh()
    } catch (e) {
      alert('Đổi chế độ chạy ngầm lỗi: ' + (e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  // ---- Bulk actions ----
  function toggleSelect(id: string): void {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll(): void {
    if (filteredAccounts.length > 0 && selectedIds.size === filteredAccounts.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredAccounts.map((a) => a.id)))
    }
  }

  async function handleBulkOpen(): Promise<void> {
    setBulkBusy(true)
    const ids = [...selectedIds]
    // Mở TẤT CẢ profile đã tick song song, không giới hạn đồng thời.
    const results = await Promise.allSettled(ids.map((id) => window.aviary.browser.open(id)))
    const errors = results.filter((r) => r.status === 'rejected').length
    await refresh()
    setBulkBusy(false)
    if (errors > 0) alert(`Đã mở ${ids.length - errors}/${ids.length} profile. ${errors} lỗi.`)
  }

  async function handleBulkDelete(): Promise<void> {
    const count = selectedIds.size
    if (!confirm(`Xóa ${count} tài khoản đã chọn? Profile, session, lịch và nhật ký sẽ bị xoá hết.`)) return
    setBulkBusy(true)
    for (const id of selectedIds) {
      await window.aviary.accounts.remove(id).catch(() => {})
    }
    setSelectedIds(new Set())
    await refresh()
    setBulkBusy(false)
  }

  // ---- Tìm kiếm + lọc đa chức năng ----
  // Text search: tìm trên tên (label), username (handle), hashtag — không phân biệt hoa thường.
  // Status filter: lọc theo trạng thái tài khoản (single-select chip).
  // Tag filter: lọc theo nhãn "Lên lịch" / "Ngầm" (multi-select chip, kết hợp AND).
  const filteredAccounts = useMemo(() => {
    const q = query.trim().toLowerCase()
    return accounts.filter((a) => {
      if (q) {
        const haystack = [a.label, a.handle ?? '', a.hashtag ?? ''].join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      if (statusFilter !== 'all') {
        if (statusFilter === 'open') {
          if (!openMap[a.id]) return false
        } else if (a.status !== statusFilter) {
          return false
        }
      }
      if (tagFilters.has('scheduled')) {
        const hasSched = schedules.some((s) => s.accountId === a.id && s.enabled)
        if (!hasSched) return false
      }
      if (tagFilters.has('headless') && !a.headless) return false
      if (healthFilter !== 'all') {
        const h = activityMap[a.id]?.health ?? 'ok'
        if (h !== healthFilter) return false
      }
      return true
    })
  }, [accounts, query, statusFilter, tagFilters, healthFilter, openMap, schedules, activityMap])

  const isFiltering =
    query.trim() !== '' || statusFilter !== 'all' || tagFilters.size > 0 || healthFilter !== 'all'

  function toggleTagFilter(tag: 'scheduled' | 'headless'): void {
    setTagFilters((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  function clearFilters(): void {
    setQuery('')
    setStatusFilter('all')
    setTagFilters(new Set())
    setHealthFilter('all')
  }

  // Số lượng tài khoản theo từng mức sức khoẻ (cho badge trên chip lọc).
  const healthCounts = useMemo(() => {
    const c = { ok: 0, error: 0, abnormal: 0 }
    for (const a of accounts) {
      const h = activityMap[a.id]?.health ?? 'ok'
      c[h]++
    }
    return c
  }, [accounts, activityMap])

  const hasSelection = selectedIds.size > 0
  const allSelected = filteredAccounts.length > 0 && selectedIds.size === filteredAccounts.length

  return (
    <div className="view">
      <div className="toolbar">
        <button
          className="btn primary"
          onClick={() => {
            setEditing(null)
            setShowForm(true)
          }}
        >
          <Plus size={16} />
          Thêm tài khoản
        </button>

        {/* Ô tìm kiếm — tìm trên tên, username, hashtag */}
        <div className="search-box">
          <Search size={15} className="search-icon" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm theo tên, @username, hashtag…"
            spellCheck={false}
          />
          {query && (
            <button
              className="search-clear"
              title="Xoá từ khoá"
              onClick={() => setQuery('')}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <span className="badge count-badge">
          {isFiltering ? `${filteredAccounts.length}/${accounts.length}` : accounts.length} tài khoản
        </span>

        {filteredAccounts.length > 0 && (
          <label className="select-all-check">
            <input
              type="checkbox"
              ref={(el) => {
                if (el) el.indeterminate = hasSelection && !allSelected
              }}
              checked={allSelected}
              onChange={toggleSelectAll}
            />
            <span className="small muted">Chọn tất cả</span>
          </label>
        )}

        {hasSelection && (
          <>
            <span className="bulk-sep" />
            <span className="badge selected-badge">Đã chọn {selectedIds.size}</span>
            <button
              className="btn icon-label"
              disabled={bulkBusy}
              onClick={handleBulkOpen}
              title={`Mở ${selectedIds.size} profile (headful)`}
            >
              {bulkBusy ? <Loader2 size={15} className="spin" /> : <Power size={15} />}
              Mở Profile
            </button>
            <button
              className="btn icon-label"
              disabled={bulkBusy}
              onClick={() => setShowBulkProxy(true)}
              title={`Đổi proxy cho ${selectedIds.size} tài khoản`}
            >
              <Globe size={15} />
              Set Proxy
            </button>
            <button
              className="btn icon-label danger"
              disabled={bulkBusy}
              onClick={handleBulkDelete}
              title={`Xoá ${selectedIds.size} tài khoản`}
            >
              <Trash2 size={15} />
              Xoá
            </button>
            <button
              className="btn icon-only ghost"
              title="Bỏ chọn tất cả"
              onClick={() => setSelectedIds(new Set())}
            >
              <X size={16} />
            </button>
          </>
        )}
      </div>

      {/* Hàng lọc nhanh — chips theo trạng thái + nhãn */}
      {accounts.length > 0 && (
        <div className="filter-bar">
          <div className="filter-chips">
            <span className="filter-label">Trạng thái:</span>
            <FilterChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>
              Tất cả
            </FilterChip>
            <FilterChip active={statusFilter === 'open'} onClick={() => setStatusFilter('open')}>
              Đang mở
            </FilterChip>
            {(Object.keys(STATUS_LABEL) as Account['status'][]).map((st) => (
              <FilterChip key={st} active={statusFilter === st} onClick={() => setStatusFilter(st)}>
                {STATUS_LABEL[st]}
              </FilterChip>
            ))}
          </div>
          <div className="filter-chips">
            <span className="filter-label">Sức khoẻ:</span>
            <FilterChip active={healthFilter === 'all'} onClick={() => setHealthFilter('all')}>
              Tất cả
            </FilterChip>
            <FilterChip active={healthFilter === 'ok'} onClick={() => setHealthFilter('ok')}>
              <CheckCircle2 size={12} className="chip-ico-ok" /> Bình thường ({healthCounts.ok})
            </FilterChip>
            <FilterChip active={healthFilter === 'error'} onClick={() => setHealthFilter('error')}>
              <AlertCircle size={12} className="chip-ico-error" /> Lỗi ({healthCounts.error})
            </FilterChip>
            <FilterChip
              active={healthFilter === 'abnormal'}
              onClick={() => setHealthFilter('abnormal')}
            >
              <AlertTriangle size={12} className="chip-ico-abnormal" /> Bất thường ({healthCounts.abnormal})
            </FilterChip>
          </div>
          <div className="filter-chips">
            <span className="filter-label">Nhãn:</span>
            <FilterChip
              active={tagFilters.has('scheduled')}
              onClick={() => toggleTagFilter('scheduled')}
            >
              <Clock size={12} /> Lên lịch
            </FilterChip>
            <FilterChip
              active={tagFilters.has('headless')}
              onClick={() => toggleTagFilter('headless')}
            >
              <EyeOff size={12} /> Ngầm
            </FilterChip>
            {isFiltering && (
              <button className="filter-clear" onClick={clearFilters}>
                <X size={13} /> Xoá lọc
              </button>
            )}
          </div>
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="empty-state">
          <UserPlus size={36} />
          <p>Chưa có tài khoản nào</p>
          <span>Bấm "Thêm tài khoản" để bắt đầu.</span>
        </div>
      ) : filteredAccounts.length === 0 ? (
        <div className="empty-state">
          <Search size={36} />
          <p>Không tìm thấy tài khoản</p>
          <span>Thử đổi từ khoá hoặc xoá bộ lọc.</span>
          <button className="btn" onClick={clearFilters} style={{ marginTop: 12 }}>
            <X size={15} /> Xoá lọc
          </button>
        </div>
      ) : (
        <div className="account-grid">
          {filteredAccounts.map((a) => {
            const isOpen = openMap[a.id]
            const proxyMissing =
              a.proxyId !== PROXY_LOCAL &&
              a.proxyId !== PROXY_RANDOM &&
              !proxies.some((p) => p.id === a.proxyId)
            const isSelected = selectedIds.has(a.id)
            const hasEnabledSchedule = schedules.some((s) => s.accountId === a.id && s.enabled)
            const hasStats =
              a.followers !== null || a.following !== null || a.statusesCount !== null
            const isBusy = busy === a.id
            const statusKey = isOpen ? 'open' : a.status
            const initial = a.label.trim().charAt(0).toUpperCase() || '?'
            const act = activityMap[a.id]
            const health = act?.health ?? 'ok'
            return (
              <div
                key={a.id}
                className={`account-card health-${health}${isSelected ? ' row-selected' : ''}`}
              >
                {/* ---- Header: checkbox + avatar + tên + menu ---- */}
                <div className="account-card-header">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(a.id)}
                  />
                  <span
                    className={`avatar-status ${statusKey}`}
                    title={isOpen ? 'Đang mở' : STATUS_LABEL[a.status]}
                  >
                    {a.avatarUrl ? (
                      <img src={a.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="avatar-fallback">{initial}</span>
                    )}
                  </span>
                  <span className="account-name" title={a.label}>{a.label}</span>
                  <HealthBadge health={act?.health ?? 'ok'} reason={act?.reason ?? null} />
                  {/* Nút nhanh ngoài card: chạy ngầm + test webhook (icon + tooltip) */}
                  <div className="card-quick-actions">
                    <button
                      className={`btn icon-only ghost${a.headless ? ' active' : ''}`}
                      title={
                        a.headless
                          ? 'Đang chạy ngầm — bấm để hiện cửa sổ (lần mở kế tiếp)'
                          : 'Đang hiện cửa sổ — bấm để chạy ngầm (lần mở kế tiếp)'
                      }
                      disabled={isBusy}
                      onClick={() => handleToggleHeadless(a)}
                    >
                      {a.headless ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                    <button
                      className="btn icon-only ghost"
                      title="Test webhook (gửi kèm assetUrl của profile)"
                      disabled={testing === a.id}
                      onClick={() => handleTestWebhook(a)}
                    >
                      {testing === a.id ? <Loader2 size={15} className="spin" /> : <Zap size={15} />}
                    </button>
                  </div>
                  <ActionMenu
                    items={[
                      {
                        icon: <Pencil size={15} />,
                        label: 'Sửa',
                        title: 'Sửa tài khoản',
                        onClick: () => {
                          setEditing(a)
                          setShowForm(true)
                        }
                      },
                      {
                        icon: <Trash2 size={15} />,
                        label: 'Xoá',
                        title: 'Xoá tài khoản',
                        danger: true,
                        onClick: () => handleDelete(a)
                      }
                    ]}
                  />
                </div>

                {/* ---- Thông tin phụ: handle + badges ---- */}
                <div className="account-card-sub">
                  {a.handle ? (
                    <span className="username-cell">
                      <span className="muted small">@{a.handle.replace(/^@/, '')}</span>
                      <button
                        className="btn icon-only ghost x-link"
                        title={`Mở x.com/${a.handle.replace(/^@/, '')}`}
                        onClick={() =>
                          window.open(`https://x.com/${(a.handle ?? '').replace(/^@/, '')}`, '_blank')
                        }
                      >
                        <ExternalLinkIcon size={13} />
                      </button>
                    </span>
                  ) : (
                    <span className="muted small">chưa có username</span>
                  )}
                  <span className={`badge badge-sm ${isOpen ? 'on' : `st-${a.status}`}`}>
                    <span className="dot" />
                    {isOpen ? 'Đang mở' : STATUS_LABEL[a.status]}
                  </span>
                </div>

                {(hasEnabledSchedule || a.headless || a.hashtag) && (
                  <div className="row-tags">
                    {hasEnabledSchedule && (
                      <span className="badge-mini schedule-mini" title="Tài khoản đang được lên lịch chạy">
                        <Clock size={11} /> Lên lịch
                      </span>
                    )}
                    {a.headless && <span className="badge-mini" title="Chế độ chạy ngầm (ẩn cửa sổ browser)">Ngầm</span>}
                    {a.hashtag && (
                      <span className="badge-mini hashtag-mini" title={`Hashtag tự chèn: ${a.hashtag}`}>
                        {a.hashtag}
                      </span>
                    )}
                  </div>
                )}

                {/* ---- Thống kê X với icon + tooltip ---- */}
                {hasStats ? (
                  <div className="account-stats">
                    <span className="stat-item stat-followers-icon" title="Followers — người theo dõi">
                      <UsersIcon size={14} />
                      {a.followers === null ? '—' : a.followers.toLocaleString()}
                    </span>
                    <span className="stat-sep">·</span>
                    <span className="stat-item stat-following-icon" title="Following — đang theo dõi">
                      <UserCheck size={14} />
                      {a.following === null ? '—' : a.following.toLocaleString()}
                    </span>
                    <span className="stat-sep">·</span>
                    <span className="stat-item stat-posts-icon" title="Bài viết — tổng số tweet">
                      <FileText size={14} />
                      {a.statusesCount === null ? '—' : a.statusesCount.toLocaleString()}
                    </span>
                  </div>
                ) : (
                  <div className="account-stats muted small">chưa có thống kê X</div>
                )}

                {/* ---- Proxy ---- */}
                <div className="account-proxy-row">
                  <span className="small muted proxy-label">Proxy</span>
                  <select
                    className="proxy-select"
                    value={a.proxyId}
                    disabled={proxyBusy === a.id}
                    title={
                      proxyMissing
                        ? 'Proxy đã bị xoá khỏi kho — chọn lại Local/Random/proxy khác'
                        : 'Đổi proxy cho tài khoản'
                    }
                    onChange={(e) => handleProxyChange(a, e.target.value)}
                  >
                    <option value={PROXY_LOCAL}>Local (IP máy)</option>
                    <option value={PROXY_RANDOM}>
                      Random{proxies.length === 0 ? ' (chưa có proxy)' : ''}
                    </option>
                    {proxies.length > 0 && (
                      <optgroup label="Proxy đã thêm">
                        {proxies.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                            {p.kind ? ` (${p.kind})` : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {proxyMissing && (
                      <option value={a.proxyId} disabled>
                        {`(đã xoá) ${a.proxyId}`}
                      </option>
                    )}
                  </select>
                </div>

                {/* ---- Hoạt động gần nhất (realtime từ Nhật ký) — bấm để mở Nhật ký lọc theo tài khoản ---- */}
                <button
                  className="account-activity"
                  title="Xem nhật ký của tài khoản này"
                  onClick={() => onNavigateToLogs?.(a.id, a.label)}
                >
                  {act?.last ? (
                    <span className={`activity-text ${act.last.ok ? 'ok' : 'fail'}`}>
                      {act.last.ok ? 'Thành công' : 'Lỗi'}: {KIND_LABEL[act.last.kind] ?? act.last.kind}{' '}
                      <span className="activity-ago">({timeSince(act.last.ts, nowTick)})</span>
                    </span>
                  ) : (
                    <span className="activity-text muted">Chưa có hoạt động</span>
                  )}
                </button>

                {/* ---- Actions chính: Mở/Đóng + Đăng ---- */}
                <div className="account-actions">
                  <button
                    className={`btn icon-label ${isOpen ? 'danger' : 'accent'}`}
                    title={isOpen ? 'Đóng profile' : 'Mở profile'}
                    disabled={isBusy}
                    onClick={() => (isOpen ? requestClose(a) : handleOpen(a))}
                  >
                    {isBusy ? (
                      <Loader2 size={15} className="spin" />
                    ) : isOpen ? (
                      <PowerOff size={15} />
                    ) : (
                      <Power size={15} />
                    )}
                    {isOpen ? 'Đóng' : 'Mở profile'}
                  </button>
                  <button
                    className="btn icon-label primary"
                    title="Đăng bài (tự mở profile nếu chưa mở)"
                    disabled={posting === a.id}
                    onClick={() => handlePostNow(a)}
                  >
                    {posting === a.id ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
                    Đăng bài
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showForm && (
        <AccountForm
          account={editing}
          onClose={() => setShowForm(false)}
          onSaved={async () => {
            setShowForm(false)
            await refresh()
          }}
        />
      )}

      {testResult && (
        <WebhookTestModal result={testResult.result} onClose={() => setTestResult(null)} />
      )}

      {showBulkProxy && (
        <BulkSetProxyModal
          proxies={proxies}
          selectedCount={selectedIds.size}
          onApply={async (proxyId) => {
            setBulkBusy(true)
            let ok = 0
            for (const id of selectedIds) {
              try {
                await window.aviary.accounts.update(id, { proxyId })
                ok++
              } catch {
                /* bỏ qua lỗi từng account */
              }
            }
            await refresh()
            setBulkBusy(false)
            setShowBulkProxy(false)
            if (ok < selectedIds.size) {
              alert(`Đã cập nhật ${ok}/${selectedIds.size} tài khoản.`)
            }
          }}
          onClose={() => setShowBulkProxy(false)}
        />
      )}

      {confirmClose && (
        <ConfirmCloseModal
          account={confirmClose}
          onCancel={() => setConfirmClose(null)}
          onConfirm={() => handleClose(confirmClose)}
        />
      )}
    </div>
  )
}

// Modal xác nhận đóng profile khi tài khoản ĐANG CHẠY tác vụ (đăng/lịch/tương tác). Đóng giữa
// chừng sẽ hủy tác vụ đang chạy -> cần user xác nhận. Design đồng bộ modal chung của app.
function ConfirmCloseModal(props: {
  account: Account
  onCancel: () => void
  onConfirm: () => void
}): JSX.Element {
  const { account, onCancel, onConfirm } = props
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-head">
          <span className="confirm-icon warn">
            <AlertTriangle size={20} />
          </span>
          <h2>Đóng khi đang chạy tác vụ?</h2>
        </div>
        <p className="hint">
          Tài khoản <b>{account.label}</b> đang thực hiện một tác vụ (đăng bài / lịch / tương tác).
          Đóng profile ngay bây giờ sẽ <b>hủy tác vụ đang chạy</b> giữa chừng.
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            Để tiếp tục
          </button>
          <button className="btn danger" onClick={onConfirm}>
            <PowerOff size={15} />
            Đóng ngay
          </button>
        </div>
      </div>
    </div>
  )
}

function AccountForm(props: {
  account: Account | null
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const { account, onClose, onSaved } = props
  const [label, setLabel] = useState(account?.label ?? '')
  const [handle, setHandle] = useState(account?.handle ?? '')
  const [proxyId, setProxyId] = useState(account?.proxyId ?? PROXY_LOCAL)
  const [proxies, setProxies] = useState<Proxy[]>([])
  const [assetUrl, setAssetUrl] = useState(account?.assetUrl ?? '')
  const [hashtag, setHashtag] = useState(account?.hashtag ?? '')
  const [captionPrefix, setCaptionPrefix] = useState(account?.captionPrefix ?? '')
  const [aiCommentTone, setAiCommentTone] = useState(account?.aiCommentTone ?? 'random')
  const [aiCommentLang, setAiCommentLang] = useState(account?.aiCommentLang ?? 'en')
  const [aiCommentFormat, setAiCommentFormat] = useState(account?.aiCommentFormat ?? 'random')
  const [headless, setHeadless] = useState(account?.headless ?? false)
  const [saving, setSaving] = useState(false)
  // Thông tin X tự fetch từ username.
  const [xInfo, setXInfo] = useState<XProfileInfo | null>(null)
  const [xFetching, setXFetching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Tải kho proxy để đổ vào dropdown (Local / Random / từng proxy).
  useEffect(() => {
    window.aviary.proxies.list().then(setProxies).catch(() => setProxies([]))
  }, [])

  // Tự động tra cứu X khi username đổi (debounce 600ms). KHÔNG watch label để tránh loop:
  // setLabel(info.name) không kích hoạt lại effect. Auto-fill Nhãn chỉ khi đang trống.
  useEffect(() => {
    const username = handle.trim().replace(/^@+/, '')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!username) {
      setXInfo(null)
      setXFetching(false)
      return
    }
    setXFetching(true)
    debounceRef.current = setTimeout(() => {
      window.aviary.accounts
        .lookup(username, account?.id)
        .then((info) => {
          setXInfo(info)
          // Luôn cập nhật Nhãn theo tên hiển thị X trả về.
          if (info.name) setLabel(info.name)
        })
        .catch(() => setXInfo(null))
        .finally(() => setXFetching(false))
    }, 600)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle])

  async function save(): Promise<void> {
    if (!label.trim()) {
      alert('Nhãn không được để trống')
      return
    }
    setSaving(true)
    const input: AccountInput = {
      label: label.trim(),
      handle: handle.trim() || null,
      proxyId,
      assetUrl: assetUrl.trim() || null,
      hashtag: hashtag.trim() || null,
      captionPrefix: captionPrefix || null,
      aiCommentTone,
      aiCommentLang,
      aiCommentFormat,
      headless
    }
    try {
      if (account) await window.aviary.accounts.update(account.id, input)
      else await window.aviary.accounts.create(input)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{account ? 'Sửa tài khoản' : 'Thêm tài khoản'}</h2>
        <label className="field">
          <span>Nhãn *</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="VD: Acc chính"
            autoFocus
          />
        </label>
        <label className="field">
          <span>Username (X)</span>
          <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="vd: myhandle" />
        </label>
        {xFetching && (
          <p className="hint" style={{ marginTop: -4 }}>
            <Loader2 size={13} className="spin" /> Đang lấy thông tin X…
          </p>
        )}
        {!xFetching && xInfo && !xInfo.error && (
          <div className="row-tags" style={{ marginTop: -4, marginBottom: 4 }}>
            {[
              ['Followers', xInfo.followers],
              ['Following', xInfo.following],
              ['Bài viết', xInfo.posts]
            ].map(([t, v]) => (
              <span key={t} className="badge-mini">
                {t}: {v === null || v === undefined ? '—' : Number(v).toLocaleString()}
              </span>
            ))}
            {xInfo.name && <span className="badge-mini">Tên: {xInfo.name}</span>}
          </div>
        )}
        {!xFetching && xInfo?.error && (
          <p className="test-result fail" style={{ marginTop: -4, marginBottom: 4 }}>
            Không lấy được thông tin X: {xInfo.error}
          </p>
        )}
        <label className="field">
          <span>Proxy</span>
          <select value={proxyId} onChange={(e) => setProxyId(e.target.value)}>
            <option value={PROXY_LOCAL}>Local (IP máy)</option>
            <option value={PROXY_RANDOM}>Random (mỗi lần chạy lấy ngẫu nhiên)</option>
            {proxies.length > 0 && (
              <optgroup label="Proxy đã thêm">
                {proxies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.kind ? ` (${p.kind})` : ''}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {proxyId === PROXY_RANDOM && proxies.length === 0 && (
            <p className="hint">
              Chưa có proxy nào trong tab Proxy — Random sẽ giống Local (IP máy). Hãy thêm
              proxy ở tab Proxy trước.
            </p>
          )}
        </label>
        <label className="field">
          <span>Link Google Sheet (danh sách link Reddit cho tài khoản này)</span>
          <input
            value={assetUrl}
            onChange={(e) => setAssetUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
          />
        </label>
        <label className="field">
          <span>Tiền tố caption (tự chèn vào ĐẦU caption khi đăng — không gửi vào webhook). Hỗ trợ escape: \n, \t, \\</span>
          <input
            value={captionPrefix}
            onChange={(e) => setCaptionPrefix(e.target.value)}
            placeholder="VD: 🔥 Bài viết hấp dẫn:  hoặc  [HOT]\n  — để trống nếu không dùng"
          />
        </label>
        <label className="field">
          <span>Hashtag (tự chèn vào cuối caption khi đăng — không gửi vào webhook)</span>
          <input
            value={hashtag}
            onChange={(e) => setHashtag(e.target.value)}
            placeholder="VD: f1, vietnam, funny — có thể nhập không cần dấu #"
          />
        </label>
        <label className="field">
          <span>Giọng điệu bình luận AI (tác vụ Tương tác feed)</span>
          <select value={aiCommentTone} onChange={(e) => setAiCommentTone(e.target.value)}>
            <option value="random">Ngẫu nhiên</option>
            <option value="friendly">Thân thiện</option>
            <option value="humorous">Hài hước</option>
            <option value="neutral">Trung lập</option>
            <option value="concise">Ngắn gọn</option>
          </select>
        </label>
        <label className="field">
          <span>Ngôn ngữ bình luận AI</span>
          <select value={aiCommentLang} onChange={(e) => setAiCommentLang(e.target.value)}>
            <option value="auto">Theo ngôn ngữ bài viết (không lọc)</option>
            <option value="vi">Tiếng Việt</option>
            <option value="en">Tiếng Anh</option>
          </select>
          <small className="hint">
            Cũng dùng để LỌC bài khi tương tác (feed): chọn Việt/Anh thì chỉ like &amp; bình luận
            bài đúng ngôn ngữ đó, bỏ qua bài tiếng khác (Nhật, Indo…). Chọn "Theo ngôn ngữ bài viết"
            = tương tác mọi ngôn ngữ như cũ.
          </small>
        </label>
        <label className="field">
          <span>Định dạng bình luận AI</span>
          <select value={aiCommentFormat} onChange={(e) => setAiCommentFormat(e.target.value)}>
            <option value="random">Ngẫu nhiên</option>
            <option value="normal">Bình thường</option>
            <option value="question">Câu hỏi</option>
            <option value="debate">Tranh luận</option>
            <option value="info">Thông tin</option>
          </select>
          <small className="hint">
            "Ngẫu nhiên" sẽ bốc lại cho mỗi bình luận. Độ dài tối đa cấu hình chung ở tab Cài đặt.
          </small>
        </label>
        <label className="field checkbox-field">
          <input
            type="checkbox"
            checked={headless}
            onChange={(e) => setHeadless(e.target.checked)}
          />
          <span>Chạy ngầm (ẩn cửa sổ browser, khó bị phát hiện)</span>
        </label>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Hủy
          </button>
          <button className="btn primary" disabled={saving} onClick={save}>
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  )
}

function WebhookTestModal(props: { result: WebhookTestResult; onClose: () => void }): JSX.Element {
  const { result, onClose } = props
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal webhook-result-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Kết quả test webhook</h2>
        {result.ok ? (
          <>
            <div className="webhook-status-banner ok">
              <CheckCircle2 size={20} />
              <span>OK · HTTP {result.status}</span>
            </div>
            <div className="webhook-detail-rows">
              <div className="webhook-detail-row">
                <span className="webhook-detail-label">Caption</span>
                <span className="webhook-detail-value">{result.caption || <em>(rỗng)</em>}</span>
              </div>
              <div className="webhook-detail-row">
                <span className="webhook-detail-label">Phát hiện</span>
                <span className="webhook-detail-value">
                  {result.assetCount ?? 0} asset{result.hasAudioMerge ? ' — tách video+audio, sẽ ghép bằng ffmpeg' : ''}
                </span>
              </div>
              <div className="webhook-detail-row">
                <span className="webhook-detail-label">accountId</span>
                <span className="webhook-detail-value mono small">{result.accountId ?? '(null)'}</span>
              </div>
              <div className="webhook-detail-row">
                <span className="webhook-detail-label">assetUrl</span>
                <span className="webhook-detail-value">
                  {result.assetUrl ? (
                    <a href={result.assetUrl} target="_blank" rel="noopener noreferrer" className="result-link">
                      {result.assetUrl}
                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    <em>(null)</em>
                  )}
                </span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="webhook-status-banner fail">
              <XCircle size={20} />
              <span>Lỗi</span>
            </div>
            <div className="webhook-detail-rows">
              <div className="webhook-detail-row">
                <span className="webhook-detail-value result-error">{result.error}</span>
              </div>
              <div className="webhook-detail-row">
                <span className="webhook-detail-label">assetUrl gửi đi</span>
                <span className="webhook-detail-value mono small">
                  {result.assetUrl ?? '(null)'}
                </span>
              </div>
              <p className="hint" style={{ marginTop: 4 }}>
                Nếu null là profile chưa lưu Google Sheet.
              </p>
            </div>
          </>
        )}
        <div className="modal-actions">
          <button className="btn primary" onClick={onClose}>
            Đóng
          </button>
        </div>
      </div>
    </div>
  )
}

function BulkSetProxyModal(props: {
  proxies: Proxy[]
  selectedCount: number
  onApply: (proxyId: string) => Promise<void>
  onClose: () => void
}): JSX.Element {
  const { proxies, selectedCount, onApply, onClose } = props
  const [proxyId, setProxyId] = useState(PROXY_LOCAL)
  const [applying, setApplying] = useState(false)

  async function apply(): Promise<void> {
    setApplying(true)
    try {
      await onApply(proxyId)
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Set Proxy cho {selectedCount} tài khoản</h2>
        <label className="field">
          <span>Proxy</span>
          <select value={proxyId} onChange={(e) => setProxyId(e.target.value)}>
            <option value={PROXY_LOCAL}>Local (IP máy)</option>
            <option value={PROXY_RANDOM}>Random (mỗi lần chạy lấy ngẫu nhiên)</option>
            {proxies.length > 0 && (
              <optgroup label="Proxy đã thêm">
                {proxies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.kind ? ` (${p.kind})` : ''}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={applying}>
            Hủy
          </button>
          <button className="btn primary" disabled={applying} onClick={apply}>
            {applying ? <Loader2 size={15} className="spin" /> : null}
            {applying ? 'Đang áp dụng…' : 'Áp dụng'}
          </button>
        </div>
      </div>
    </div>
  )
}

type MenuItem = {
  icon: JSX.Element
  label: string
  title: string
  disabled?: boolean
  danger?: boolean
  onClick: () => void
}

function ActionMenu({ items }: { items: MenuItem[] }): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  return (
    <div className="action-menu" ref={ref}>
      <button
        className="btn icon-only ghost"
        title="Thêm tác vụ"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="action-menu-dropdown">
          {items.map((item, i) => (
            <button
              key={i}
              className={`action-menu-item${item.danger ? ' danger' : ''}`}
              title={item.title}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onClick()
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Chấm sức khoẻ tài khoản: xanh lá (bình thường), đỏ (≥2 lỗi), cam (bất thường).
function HealthBadge({ health, reason }: { health: AccountHealth; reason: string | null }): JSX.Element {
  if (health === 'error') {
    return (
      <span className="health-badge error" title={reason ?? 'Lỗi'}>
        <AlertCircle size={15} />
      </span>
    )
  }
  if (health === 'abnormal') {
    return (
      <span className="health-badge abnormal" title={reason ?? 'Bất thường'}>
        <AlertTriangle size={15} />
      </span>
    )
  }
  return (
    <span className="health-badge ok" title="Bình thường">
      <CheckCircle2 size={15} />
    </span>
  )
}

function FilterChip(props: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  const { active, onClick, children } = props
  return (
    <button className={`filter-chip${active ? ' active' : ''}`} onClick={onClick}>
      {children}
    </button>
  )
}
