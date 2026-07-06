import { useEffect, useState, useCallback, useRef } from 'react'
import {
  RefreshCw,
  Loader2,
  ListOrdered,
  Send,
  Trash,
  MessageCircle,
  Clock,
  CalendarClock,
  ArrowRight,
  BarChart3,
  Activity,
  Square
} from 'lucide-react'
import type { Account, Schedule, AppSettings } from '@shared/types'

// Trạng thái hàng đợi của 1 lịch.
type QueueStatus = 'running' | 'waiting' | 'upcoming'

function classifySchedule(s: Schedule, now: number): QueueStatus {
  if (s.running) return 'running'
  if (s.enabled && s.nextRunAt && s.nextRunAt <= now) return 'waiting'
  return 'upcoming'
}

const STATUS_META: Record<QueueStatus, { cls: string; text: string }> = {
  running: { cls: 'st-running', text: 'Đang chạy' },
  waiting: { cls: 'st-waiting', text: 'Chờ slot' },
  upcoming: { cls: 'st-upcoming', text: 'Sắp tới' }
}

const STATUS_ORDER: Record<QueueStatus, number> = { running: 0, waiting: 1, upcoming: 2 }

// Tiến trình realtime của 1 tài khoản đang chạy (lấy từ onProgress).
interface LiveProgress {
  stage: string
  message: string
}

