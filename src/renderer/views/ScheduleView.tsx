import { useEffect, useState, useCallback } from 'react'
import { Plus, Pencil, Trash2, RefreshCw, Loader2, Clock, CalendarClock } from 'lucide-react'
import type { Account, Schedule, ScheduleInput, ScheduleKind } from '@shared/types'

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
    refresh()
    // Làm mới định kỳ để cập nhật "lần chạy cuối / lần kế" + tự tick mỗi 15s.
    const iv = setInterval(() => {
      window.aviary.schedules.list().then(setSchedules).catch(() => {})
      force((n) => n + 1) // ép render lại để đếm ngược "lần kế" cập nhật
    }, REFRESH_MS)
    const off = window.aviary.post.onProgress((p) => {
      // Khi một job (manual hoặc schedule) xong -> nạp lại để cập nhật last_run.
      if (!p.busy) refresh()
    })
    return () => {
      clearInterval(iv)
      off()
    }
  }, [refresh])

  async function handleDelete(s: Schedule): Promise<void> {
    if (!confirm(`Xóa lịch "${describe(s)}" cho ${accountLabel(s.accountId)}?`)) return
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
            Thêm lịch để profile tự đăng bài theo giờ / khoảng thời gian. Mọi sự kiện được
            ghi vào Nhật ký.
          </span>
        </div>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Tài khoản</th>
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
  const [accountId, setAccountId] = useState(schedule?.accountId ?? accounts[0]?.id ?? '')
  const [label, setLabel] = useState(schedule?.label ?? '')
  const [kind, setKind] = useState<ScheduleKind>(schedule?.kind ?? 'interval')
  const [intervalMinutes, setIntervalMinutes] = useState(
    String(schedule?.intervalMinutes ?? 30)
  )
  const [times, setTimes] = useState((schedule?.times ?? []).join(', '))
  const [jitterSeconds, setJitterSeconds] = useState(String(schedule?.jitterSeconds ?? 0))
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(): Promise<void> {
    setError(null)
    const input: ScheduleInput = {
      accountId,
      label: label.trim() || null,
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
      enabled
    }
    setSaving(true)
    try {
      if (schedule) await window.aviary.schedules.update(schedule.id, input)
      else await window.aviary.schedules.create(input)
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
          <span>Tài khoản *</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Nhãn (tùy chọn)</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="VD: Lịch sáng" />
        </label>
        <label className="field">
          <span>Mô hình</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as ScheduleKind)}>
            <option value="interval">Theo khoảng (mỗi N phút)</option>
            <option value="fixed">Theo giờ cố định (HH:MM mỗi ngày)</option>
          </select>
        </label>
        {kind === 'interval' ? (
          <label className="field">
            <span>Số phút giữa mỗi lần đăng *</span>
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
            <span>Giờ đăng mỗi ngày * (HH:MM, cách nhau bởi dấu phẩy hoặc dòng)</span>
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
            {saving ? <Loader2 size={15} className="spin" /> : <CalendarClock size={15} />}
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Mô tả lịch gọn cho bảng.
function describe(s: Schedule): string {
  if (s.kind === 'interval') {
    return `Mỗi ${s.intervalMinutes ?? '?'} phút${s.jitterSeconds ? ` ±${s.jitterSeconds}s` : ''}`
  }
  return `${s.times.join(', ') || '—'}${s.jitterSeconds ? ` ±${s.jitterSeconds}s` : ''}`
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString()
}

// Đếm ngược tới lần kế: hiển thị "5m 12s" / "2h 3m" + giờ cụ thể.
function fmtCountdown(nextRunAt: number): string {
  const diff = nextRunAt - Date.now()
  const at = new Date(nextRunAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diff <= 0) return `${at} (sắp)`
  const mins = Math.floor(diff / 60_000)
  const secs = Math.floor((diff % 60_000) / 1000)
  const hm = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m ${secs}s`
  return `${hm} → ${at}`
}