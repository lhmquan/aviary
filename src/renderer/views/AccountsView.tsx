import { useEffect, useState, useCallback } from 'react'
import type { Account, AccountInput } from '@shared/types'

const STATUS_LABEL: Record<Account['status'], string> = {
  new: 'Mới',
  logged_in: 'Đã đăng nhập',
  checkpoint: 'Checkpoint',
  banned: 'Bị khóa',
  disabled: 'Tắt'
}

export default function AccountsView(): JSX.Element {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const list = await window.aviary.accounts.list()
    setAccounts(list)
    const entries = await Promise.all(
      list.map(async (a) => [a.id, (await window.aviary.browser.status(a.id)).open] as const)
    )
    setOpenMap(Object.fromEntries(entries))
  }, [])

  useEffect(() => {
    refresh()
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

  return (
    <div>
      <div className="toolbar">
        <button
          className="btn primary"
          onClick={() => {
            setEditing(null)
            setShowForm(true)
          }}
        >
          + Thêm tài khoản
        </button>
      </div>

      {accounts.length === 0 ? (
        <p className="placeholder">Chưa có tài khoản nào. Bấm "Thêm tài khoản" để bắt đầu.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Nhãn</th>
              <th>Handle</th>
              <th>Proxy</th>
              <th>Trạng thái</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>{a.label}</td>
                <td>{a.handle || '—'}</td>
                <td className="mono">{a.proxy || '—'}</td>
                <td>
                  <span className={`badge ${openMap[a.id] ? 'on' : ''}`}>
                    {openMap[a.id] ? 'Đang mở' : STATUS_LABEL[a.status]}
                  </span>
                </td>
                <td className="actions">
                  {openMap[a.id] ? (
                    <button className="btn" disabled={busy === a.id} onClick={() => handleClose(a)}>
                      Đóng
                    </button>
                  ) : (
                    <button className="btn" disabled={busy === a.id} onClick={() => handleOpen(a)}>
                      {busy === a.id ? 'Đang mở…' : 'Mở profile'}
                    </button>
                  )}
                  <button
                    className="btn"
                    onClick={() => {
                      setEditing(a)
                      setShowForm(true)
                    }}
                  >
                    Sửa
                  </button>
                  <button className="btn danger" onClick={() => handleDelete(a)}>
                    Xóa
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
  const [proxy, setProxy] = useState(account?.proxy ?? '')
  const [saving, setSaving] = useState(false)

  async function save(): Promise<void> {
    if (!label.trim()) {
      alert('Nhãn không được để trống')
      return
    }
    setSaving(true)
    const input: AccountInput = {
      label: label.trim(),
      handle: handle.trim() || null,
      proxy: proxy.trim() || null
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
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="VD: Acc chính" />
        </label>
        <label className="field">
          <span>Handle (@)</span>
          <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="vd: myhandle" />
        </label>
        <label className="field">
          <span>Proxy</span>
          <input
            value={proxy}
            onChange={(e) => setProxy(e.target.value)}
            placeholder="user:pass@host:port hoặc host:port"
          />
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
