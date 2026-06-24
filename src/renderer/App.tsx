import { useEffect, useState, useCallback, useRef, memo } from 'react'
import {
  Users,
  Clock,
  ListOrdered,
  ScrollText,
  Settings,
  Feather,
  Monitor,
  Sun,
  Moon,
  RefreshCw,
  RotateCcw,
  Download,
  Loader2,
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronUp,
  Globe,
  TerminalSquare,
  Trash2,
  Minimize2,
  Maximize2,
  BarChart3
} from 'lucide-react'
import type { AppInfo, UpdateStatusPayload, ProgressPayload } from '@shared/types'
import AccountsView from './views/AccountsView'
import SettingsView from './views/SettingsView'
import LogsView from './views/LogsView'
import ProxiesView from './views/ProxiesView'
import ScheduleView from './views/ScheduleView'
import QueueView from './views/QueueView'
import AnalyticsView from './views/AnalyticsView'

type Section = 'accounts' | 'proxies' | 'schedule' | 'queue' | 'analytics' | 'logs' | 'settings'
type ThemeMode = 'system' | 'light' | 'dark'

type TerminalLine = {
  id: number
  ts: number
  time: string // giờ HH:MM:SS đã format sẵn 1 lần (tránh format lại mỗi lần re-render)
  accountId?: string
  accountLabel?: string
  stage: string
  message: string
  busy: boolean
}

const MIN_TERMINAL_HEIGHT = 44
const MAX_TERMINAL_HEIGHT = 320
const DEFAULT_TERMINAL_HEIGHT = 148
// Trần số dòng giữ trong DOM. Vượt quá -> cắt bớt dòng cũ nhất. 500 node DOM gây đơ/lag khi
// co dãn & cuộn; ~180 dòng đủ cho ngữ cảnh gần mà vẫn mượt.
const MAX_LINES = 180

// Format giờ 1 lần khi nhận sự kiện (không gọi trong render). Hàm thuần, không phụ thuộc state.
function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('vi-VN', { hour12: false })
}

// Nhãn ngắn gọn cho từng stage (hiển thị trong pill). Không khớp -> dùng nguyên stage.
const STAGE_LABEL: Record<string, string> = {
  schedule: 'LỊCH',
  prepare: 'CHUẨN BỊ',
  open: 'MỞ',
  fetch: 'TẢI DỮ LIỆU',
  download: 'TẢI MEDIA',
  post: 'ĐĂNG',
  delete: 'XOÁ',
  markdone: 'N8N',
  done: 'XONG',
  error: 'LỖI',
  idle: 'SẴN SÀNG'
}

// 1 dòng log — tách riêng + memo để khi thêm dòng mới, các dòng cũ KHÔNG re-render (mấu chốt
// giữ mượt khi danh sách dài).
const TerminalRow = memo(function TerminalRow({ line }: { line: TerminalLine }): JSX.Element {
  const account = line.accountLabel ?? line.accountId
  return (
    <div className={`terminal-line stage-${line.stage}`}>
      <span className="terminal-time">{line.time}</span>
      <span className="terminal-stage">{STAGE_LABEL[line.stage] ?? line.stage}</span>
      {account && account !== 'system' && <span className="terminal-account">{account}</span>}
      <span className="terminal-message">{line.message}</span>
    </div>
  )
})

const NAV: { id: Section; label: string; icon: typeof Users }[] = [
  { id: 'accounts', label: 'Tài khoản', icon: Users },
  { id: 'proxies', label: 'Proxy', icon: Globe },
  { id: 'schedule', label: 'Lên lịch', icon: Clock },
  { id: 'queue', label: 'Hàng đợi', icon: ListOrdered },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'logs', label: 'Nhật ký', icon: ScrollText },
  { id: 'settings', label: 'Cài đặt', icon: Settings }
]

const SUBTITLE: Record<Section, string> = {
  accounts: 'Quản lý tài khoản và profile Chromium',
  proxies: 'Kho proxy chung — gán cho từng tài khoản',
  schedule: 'Lên lịch đăng bài tự động',
  queue: 'Hàng đợi scheduler — tài khoản đang chạy, chờ slot và sắp tới',
  analytics: 'Theo dõi tăng trưởng followers, following, bài viết theo ngày',
  logs: 'Theo dõi lịch sử đăng bài và lỗi',
  settings: 'Cấu hình webhook, thư mục và hiệu năng'
}

const THEME_ICON: Record<ThemeMode, typeof Monitor> = {
  system: Monitor,
  light: Sun,
  dark: Moon
}

const UPDATE_LABEL: Record<string, string> = {
  checking: 'Đang kiểm tra…',
  available: 'Có bản mới, đang tải…',
  none: 'Đang ở bản mới nhất',
  downloading: 'Đang tải bản mới…',
  downloaded: 'Cài đặt & khởi động lại',
  error: 'Thử lại kiểm tra'
}