export default function QueueView(): JSX.Element {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(false)
  const [, force] = useState(0)
  // Map accountId -> dòng tiến trình sống nhất (vd "Đang chờ X xác nhận…").
  const [live, setLive] = useState<Record<string, LiveProgress>>({})
  const liveRef = useRef(live)
  liveRef.current = live
  // Tập accountId user đã bấm Dừng nhưng phiên chưa kết thúc (để hiện "Đang dừng…").
  const [stopping, setStopping] = useState<Set<string>>(new Set())

  // Bấm Dừng: gọi IPC dừng + đánh dấu đang-dừng. Cờ tự xoá khi phiên hết busy (onProgress).
  const stopAccount = useCallback((accountId: string) => {
    setStopping((prev) => new Set(prev).add(accountId))
    window.aviary.post.stop(accountId).catch(() => {})
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [list, accs, st] = await Promise.all([
        window.aviary.schedules.list(),
        window.aviary.accounts.list(),
        window.aviary.settings.get()
      ])
      setSchedules(list)
      setAccounts(accs)
      setSettings(st)
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
    // Tiến trình tác vụ: cập nhật dòng "đang làm gì" cho từng tài khoản + làm mới khi xong.
    const offProgress = window.aviary.post.onProgress((p) => {
      if (p.accountId) {
        const id = p.accountId
        if (p.busy) {
          setLive((prev) => ({ ...prev, [id]: { stage: p.stage, message: p.message } }))
        } else {
          // Xong/lỗi -> xoá dòng sống + cờ đang-dừng của tài khoản đó.
          setLive((prev) => {
            if (!prev[id]) return prev
            const next = { ...prev }
            delete next[id]
            return next
          })
          setStopping((prev) => {
            if (!prev.has(id)) return prev
            const next = new Set(prev)
            next.delete(id)
            return next
          })
        }
      }
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

  // Đánh dấu item "kế tiếp": item upcoming có nextRunAt nhỏ nhất.
  const nextUpId = queueItems.find((q) => q.status === 'upcoming' && q.s.nextRunAt)?.s.id ?? null

  return (
    <div className="view">
      <div className="toolbar queue-toolbar">
        <button className="btn" onClick={refresh} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spin' : undefined} />
          Làm mới
        </button>

        <span className="bulk-sep" />

        {/* Slot meter dạng pips trực quan */}
        <div className="queue-slot-meter" title={`${runningCount}/${concurrency} slot đồng thời đang dùng`}>
          <span className="slot-pips">
            {Array.from({ length: concurrency }).map((_, i) => (
              <span key={i} className={`slot-pip ${i < runningCount ? 'on' : ''}`} />
            ))}
          </span>
          <span className="slot-meter-label">
            <strong>{runningCount}</strong>/{concurrency} slot
          </span>
        </div>

        <span className="queue-stat-group">
          {runningCount > 0 && (
            <span className="queue-stat running">
              <Loader2 size={12} className="spin" /> {runningCount} đang chạy
            </span>
          )}
          {waitingCount > 0 && (
            <span className="queue-stat waiting">
              <span className="dot" /> {waitingCount} chờ slot
            </span>
          )}
          {upcomingCount > 0 && (
            <span className="queue-stat upcoming">
              <span className="dot" /> {upcomingCount} sắp tới
            </span>
          )}
        </span>
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
        <div className="queue-list">
          {queueItems.map(({ s, status }) => (
            <QueueCard
              key={s.id}
              schedule={s}
              status={status}
              account={accountOf(s.accountId)}
              live={live[s.accountId]}
              isNext={s.id === nextUpId}
              slotsFull={runningCount >= concurrency}
              stopping={stopping.has(s.accountId)}
              onStop={stopAccount}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ---- Card 1 mục hàng đợi ----
function QueueCard(props: {
  schedule: Schedule
  status: QueueStatus
  account: Account | undefined
  live: LiveProgress | undefined
  isNext: boolean
  slotsFull: boolean
  stopping: boolean
  onStop: (accountId: string) => void
}): JSX.Element {
  const { schedule: s, status, account: acc, live, isNext, slotsFull, stopping, onStop } = props
  const meta = STATUS_META[status]
  // Phân biệt khi due nhưng chưa chạy: slot đầy -> "chờ slot trống"; slot còn trống ->
  // "đang xếp hàng" (sắp được nhặt ngay, chỉ thoáng qua) -> tránh báo "chờ slot" sai.
  const waitText = status === 'waiting' && !slotsFull ? 'Đang xếp hàng' : meta.text
  const isSystem = s.accountId === '__system__'
  const label = isSystem ? 'Hệ thống' : (acc?.label ?? '(đã xoá)')
  const initial = (label.charAt(0) || '?').toUpperCase()
  const pct = progressPercent(s, status)

  return (
    <div className={`queue-card status-${status} ${isNext ? 'is-next' : ''} ${isSystem ? 'is-system' : ''}`}>
      {/* Cột trái: avatar + danh tính + tác vụ */}
      <div className="qc-identity">
        <span className="qc-avatar" title={label}>
          {isSystem ? (
            <span className="qc-avatar-fallback qc-avatar-system">
              <BarChart3 size={18} />
            </span>
          ) : acc?.avatarUrl ? (
            <img src={acc.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <span className="qc-avatar-fallback">{initial}</span>
          )}
          {status === 'running' && <span className="qc-avatar-ring" />}
        </span>
        <div className="qc-names">
          <div className="qc-name" title={label}>
            {label}
            {isNext && <span className="qc-next-tag">kế tiếp</span>}
          </div>
          <div className="qc-sub">
            {isSystem ? (
              <span className="qc-handle">{s.label ?? 'Tự động fetch thống kê X'}</span>
            ) : (
              acc?.handle && <span className="qc-handle">@{acc.handle.replace(/^@/, '')}</span>
            )}
            <ActionChip action={s.action} schedule={s} isSystem={isSystem} />
          </div>
        </div>
      </div>

      {/* Cột giữa: lịch + tiến trình / dòng sống */}
      <div className="qc-middle">
        <div className="qc-schedule">
          {s.kind === 'interval' ? (
            <>
              <Clock size={12} /> Mỗi {s.intervalMinutes ?? '?'} phút
            </>
          ) : (
            <>
              <CalendarClock size={12} /> {s.times.join(', ') || '—'}
            </>
          )}
          {s.jitterSeconds ? <span className="qc-jitter">±{s.jitterSeconds}s</span> : null}
        </div>

        {status === 'running' ? (
          <div className="qc-live">
            <span className="qc-live-bar" />
            <span className="qc-live-text">{live?.message ?? 'Đang xử lý…'}</span>
          </div>
        ) : (
          <div className="qc-progress" title={`${Math.round(pct * 100)}% tới lần chạy kế`}>
            <div className={`qc-progress-fill ${status}`} style={{ width: `${Math.round(pct * 100)}%` }} />
          </div>
        )}
      </div>

      {/* Cột phải: trạng thái + countdown. Khi đang chạy: badge + nút Dừng nằm NGANG hàng. */}
      <div className="qc-right">
        <div className="qc-status-row">
          <span className={`qc-status ${meta.cls}`}>
            {status === 'running' ? (
              <Loader2 size={12} className="spin" />
            ) : (
              <span className="dot" />
            )}
            {status === 'waiting' ? waitText : meta.text}
          </span>
          {/* Nút Dừng — chỉ hiện khi tài khoản đang chạy (không áp dụng tác vụ hệ thống). */}
          {status === 'running' && !isSystem && (
            <button
              className="btn btn-stop qc-stop-btn"
              onClick={() => onStop(s.accountId)}
              disabled={stopping}
              title="Dừng phiên đang chạy của tài khoản này"
            >
              {stopping ? <Loader2 size={13} className="spin" /> : <Square size={13} />}
              {stopping ? 'Đang dừng…' : 'Dừng'}
            </button>
          )}
        </div>
        {status !== 'running' && (
          <div className="qc-countdown">{nextRunDisplay(s, status, slotsFull)}</div>
        )}
      </div>
    </div>
  )
}

// Chip tác vụ — đúng màu: đăng (xanh), xoá (đỏ), bình luận (tím), analytics hệ thống (cam).
function ActionChip({ action, schedule, isSystem }: { action: Schedule['action']; schedule: Schedule; isSystem?: boolean }): JSX.Element {
  if (isSystem) {
    return (
      <span className="qc-action action-system" title="Tác vụ hệ thống — tự động fetch thống kê X">
        <BarChart3 size={11} /> Analytics
      </span>
    )
  }
  if (action === 'delete') {
    const detail = schedule.deleteCount === 0 ? 'tất cả' : `${schedule.deleteCount} bài`
    return (
      <span className="qc-action action-delete" title={`Xoá ${detail}`}>
        <Trash size={11} /> Xoá
      </span>
    )
  }
  if (action === 'comment') {
    return (
      <span className="qc-action action-comment" title={`Bình luận ${schedule.commentCount} bài`}>
        <MessageCircle size={11} /> Bình luận
      </span>
    )
  }
  if (action === 'interact') {
    return (
      <span className="qc-action action-interact" title={`Tương tác ${schedule.interactDurationMinutes} phút`}>
        <Activity size={11} /> Tương tác
      </span>
    )
  }
  return (
    <span className="qc-action action-post">
      <Send size={11} /> Đăng
    </span>
  )
}

// % thời gian đã trôi từ lần chạy trước tới lần kế. Fallback theo interval khi
// thiếu lastRunAt. Trả về 0..1.
function progressPercent(s: Schedule, status: QueueStatus): number {
  if (status === 'waiting') return 1
  if (!s.nextRunAt) return 0
  const now = Date.now()
  let start: number
  if (s.lastRunAt && s.lastRunAt < s.nextRunAt) {
    start = s.lastRunAt
  } else if (s.kind === 'interval' && s.intervalMinutes) {
    // Chưa từng chạy: ước lượng mốc bắt đầu = nextRun - chu kỳ.
    start = s.nextRunAt - s.intervalMinutes * 60_000
  } else {
    start = s.nextRunAt - 86_400_000 // fixed: giả định cửa sổ 1 ngày
  }
  const span = s.nextRunAt - start
  if (span <= 0) return 1
  return Math.max(0, Math.min(1, (now - start) / span))
}

// Hiển thị "Lần kế" theo trạng thái.
function nextRunDisplay(s: Schedule, status: QueueStatus, slotsFull: boolean): JSX.Element {
  if (status === 'waiting') {
    return (
      <span className="qc-cd-waiting">{slotsFull ? 'chờ slot trống' : 'sắp chạy…'}</span>
    )
  }
  if (s.nextRunAt) return <Countdown nextRunAt={s.nextRunAt} />
  return <>—</>
}

// Countdown: "44m 27s → 03:58 PM" với giờ tách riêng cho dễ đọc.
function Countdown({ nextRunAt }: { nextRunAt: number }): JSX.Element {
  const diff = nextRunAt - Date.now()
  const at = new Date(nextRunAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diff <= 0) {
    return (
      <span className="qc-cd">
        <span className="qc-cd-soon">sắp chạy</span>
        <ArrowRight size={11} /> <span className="qc-cd-at">{at}</span>
      </span>
    )
  }
  const mins = Math.floor(diff / 60_000)
  const secs = Math.floor((diff % 60_000) / 1000)
  const display = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m ${secs}s`
  return (
    <span className="qc-cd">
      <span className="qc-cd-rel">{display}</span>
      <ArrowRight size={11} /> <span className="qc-cd-at">{at}</span>
    </span>
  )
}
