import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/types'

type Section = 'accounts' | 'schedule' | 'content' | 'logs' | 'settings'

const NAV: { id: Section; label: string; icon: string }[] = [
  { id: 'accounts', label: 'Tài khoản', icon: '👤' },
  { id: 'schedule', label: 'Lịch đăng', icon: '🕒' },
  { id: 'content', label: 'Nội dung', icon: '📝' },
  { id: 'logs', label: 'Nhật ký', icon: '📋' },
  { id: 'settings', label: 'Cài đặt', icon: '⚙️' }
]

const PLACEHOLDER: Record<Section, string> = {
  accounts: 'Quản lý profile chromium + proxy cho từng tài khoản X. (Giai đoạn 1)',
  schedule: 'Hẹn giờ đăng bài theo từng tài khoản, có jitter. (Giai đoạn 1)',
  content: 'Hàng đợi nội dung lấy từ n8n. (Giai đoạn 4)',
  logs: 'Nhật ký mỗi lần chạy, ảnh chụp khi lỗi. (Giai đoạn 1)',
  settings: 'Webhook n8n, proxy mặc định, thư mục tải, giới hạn concurrency. (Giai đoạn 1)'
}

export default function App(): JSX.Element {
  const [active, setActive] = useState<Section>('accounts')
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    window.aviary.getAppInfo().then(setInfo)
  }, [])

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-logo">🪶</span>
          <span className="brand-name">Aviary</span>
        </div>
        <nav>
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${active === item.id ? 'active' : ''}`}
              onClick={() => setActive(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="version">{info ? `v${info.version}` : ''}</div>
      </aside>

      <main className="content">
        <h1>{NAV.find((n) => n.id === active)?.label}</h1>
        <p className="placeholder">{PLACEHOLDER[active]}</p>
      </main>
    </div>
  )
}
