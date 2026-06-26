import { useEffect, useState, useCallback } from 'react'
import { Plus, Pencil, Trash2, RefreshCw, Loader2, Clock, CalendarClock, Trash, MessageSquare } from 'lucide-react'
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
  }, [refresh, showForm])

  async function handleDelete(s: Schedule): Promise<void> {
    const actionLabel = s.action === 'delete' ? 'xoá bài' : s.action === 'comment' ? 'bình luận' : 'đăng bài'
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
                    <span className={`badge ${s.action === 'delete' ? 'action-delete' : s.action === 'comment' ? 'action-comment' : 'action-post'}`}>
                      {s.action === 'delete' ? 'Xoá' : s.action === 'comment' ? 'Bình luận' : 'Đăng'}
                    </span>
                  </td>
                  <td>{s.kind === 'interval' ? 'Khoảng' : 'Giờ cố định'}</td>
                  <td className="small">{describe(s)}</td>
                  <td className="mono small">{s.lastRunAt ? fmtTime(s.lastRunAt) : '—'}</td>
                  <td className="mono small">{nextRunCell(s)}</td>
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
  // Comment fields
  const [commentCount, setCommentCount] = useState(String(schedule?.commentCount ?? 1))
  const [commentIntervalSeconds, setCommentIntervalSeconds] = useState(String(schedule?.commentIntervalSeconds ?? 60))
  const [commentSourceUrl, setCommentSourceUrl] = useState(schedule?.commentSourceUrl ?? '')
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
      commentSourceUrl: action === 'comment' ? commentSourceUrl.trim() || null : null
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
            <option value="comment">Bình luận</option>
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
            {saving ? <Loader2 size={15} className="spin" /> : action === 'delete' ? <Trash size={15} /> : action === 'comment' ? <MessageSquare size={15} /> : <CalendarClock size={15} />}
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
