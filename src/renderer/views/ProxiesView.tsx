import { useEffect, useState, useCallback } from 'react'
import { Plus, Pencil, Trash2, RefreshCw, Loader2, Globe, ShieldCheck, X } from 'lucide-react'
import type { Proxy, ProxyInput, ProxyCheckResult } from '@shared/types'

// Định dạng hiển thị proxy: che phần user:pass để không lộ trên màn hình khi chia sẻ.
function maskProxy(raw: string): string {
  const at = raw.lastIndexOf('@')
  if (at === -1) return raw
  const cred = raw.slice(0, at)
  const host = raw.slice(at + 1)
  const ci = cred.indexOf(':')
  const user = ci === -1 ? cred : cred.slice(0, ci)
  const maskedUser = user ? user.slice(0, 1) + '***' : ''
  return `${maskedUser}@${host}`
}

// Badge trạng thái proxy check.
function statusBadge(status: Proxy['status'], latencyMs: number | null): JSX.Element {
  if (status === 'live') {
    return (
      <span className="badge on">
        <span className="dot" />
        Live{latencyMs != null ? ` · ${latencyMs}ms` : ''}
      </span>
    )
  }
  if (status === 'dead') {
    return <span className="badge fail"><span className="dot" /> Die</span>
  }
  return <span className="badge"><span className="dot" /> Chưa kiểm</span>
}

