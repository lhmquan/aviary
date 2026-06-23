import { useEffect, useState, useCallback } from 'react'
import { Plus, Pencil, Trash2, RefreshCw, Loader2, Clock, CalendarClock, Trash } from 'lucide-react'
import type { Account, Schedule, ScheduleInput, ScheduleKind, ScheduleAction, DeleteMode } from '@shared/types'

const REFRESH_MS = 15_000

export default function ScheduleView(): JSX.Element {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Schedule | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const [, force] = useState(0)

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
    if (showForm) return

    refresh()
    // Làm mới định kỳ để cập nhật "lần chạy cuối / lần kế" + force render countdown realtime.
    const ivRefresh = setInterval(() => {
      window.aviary.schedules.list().then(setSchedules).catch(() => {})
    }, REFRESH_MS)
    const ivForce = setInterval(() => force((n) => n + 1), 100)

    const off = window.aviary.post.onProgress((p) => {
      if (!p.busy) refresh()
    })
    return () => {
      clearInterval(ivRefresh)
      clearInterval(ivForce)
      off()
    }
  }, [refresh, showForm])

  async function handleDelete(s: Schedule): Promise<void> {
    const actionLabel = s.action === 'delete' ? 'xoá bài' : 'đăng bài'
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
      </div>

      {schedules.length === 0 ? (
        <div className="empty-state">
          <Clock size={36} />
          <p>Chưa có lịch nào</p>
          <span>
            Thêm lịch để profile tự đăng bài hoặc xoá bài theo giờ / khoảng thời gian. Mọi sự kiện
            được ghi vào Nhật ký.
          </span>
        </div>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
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
              {schedules.map((s) => (
                <tr key={s.id}>
                  <td className="cell-label">
                    {accountLabel(s.accountId)}
                    {s.label && <div className="small muted">{s.label}</div>}
                  </td>
                  <td>
                    <span className={`badge ${s.action === 'delete' ? 'action-delete' : 'action-post'}`}>
                      {s.action === 'delete' ? 'Xoá' : 'Đăng'}
                    </span>
                  </td>
                  <td>{s.kind === 'interval' ? 'Khoảng' : 'Giờ cố định'}</td>
                  <td className="small">{describe(s)}</td>
                  <td className="mono small">{s.lastRunAt ? fmtTime(s.lastRunAt) : '—'}</td>
                  <td className="mono small">
                    {s.enabled && s.nextRunAt ? fmtCountdown(s.nextRunAt) : '—'}
                  </td>
                  <td>
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
                  </td>
                  <td className="actions">
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
                      className="btn icon-only danger"
                      title="Xóa"
                      onClick={() => handleDelete(s)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <ScheduleForm
          schedule={editing}
          accounts={accounts}
          onClose={() => setShowForm(false)}
          onSaved={async () => {
            setShowForm(false)
            await refresh()
          }}
        />
      )}
    </div>
  )
}

function ScheduleForm(props: {
  schedule: Schedule | null
  accounts: Account[]
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const { schedule, accounts, onClose, onSaved } = props
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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function accountSelection(): string[] {
    return accountScope === 'all' ? accounts.map((a) => a.id) : selectedAccountIds
  }

  async function save(): Promise<void> {
    setError(null)
    const targetAccountIds = accountSelection()
    if (targetAccountIds.length === 0) {
      setError('Phải chọn ít nhất 1 tài khoản')
      return
    }
    const parsedDeleteCount = deleteCount.trim() === '' ? 1 : Number(deleteCount)
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
      deleteCount: action === 'delete' ? Math.max(0, parsedDeleteCount) : 1
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
          <label className="field">
            <span>Tài khoản * ({selectedAccountIds.length} đã chọn)</span>
            <select
              multiple
              className="multi-select"
              size={Math.min(8, Math.max(3, accounts.length))}
              value={selectedAccountIds}
              onChange={(e) =>
                setSelectedAccountIds(Array.from(e.currentTarget.selectedOptions, (opt) => opt.value))
              }
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <p className="hint">Giữ Ctrl hoặc Shift để chọn nhiều tài khoản.</p>
          </label>
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

        <label className="field">
          <span>Mô hình</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as ScheduleKind)}>
            <option value="interval">Theo khoảng (mỗi N phút)</option>
            <option value="fixed">Theo giờ cố định (HH:MM mỗi ngày)</option>
          </select>
        </label>
        {kind === 'interval' ? (
          <label className="field">
            <span>Số phút giữa mỗi lần {action === 'delete' ? 'xoá' : 'đăng'} *</span>
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
            <span>Giờ {action === 'delete' ? 'xoá' : 'đăng'} mỗi ngày * (HH:MM, cách nhau bởi dấu phẩy hoặc dòng)</span>
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
            {saving ? <Loader2 size={15} className="spin" /> : action === 'delete' ? <Trash size={15} /> : <CalendarClock size={15} />}
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
