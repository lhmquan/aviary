import { useEffect, useState, useCallback, useRef } from 'react'
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
  Zap,
  CheckCircle2,
  XCircle,
  Globe,
  X,
  Clock,
  Eye,
  EyeOff,
  ExternalLink as ExternalLinkIcon
} from 'lucide-react'
import type { Account, AccountInput, Proxy, Schedule, WebhookTestResult } from '@shared/types'
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
  const [schedules, setSchedules] = useState<Schedule[]>([])
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
  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [showBulkProxy, setShowBulkProxy] = useState(false)

  const refresh = useCallback(async () => {
    const [list, proxList, schedList] = await Promise.all([
      window.aviary.accounts.list(),
      window.aviary.proxies.list(),
      window.aviary.schedules.list()
    ])
    setAccounts(list)
    setProxies(proxList)
    setSchedules(schedList)
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

  // Khi danh sách account thay đổi (xoá...), xoá selectedIds không còn tồn tại.
  useEffect(() => {
    setSelectedIds((prev) => {
      const next = new Set<string>()
      for (const id of prev) {
        if (accounts.some((a) => a.id === id)) next.add(id)
      }
      return next.size === prev.size ? prev : next
    })
  }, [accounts])

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

  // Bật/tắt nhanh chế độ chạy ngầm (headless) ngay tại dòng — lưu tức thì, không cần mở Sửa.
  // Lưu ý: thay đổi chỉ áp dụng cho lần MỞ profile kế tiếp; profile đang mở không đổi chế độ.
  async function handleToggleHeadless(a: Account): Promise<void> {
    setBusy(a.id)
    try {
      await window.aviary.accounts.update(a.id, { headless: !a.headless })
      await refresh()
    } catch (e) {
      alert('Đổi chế độ chạy ngầm lỗi: ' + (e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  // ---- Bulk actions ----
  function toggleSelect(id: string): void {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll(): void {
    if (selectedIds.size === accounts.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(accounts.map((a) => a.id)))
    }
  }

  async function handleBulkOpen(): Promise<void> {
    setBulkBusy(true)
    let errors = 0
    for (const id of selectedIds) {
      try {
        await window.aviary.browser.open(id)
      } catch {
        errors++
      }
    }
    await refresh()
    setBulkBusy(false)
    if (errors > 0) alert(`Đã mở ${selectedIds.size - errors}/${selectedIds.size} profile. ${errors} lỗi.`)
  }

  async function handleBulkDelete(): Promise<void> {
    const count = selectedIds.size
    if (!confirm(`Xóa ${count} tài khoản đã chọn? Profile và session sẽ vẫn nằm trên ổ đĩa.`)) return
    setBulkBusy(true)
    for (const id of selectedIds) {
      await window.aviary.accounts.remove(id).catch(() => {})
    }
    setSelectedIds(new Set())
    await refresh()
    setBulkBusy(false)
  }

  const hasSelection = selectedIds.size > 0
  const allSelected = accounts.length > 0 && selectedIds.size === accounts.length

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

        <span className="badge count-badge">{accounts.length} tài khoản</span>

        {hasSelection && (
          <>
            <span className="bulk-sep" />
            <span className="badge selected-badge">Đã chọn {selectedIds.size}</span>
            <button
              className="btn icon-label"
              disabled={bulkBusy}
              onClick={handleBulkOpen}
              title={`Mở ${selectedIds.size} profile (headful)`}
            >
              {bulkBusy ? <Loader2 size={15} className="spin" /> : <Power size={15} />}
              Mở Profile
            </button>
            <button
              className="btn icon-label"
              disabled={bulkBusy}
              onClick={() => setShowBulkProxy(true)}
              title={`Đổi proxy cho ${selectedIds.size} tài khoản`}
            >
              <Globe size={15} />
              Set Proxy
            </button>
            <button
              className="btn icon-label danger"
              disabled={bulkBusy}
              onClick={handleBulkDelete}
              title={`Xoá ${selectedIds.size} tài khoản`}
            >
              <Trash2 size={15} />
              Xoá
            </button>
            <button
              className="btn icon-only ghost"
              title="Bỏ chọn tất cả"
              onClick={() => setSelectedIds(new Set())}
            >
              <X size={16} />
            </button>
          </>
        )}
      </div>

      {accounts.length === 0 ? (
        <div className="empty-state">
          <UserPlus size={36} />
          <p>Chưa có tài khoản nào</p>
          <span>Bấm "Thêm tài khoản" để bắt đầu.</span>
        </div>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th className="col-check">
                  <input
                    type="checkbox"
                    ref={(el) => {
                      if (el) el.indeterminate = hasSelection && !allSelected
                    }}
                    checked={allSelected}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th>Name</th>
                <th>Username</th>
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
                const isSelected = selectedIds.has(a.id)
                // Tài khoản có lịch đang bật (enabled) -> hiện nhãn "Đang lên lịch"
                const hasEnabledSchedule = schedules.some((s) => s.accountId === a.id && s.enabled)
                return (
                  <tr key={a.id} className={isSelected ? 'row-selected' : ''}>
                    <td className="col-check">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(a.id)}
                      />
                    </td>
                    <td className="cell-label">
                      <div>{a.label}</div>
                      <div className="row-tags">
                        {hasEnabledSchedule && (
                          <span className="badge-mini schedule-mini" title="Tài khoản đang được lên lịch chạy">
                            <Clock size={11} /> Lên lịch
                          </span>
                        )}
                        {a.headless && <span className="badge-mini">Ngầm</span>}
                        {a.hashtag && <span className="badge-mini hashtag-mini">{a.hashtag}</span>}
                      </div>
                    </td>
                    <td>
                      {a.handle ? (
                        <span className="username-cell">
                          {a.handle ? a.handle.replace(/^@/, '') : '—'}
                          <button
                            className="btn icon-only ghost x-link"
                            title={a.handle ? `Mở x.com/${a.handle.replace(/^@/, '')}` : 'Mở profile'}
                            onClick={() =>
                              window.open(`https://x.com/${(a.handle ?? '').replace(/^@/, '')}`, '_blank')
                            }
                          >
                            <ExternalLinkIcon size={13} />
                          </button>
                        </span>
                      ) : '—'}
                    </td>
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
                        className={`btn icon-only ${a.headless ? 'accent' : ''}`}
                        title={
                          a.headless
                            ? 'Đang chạy ngầm (ẩn cửa sổ) — bấm để chuyển sang hiện cửa sổ. Áp dụng cho lần mở kế tiếp.'
                            : 'Đang hiện cửa sổ — bấm để chuyển sang chạy ngầm. Áp dụng cho lần mở kế tiếp.'
                        }
                        disabled={busy === a.id}
                        onClick={() => handleToggleHeadless(a)}
                      >
                        {busy === a.id ? (
                          <Loader2 size={16} className="spin" />
                        ) : a.headless ? (
                          <EyeOff size={16} />
                        ) : (
                          <Eye size={16} />
                        )}
                      </button>
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

      {showBulkProxy && (
        <BulkSetProxyModal
          proxies={proxies}
          selectedCount={selectedIds.size}
          onApply={async (proxyId) => {
            setBulkBusy(true)
            let ok = 0
            for (const id of selectedIds) {
              try {
                await window.aviary.accounts.update(id, { proxyId })
                ok++
              } catch {
                /* bỏ qua lỗi từng account */
              }
            }
            await refresh()
            setBulkBusy(false)
            setShowBulkProxy(false)
            if (ok < selectedIds.size) {
              alert(`Đã cập nhật ${ok}/${selectedIds.size} tài khoản.`)
            }
          }}
          onClose={() => setShowBulkProxy(false)}
        />
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
          <span>Username (X)</span>
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
      <div className="modal webhook-result-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Kết quả test webhook</h2>
        {result.ok ? (
          <>
            <div className="webhook-status-banner ok">
              <CheckCircle2 size={20} />
              <span>OK · HTTP {result.status}</span>
            </div>
            <div className="webhook-detail-rows">
              <div className="webhook-detail-row">
                <span className="webhook-detail-label">Caption</span>
                <span className="webhook-detail-value">{result.caption || <em>(rỗng)</em>}</span>
              </div>
              <div className="webhook-detail-row">
                <span className="webhook-detail-label">Phát hiện</span>
                <span className="webhook-detail-value">
                  {result.assetCount ?? 0} asset{result.hasAudioMerge ? ' — tách video+audio, sẽ ghép bằng ffmpeg' : ''}
                </span>
              </div>
              <div className="webhook-detail-row">
                <span className="webhook-detail-label">accountId</span>
                <span className="webhook-detail-value mono small">{result.accountId ?? '(null)'}</span>
              </div>
              <div className="webhook-detail-row">
                <span className="webhook-detail-label">assetUrl</span>
                <span className="webhook-detail-value">
                  {result.assetUrl ? (
                    <a href={result.assetUrl} target="_blank" rel="noopener noreferrer" className="result-link">
                      {result.assetUrl}
                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    <em>(null)</em>
                  )}
                </span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="webhook-status-banner fail">
              <XCircle size={20} />
              <span>Lỗi</span>
            </div>
            <div className="webhook-detail-rows">
              <div className="webhook-detail-row">
                <span className="webhook-detail-value result-error">{result.error}</span>
              </div>
              <div className="webhook-detail-row">
                <span className="webhook-detail-label">assetUrl gửi đi</span>
                <span className="webhook-detail-value mono small">
                  {result.assetUrl ?? '(null)'}
                </span>
              </div>
              <p className="hint" style={{ marginTop: 4 }}>
                Nếu null là profile chưa lưu Google Sheet.
              </p>
            </div>
          </>
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

function BulkSetProxyModal(props: {
  proxies: Proxy[]
  selectedCount: number
  onApply: (proxyId: string) => Promise<void>
  onClose: () => void
}): JSX.Element {
  const { proxies, selectedCount, onApply, onClose } = props
  const [proxyId, setProxyId] = useState(PROXY_LOCAL)
  const [applying, setApplying] = useState(false)

  async function apply(): Promise<void> {
    setApplying(true)
    try {
      await onApply(proxyId)
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Set Proxy cho {selectedCount} tài khoản</h2>
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
        </label>
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={applying}>
            Hủy
          </button>
          <button className="btn primary" disabled={applying} onClick={apply}>
            {applying ? <Loader2 size={15} className="spin" /> : null}
            {applying ? 'Đang áp dụng…' : 'Áp dụng'}
          </button>
        </div>
      </div>
    </div>
  )
}
