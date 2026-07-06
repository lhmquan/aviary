import { useEffect, useState } from 'react'
import {
  Webhook,
  FolderOpen,
  Gauge,
  Save,
  Loader2,
  Monitor,
  Bot,
  Sparkles
} from 'lucide-react'
import type { AppSettings, AiTestResult } from '@shared/types'

export default function SettingsView(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [autoStart, setAutoStart] = useState(false)
  const [aiTesting, setAiTesting] = useState(false)
  const [aiTestResult, setAiTestResult] = useState<AiTestResult | null>(null)

  useEffect(() => {
    window.aviary.settings.get().then(setSettings)
    window.aviary.autoStart.get().then(setAutoStart)
  }, [])

  if (!settings) return <p className="placeholder">Đang tải cài đặt…</p>

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    setSettings((s) => (s ? { ...s, [key]: value } : s))
  }

  async function save(): Promise<void> {
    if (!settings) return
    setSaving(true)
    try {
      const next = await window.aviary.settings.save(settings)
      setSettings(next)
      setSavedAt(Date.now())
    } finally {
      setSaving(false)
    }
  }

  async function testAi(): Promise<void> {
    setAiTesting(true)
    setAiTestResult(null)
    try {
      // Lưu cấu hình hiện tại trước để AiClient (main) đọc đúng base URL/key/model.
      if (settings) await window.aviary.settings.save(settings)
      const r = await window.aviary.ai.test(
        'Hôm nay trời đẹp quá, vừa hoàn thành xong dự án lớn, cảm thấy rất vui!'
      )
      setAiTestResult(r)
    } catch (e) {
      setAiTestResult({ ok: false, error: (e as Error).message })
    } finally {
      setAiTesting(false)
    }
  }

  return (
    <div className="settings">
      <section className="card">
        <h2>
          <Webhook size={16} /> n8n Webhook
        </h2>
        <label className="field">
          <span>Webhook URL</span>
          <input
            value={settings.webhookUrl}
            onChange={(e) => update('webhookUrl', e.target.value)}
            placeholder="https://n8n.example.com/webhook/aviary"
          />
        </label>
        <label className="field">
          <span>Secret (gửi qua header X-Aviary-Secret)</span>
          <input
            type="password"
            value={settings.webhookSecret}
            onChange={(e) => update('webhookSecret', e.target.value)}
            placeholder="(tùy chọn)"
          />
        </label>
      </section>

      <section className="card">
        <h2>
          <FolderOpen size={16} /> Tải file
        </h2>
        <label className="field">
          <span>Thư mục lưu asset đã tải (để trống = mặc định trong userData)</span>
          <div className="row" style={{ marginTop: 0 }}>
            <input
              value={settings.downloadsDir}
              onChange={(e) => update('downloadsDir', e.target.value)}
              placeholder="E:\\Antigravity\\Aviary\\data\\downloads"
              style={{ flex: 1 }}
            />
            <button
              className="btn"
              onClick={async () => {
                const dir = await window.aviary.pickFolder()
                if (dir) update('downloadsDir', dir)
              }}
            >
              <FolderOpen size={15} />
              Chọn…
            </button>
          </div>
        </label>
      </section>

      <section className="card">
        <h2>
          <Gauge size={16} /> Hiệu năng & Nhật ký
        </h2>
        <label className="field">
          <span>Số profile mở đồng thời</span>
          <input
            type="number"
            min={1}
            max={20}
            value={settings.concurrency}
            onChange={(e) => update('concurrency', Number(e.target.value) || 1)}
            style={{ width: 120 }}
          />
        </label>
        <label className="field">
          <span>Số ngày giữ nhật ký (0 = giữ mãi)</span>
          <input
            type="number"
            min={0}
            max={3650}
            value={settings.logRetentionDays}
            onChange={(e) => update('logRetentionDays', Number(e.target.value) || 0)}
            style={{ width: 120 }}
          />
          <small className="hint">Log và ảnh lỗi cũ hơn số ngày này sẽ tự xoá khi app khởi động / sau mỗi lần đăng.</small>
        </label>
        <label className="field">
          <span>Giới hạn số bình luận / ngày / tài khoản</span>
          <input
            type="number"
            min={1}
            max={500}
            value={settings.commentDailyLimit}
            onChange={(e) => update('commentDailyLimit', Number(e.target.value) || 1)}
            style={{ width: 120 }}
          />
          <small className="hint">
            Khi một tài khoản đạt đến giới hạn này trong ngày, lịch bình luận tự động tạm dừng
            và chạy tiếp vào ngày hôm sau. Tránh bị X đánh dấu spam.
          </small>
        </label>
      </section>

      <section className="card">
        <h2>
          <Bot size={16} /> AI sinh bình luận
        </h2>
        <small className="hint" style={{ marginBottom: 8 }}>
          Chuẩn OpenAI-compatible (<code>/v1/chat/completions</code>). Dùng được với OpenAI thật
          hoặc proxy bên thứ 3 (vd vietapi.tech). Dùng cho tác vụ Tương tác để sinh bình luận theo bài.
        </small>
        <label className="field">
          <span>Base URL</span>
          <input
            value={settings.aiBaseUrl}
            onChange={(e) => update('aiBaseUrl', e.target.value)}
            placeholder="https://api.openai.com/v1  hoặc  https://api.vietapi.tech/v1"
          />
        </label>
        <label className="field">
          <span>API Key</span>
          <input
            type="password"
            value={settings.aiApiKey}
            onChange={(e) => update('aiApiKey', e.target.value)}
            placeholder="sk-..."
          />
        </label>
        <label className="field">
          <span>Model</span>
          <input
            value={settings.aiModel}
            onChange={(e) => update('aiModel', e.target.value)}
            placeholder="gpt-4o-mini  hoặc  gpt"
          />
        </label>
        <label className="field">
          <span>Độ dài bình luận tối đa (ký tự)</span>
          <input
            type="number"
            min={20}
            max={280}
            value={settings.aiCommentMaxLen}
            onChange={(e) => update('aiCommentMaxLen', Number(e.target.value) || 200)}
            style={{ width: 120 }}
          />
          <small className="hint">
            X cho tối đa 280 ký tự. AI được nhắc viết dưới giới hạn này; nếu vẫn vượt sẽ tự cắt.
            Giọng điệu, ngôn ngữ và định dạng cấu hình riêng ở từng tài khoản (tab Tài khoản → Sửa).
          </small>
        </label>
        <div className="row" style={{ marginTop: 4 }}>
          <button className="btn" disabled={aiTesting} onClick={testAi}>
            {aiTesting ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
            {aiTesting ? 'Đang test…' : 'Test AI'}
          </button>
        </div>
        {aiTestResult && (
          <div className={`test-result ${aiTestResult.ok ? 'pass' : 'fail'}`}>
            {aiTestResult.ok
              ? `AI trả về: "${aiTestResult.comment}"`
              : `Lỗi${aiTestResult.status ? ` (HTTP ${aiTestResult.status})` : ''}: ${aiTestResult.error}`}
          </div>
        )}
      </section>

      <section className="card">
        <h2>
          <Monitor size={16} /> Hệ thống
        </h2>
        <label className="field checkbox-field">
          <input
            type="checkbox"
            checked={autoStart}
            onChange={async (e) => {
              const next = e.target.checked
              await window.aviary.autoStart.set(next)
              setAutoStart(next)
            }}
          />
          <span>Khởi động cùng Windows</span>
        </label>
        <small className="hint">
          App tự chạy ngầm trên thanh tray khi khởi động. Nhấn X để thu xuống tray, chuột phải tray icon để thoát hẳn.
        </small>
      </section>

      <div className="row" style={{ marginTop: 4 }}>
        <button className="btn primary" disabled={saving} onClick={save}>
          {saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
          {saving ? 'Đang lưu…' : 'Lưu cài đặt'}
        </button>
        {savedAt && (
          <span className="hint">Đã lưu lúc {new Date(savedAt).toLocaleTimeString()}</span>
        )}
      </div>
    </div>
  )
}
