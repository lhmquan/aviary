import { useEffect, useState, useCallback, useMemo } from 'react'
import { Plus, Pencil, Trash2, RefreshCw, Loader2, Clock, CalendarClock, Trash, MessageSquare, Activity, Send, MessageCircle, BarChart3, ListOrdered, Copy, X, Check } from 'lucide-react'
import type { Account, Schedule, ScheduleInput, ScheduleKind, ScheduleAction, DeleteMode } from '@shared/types'

const REFRESH_MS = 15_000

// Loại tác vụ để lọc bảng lịch. 'system' = tác vụ hệ thống (analytics).
type ScheduleKindTag = 'post' | 'delete' | 'comment' | 'interact' | 'system'

function kindOf(s: Schedule): ScheduleKindTag {
  if (s.accountId === '__system__') return 'system'
  return actionToKind(s.action)
}

// Map ScheduleAction -> tag loại (post/delete/comment/interact). Không bao giờ 'system'.
function actionToKind(action: ScheduleAction): ScheduleKindTag {
  if (action === 'delete') return 'delete'
  if (action === 'comment') return 'comment'
  if (action === 'interact') return 'interact'
  return 'post'
}

// Đếm số lịch theo tài khoản + loại tác vụ: Map<accountId, Map<kind, count>>. Bỏ qua lịch
// hệ thống. Dùng cho badge số lịch trong menu chọn tài khoản (AccountPicker).
function buildScheduleCountMap(schedules: Schedule[]): Map<string, Map<ScheduleKindTag, number>> {
  const map = new Map<string, Map<ScheduleKindTag, number>>()
  for (const s of schedules) {
    if (s.accountId === '__system__') continue
    const kind = kindOf(s)
    let inner = map.get(s.accountId)
    if (!inner) {
      inner = new Map<ScheduleKindTag, number>()
      map.set(s.accountId, inner)
    }
    inner.set(kind, (inner.get(kind) ?? 0) + 1)
  }
  return map
}

// Nhãn + icon + class màu cho chip lọc (đồng bộ với badge tác vụ trong bảng + tab Hàng đợi).
const KIND_META: Record<ScheduleKindTag, { text: string; Icon: typeof Send; cls: string }> = {
  post: { text: 'Đăng', Icon: Send, cls: 'action-post' },
  delete: { text: 'Xoá', Icon: Trash, cls: 'action-delete' },
  comment: { text: 'Bình luận', Icon: MessageCircle, cls: 'action-comment' },
  interact: { text: 'Tương tác', Icon: Activity, cls: 'action-interact' },
  system: { text: 'Analytics', Icon: BarChart3, cls: 'action-system' }
}
const KIND_ORDER: ScheduleKindTag[] = ['post', 'delete', 'comment', 'interact', 'system']

// Chip lọc (dùng lại style .filter-chip + .qfilter-chip toàn cục). colorCls: khi active tô
// đúng màu loại tác vụ cho đồng bộ với badge trong bảng.
function ScheduleFilterChip(props: {
  active: boolean
  onClick: () => void
  colorCls?: string
  children: React.ReactNode
}): JSX.Element {
  const { active, onClick, colorCls, children } = props
  const cls = `filter-chip qfilter-chip${active ? ' active' : ''}${active && colorCls ? ` ${colorCls}` : ''}`
  return (
    <button className={cls} onClick={onClick}>
      {children}
    </button>
  )
}

// Badge số lịch theo từng loại tác vụ cho 1 tài khoản (tô màu đồng bộ). Bỏ qua loại 'system'.
// countKind: null = hiện tất cả loại (trừ system); 1 loại cụ thể = chỉ hiện loại đó.
function AccountScheduleBadges(props: {
  counts: Map<ScheduleKindTag, number>
  countKind: ScheduleKindTag | null
}): JSX.Element | null {
  const { counts, countKind } = props
  const kinds = (countKind ? [countKind] : KIND_ORDER).filter((k) => k !== 'system' && counts.get(k))
  if (kinds.length === 0) return null
  return (
    <span className="ap-badges">
      {kinds.map((k) => {
        const { text, Icon, cls } = KIND_META[k]
        return (
          <span key={k} className={`ap-badge ${cls}`} title={`${counts.get(k)} lịch ${text}`}>
            <Icon size={11} /> {counts.get(k)}
          </span>
        )
      })}
    </span>
  )
}