export default function App(): JSX.Element {
  const [active, setActive] = useState<Section>('accounts')
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      return (localStorage.getItem('aviary-theme') as ThemeMode) || 'system'
    } catch {
      return 'system'
    }
  })
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusPayload | null>(null)
  const [updating, setUpdating] = useState(false)
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([])
  const [terminalBusy, setTerminalBusy] = useState(false)
  const [statusbarOn, setStatusbarOn] = useState(true)
  const [terminalCollapsed, setTerminalCollapsed] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('aviary-statusbar-height'))
      return Number.isFinite(saved)
        ? Math.min(MAX_TERMINAL_HEIGHT, Math.max(MIN_TERMINAL_HEIGHT, saved))
        : DEFAULT_TERMINAL_HEIGHT
    } catch {
      return DEFAULT_TERMINAL_HEIGHT
    }
  })
  const terminalLogRef = useRef<HTMLDivElement | null>(null)
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const lineIdRef = useRef(0)
  // atBottom: người dùng có đang ở đáy log không. Chỉ auto-scroll khi ở đáy -> không "giật"
  // người dùng đang cuộn lên xem lịch sử. Khi không ở đáy -> hiện nút "xuống cuối".
  const [atBottom, setAtBottom] = useState(true)

  useEffect(() => {
    window.aviary.getAppInfo().then(setInfo)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('aviary-theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  useEffect(() => window.aviary.update.onStatus(setUpdateStatus), [])

  // #6: lắng nghe tiến trình tác vụ để hiển thị terminal trạng thái realtime.
  useEffect(
    () =>
      window.aviary.post.onProgress((p: ProgressPayload) => {
        const ts = Date.now()
        const line: TerminalLine = { id: lineIdRef.current++, ts, time: formatClock(ts), ...p }
        setTerminalBusy(p.busy)
        setTerminalLines((prev) => {
          const next = prev.length >= MAX_LINES ? prev.slice(prev.length - MAX_LINES + 1) : prev.slice()
          next.push(line)
          return next
        })
      }),
    []
  )

  // Auto-scroll thông minh: chỉ bám đáy khi người dùng đang ở đáy (atBottom). Nếu họ cuộn lên
  // xem lịch sử thì KHÔNG kéo xuống (tránh giật). dòng mới -> cuộn nếu atBottom.
  useEffect(() => {
    const el = terminalLogRef.current
    if (!el || terminalCollapsed || !atBottom) return
    el.scrollTop = el.scrollHeight
  }, [terminalLines, terminalCollapsed, atBottom])

  // Theo dõi vị trí cuộn để biết người dùng còn ở đáy không (ngưỡng 24px).
  const handleTerminalScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    setAtBottom(nearBottom)
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = terminalLogRef.current
    if (el) el.scrollTop = el.scrollHeight
    setAtBottom(true)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('aviary-statusbar-height', String(terminalHeight))
    } catch {
      /* ignore */
    }
  }, [terminalHeight])

  const cycleTheme = useCallback(() => {
    setTheme((t) => (t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system'))
  }, [])

  const handleCheckUpdate = useCallback(async () => {
    setUpdating(true)
    setUpdateStatus({ state: 'checking' })
    try {
      await window.aviary.update.check()
    } finally {
      setUpdating(false)
    }
  }, [])

  const handleInstallUpdate = useCallback(async () => {
    await window.aviary.update.install().catch(() => {})
  }, [])

  const handleReload = useCallback(async () => {
    await window.aviary.relaunch().catch(() => {})
  }, [])

  const ThemeIcon = THEME_ICON[theme]
  const state = updateStatus?.state ?? 'idle'
  const canInstall = state === 'downloaded'
  const isBusy = state === 'checking' || state === 'downloading' || updating

  const shownTerminalHeight = terminalCollapsed ? MIN_TERMINAL_HEIGHT : terminalHeight

  const handleResizeStart = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      resizeRef.current = { startY: e.clientY, startHeight: terminalHeight }
      const onMove = (ev: MouseEvent): void => {
        const drag = resizeRef.current
        if (!drag) return
        const delta = drag.startY - ev.clientY
        setTerminalHeight(Math.min(MAX_TERMINAL_HEIGHT, Math.max(MIN_TERMINAL_HEIGHT, drag.startHeight + delta)))
        setTerminalCollapsed(false)
      }
      const onUp = (): void => {
        resizeRef.current = null
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [terminalHeight]
  )

  const latestLine = terminalLines.length > 0 ? terminalLines[terminalLines.length - 1] : null
  const terminalState = latestLine?.stage === 'error' ? 'error' : terminalBusy ? 'busy' : 'idle'
  const terminalTitle = terminalBusy
    ? 'Đang xử lý'
    : latestLine?.stage === 'error'
      ? 'Có lỗi'
      : 'Sẵn sàng'
  const isEmpty = terminalLines.length === 0

  return (
    <div className="app">
      <div className="app-body">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <Feather size={20} />
          </span>
          <span className="brand-name">Aviary</span>
        </div>

        <nav>
          {NAV.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                className={`nav-item ${active === item.id ? 'active' : ''}`}
                onClick={() => setActive(item.id)}
              >
                <span className="nav-icon">
                  <Icon size={18} />
                </span>
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="update-area">
            <button
              className={`btn block ${canInstall ? 'primary' : ''}`}
              disabled={isBusy}
              onClick={canInstall ? handleInstallUpdate : handleCheckUpdate}
              title="Kiểm tra & cài bản cập nhật mới"
            >
              {isBusy ? (
                <Loader2 size={16} className="spin" />
              ) : canInstall ? (
                <Download size={16} />
              ) : (
                <RefreshCw size={16} />
              )}
              {UPDATE_LABEL[state] ?? 'Kiểm tra cập nhật'}
            </button>

            {state === 'downloading' && (
              <div className="progress">
                <div
                  className="progress-bar"
                  style={{ width: `${updateStatus?.percent ?? 0}%` }}
                />
              </div>
            )}
            {state === 'error' && (
              <p className="update-error">{updateStatus?.error || 'Lỗi không xác định'}</p>
            )}
          </div>

          <div className="sidebar-bottom">
            <div className="sidebar-actions">
              <button
                className="btn ghost icon-only"
                onClick={cycleTheme}
                title={`Giao diện: ${theme}`}
              >
                <ThemeIcon size={16} />
              </button>
              <button
                className="btn ghost icon-only"
                onClick={handleReload}
                title="Reload — đóng profile và khởi động lại app để nạp code mới"
              >
                <RotateCcw size={16} />
              </button>
            </div>
            <span className="version">{info ? `v${info.version}` : ''}</span>
          </div>
        </div>
      </aside>

      <main className="content">
        <header className="page-header">
          <h1>{NAV.find((n) => n.id === active)?.label}</h1>
          <p className="page-subtitle">{SUBTITLE[active]}</p>
        </header>

        {active === 'accounts' && <AccountsView />}
        {active === 'proxies' && <ProxiesView />}
        {active === 'schedule' && <ScheduleView />}
        {active === 'settings' && <SettingsView />}
        {active === 'logs' && <LogsView />}
        {active === 'queue' && <QueueView />}
        {active === 'analytics' && <AnalyticsView />}
      </main>
      </div>

      {statusbarOn && (
        <footer
          className={`terminal-panel ${terminalState} ${terminalCollapsed ? 'collapsed' : ''}`}
          style={{ height: shownTerminalHeight }}
        >
          <div className="terminal-resize-handle" onMouseDown={handleResizeStart} />
          <div className="terminal-header">
            <div className="terminal-header-left">
              <span className={`terminal-status-dot ${terminalState}`} />
              <TerminalSquare size={14} className="terminal-header-icon" />
              <span className="terminal-header-title">{terminalTitle}</span>
              {latestLine && (
                <span className="terminal-header-meta">
                  {terminalLines.length}/{MAX_LINES} · {latestLine.time}
                </span>
              )}
            </div>
            <div className="terminal-header-actions">
              <button
                className="terminal-icon-btn"
                title={terminalCollapsed ? 'Mở rộng terminal' : 'Thu gọn terminal'}
                onClick={() => setTerminalCollapsed((v) => !v)}
              >
                {terminalCollapsed ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
              </button>
              <button
                className="terminal-icon-btn"
                title="Xoá log terminal"
                disabled={isEmpty}
                onClick={() => {
                  setTerminalLines([])
                  setTerminalBusy(false)
                  setAtBottom(true)
                }}
              >
                <Trash2 size={14} />
              </button>
              <button
                className="terminal-icon-btn"
                title="Ẩn thanh trạng thái"
                onClick={() => setStatusbarOn(false)}
              >
                <ChevronDown size={14} />
              </button>
            </div>
          </div>
          {!terminalCollapsed && (
            <div className="terminal-body">
              <div className="terminal-log" ref={terminalLogRef} onScroll={handleTerminalScroll}>
                {isEmpty ? (
                  <div className="terminal-empty">
                    <TerminalSquare size={22} />
                    <span>Aviary terminal sẵn sàng — chờ tác vụ đăng / xoá / lịch…</span>
                  </div>
                ) : (
                  terminalLines.map((line) => <TerminalRow key={line.id} line={line} />)
                )}
                {terminalBusy && !isEmpty && (
                  <div className="terminal-line terminal-cursor-line">
                    <span className="terminal-cursor">▋</span>
                  </div>
                )}
              </div>
              {!atBottom && (
                <button className="terminal-jump" title="Xuống dòng mới nhất" onClick={scrollToBottom}>
                  <ChevronDown size={14} />
                </button>
              )}
            </div>
          )}
        </footer>
      )}
      {!statusbarOn && (
        <button
          className="terminal-show"
          title="Hiện lại terminal"
          onClick={() => setStatusbarOn(true)}
        >
          <ChevronUp size={14} />
        </button>
      )}
    </div>
  )
}
