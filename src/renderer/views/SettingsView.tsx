import { useEffect, useState } from 'react'
import {
  Webhook,
  FolderOpen,
  Gauge,
  Save,
  Send,
  CheckCircle2,
  XCircle,
  Loader2
} from 'lucide-react'
import type { AppSettings, WebhookTestResult } from '@shared/types'

export default function SettingsView(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<WebhookTestResult | null>(null)

  useEffect(() => {
    window.aviary.settings.get().then(setSettings)
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

  async function runTest(): Promise<void> {
    setTesting(true)
    setTestResult(null)
    try {
      // Lưu trước khi test để chắc chắn dùng giá trị mới nhất.
      await window.aviary.settings.save(settings!)
      const r = await window.aviary.webhook.test()
      setTestResult(r)
    } finally {
      setTesting(false)
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
        <div className="row">
          <button className="btn primary" disabled={saving} onClick={save}>
            {saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
            {saving ? 'Đang lưu…' : 'Lưu cài đặt'}
          </button>
          <button className="btn" disabled={testing || !settings.webhookUrl} onClick={runTest}>
            {testing ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
            {testing ? 'Đang test…' : 'Test webhook'}
          </button>
          {savedAt && (
            <span className="hint">Đã lưu lúc {new Date(savedAt).toLocaleTimeString()}</span>
          )}
        </div>

        {testResult && (
          <div className={`test-result ${testResult.ok ? 'ok' : 'fail'}`}>
            {testResult.ok ? (
              <>
                <strong>
                  <CheckCircle2 size={14} style={{ verticalAlign: 'middle' }} /> OK · HTTP{' '}
                  {testResult.status}
                </strong>
                <div>Caption: {testResult.caption || <em>(rỗng)</em>}</div>
                <div>Số asset: {testResult.assetCount ?? 0}</div>
                {testResult.hasAudioMerge && (
                  <div>Phát hiện video tách audio — sẽ ghép bằng ffmpeg khi tải.</div>
                )}
              </>
            ) : (
              <>
                <strong>
                  <XCircle size={14} style={{ verticalAlign: 'middle' }} /> Lỗi
                </strong>
                <div>{testResult.error}</div>
              </>
            )}
          </div>
        )}
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
          <Gauge size={16} /> Hiệu năng &amp; Nhật ký
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
      </section>
    </div>
  )
}