// Menu chọn tài khoản dùng chung (thay <select multiple>): mỗi tài khoản 1 row bấm-để-chọn
// (không cần Ctrl/Shift), có avatar + tên + badge số lịch theo loại để user biết account nào
// đã có lịch. multi=false -> chỉ chọn 1 (radio-like). countKind quyết định badge đếm loại nào.
function AccountPicker(props: {
  accounts: Account[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  scheduleCountByAccount: Map<string, Map<ScheduleKindTag, number>>
  countKind: ScheduleKindTag | null
  multi?: boolean
}): JSX.Element {
  const { accounts, selectedIds, onChange, scheduleCountByAccount, countKind, multi = true } = props
  const selected = new Set(selectedIds)

  function toggle(id: string): void {
    if (!multi) {
      onChange([id])
      return
    }
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange([...next])
  }

  const allSelected = accounts.length > 0 && accounts.every((a) => selected.has(a.id))

  // "Chưa có lịch" hiểu theo đúng loại đang xét (countKind) để KHỚP với badge đang hiển thị:
  // - countKind cụ thể (vd Tương tác) -> tài khoản chưa có lịch LOẠI ĐÓ.
  // - countKind null (tất cả) -> tài khoản chưa có lịch nào.
  // Lịch hệ thống đã loại sẵn khỏi scheduleCountByAccount.
  function hasNoSchedule(id: string): boolean {
    const inner = scheduleCountByAccount.get(id)
    if (!inner || inner.size === 0) return true
    if (countKind) return !inner.get(countKind)
    return false
  }
  const noScheduleAccounts = accounts.filter((a) => hasNoSchedule(a.id))
  // Nhãn nút phản ánh loại đang xét (vd "Chưa có lịch Tương tác").
  const noScheduleLabel = countKind ? `Chưa có lịch ${KIND_META[countKind].text}` : 'Chưa có lịch'
  // Nhóm "chưa có lịch" đã được chọn hết chưa (để toggle: bấm lần nữa -> bỏ chọn nhóm này).
  const allNoSchedSelected =
    noScheduleAccounts.length > 0 && noScheduleAccounts.every((a) => selected.has(a.id))

  // Toggle chọn/bỏ nhóm "chưa có lịch" (giữ nguyên các lựa chọn khác).
  function toggleNoSchedule(): void {
    const ids = noScheduleAccounts.map((a) => a.id)
    if (allNoSchedSelected) {
      const next = new Set(selected)
      for (const id of ids) next.delete(id)
      onChange([...next])
    } else {
      onChange([...new Set([...selected, ...ids])])
    }
  }

  return (
    <div className="account-picker">
      {multi && accounts.length > 1 && (
        <div className="ap-head">
          <span className="ap-head-actions">
            <button
              type="button"
              className="ap-selectall"
              onClick={() => onChange(allSelected ? [] : accounts.map((a) => a.id))}
            >
              {allSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
            </button>
            {noScheduleAccounts.length > 0 && (
              <button
                type="button"
                className={`ap-selectall${allNoSchedSelected ? ' active' : ''}`}
                onClick={toggleNoSchedule}
                title={`Chọn các tài khoản ${noScheduleLabel.toLowerCase()}`}
              >
                {noScheduleLabel} ({noScheduleAccounts.length})
              </button>
            )}
          </span>
          <span className="ap-count">{selectedIds.length}/{accounts.length} đã chọn</span>
        </div>
      )}
      <div className="ap-list">
        {accounts.map((a) => {
          const isSel = selected.has(a.id)
          const counts = scheduleCountByAccount.get(a.id) ?? new Map<ScheduleKindTag, number>()
          const initial = a.label.trim().charAt(0).toUpperCase() || '?'
          return (
            <button
              type="button"
              key={a.id}
              className={`ap-row${isSel ? ' selected' : ''}`}
              onClick={() => toggle(a.id)}
            >
              <span className={`ap-check${isSel ? ' on' : ''}`}>
                {isSel && <Check size={12} />}
              </span>
              <span className="ap-avatar">
                {a.avatarUrl ? (
                  <img src={a.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
                ) : (
                  <span className="ap-avatar-fallback">{initial}</span>
                )}
              </span>
              <span className="ap-name" title={a.label}>
                {a.label}
                {a.handle && <span className="ap-handle">@{a.handle.replace(/^@/, '')}</span>}
              </span>
              <AccountScheduleBadges counts={counts} countKind={countKind} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function ScheduleView(): JSX.Element {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Schedule | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const [, force] = useState(0)
  // Lọc bảng theo loại tác vụ. null = tất cả.
  const [kindFilter, setKindFilter] = useState<ScheduleKindTag | null>(null)
  // Bulk select: tập id lịch đã tick (bỏ qua lịch hệ thống). + cờ đang xử lý hàng loạt.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  // Lịch đang mở modal Clone (null = không mở).
  const [cloning, setCloning] = useState<Schedule | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [list, accs] = await Promise.all([
        window.aviary.schedules.list(),
        window.aviary.accounts.list()
      ])
      setSchedules(list)
      setAccounts(accs)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Khi form (modal thêm/sửa) đang mở: ĐÓNG BĂNG mọi cập nhật nền. Modal che hết bảng phía
    // sau nên không cần làm mới realtime lúc này. Lý do quan trọng: mỗi lần re-render ScheduleView
    // (do ivRefresh 15s, force render 100ms, hoặc onProgress khi một lịch chạy xong) đều re-render
    // ScheduleForm và có thể LÀM RỚT KÝ TỰ đang gõ ở ô <input type="number"> (controlled input) —
    // đó là lý do "thỉnh thoảng không nhập số được, chỉ chỉnh bằng nút lên/xuống". Với lịch chạy
    // mỗi 1 phút, onProgress bắn refresh() đúng lúc đang gõ -> rớt ký tự. Đóng băng để form ổn định.
    // Modal Clone cũng phải đóng băng: re-render 100ms/lần sẽ RESET lựa chọn của <select multiple>
    // controlled -> "click chọn tài khoản không ăn". Che modal nên không cần cập nhật nền.
    if (showForm || cloning) return

    refresh()
    // Làm mới định kỳ để cập nhật "lần chạy cuối / lần kế" + force render countdown realtime.
    const ivRefresh = setInterval(() => {
      window.aviary.schedules.list().then(setSchedules).catch(() => {})
    }, REFRESH_MS)
    const ivForce = setInterval(() => force((n) => n + 1), 100)

    const off = window.aviary.post.onProgress((p) => {
      if (!p.busy) refresh()
    })
    // Hàng đợi scheduler thay đổi (nhặt lịch / chạy xong) -> làm mới để cập nhật cờ running.
    const offQueue = window.aviary.post.onQueueChanged(() => {
      window.aviary.schedules.list().then(setSchedules).catch(() => {})
    })
    return () => {
      clearInterval(ivRefresh)
      clearInterval(ivForce)
      off()
      offQueue()
    }
  }, [refresh, showForm, cloning])

  async function handleDelete(s: Schedule): Promise<void> {
    const actionLabel = s.action === 'delete' ? 'xoá bài' : s.action === 'comment' ? 'bình luận' : s.action === 'interact' ? 'tương tác' : 'đăng bài'
    if (!confirm(`Xóa lịch ${actionLabel} "${describe(s)}" cho ${accountLabel(s.accountId)}?`)) return
    await window.aviary.schedules.remove(s.id)
    await refresh()
  }

  async function handleToggle(s: Schedule): Promise<void> {
    setToggling(s.id)
    try {
      await window.aviary.schedules.update(s.id, { enabled: !s.enabled })
      await refresh()
    } catch (e) {
      alert('Đổi trạng thái lỗi: ' + (e as Error).message)
    } finally {
      setToggling(null)
    }
  }

  function accountLabel(accountId: string): string {
    return accounts.find((a) => a.id === accountId)?.label ?? '(đã xoá)'
  }

  // Các loại tác vụ đang có (kèm số lượng) — chỉ hiện chip cho loại có thật.
  const kindCounts = useMemo(() => {
    const counts = new Map<ScheduleKindTag, number>()
    for (const s of schedules) counts.set(kindOf(s), (counts.get(kindOf(s)) ?? 0) + 1)
    return counts
  }, [schedules])
  const availableKinds = KIND_ORDER.filter((k) => kindCounts.has(k))

  // Số lịch theo tài khoản + loại (cho badge trong menu chọn tài khoản).
  const scheduleCountByAccount = useMemo(() => buildScheduleCountMap(schedules), [schedules])

  // Filter đã chọn nhưng loại đó không còn -> tự bỏ filter (hiện tất cả).
  const effectiveKind = kindFilter && kindCounts.has(kindFilter) ? kindFilter : null
  const visibleSchedules = effectiveKind
    ? schedules.filter((s) => kindOf(s) === effectiveKind)
    : schedules

  // ---- Bulk select ----
  // Chỉ lịch thường mới chọn được (lịch hệ thống __system__ không xoá được).
  const selectableVisible = visibleSchedules.filter((s) => s.accountId !== '__system__')
  const allVisibleSelected =
    selectableVisible.length > 0 && selectableVisible.every((s) => selectedIds.has(s.id))
  const hasSelection = selectedIds.size > 0

  function toggleSelect(id: string): void {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll(): void {
    if (allVisibleSelected) {
      // Bỏ chọn các lịch đang hiển thị (giữ lựa chọn ở loại khác nếu có).
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const s of selectableVisible) next.delete(s.id)
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const s of selectableVisible) next.add(s.id)
        return next
      })
    }
  }

  async function handleBulkDelete(): Promise<void> {
    const count = selectedIds.size
    if (count === 0) return
    if (!confirm(`Xoá ${count} lịch đã chọn?`)) return
    setBulkBusy(true)
    for (const id of selectedIds) {
      await window.aviary.schedules.remove(id).catch(() => {})
    }
    setSelectedIds(new Set())
    await refresh()
    setBulkBusy(false)
  }

  return (
    <div className="view">
      <div className="toolbar">
        <button className="btn" onClick={refresh} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spin' : undefined} />
          Làm mới
        </button>
        <button
          className="btn primary"
          onClick={() => {
            setEditing(null)
            setShowForm(true)
          }}
        >
          <Plus size={15} />
          Thêm lịch
        </button>

        {/* Chọn tất cả (các lịch đang hiển thị, bỏ qua lịch hệ thống). */}
        {selectableVisible.length > 0 && (
          <label className="select-all-check">
            <input
              type="checkbox"
              ref={(el) => {
                if (el) el.indeterminate = hasSelection && !allVisibleSelected
              }}
              checked={allVisibleSelected}
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
              className="btn icon-label danger"
              disabled={bulkBusy}
              onClick={handleBulkDelete}
              title={`Xoá ${selectedIds.size} lịch`}
            >
              {bulkBusy ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
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

      {/* Hàng chip lọc theo loại tác vụ — chỉ hiện khi có từ 2 loại trở lên. */}
      {availableKinds.length >= 2 && (
        <div className="filter-bar">
          <div className="filter-chips">
            <span className="filter-label">Loại tác vụ:</span>
            <ScheduleFilterChip active={effectiveKind === null} onClick={() => setKindFilter(null)}>
              <ListOrdered size={12} /> Tất cả <span className="chip-count">{schedules.length}</span>
            </ScheduleFilterChip>
            {availableKinds.map((k) => {
              const { text, Icon, cls } = KIND_META[k]
              return (
                <ScheduleFilterChip
                  key={k}
                  active={effectiveKind === k}
                  colorCls={cls}
                  onClick={() => setKindFilter((prev) => (prev === k ? null : k))}
                >
                  <Icon size={12} /> {text} <span className="chip-count">{kindCounts.get(k)}</span>
                </ScheduleFilterChip>
              )
            })}
          </div>
        </div>
      )}

      {schedules.length === 0 ? (
        <div className="empty-state">
          <Clock size={36} />
          <p>Chưa có lịch nào</p>
          <span>
            Thêm lịch để profile tự đăng bài hoặc xoá bài theo giờ / khoảng thời gian. Mọi sự kiện
            được ghi vào Nhật ký.
          </span>
        </div>
      ) : visibleSchedules.length === 0 ? (
        <div className="empty-state">
          <Clock size={36} />
          <p>Không có lịch "{effectiveKind ? KIND_META[effectiveKind].text : ''}"</p>
          <span>Không có lịch nào thuộc loại này. Bấm "Tất cả" để xem hết.</span>
        </div>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th className="col-check">
                  {selectableVisible.length > 0 && (
                    <input
                      type="checkbox"
                      ref={(el) => {
                        if (el) el.indeterminate = hasSelection && !allVisibleSelected
                      }}
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                      title="Chọn tất cả"
                    />
                  )}
                </th>
                <th>Tài khoản</th>
                <th>Tác vụ</th>
                <th>Mô hình</th>
                <th>Lịch</th>
                <th>Lần cuối</th>
                <th>Lần kế</th>
                <th>Trạng thái</th>
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {visibleSchedules.map((s) => {
                const isSystem = s.accountId === '__system__'
                const isSelected = selectedIds.has(s.id)
                return (
                  <tr
                    key={s.id}
                    className={`${isSystem ? 'system-schedule' : ''}${isSelected ? ' row-selected' : ''}`}
                  >
                    <td className="col-check">
                      {!isSystem && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(s.id)}
                        />
                      )}
                    </td>
                    <td className="cell-label">
                      {isSystem ? (
                        <span className="system-label">Hệ thống</span>
                      ) : (
                        <>
                          {accountLabel(s.accountId)}
                          {s.label && <div className="small muted">{s.label}</div>}
                        </>
                      )}
                    </td>
                    <td>
                      {isSystem ? (
                        <span className="badge action-system">Analytics</span>
                      ) : (
                        <span className={`badge ${s.action === 'delete' ? 'action-delete' : s.action === 'comment' ? 'action-comment' : s.action === 'interact' ? 'action-interact' : 'action-post'}`}>
                          {s.action === 'delete' ? 'Xoá' : s.action === 'comment' ? 'Bình luận' : s.action === 'interact' ? 'Tương tác' : 'Đăng'}
                        </span>
                      )}
                    </td>
                    <td>{s.kind === 'interval' ? 'Khoảng' : 'Giờ cố định'}</td>
                    <td className="small">{describe(s)}</td>
                    <td className="mono small">{s.lastRunAt ? fmtTime(s.lastRunAt) : '—'}</td>
                    <td className="mono small">{nextRunCell(s)}</td>
                    <td>
                      {isSystem ? (
                        <span className={`badge ${s.enabled ? 'on' : 'st-disabled'}`}>
                          <span className="dot" />
                          {s.enabled ? 'Bật' : 'Tắt'}
                        </span>
                      ) : (
                        <button
                          className={`badge ${s.enabled ? 'on' : 'st-disabled'}`}
                          disabled={toggling === s.id}
                          onClick={() => handleToggle(s)}
                          title={s.enabled ? 'Đang bật — bấm để tắt' : 'Đang tắt — bấm để bật'}
                          style={{ border: 'none', cursor: 'pointer' }}
                        >
                          {toggling === s.id ? <Loader2 size={13} className="spin" /> : <span className="dot" />}
                          {s.enabled ? 'Bật' : 'Tắt'}
                        </button>
                      )}
                    </td>
                    <td className="actions">
                      {!isSystem && (
                        <>
                          <button
                            className="btn icon-only"
                            title="Sửa"
                            onClick={() => {
                              setEditing(s)
                              setShowForm(true)
                            }}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            className="btn icon-only"
                            title="Nhân bản lịch sang tài khoản khác"
                            onClick={() => setCloning(s)}
                          >
                            <Copy size={16} />
                          </button>
                          <button
                            className="btn icon-only danger"
                            title="Xóa"
                            onClick={() => handleDelete(s)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <ScheduleForm
          schedule={editing}
          accounts={accounts}
          scheduleCountByAccount={scheduleCountByAccount}
          onClose={() => setShowForm(false)}
          onSaved={async () => {
            setShowForm(false)
            await refresh()
          }}
        />
      )}

      {cloning && (
        <CloneScheduleModal
          schedule={cloning}
          accounts={accounts}
          accountLabel={accountLabel}
          scheduleCountByAccount={scheduleCountByAccount}
          countKind={effectiveKind && effectiveKind !== 'system' ? effectiveKind : null}
          onClose={() => setCloning(null)}
          onCloned={async () => {
            setCloning(null)
            await refresh()
          }}
        />
      )}
    </div>
  )
}

// ---- Modal Clone: nhân bản 1 lịch sang 1+ tài khoản khác ----
// Sao chép TOÀN BỘ cấu hình lịch gốc (tác vụ, mô hình, giờ, jitter, các field theo tác vụ),
// chỉ đổi accountId. Chọn nhiều tài khoản -> tạo nhiều lịch tương ứng. Lịch mới luôn tạo bằng
// schedules.create (không đụng lịch gốc). Mặc định KHÔNG cho tick lại chính tài khoản gốc.
function CloneScheduleModal(props: {
  schedule: Schedule
  accounts: Account[]
  accountLabel: (accountId: string) => string
  scheduleCountByAccount: Map<string, Map<ScheduleKindTag, number>>
  // Loại tác vụ để đếm badge: theo filter đang chọn (null = tất cả loại trừ system).
  countKind: ScheduleKindTag | null
  onClose: () => void
  onCloned: () => void
}): JSX.Element {
  const { schedule, accounts, accountLabel, scheduleCountByAccount, countKind, onClose, onCloned } = props
  // Loại trừ tài khoản gốc khỏi danh sách đích (clone sang tài khoản KHÁC).
  const targets = accounts.filter((a) => a.id !== schedule.accountId)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [enabled, setEnabled] = useState<boolean>(schedule.enabled)
  const [cloning, setCloning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Dựng input clone từ lịch gốc (bỏ id/accountId/trạng thái runtime), giữ mọi cấu hình.
  function buildInput(accountId: string): ScheduleInput {
    return {
      accountId,
      label: schedule.label,
      action: schedule.action,
      kind: schedule.kind,
      intervalMinutes: schedule.intervalMinutes,
      times: schedule.times,
      jitterSeconds: schedule.jitterSeconds,
      enabled,
      deleteMode: schedule.deleteMode,
      deleteBeforeDate: schedule.deleteBeforeDate,
      deleteCount: schedule.deleteCount,
      commentCount: schedule.commentCount,
      commentIntervalSeconds: schedule.commentIntervalSeconds,
      commentSourceUrl: schedule.commentSourceUrl,
      interactDurationMinutes: schedule.interactDurationMinutes,
      interactCommentTarget: schedule.interactCommentTarget
    }
  }

  async function doClone(): Promise<void> {
    if (selectedIds.length === 0) {
      setError('Phải chọn ít nhất 1 tài khoản đích')
      return
    }
    setError(null)
    setCloning(true)
    try {
      for (const accountId of selectedIds) {
        await window.aviary.schedules.create(buildInput(accountId))
      }
      onCloned()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCloning(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Nhân bản lịch</h2>
        <p className="hint">
          Sao chép lịch <b>{describe(schedule)}</b> (từ {accountLabel(schedule.accountId)}) sang các
          tài khoản được chọn. Mỗi tài khoản được tạo 1 lịch giống hệt.
        </p>
        {targets.length === 0 ? (
          <p className="hint">Không có tài khoản nào khác để nhân bản.</p>
        ) : (
          <div className="field">
            <span>Tài khoản đích * ({selectedIds.length} đã chọn)</span>
            <AccountPicker
              accounts={targets}
              selectedIds={selectedIds}
              onChange={setSelectedIds}
              scheduleCountByAccount={scheduleCountByAccount}
              countKind={countKind}
            />
          </div>
        )}
        <label className="field checkbox-field">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>Bật các lịch vừa nhân bản</span>
        </label>
        {error && <p className="test-result fail">{error}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={cloning}>
            Hủy
          </button>
          <button
            className="btn primary"
            disabled={cloning || targets.length === 0 || selectedIds.length === 0}
            onClick={doClone}
          >
            {cloning ? <Loader2 size={15} className="spin" /> : <Copy size={15} />}
            {cloning ? 'Đang nhân bản…' : `Nhân bản (${selectedIds.length})`}
          </button>
        </div>
      </div>
    </div>
  )
}

function ScheduleForm(props: {
  schedule: Schedule | null
  accounts: Account[]
  scheduleCountByAccount: Map<string, Map<ScheduleKindTag, number>>
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const { schedule, accounts, scheduleCountByAccount, onClose, onSaved } = props
  const [accountScope, setAccountScope] = useState<'all' | 'specific'>('specific')
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>(schedule ? [schedule.accountId] : accounts[0] ? [accounts[0].id] : [])
  const [label, setLabel] = useState(schedule?.label ?? '')
  const [action, setAction] = useState<ScheduleAction>(schedule?.action ?? 'post')
  const [kind, setKind] = useState<ScheduleKind>(schedule?.kind ?? 'interval')
  const [intervalMinutes, setIntervalMinutes] = useState(
    String(schedule?.intervalMinutes ?? 30)
  )
  const [times, setTimes] = useState((schedule?.times ?? []).join(', '))
  const [jitterSeconds, setJitterSeconds] = useState(String(schedule?.jitterSeconds ?? 0))
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true)
  const [deleteMode, setDeleteMode] = useState<DeleteMode>(schedule?.deleteMode ?? 'newest')
  const [deleteBeforeDate, setDeleteBeforeDate] = useState(schedule?.deleteBeforeDate ?? '')
  const [deleteCount, setDeleteCount] = useState(String(schedule?.deleteCount ?? 1))
  // Comment fields
  const [commentCount, setCommentCount] = useState(String(schedule?.commentCount ?? 1))
  const [commentIntervalSeconds, setCommentIntervalSeconds] = useState(String(schedule?.commentIntervalSeconds ?? 60))
  const [commentSourceUrl, setCommentSourceUrl] = useState(schedule?.commentSourceUrl ?? '')
  // Interact fields
  const [interactDurationMinutes, setInteractDurationMinutes] = useState(String(schedule?.interactDurationMinutes ?? 15))
  // Số bình luận mục tiêu/phiên: '' hoặc '0' = tự tính theo thời lượng (như cũ).
  const [interactCommentTarget, setInteractCommentTarget] = useState(
    String(schedule?.interactCommentTarget ?? 0)
  )
  const [testingComment, setTestingComment] = useState(false)
  const [commentTestResult, setCommentTestResult] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function accountSelection(): string[] {
    return accountScope === 'all' ? accounts.map((a) => a.id) : selectedAccountIds
  }

  // Tính ràng buộc thời gian cho comment realtime (không throw, chỉ cảnh báo UI).
  // Tổng thời gian thực thi (count-1)*interval + buffer 30s phải ≤ khoảng cách giữa 2 tác vụ.
  function commentTimingWarning(): string | null {
    if (action !== 'comment') return null
    const count = Math.max(1, Number(commentCount) || 1)
    const interval = Math.max(5, Number(commentIntervalSeconds) || 0)
    const execTime = count > 1 ? (count - 1) * interval : 0
    const buffer = 30
    // Khoảng cách nhỏ nhất giữa 2 lần chạy theo kind.
    let gap = 0
    if (kind === 'interval') {
      gap = Math.max(1, (Number(intervalMinutes) || 0) * 60)
    } else {
      const ts = times.split(/[,\n]+/).map((t) => t.trim()).filter(Boolean)
      if (ts.length <= 1) gap = 86400
      else {
        const mins = ts
          .map((t) => {
            const m = t.match(/^(\d{1,2}):(\d{2})$/)
            return m ? Number(m[1]) * 60 + Number(m[2]) : -1
          })
          .filter((m) => m >= 0)
          .sort((a, b) => a - b)
        if (mins.length <= 1) gap = 86400
        else {
          let mn = (mins[0] + 1440 - mins[mins.length - 1]) % 1440
          for (let i = 1; i < mins.length; i++) mn = Math.min(mn, mins[i] - mins[i - 1])
          gap = Math.max(1, mn * 60)
        }
      }
    }
    if (execTime + buffer > gap) {
      return `Tổng thời gian bình luận (${execTime}s) + buffer ${buffer}s > khoảng cách giữa 2 tác vụ (${gap}s). Giảm số bài, giảm thời gian giữa mỗi bình luận, hoặc tăng khoảng cách lịch.`
    }
    return null
  }

  async function testCommentWebhook(): Promise<void> {
    setTestingComment(true)
    setCommentTestResult(null)
    try {
      // Lấy handle của tài khoản đầu tiên được chọn để test.
      const ids = accountSelection()
      const acc = accounts.find((a) => a.id === ids[0])
      const handle = acc?.handle?.replace(/^@+/, '') ?? ''
      if (!handle) {
        setCommentTestResult('Tài khoản chưa có username X — không thể test.')
        return
      }
      const r = await window.aviary.webhook.testComments(handle, commentSourceUrl.trim() || null)
      if (r.ok) {
        setCommentTestResult(`OK — nội dung: "${r.comment?.slice(0, 80) ?? ''}"`)
      } else {
        setCommentTestResult(`Lỗi: ${r.error ?? 'không xác định'}`)
      }
    } catch (e) {
      setCommentTestResult(`Lỗi: ${(e as Error).message}`)
    } finally {
      setTestingComment(false)
    }
  }

  async function save(): Promise<void> {
    setError(null)
    const targetAccountIds = accountSelection()
    if (targetAccountIds.length === 0) {
      setError('Phải chọn ít nhất 1 tài khoản')
      return
    }
    // Chặn lưu nếu vi phạm ràng buộc thời gian comment.
    const warning = commentTimingWarning()
    if (warning) {
      setError(warning)
      return
    }
    const parsedDeleteCount = deleteCount.trim() === '' ? 1 : Number(deleteCount)
    const parsedCommentCount = commentCount.trim() === '' ? 1 : Number(commentCount)
    const baseInput = {
      label: label.trim() || null,
      action,
      kind,
      intervalMinutes: kind === 'interval' ? Number(intervalMinutes) : null,
      times:
        kind === 'fixed'
          ? times
              .split(/[,\n]+/)
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
      jitterSeconds: Number(jitterSeconds) || 0,
      enabled,
      deleteMode: action === 'delete' ? deleteMode : null,
      deleteBeforeDate:
        action === 'delete' && deleteMode === 'by_date'
          ? deleteBeforeDate || null
          : null,
      deleteCount: action === 'delete' ? Math.max(0, parsedDeleteCount) : 1,
      commentCount: action === 'comment' ? Math.max(1, parsedCommentCount) : 1,
      commentIntervalSeconds:
        action === 'comment' ? Math.max(5, Number(commentIntervalSeconds) || 60) : 60,
      commentSourceUrl: action === 'comment' ? commentSourceUrl.trim() || null : null,
      interactDurationMinutes: action === 'interact' ? Math.max(1, Number(interactDurationMinutes) || 15) : 15,
      interactCommentTarget:
        action === 'interact' ? Math.max(0, Math.floor(Number(interactCommentTarget) || 0)) : 0
    } satisfies Omit<ScheduleInput, 'accountId'>
    setSaving(true)
    try {
      if (schedule) {
        const [firstAccountId, ...extraAccountIds] = targetAccountIds
        await window.aviary.schedules.update(schedule.id, { ...baseInput, accountId: firstAccountId })
        for (const accountId of extraAccountIds) {
          await window.aviary.schedules.create({ ...baseInput, accountId })
        }
      } else {
        for (const accountId of targetAccountIds) {
          await window.aviary.schedules.create({ ...baseInput, accountId })
        }
      }
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (accounts.length === 0) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>Thêm lịch</h2>
          <p className="hint">Chưa có tài khoản nào. Hãy thêm tài khoản ở tab Tài khoản trước.</p>
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>
              Đóng
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{schedule ? 'Sửa lịch' : 'Thêm lịch'}</h2>
        <label className="field">
          <span>Phạm vi tài khoản *</span>
          <select
            value={accountScope}
            onChange={(e) => {
              const next = e.target.value as 'all' | 'specific'
              setAccountScope(next)
              if (next === 'all') setSelectedAccountIds(accounts.map((a) => a.id))
              else if (selectedAccountIds.length === 0 && accounts[0]) setSelectedAccountIds([accounts[0].id])
            }}
          >
            <option value="all">Tất cả tài khoản ({accounts.length})</option>
            <option value="specific">Chọn tài khoản</option>
          </select>
        </label>
        {accountScope === 'specific' && (
          <div className="field">
            <span>Tài khoản * ({selectedAccountIds.length} đã chọn)</span>
            <AccountPicker
              accounts={accounts}
              selectedIds={selectedAccountIds}
              onChange={setSelectedAccountIds}
              scheduleCountByAccount={scheduleCountByAccount}
              countKind={actionToKind(action)}
            />
          </div>
        )}
        {schedule && accountSelection().length > 1 && (
          <p className="hint">
            Khi sửa lịch và chọn nhiều tài khoản, app sẽ cập nhật lịch hiện tại cho tài khoản đầu tiên
            trong lựa chọn và tạo thêm lịch giống hệt cho các tài khoản còn lại.
          </p>
        )}
        <label className="field">
          <span>Nhãn (tùy chọn)</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="VD: Lịch sáng" />
        </label>
        <label className="field">
          <span>Tác vụ</span>
          <select value={action} onChange={(e) => setAction(e.target.value as ScheduleAction)}>
            <option value="post">Đăng bài</option>
            <option value="delete">Xoá bài</option>
            <option value="comment">Bình luận</option>
            <option value="interact">Tương tác</option>
          </select>
        </label>

        {action === 'delete' && (
          <>
            <label className="field">
              <span>Chế độ xoá</span>
              <select value={deleteMode} onChange={(e) => setDeleteMode(e.target.value as DeleteMode)}>
                <option value="newest">Lần lượt từ bài mới nhất</option>
                <option value="by_date">Chỉ định ngày (xoá bài từ ngày đó trở về trước)</option>
              </select>
            </label>
            {deleteMode === 'by_date' && (
              <label className="field">
                <span>Xoá bài từ ngày này trở về trước *</span>
                <input
                  type="date"
                  value={deleteBeforeDate}
                  onChange={(e) => setDeleteBeforeDate(e.target.value)}
                />
              </label>
            )}
            <label className="field">
              <span>Số bài xoá mỗi lần chạy (0 = xoá tất cả bài khớp)</span>
              <input
                type="number"
                min={0}
                value={deleteCount}
                onChange={(e) => setDeleteCount(e.target.value)}
                placeholder="VD: 1"
              />
            </label>
            <p className="hint">
              Mỗi lần lịch kích hoạt, app sẽ mở profile X của tài khoản và xoá tối đa số bài đã chọn.
              {deleteMode === 'by_date' && ' Chỉ xoá bài có ngày đăng từ ngày đã chọn trở về trước.'}
            </p>
          </>
        )}

        {action === 'comment' && (
          <>
            <div className="field-row-2">
              <label className="field">
                <span>Số bài bình luận / lần chạy *</span>
                <input
                  type="number"
                  min={1}
                  value={commentCount}
                  onChange={(e) => setCommentCount(e.target.value)}
                  placeholder="VD: 1"
                />
              </label>
              {Number(commentCount) > 1 && (
                <label className="field">
                  <span>Thời gian giữa mỗi bình luận (giây) *</span>
                  <input
                    type="number"
                    min={5}
                    value={commentIntervalSeconds}
                    onChange={(e) => setCommentIntervalSeconds(e.target.value)}
                    placeholder="VD: 60"
                  />
                </label>
              )}
            </div>
            <label className="field">
              <span>Nguồn bình luận (link Google Sheet) *</span>
              <div className="field-row">
                <input
                  type="url"
                  value={commentSourceUrl}
                  onChange={(e) => setCommentSourceUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                />
                <button
                  type="button"
                  className="btn"
                  disabled={testingComment || !commentSourceUrl.trim()}
                  onClick={testCommentWebhook}
                  title="Test webhook để xem nội dung bình luận n8n trả về"
                >
                  {testingComment ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
                  Test Webhook
                </button>
              </div>
            </label>
            {commentTestResult && (
              <p className={`test-result ${commentTestResult.startsWith('OK') ? 'pass' : 'fail'}`}>
                {commentTestResult}
              </p>
            )}
            {commentTimingWarning() && (
              <p className="test-result fail">{commentTimingWarning()}</p>
            )}
          </>
        )}

        {action === 'interact' && (
          <>
            <label className="field">
              <span>Thời lượng phiên (phút) *</span>
              <input
                type="number"
                min={1}
                value={interactDurationMinutes}
                onChange={(e) => setInteractDurationMinutes(e.target.value)}
                placeholder="VD: 15"
              />
            </label>
            <label className="field">
              <span>Số bình luận mỗi phiên (0 = tự động)</span>
              <input
                type="number"
                min={0}
                value={interactCommentTarget}
                onChange={(e) => setInteractCommentTarget(e.target.value)}
                placeholder="0 = tự tính theo thời lượng"
              />
            </label>
            <p className="hint">
              Mỗi lần lịch kích hoạt, app mở profile và mô phỏng người thật trên feed suốt thời lượng:
              cuộn feed, thỉnh thoảng thả tim, bình luận (nội dung do AI sinh theo bài), thỉnh thoảng F5.
            </p>
            <p className="hint">
              <b>Số bình luận mỗi phiên</b>: để <b>0</b> thì app tự tính theo thời lượng (khoảng
              1 bình luận mỗi 2,5 phút). Đặt số cụ thể thì app phân bổ để đạt đúng số đó, giãn đều
              trong phiên. Mỗi bình luận cần tối thiểu ~90 giây (chống spam) nên số tối đa ≈ thời
              lượng (phút) × 60 ÷ 90.
            </p>
            <p className="hint">
              Bình luận cần cấu hình AI ở tab <b>Cài đặt → AI sinh bình luận</b>. Nếu chưa cấu hình,
              phiên vẫn chạy nhưng bỏ qua bình luận. Bình luận tôn trọng giới hạn comment/ngày.
            </p>
          </>
        )}

        <label className="field">
          <span>Mô hình</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as ScheduleKind)}>
            <option value="interval">Theo khoảng (mỗi N phút)</option>
            <option value="fixed">Theo giờ cố định (HH:MM mỗi ngày)</option>
          </select>
        </label>
        {kind === 'interval' ? (
          <label className="field">
            <span>Thời gian giữa mỗi tác vụ (phút) *</span>
            <input
              type="number"
              min={1}
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(e.target.value)}
              placeholder="VD: 30"
            />
          </label>
        ) : (
          <label className="field">
            <span>Giờ chạy mỗi ngày * (HH:MM, cách nhau bởi dấu phẩy hoặc dòng)</span>
            <textarea
              value={times}
              onChange={(e) => setTimes(e.target.value)}
              placeholder="VD: 08:00, 12:30, 19:00"
              rows={3}
              className="mono"
            />
          </label>
        )}
        <label className="field">
          <span>Jitter ± giây (ngẫu nhiên mỗi lần để giống người — để 0 là tắt)</span>
          <input
            type="number"
            min={0}
            value={jitterSeconds}
            onChange={(e) => setJitterSeconds(e.target.value)}
            placeholder="VD: 60"
          />
        </label>
        <label className="field checkbox-field">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>Bật lịch ngay sau khi lưu</span>
        </label>
        {error && <p className="test-result fail">{error}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={saving}>
            Hủy
          </button>
          <button className="btn primary" disabled={saving} onClick={save}>
            {saving ? <Loader2 size={15} className="spin" /> : action === 'delete' ? <Trash size={15} /> : action === 'comment' ? <MessageSquare size={15} /> : action === 'interact' ? <Activity size={15} /> : <CalendarClock size={15} />}
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Mô tả lịch gọn cho bảng.
function describe(s: Schedule): string {
  const timing =
    s.kind === 'interval'
      ? `Mỗi ${s.intervalMinutes ?? '?'} phút${s.jitterSeconds ? ` ±${s.jitterSeconds}s` : ''}`
      : `${s.times.join(', ') || '—'}${s.jitterSeconds ? ` ±${s.jitterSeconds}s` : ''}`

  if (s.action === 'delete') {
    const countText = s.deleteCount === 0 ? 'tất cả' : `${s.deleteCount} bài`
    const modeText = s.deleteMode === 'by_date' ? `trước/đến ${s.deleteBeforeDate ?? '?'}` : 'mới nhất'
    return `Xoá ${countText} (${modeText}) · ${timing}`
  }
  if (s.action === 'comment') {
    return `Bình luận ${s.commentCount ?? 1} bài · ${timing}`
  }
  if (s.action === 'interact') {
    return `Tương tác ${s.interactDurationMinutes ?? 15} phút · ${timing}`
  }

  return timing
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString()
}

// Đếm ngược realtime tới lần kế: hiển thị "44m 27s → 03:58 PM" kiểu realtime.
function fmtCountdown(nextRunAt: number): string {
  const diff = nextRunAt - Date.now();
  const at = new Date(nextRunAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff <= 0) return `${at} (sắp)`;

  const mins = Math.floor(diff / 60_000);
  const secs = Math.floor((diff % 60_000) / 1000);

  const display = mins >= 60
    ? `${Math.floor(mins / 60)}h ${mins % 60}m`
    : `${mins}m ${secs}s`;

  return `${display} → ${at}`;
}

// Ô "Lần kế": hiển thị trạng thái hàng đợi scheduler.
// - running           -> "Đang chạy"
// - đến giờ nhưng chờ  -> "Đang chờ hàng đợi" (slot concurrency đầy hoặc account đang chạy)
// - bình thường        -> countdown realtime
// - tắt / chưa có kế  -> "—"
function nextRunCell(s: Schedule): JSX.Element {
  if (s.running) {
    return <span className="badge on">Đang chạy</span>
  }
  if (s.enabled && s.nextRunAt && s.nextRunAt <= Date.now()) {
    return <span className="badge st-queued">Đang chờ hàng đợi</span>
  }
  if (s.enabled && s.nextRunAt) {
    return <>{fmtCountdown(s.nextRunAt)}</>
  }
  return <>—</>
}
