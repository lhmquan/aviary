import { useEffect, useState, useCallback } from 'react'
import {
  Plus,
  Pencil,
  Trash2,
  Power,
  PowerOff,
  Send,
  Loader2,
  ExternalLink,
  UserPlus,
  Zap
} from 'lucide-react'
import type { Account, AccountInput, Proxy, WebhookTestResult } from '@shared/types'
import { PROXY_LOCAL, PROXY_RANDOM } from '@shared/types'

const STATUS_LABEL: Record<Account['status'], string> = {
  new: 'Mới',
  logged_in: 'Đã đăng nhập',
  checkpoint: 'Checkpoint',
  banned: 'Bị khóa',
  disabled: 'Tắt'
}

export default function AccountsView(): JSX.Element {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [proxies, setProxies] = useState<Proxy[]>([])
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [posting, setPosting] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [proxyBusy, setProxyBusy] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ accountId: string; result: WebhookTestResult } | null>(
    null
  )

  const refresh = useCallback(async () => {
    const [list, proxList] = await Promise.all([
      window.aviary.accounts.list(),
      window.aviary.proxies.list()
    ])
    setAccounts(list)
    setProxies(proxList)
    const entries = await Promise.all(
      list.map(async (a) => [a.id, (await window.aviary.browser.status(a.id)).open] as const)
    )
    setOpenMap(Object.fromEntries(entries))
  }, [])

  useEffect(() => {
    refresh()
    // #1: cập nhật realtime khi user đóng cửa sổ browser thủ công.
    const off = window.aviary.browser.onStatusChanged((accountId, open) => {
      setOpenMap((m) => ({ ...m, [accountId]: open }))
    })
    return off
  }, [refresh])

  async function handleOpen(a: Account): Promise<void> {
    setBusy(a.id)
    try {
      await window.aviary.browser.open(a.id)
      await refresh()
    } catch (e) {
      alert('Không mở được profile: ' + (e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function handleClose(a: Account): Promise<void> {
    setBusy(a.id)
    try {
      await window.aviary.browser.close(a.id)
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  async function handleDelete(a: Account): Promise<void> {
    if (!confirm(`Xóa tài khoản "${a.label}"? Profile và session sẽ vẫn nằm trên ổ đĩa.`)) return
    await window.aviary.accounts.remove(a.id)
    await refresh()
  }

  async function handlePostNow(a: Account): Promise<void> {
    if (!confirm(`Đăng bài cho "${a.label}"? Nếu profile chưa mở sẽ tự mở (chạy ngầm nếu đã bật).`))
      return
    setPosting(a.id)
    try {
      await window.aviary.post.runNow(a.id)
      // Kết quả hiển thị trong Nhật ký + thanh trạng thái, không còn popup.
    } catch (e) {
      alert('Đăng bài lỗi: ' + (e as Error).message)
    } finally {
      setPosting(null)
    }
  }

  // Test webhook kèm accountId + assetUrl của profile này để n8n nhận đúng asset.
  async function handleTestWebhook(a: Account): Promise<void> {
    setTesting(a.id)
    setTestResult(null)
    try {
      const result = await window.aviary.webhook.test(a.id)
      setTestResult({ accountId: a.id, result })
    } catch (e) {
      setTestResult({ accountId: a.id, result: { ok: false, error: (e as Error).message } })
    } finally {
      setTesting(null)
    }
  }

  // Đổi proxy ngay tại dòng (Local / Random / proxy cụ thể) -> lưu tức thì, không cần Sửa.
  async function handleProxyChange(a: Account, nextProxyId: string): Promise<void> {
    if (nextProxyId === a.proxyId) return
    setProxyBusy(a.id)
    try {
      await window.aviary.accounts.update(a.id, { proxyId: nextProxyId })
      await refresh()
    } catch (e) {
      alert('Đổi proxy lỗi: ' + (e as Error).message)
    } finally {
      setProxyBusy(null)
    }
  }

  return (
    <div className="view">
      <div className="toolbar">
        <button
          className="btn primary"
          onClick={() => {
            setEditing(null)
            setShowForm(true)
          }}
        >
          <Plus size={16} />
          Thêm tài khoản
        </button>
      </div>

      {accounts.length === 0 ? (
        <div className="empty-state">
          <UserPlus size={36} />
          <p>Chưa có tài khoản nào</p>
          <span>Bấm &quot;Thêm tài khoản&quot; để bắt đầu.</span>
        </div>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Nhãn</th>
                <th>Handle</th>
                <th>Proxy</th>
                <th>Trạng thái</th>
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const isOpen = openMap[a.id]
                const proxyMissing =
                  a.proxyId !== PROXY_LOCAL &&
                  a.proxyId !== PROXY_RANDOM &&
                  !proxies.some((p) => p.id === a.proxyId)
                return (
                  <tr key={a.id}>
                    <td className="cell-label">
                      <div>{a.label}</div>
                      <div className="row-tags">
                        {a.headless && <span className="badge-mini">Ngầm</span>}
                        {a.hashtag && <span className="badge-mini hashtag-mini">{a.hashtag}</span>}
                      </div>
                    </td>
                    <td>{a.handle ? `@${a.handle.replace(/^@/, '')}` : '—'}</td>
                    <td>
                      <select
                        className="proxy-select"
                        value={a.proxyId}
                        disabled={proxyBusy === a.id}
                        title={
                          proxyMissing
                            ? 'Proxy đã bị xoá khỏi kho — chọn lại Local/Random/proxy khác'
                            : 'Đổi proxy cho tài khoản'
                        }
                        onChange={(e) => handleProxyChange(a, e.target.value)}
                      >
                        <option value={PROXY_LOCAL}>Local (IP máy)</option>
                        <option value={PROXY_RANDOM}>
                          Random{proxies.length === 0 ? ' (chưa có proxy)' : ''}
                        </option>
                        {proxies.length > 0 && (
                          <optgroup label="Proxy đã thêm">
                            {proxies.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.label}
                                {p.kind ? ` (${p.kind})` : ''}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {proxyMissing && (
                          <option value={a.proxyId} disabled>
                            {`(đã xoá) ${a.proxyId}`}
                          </option>
                        )}
                      </select>
                    </td>
                    <td>
                      <span className={`badge ${isOpen ? 'on' : `st-${a.status}`}`}>
                        <span className="dot" />
                        {isOpen ? 'Đang mở' : STATUS_LABEL[a.status]}
                      </span>
                    </td>
                    <td className="actions">
                      {isOpen ? (
                        <button
                          className="btn icon-only"
                          title="Đóng profile"
                          disabled={busy === a.id}
                          onClick={() => handleClose(a)}
                        >
                          {busy === a.id ? <Loader2 size={16} className="spin" /> : <PowerOff size={16} />}
                        </button>
                      ) : (
                        <button
                          className="btn icon-only"
                          title="Mở profile"
                          disabled={busy === a.id}
                          onClick={() => handleOpen(a)}
                        >
                          {busy === a.id ? <Loader2 size={16} className="spin" /> : <Power size={16} />}
                        </button>
                      )}
                      <button
                        className="btn icon-only accent"
                        title="Đăng bài (tự mở profile nếu chưa mở)"
                        disabled={posting === a.id}
                        onClick={() => handlePostNow(a)}
                      >
                        {posting === a.id ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
                      </button>
                      <button
                        className="btn icon-only"
                        title="Test webhook (gửi kèm assetUrl của profile)"
                        disabled={testing === a.id}
                        onClick={() => handleTestWebhook(a)}
                      >
                        {testing === a.id ? <Loader2 size={16} className="spin" /> : <Zap size={16} />}
                      </button>
                      <button
                        className="btn icon-only"
                        title="Sửa"
                        onClick={() => {
                          setEditing(a)
                          setShowForm(true)
                        }}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="btn icon-only danger"
                        title="Xóa"
                        onClick={() => handleDelete(a)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <AccountForm
          account={editing}
          onClose={() => setShowForm(false)}
          onSaved={async () => {
            setShowForm(false)
            await refresh()
          }}
        />
      )}

      {testResult && (
        <WebhookTestModal result={testResult.result} onClose={() => setTestResult(null)} />
      )}
    </div>
  )
}

function AccountForm(props: {
  account: Account | null
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const { account, onClose, onSaved } = props
  const [label, setLabel] = useState(account?.label ?? '')
  const [handle, setHandle] = useState(account?.handle ?? '')
  const [proxyId, setProxyId] = useState(account?.proxyId ?? PROXY_LOCAL)
  const [proxies, setProxies] = useState<Proxy[]>([])
  const [assetUrl, setAssetUrl] = useState(account?.assetUrl ?? '')
  const [hashtag, setHashtag] = useState(account?.hashtag ?? '')
  const [headless, setHeadless] = useState(account?.headless ?? false)
  const [saving, setSaving] = useState(false)

  // Tải kho proxy để đổ vào dropdown (Local / Random / từng proxy).
  useEffect(() => {
    window.aviary.proxies.list().then(setProxies).catch(() => setProxies([]))
  }, [])

  async function save(): Promise<void> {
    if (!label.trim()) {
      alert('Nhãn không được để trống')
      return
    }
    setSaving(true)
    const input: AccountInput = {
      label: label.trim(),
      handle: handle.trim() || null,
      proxyId,
      assetUrl: assetUrl.trim() || null,
      hashtag: hashtag.trim() || null,
      headless
    }
    try {
      if (account) await window.aviary.accounts.update(account.id, input)
      else await window.aviary.accounts.create(input)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{account ? 'Sửa tài khoản' : 'Thêm tài khoản'}</h2>
        <label className="field">
          <span>Nhãn *</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="VD: Acc chính"
            autoFocus
          />
        </label>
        <label className="field">
          <span>Handle (@)</span>
          <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="vd: myhandle" />
        </label>
        <label className="field">
          <span>Proxy</span>
          <select value={proxyId} onChange={(e) => setProxyId(e.target.value)}>
            <option value={PROXY_LOCAL}>Local (IP máy)</option>
            <option value={PROXY_RANDOM}>Random (mỗi lần chạy lấy ngẫu nhiên)</option>
            {proxies.length > 0 && (
              <optgroup label="Proxy đã thêm">
                {proxies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.kind ? ` (${p.kind})` : ''}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {proxyId === PROXY_RANDOM && proxies.length === 0 && (
            <p className="hint">
              Chưa có proxy nào trong tab Proxy — Random sẽ giống Local (IP máy). Hãy thêm
              proxy ở tab Proxy trước.
            </p>
          )}
        </label>
        <label className="field">
          <span>Link Google Sheet (danh sách link Reddit cho tài khoản này)</span>
          <input
            value={assetUrl}
            onChange={(e) => setAssetUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
          />
        </label>
        <label className="field">
          <span>Hashtag (tự chèn vào cuối caption khi đăng — không gửi vào webhook)</span>
          <input
            value={hashtag}
            onChange={(e) => setHashtag(e.target.value)}
            placeholder="VD: f1, vietnam, funny — có thể nhập không cần dấu #"
          />
        </label>
        <label className="field checkbox-field">
          <input
            type="checkbox"
            checked={headless}
            onChange={(e) => setHeadless(e.target.checked)}
          />
          <span>Chạy ngầm (ẩn cửa sổ browser, khó bị phát hiện)</span>
        </label>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Hủy
          </button>
          <button className="btn primary" disabled={saving} onClick={save}>
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  )
}

function WebhookTestModal(props: { result: WebhookTestResult; onClose: () => void }): JSX.Element {
  const { result, onClose } = props
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Kết quả test webhook</h2>
        {result.ok ? (
          <div className="result-block ok">
            <strong>OK · HTTP {result.status}</strong>
            <div>accountId: {result.accountId ?? '(null)'}</div>
            <div>
              assetUrl gửi đi:{' '}
              {result.assetUrl ? (
                <a href={result.assetUrl} target="_blank" rel="noopener noreferrer" className="result-link">
                  {result.assetUrl}
                  <ExternalLink size={12} />
                </a>
              ) : (
                <em>(null)</em>
              )}
            </div>
            <div>Caption: {result.caption || <em>(rỗng)</em>}</div>
            <div>Số asset: {result.assetCount ?? 0}</div>
            {result.hasAudioMerge && <div>Phát hiện video tách audio — sẽ ghép bằng ffmpeg.</div>}
          </div>
        ) : (
          <div className="result-block fail">
            <strong>Lỗi</strong>
            <p className="result-error">{result.error}</p>
            <p className="hint">
              assetUrl gửi đi: {result.assetUrl ?? '(null)'} — nếu null là profile chưa lưu Google Sheet.
            </p>
          </div>
        )}
        <div className="modal-actions">
          <button className="btn primary" onClick={onClose}>
            Đóng
          </button>
        </div>
      </div>
    </div>
  )
}
