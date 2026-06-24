import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, Loader2, ListOrdered, Send, Trash, Clock, CalendarClock } from 'lucide-react'
import type { Account, Schedule, AppSettings } from '@shared/types'

// Trạng thái hàng đợi của 1 lịch.
type QueueStatus = 'running' | 'waiting' | 'upcoming'

function classifySchedule(s: Schedule, now: number): QueueStatus {
  if (s.running) return 'running'
  if (s.enabled && s.nextRunAt && s.nextRunAt <= now) return 'waiting'
  return 'upcoming'
}

const STATUS_BADGE: Record<QueueStatus, { cls: string; text: string }> = {
  running: { cls: 'on', text: 'Đang chạy' },
  waiting: { cls: 'st-queued', text: 'Đang chờ hàng đợi' },
  upcoming: { cls: 'st-disabled', text: 'Sắp tới' }
}

const STATUS_ORDER: Record<QueueStatus, number> = { running: 0, waiting: 1, upcoming: 2 }

export default function QueueView(): JSX.Element {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(false)
  const [, force] = useState(0)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [list, accs, settings] = await Promise.all([
        window.aviary.schedules.list(),
        window.aviary.accounts.list(),
        window.aviary.settings.get()
      ])
      setSchedules(list)
      setAccounts(accs)
      setSettings(settings)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    // Countdown realtime — force render mỗi 500ms (đủ mượt cho phút/giây).
    const ivForce = setInterval(() => force((n) => n + 1), 500)
    // Làm mới định kỳ để cập nhật trạng thái hàng đợi.
    const ivRefresh = setInterval(refresh, 10_000)
    // Hàng đợi thay đổi (nhặt lịch / chạy xong / nhả slot) -> làm mới ngay.
    const offQueue = window.aviary.post.onQueueChanged(() => {
      window.aviary.schedules.list().then(setSchedules).catch(() => {})
    })
    // Tiến trình tác vụ: khi xong (busy=false) -> làm mới để cập nhật trạng thái.
    const offProgress = window.aviary.post.onProgress((p) => {
      if (!p.busy) window.aviary.schedules.list().then(setSchedules).catch(() => {})
    })
    return () => {
      clearInterval(ivForce)
      clearInterval(ivRefresh)
      offQueue()
      offProgress()
    }
  }, [refresh])

  function accountOf(accountId: string): Account | undefined {
    return accounts.find((a) => a.id === accountId)
  }

  // Lọc: chỉ hiển thị lịch đang bật (enabled) — tắt thì không nằm trong hàng đợi.
  const now = Date.now()
  const queueItems = schedules
    .filter((s) => s.enabled)
    .map((s) => ({ s, status: classifySchedule(s, now) }))
    .sort((a, b) => {
      // Ưu tiên: running > waiting > upcoming. Trong cùng nhóm: sắp tới -> theo nextRunAt.
      const ordDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
      if (ordDiff !== 0) return ordDiff
      const aTime = a.s.nextRunAt ?? 0
      const bTime = b.s.nextRunAt ?? 0
      return aTime - bTime
    })

  const runningCount = queueItems.filter((q) => q.status === 'running').length
  const waitingCount = queueItems.filter((q) => q.status === 'waiting').length
  const upcomingCount = queueItems.filter((q) => q.status === 'upcoming').length
  const concurrency = settings?.concurrency ?? 3

  return (
    <div className="view">
      <div className="toolbar">
        <button className="btn" onClick={refresh} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spin' : undefined} />
          Làm mới
        </button>

        <span className="bulk-sep" />

        {/* Tóm tắt slot đồng thời */}
        <div className="queue-slot-summary">
          <span className={`badge ${runningCount >= concurrency ? 'st-queued' : 'on'}`}>
            {runningCount}/{concurrency} slot
          </span>
          <span className="muted small">đang dùng</span>
        </div>

        {runningCount > 0 && (
          <span className="badge count-badge queue-running-badge">
            <Loader2 size={12} className="spin" /> {runningCount} đang chạy
          </span>
        )}
        {waitingCount > 0 && (
          <span className="badge st-queued count-badge">
            {waitingCount} đang chờ
          </span>
        )}
        {upcomingCount > 0 && (
          <span className="badge count-badge queue-upcoming-badge">
            {upcomingCount} sắp tới
          </span>
        )}
      </div>

      {queueItems.length === 0 ? (
        <div className="empty-state">
          <ListOrdered size={36} />
          <p>Hàng đợi trống</p>
          <span>
            Chưa có lịch nào đang bật. Hãy thêm lịch ở tab "Lên lịch" để tài khoản tự động
            đăng/xoá bài theo hàng đợi.
          </span>
        </div>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Tài khoản</th>
                <th>Tác vụ</th>
                <th>Trạng thái</th>
                <th>Chi tiết lịch</th>
                <th>Lần kế</th>
              </tr>
            </thead>
            <tbody>
              {queueItems.map(({ s, status }) => {
                const acc = accountOf(s.accountId)
                const badge = STATUS_BADGE[status]
                return (
                  <tr key={s.id} className={status === 'running' ? 'row-running' : ''}>
                    <td className="cell-label">
                      <div className="cell-label-main" title={acc?.label ?? '(đã xoá)'}>
                        {acc?.label ?? '(đã xoá)'}
                      </div>
                      {acc?.handle && (
                        <div className="small muted">@{acc.handle.replace(/^@/, '')}</div>
                      )}
                      {s.label && <div className="small muted">{s.label}</div>}
                    </td>
                    <td>
                      <span className={`badge ${s.action === 'delete' ? 'action-delete' : 'action-post'}`}>
                        {s.action === 'delete' ? (
                          <>
                            <Trash size={12} /> Xoá
                          </>
                        ) : (
                          <>
                            <Send size={12} /> Đăng
                          </>
                        )}
                      </span>
                      {/* Chi tiết xoá bài */}
                      {s.action === 'delete' && (
                        <div className="small muted" style={{ marginTop: 2 }}>
                          {s.deleteCount === 0 ? 'tất cả' : `${s.deleteCount} bài`}
                          {s.deleteMode === 'by_date' && s.deleteBeforeDate
                            ? ` · đến ${s.deleteBeforeDate}`
                            : ' · mới nhất'}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${badge.cls}`}>
                        {status === 'running' && <Loader2 size={12} className="spin" />}
                        <span className="dot" />
                        {badge.text}
                      </span>
                    </td>
                    <td className="small">
                      <span className="queue-detail-line">
                        {s.kind === 'interval' ? (
                          <>
                            <Clock size={12} /> Mỗi {s.intervalMinutes ?? '?'} phút
                          </>
                        ) : (
                          <>
                            <CalendarClock size={12} /> {s.times.join(', ') || '—'}
                          </>
                        )}
                        {s.jitterSeconds ? ` ±${s.jitterSeconds}s` : ''}
                      </span>
                    </td>
                    <td className="mono small">{nextRunCell(s, status)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Ô "Lần kế": hiển thị theo trạng thái hàng đợi.
function nextRunCell(s: Schedule, status: QueueStatus): JSX.Element {
  if (status === 'running') return <span className="badge on">đang chạy…</span>
  if (status === 'waiting') return <span className="badge st-queued">chờ slot…</span>
  if (s.nextRunAt) return <>{fmtCountdown(s.nextRunAt)}</>
  return <>—</>
}

// Đếm ngược realtime: "44m 27s → 03:58 PM".
function fmtCountdown(nextRunAt: number): string {
  const diff = nextRunAt - Date.now()
  const at = new Date(nextRunAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diff <= 0) return `${at} (sắp)`

  const mins = Math.floor(diff / 60_000)
  const secs = Math.floor((diff % 60_000) / 1000)

  const display = mins >= 60
    ? `${Math.floor(mins / 60)}h ${mins % 60}m`
    : `${mins}m ${secs}s`

  return `${display} → ${at}`
}