export default function ProxiesView(): JSX.Element {
  const [proxies, setProxies] = useState<Proxy[]>([])
  const [loading, setLoading] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  const [editing, setEditing] = useState<Proxy | null>(null)
  // Multi-select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Check state
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setProxies(await window.aviary.proxies.list())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Khi danh sách proxy thay đổi, xoá selectedIds không còn tồn tại.
  useEffect(() => {
    setSelectedIds((prev) => {
      const next = new Set<string>()
      for (const id of prev) {
        if (proxies.some((p) => p.id === id)) next.add(id)
      }
      return next.size === prev.size ? prev : next
    })
  }, [proxies])

  async function handleDelete(p: Proxy): Promise<void> {
    if (!confirm(`Xóa proxy "${p.label}"?\nCác tài khoản đang gán proxy này sẽ tự về Local.`)) return
    await window.aviary.proxies.remove(p.id)
    await refresh()
  }

  async function handleClearAll(): Promise<void> {
    if (!confirm('Xóa TOÀN BỘ proxy? Các tài khoản đang gán proxy sẽ tự về Local.')) return
    await window.aviary.proxies.clear()
    setSelectedIds(new Set())
    await refresh()
  }

  function toggleSelect(id: string): void {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll(): void {
    if (selectedIds.size === proxies.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(proxies.map((p) => p.id)))
    }
  }

  async function handleBulkDelete(): Promise<void> {
    const count = selectedIds.size
    if (!confirm(`Xóa ${count} proxy đã chọn?`)) return
    for (const id of selectedIds) {
      await window.aviary.proxies.remove(id).catch(() => {})
    }
    setSelectedIds(new Set())
    await refresh()
  }

  async function handleCheckSelected(): Promise<void> {
    const ids = [...selectedIds]
    setCheckingIds(new Set(ids))
    try {
      await window.aviary.proxies.check(ids)
    } finally {
      setCheckingIds(new Set())
      await refresh()
    }
  }

  async function handleCheckAll(): Promise<void> {
    const ids = proxies.map((p) => p.id)
    setCheckingIds(new Set(ids))
    try {
      await window.aviary.proxies.check(ids)
    } finally {
      setCheckingIds(new Set())
      await refresh()
    }
  }

  const hasSelection = selectedIds.size > 0
  const allSelected = proxies.length > 0 && selectedIds.size === proxies.length

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
            setShowBulk(true)
          }}
        >
          <Plus size={15} />
          Thêm danh sách proxy
        </button>

        <span className="badge count-badge">{proxies.length} proxy</span>

        {proxies.length > 0 && (
          <button className="btn icon-label" onClick={handleCheckAll} disabled={checkingIds.size > 0}>
            {checkingIds.size > 0 ? <Loader2 size={15} className="spin" /> : <ShieldCheck size={15} />}
            Kiểm tra tất cả
          </button>
        )}

        {proxies.length > 0 && (
          <button className="btn danger" onClick={handleClearAll}>
            <Trash2 size={15} />
            Xoá tất cả
          </button>
        )}

        {hasSelection && (
          <>
            <span className="bulk-sep" />
            <span className="badge selected-badge">Đã chọn {selectedIds.size}</span>
            <button className="btn icon-label" disabled={checkingIds.size > 0} onClick={handleCheckSelected}>
              <ShieldCheck size={15} />
              Kiểm tra
            </button>
            <button className="btn icon-label danger" onClick={handleBulkDelete}>
              <Trash2 size={15} />
              Xoá
            </button>
            <button className="btn icon-only ghost" title="Bỏ chọn tất cả" onClick={() => setSelectedIds(new Set())}>
              <X size={16} />
            </button>
          </>
        )}
      </div>

      {proxies.length === 0 ? (
        <div className="empty-state">
          <Globe size={36} />
          <p>Chưa có proxy nào</p>
          <span>
            Thêm nhiều proxy cùng lúc (mỗi dòng 1 proxy), sau đó gán cho từng tài khoản ở tab
            Tài khoản.
            <br />
            Mặc định tài khoản dùng <strong>Local</strong> (IP máy).
          </span>
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
                <th>Nhãn</th>
                <th>Proxy</th>
                <th>Nhóm</th>
                <th>Trạng thái</th>
                <th>Vị trí</th>
                <th>Ghi chú</th>
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {proxies.map((p) => {
                const isSelected = selectedIds.has(p.id)
                const isChecking = checkingIds.has(p.id)
                return (
                  <tr key={p.id} className={isSelected ? 'row-selected' : ''}>
                    <td className="col-check">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(p.id)}
                      />
                    </td>
                    <td className="cell-label">
                      {p.label}
                      {isChecking && <Loader2 size={12} className="spin" style={{ marginLeft: 4, verticalAlign: 'middle' }} />}
                    </td>
                    <td className="mono small">{maskProxy(p.proxyString)}</td>
                    <td>{p.kind || '—'}</td>
                    <td>{statusBadge(p.status, p.latencyMs)}</td>
                    <td className="small">
                      {p.city && p.country ? `${p.city}, ${p.country}` : p.checkIp || '—'}
                    </td>
                    <td className="small">{p.note || '—'}</td>
                    <td className="actions">
                      <button
                        className="btn icon-only"
                        title="Kiểm tra"
                        disabled={isChecking}
                        onClick={async () => {
                          setCheckingIds(new Set([p.id]))
                          try { await window.aviary.proxies.check([p.id]) } finally { setCheckingIds(new Set()); await refresh() }
                        }}
                      >
                        {isChecking ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}
                      </button>
                      <button
                        className="btn icon-only"
                        title="Sửa"
                        onClick={() => setEditing(p)}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="btn icon-only danger"
                        title="Xóa"
                        onClick={() => handleDelete(p)}
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

      {showBulk && (
        <BulkAddForm
          onClose={() => setShowBulk(false)}
          onSaved={async () => {
            setShowBulk(false)
            await refresh()
          }}
        />
      )}

      {editing && (
        <ProxyForm
          proxy={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await refresh()
          }}
        />
      )}
    </div>
  )
}

function ProxyForm(props: {
  proxy: Proxy
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const { proxy, onClose, onSaved } = props
  const [label, setLabel] = useState(proxy.label)
  const [proxyString, setProxyString] = useState(proxy.proxyString)
  const [kind, setKind] = useState(proxy.kind ?? '')
  const [note, setNote] = useState(proxy.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(): Promise<void> {
    if (!label.trim()) {
      setError('Nhãn không được để trống')
      return
    }
    if (!proxyString.trim()) {
      setError('Chuỗi proxy không được để trống')
      return
    }
    setSaving(true)
    setError(null)
    const input: ProxyInput = {
      label: label.trim(),
      proxyString: proxyString.trim(),
      kind: kind.trim() || null,
      note: note.trim() || null
    }
    try {
      await window.aviary.proxies.update(proxy.id, input)
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Sửa proxy</h2>
        <label className="field">
          <span>Nhãn *</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="VD: Proxy VN 1"
            autoFocus
          />
        </label>
        <label className="field">
          <span>Chuỗi proxy *</span>
          <input
            value={proxyString}
            onChange={(e) => setProxyString(e.target.value)}
            placeholder="host:port:user:pass hoặc user:pass@host:port"
            className="mono"
          />
          <p className="hint">
            Chấp nhận <code>host:port:user:pass</code>, <code>user:pass@host:port</code>,{' '}
            <code>host:port</code>, <code>socks5://user:pass@host:1080</code>.
          </p>
        </label>
        <label className="field">
          <span>Nhóm / khu vực</span>
          <input
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            placeholder="VD: VN, US, Residential"
          />
        </label>
        <label className="field">
          <span>Ghi chú</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Tùy chọn" />
        </label>
        {error && <p className="test-result fail">{error}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Hủy
          </button>
          <button className="btn primary" disabled={saving} onClick={save}>
            {saving ? <Loader2 size={15} className="spin" /> : <ShieldCheck size={15} />}
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Modal thêm nhiều proxy cùng lúc (paste danh sách, mỗi dòng 1 proxy).
function BulkAddForm(props: { onClose: () => void; onSaved: () => void }): JSX.Element {
  const { onClose, onSaved } = props
  const [text, setText] = useState('')
  const [labelPrefix, setLabelPrefix] = useState('Proxy')
  const [kind, setKind] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save(): Promise<void> {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) {
      setError('Dán ít nhất 1 proxy (mỗi dòng 1 proxy)')
      return
    }
    setSaving(true)
    setError(null)
    setResult(null)
    try {
      const res = await window.aviary.proxies.bulkCreate(lines, {
        labelPrefix: labelPrefix.trim() || 'Proxy',
        kind: kind.trim() || null
      })
      setResult({ added: res.added, skipped: res.skipped.length })
      if (res.added > 0) {
        // Đã thêm thành công -> đóng modal sau khi cho user thấy kết quả ngắn.
        setTimeout(() => onSaved(), 900)
      } else if (res.skipped.length > 0) {
        setError(`Tất cả ${res.skipped.length} proxy đều đã tồn tại (bỏ qua).`)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Thêm danh sách proxy</h2>
        <label className="field">
          <span>Danh sách proxy (mỗi dòng 1 proxy)</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`host:port:user:pass
user:pass@host:port
host:port
socks5://user:pass@host:1080
Nhãn tùy chỉnh|host:port:user:pass`}
            rows={9}
            className="mono"
            autoFocus
          />
          <p className="hint">
            Mỗi dòng 1 proxy. Chấp nhận <code>host:port:user:pass</code>,{' '}
            <code>user:pass@host:port</code>, <code>host:port</code>. Có thể kèm nhãn riêng{' '}
            <code>nhãn|proxy</code>.
          </p>
        </label>
        <div className="row">
          <label className="field" style={{ flex: 1, marginBottom: 0 }}>
            <span>Tiền tố nhãn tự sinh</span>
            <input
              value={labelPrefix}
              onChange={(e) => setLabelPrefix(e.target.value)}
              placeholder="Proxy"
            />
          </label>
          <label className="field" style={{ flex: 1, marginBottom: 0 }}>
            <span>Nhóm (áp dụng cho tất cả)</span>
            <input
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              placeholder="VD: VN, US"
            />
          </label>
        </div>
        {result && (
          <p className="test-result ok">
            Đã thêm {result.added} proxy{result.skipped > 0 ? ` · bỏ qua ${result.skipped} trùng` : ''}.
          </p>
        )}
        {error && <p className="test-result fail">{error}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={saving}>
            Hủy
          </button>
          <button className="btn primary" disabled={saving} onClick={save}>
            {saving ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}
            {saving ? 'Đang lưu…' : 'Thêm'}
          </button>
        </div>
      </div>
    </div>
  )
}
