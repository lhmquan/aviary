import { useEffect, useState, useCallback } from 'react'
import {
  Users,
  Clock,
  FileText,
  ScrollText,
  Settings,
  Feather,
  Monitor,
  Sun,
  Moon,
  RefreshCw,
  RotateCcw,
  Download,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronUp,
  Globe
} from 'lucide-react'
import type { AppInfo, UpdateStatusPayload, ProgressPayload } from '@shared/types'
import AccountsView from './views/AccountsView'
import SettingsView from './views/SettingsView'
import LogsView from './views/LogsView'
import ProxiesView from './views/ProxiesView'
import ScheduleView from './views/ScheduleView'

type Section = 'accounts' | 'proxies' | 'schedule' | 'content' | 'logs' | 'settings'

type ThemeMode = 'system' | 'light' | 'dark'

const NAV: { id: Section; label: string; icon: typeof Users }[] = [
  { id: 'accounts', label: 'Tài khoản', icon: Users },
  { id: 'proxies', label: 'Proxy', icon: Globe },
  { id: 'schedule', label: 'Lịch đăng', icon: Clock },
  { id: 'content', label: 'Nội dung', icon: FileText },
  { id: 'logs', label: 'Nhật ký', icon: ScrollText },
  { id: 'settings', label: 'Cài đặt', icon: Settings }
]

const SUBTITLE: Record<Section, string> = {
  accounts: 'Quản lý tài khoản và profile Chromium',
  proxies: 'Kho proxy chung — gán cho từng tài khoản',
  schedule: 'Lên lịch đăng bài tự động',
  content: 'Hàng đợi nội dung từ n8n',
  logs: 'Theo dõi lịch sử đăng bài và lỗi',
  settings: 'Cấu hình webhook, thư mục và hiệu năng'
}

const PLACEHOLDER: Record<'content', string> = {
  content: 'Hàng đợi nội dung lấy từ n8n. (Giai đoạn 4)'
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
  const [progress, setProgress] = useState<ProgressPayload | null>(null)

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

  // #6: lắng nghe tiến trình tác vụ để hiển thị thanh trạng thái.
  useEffect(() => window.aviary.post.onProgress(setProgress), [])

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

  const progressBusy = progress?.busy ?? false
  const progressMsg = progress?.message
  const progressStage = progress?.stage
  const [statusbarOn, setStatusbarOn] = useState(true)

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
        {active === 'content' && (
          <div className="placeholder">
            <AlertCircle size={28} />
            <p>{PLACEHOLDER[active]}</p>
          </div>
        )}
      </main>
      </div>

      {statusbarOn && (
        <footer
          className={`statusbar ${progressBusy ? 'busy' : progressStage === 'error' ? 'error' : ''}`}
        >
          <span className="statusbar-left">
            {progressBusy ? (
              <Loader2 size={14} className="spin" />
            ) : progressStage === 'done' ? (
              <CheckCircle2 size={14} />
            ) : progressStage === 'error' ? (
              <AlertCircle size={14} />
            ) : (
              <Circle size={11} />
            )}
            <span className="statusbar-msg">{progressMsg ?? 'Sẵn sàng'}</span>
          </span>
          <button
            className="statusbar-toggle"
            title="Ẩn thanh trạng thái"
            onClick={() => setStatusbarOn(false)}
          >
            <ChevronDown size={14} />
          </button>
        </footer>
      )}
      {!statusbarOn && (
        <button
          className="statusbar-show"
          title="Hiện lại thanh trạng thái"
          onClick={() => setStatusbarOn(true)}
        >
          <ChevronUp size={14} />
        </button>
      )}
    </div>
  )
}
