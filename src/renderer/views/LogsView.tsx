import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, Trash2, ExternalLink, CheckCircle2, XCircle, ScrollText, Clock, Settings2, Send, SkipForward, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Filter, Trash } from 'lucide-react'
import type { LogEntry } from '@shared/types'

const PAGE_SIZE = 50

// Số link bài xoá hiển thị mặc định trước khi gập (tránh tràn UI khi xoá nhiều).
const DELETED_URLS_PREVIEW = 3

// Badge phân loại sự kiện, mỗi loại 1 màu theo chức năng:
//   Đăng (post)        → xanh lá  (tạo nội dung)
//   Lịch: Đăng (run)   → xanh dương (đăng tự động theo lịch)
//   Xoá (delete)       → đỏ       (xoá thủ công, phá huỷ)
//   Lịch: Xoá (run_delete) → cam  (xoá tự động theo lịch)
//   Hệ thống (schedule)→ tím      (sự kiện hệ thống/lịch)
function eventBadge(eventType: string | null | undefined): JSX.Element {
  if (eventType === 'run') {
    return <span className="badge ev-run"><Clock size={13} /> Lịch: Đăng</span>
  }
  if (eventType === 'run_delete') {
    return <span className="badge ev-run-delete"><Clock size={13} /> Lịch: Xoá</span>
  }
  if (eventType === 'delete') {
    return <span className="badge ev-delete"><Trash size={13} /> Xoá</span>
  }
  if (eventType === 'schedule') {
    return <span className="badge ev-system"><Settings2 size={13} /> Hệ thống</span>
  }
  return <span className="badge ev-post"><Send size={13} /> Đăng</span>
}

// Các tùy chọn lọc loại sự kiện.
const FILTER_OPTIONS: { value: string | null; label: string }[] = [
  { value: null, label: 'Tất cả' },
  { value: 'schedule', label: 'Hệ thống' },
  { value: 'run', label: 'Lịch: Đăng' },
  { value: 'run_delete', label: 'Lịch: Xoá' },
  { value: 'delete', label: 'Xoá bài (thủ công)' },
  { value: 'post', label: 'Đăng bài (thủ công)' },
]

// Danh sách link các bài đã xoá, hiển thị thông minh: mặc định chỉ hiện vài link đầu,
// nếu nhiều hơn thì gập lại kèm nút "Xem tất cả / Thu gọn".
function DeletedUrlsList({ urls }: { urls: string[] }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const hasMore = urls.length > DELETED_URLS_PREVIEW
  const shown = expanded ? urls : urls.slice(0, DELETED_URLS_PREVIEW)

  // Rút gọn URL cho dễ đọc: chỉ giữ phần /handle/status/id.
  const shortUrl = (u: string): string => {
    try {
      return new URL(u).pathname
    } catch {
      return u
    }
  }

  return (
    <div className="deleted-urls">
      <ol className="deleted-urls-list">
        {shown.map((u, i) => (
          <li key={`${u}-${i}`}>
            <a href={u} target="_blank" rel="noopener noreferrer" className="result-link">
              {shortUrl(u)}
              <ExternalLink size={11} />
            </a>
          </li>
        ))}
      </ol>
      {hasMore && (
        <button
          type="button"
          className="link-btn deleted-urls-toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <>
              <ChevronUp size={12} /> Thu gọn
            </>
          ) : (
            <>
              <ChevronDown size={12} /> Xem tất cả {urls.length} link
            </>
          )}
        </button>
      )}
    </div>
  )
}

export default function LogsView(): JSX.Element {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [filterEventType, setFilterEventType] = useState<string | null>(null)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const refresh = useCallback(async (p: number = page, ev: string | null = filterEventType) => {
    setLoading(true)
    try {
      const result = await window.aviary.logs.list({ page: p, pageSize: PAGE_SIZE, eventType: ev })
      setLogs(result.rows)
      setTotal(result.total)
    } finally {
      setLoading(false)
    }
  }, [page, filterEventType])

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

  // Đổi bộ lọc loại: reset về trang 1 và tải lại theo loại mới.
  function handleFilterChange(ev: string | null): void {
    setFilterEventType(ev)
    setPage(1)
    refresh(1, ev)
  }

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

  const isFiltered = filterEventType !== null

  return (
    <div className="view">
      <div className="toolbar">
        <button className="btn" onClick={() => refresh(page)} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spin' : undefined} />
          Làm mới
        </button>
        <button className="btn danger" onClick={clearAll} disabled={total === 0 && !isFiltered}>
          <Trash2 size={15} />
          Xóa hết
        </button>
        <span className="filter-group" title="Lọc nhật ký theo loại sự kiện">
          <Filter size={15} className="filter-icon" />
          <select
            className="log-filter-select"
            value={filterEventType ?? ''}
            onChange={(e) => handleFilterChange(e.target.value === '' ? null : e.target.value)}
          >
            {FILTER_OPTIONS.map((opt) => (
              <option key={opt.label} value={opt.value ?? ''}>
                {opt.label}
              </option>
            ))}
          </select>
        </span>
        <span className="badge count-badge">
          {total} dòng{isFiltered ? ' (đã lọc)' : ''}
        </span>
      </div>

      {total === 0 ? (
        <div className="empty-state">
          <ScrollText size={36} />
          {isFiltered ? (
            <>
              <p>Không có nhật ký loại này</p>
              <span>Thử đổi bộ lọc hoặc chọn "Tất cả".</span>
            </>
          ) : (
            <>
              <p>Chưa có nhật ký nào</p>
              <span>Kết quả đăng bài sẽ hiện ở đây.</span>
            </>
          )}
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
                          l.urls && l.urls.length > 0 ? (
                            <div className="deleted-cell">
                              <span className="deleted-caption">{l.caption}</span>
                              <DeletedUrlsList urls={l.urls} />
                            </div>
                          ) : l.url ? (
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
