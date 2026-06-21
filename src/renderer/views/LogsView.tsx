import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, Trash2, ExternalLink, CheckCircle2, XCircle, ScrollText, Clock, Settings2, Send, SkipForward, ChevronLeft, ChevronRight } from 'lucide-react'
import type { LogEntry } from '@shared/types'

const PAGE_SIZE = 50

// Badge phân loại sự kiện: null/'post' = Đăng, 'run' = Chạy lịch, 'schedule' = Hệ thống/Lịch.
function eventBadge(eventType: string | null | undefined): JSX.Element {
  if (eventType === 'run') {
    return <span className="badge st-checkpoint"><Clock size={13} /> Chạy lịch</span>
  }
  if (eventType === 'schedule') {
    return <span className="badge"><Settings2 size={13} /> Hệ thống</span>
  }
  return <span className="badge on"><Send size={13} /> Đăng</span>
}

export default function LogsView(): JSX.Element {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const refresh = useCallback(async (p: number = page) => {
    setLoading(true)
    try {
      const result = await window.aviary.logs.list({ page: p, pageSize: PAGE_SIZE })
      setLogs(result.rows)
      setTotal(result.total)
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => {
    refresh(1)
    // Tự làm mới khi có tiến trình hoàn thành/error (đăng bài xong sẽ có log mới).
    const off = window.aviary.post.onProgress((p) => {
      if (!p.busy) {
        setPage(1)
        refresh(1)
      }
    })
    return off
  }, [])

  async function clearAll(): Promise<void> {
    if (!confirm('Xóa toàn bộ nhật ký (kèm ảnh lỗi)?')) return
    await window.aviary.logs.clear()
    setPage(1)
    await refresh(1)
  }

  function goToPage(p: number): void {
    const next = Math.max(1, Math.min(totalPages, p))
    setPage(next)
    refresh(next)
  }

  return (
    <div className="view">
      <div className="toolbar">
        <button className="btn" onClick={() => refresh(page)} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spin' : undefined} />
          Làm mới
        </button>
        <button className="btn danger" onClick={clearAll} disabled={total === 0}>
          <Trash2 size={15} />
          Xóa hết
        </button>
        <span className="badge count-badge">{total} dòng</span>
      </div>

      {total === 0 ? (
        <div className="empty-state">
          <ScrollText size={36} />
          <p>Chưa có nhật ký nào</p>
          <span>Kết quả đăng bài sẽ hiện ở đây.</span>
        </div>
      ) : (
        <>
          <div className="card table-card">
            <table className="table">
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Loại</th>
                  <th>Tài khoản</th>
                  <th>Kết quả</th>
                  <th>Nội dung</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => {
                  const isSkip = l.step === 'skipped'
                  return (
                    <tr key={l.id}>
                      <td className="mono small">{new Date(l.ts).toLocaleString()}</td>
                      <td>{eventBadge(l.eventType)}</td>
                      <td className="cell-label">{l.accountLabel}</td>
                      <td>
                        {isSkip ? (
                          <span className="badge st-checkpoint">
                            <SkipForward size={13} /> Bỏ qua
                          </span>
                        ) : l.ok ? (
                          <span className="badge on">
                            <CheckCircle2 size={13} /> OK
                          </span>
                        ) : (
                          <span className="badge fail">
                            <XCircle size={13} /> Lỗi
                          </span>
                        )}
                      </td>
                      <td className="small">
                        {isSkip ? (
                          <span className="result-error">
                            {l.caption}
                            <span className="hint"> · bỏ qua (link hỏng, n8n đã mark)</span>
                          </span>
                        ) : l.ok ? (
                          l.url ? (
                            <a
                              href={l.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="result-link"
                            >
                              {l.caption ? l.caption.slice(0, 50) + (l.caption.length > 50 ? '…' : '') : l.url}
                              <ExternalLink size={12} />
                            </a>
                          ) : (
                            <span>{l.caption || '—'}</span>
                          )
                        ) : (
                          <span className="result-error">
                            {l.error || l.caption}
                            {l.step && <span className="hint"> · {l.step}</span>}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="btn icon-only"
                disabled={page <= 1 || loading}
                onClick={() => goToPage(page - 1)}
                title="Trang trước"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="page-info">
                Trang {page}/{totalPages}
              </span>
              <button
                className="btn icon-only"
                disabled={page >= totalPages || loading}
                onClick={() => goToPage(page + 1)}
                title="Trang sau"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
