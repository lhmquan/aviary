import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, Trash2, ExternalLink, CheckCircle2, XCircle, ScrollText, Clock, Settings2, Send, SkipForward, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Filter, Trash, MessageCircle, Activity, Search, X } from 'lucide-react'
import type { LogEntry } from '@shared/types'
import { useUiFeedback } from '../components/UiFeedback'

const PAGE_SIZE = 50

// Số link bài xoá hiển thị mặc định trước khi gập (tránh tràn UI khi xoá nhiều).
const DELETED_URLS_PREVIEW = 3

// Độ dài tối đa của thông báo lỗi khi CHƯA mở rộng (tránh 1 dòng lỗi dài — như call log
// Playwright — làm phình cả hàng nhật ký, khó nhìn).
const ERROR_PREVIEW_LEN = 160

// Làm sạch text lỗi: bỏ mã màu ANSI (\x1b[..m) hiển thị thành ô vuông "□[2m", gộp nhiều
// khoảng trắng/xuống dòng thành 1 space. Giữ nội dung đọc được.
function cleanErrorText(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const ansi = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g')
  return raw.replace(ansi, '').replace(/\s+/g, ' ').trim()
}

// Ô hiển thị lỗi: làm sạch ANSI + gập/mở khi quá dài (mặc định cắt ngắn, bấm để xem đầy đủ).
function ErrorText({ text, step }: { text: string; step?: string | null }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const clean = cleanErrorText(text)
  const isLong = clean.length > ERROR_PREVIEW_LEN
  const shown = expanded || !isLong ? clean : clean.slice(0, ERROR_PREVIEW_LEN) + '…'
  return (
    <span className="result-error">
      {shown}
      {isLong && (
        <button type="button" className="link-btn error-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? (
            <>
              <ChevronUp size={12} /> Thu gọn
            </>
          ) : (
            <>
              <ChevronDown size={12} /> Xem đầy đủ
            </>
          )}
        </button>
      )}
      {step && <span className="hint"> · {step}</span>}
    </span>
  )
}

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
  if (eventType === 'run_comment') {
    return <span className="badge ev-run-comment"><Clock size={13} /> Lịch: Bình luận</span>
  }
  if (eventType === 'run_interact') {
    return <span className="badge ev-run-interact"><Clock size={13} /> Lịch: Tương tác</span>
  }
  if (eventType === 'comment') {
    return <span className="badge ev-comment"><MessageCircle size={13} /> Bình luận</span>
  }
  if (eventType === 'interact') {
    return <span className="badge ev-interact"><Activity size={13} /> Tương tác</span>
  }
  if (eventType === 'delete') {
    return <span className="badge ev-delete"><Trash size={13} /> Xoá</span>
  }
  if (eventType === 'schedule') {
    return <span className="badge ev-system"><Settings2 size={13} /> Hệ thống</span>
  }
  return <span className="badge ev-post"><Send size={13} /> Đăng</span>
}

// Các tùy chọn lọc loại sự kiện — kèm icon + class màu badge để chip đồng bộ với cột "Loại".
const FILTER_OPTIONS: { value: string | null; label: string; Icon?: typeof Send; cls?: string }[] = [
  { value: null, label: 'Tất cả' },
  { value: 'post', label: 'Đăng (thủ công)', Icon: Send, cls: 'ev-post' },
  { value: 'delete', label: 'Xoá (thủ công)', Icon: Trash, cls: 'ev-delete' },
  { value: 'run', label: 'Lịch: Đăng', Icon: Clock, cls: 'ev-run' },
  { value: 'run_delete', label: 'Lịch: Xoá', Icon: Clock, cls: 'ev-run-delete' },
  { value: 'run_comment', label: 'Lịch: Bình luận', Icon: Clock, cls: 'ev-run-comment' },
  { value: 'run_interact', label: 'Lịch: Tương tác', Icon: Clock, cls: 'ev-run-interact' },
  { value: 'schedule', label: 'Hệ thống', Icon: Settings2, cls: 'ev-system' },
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

export default function LogsView(props: {
  // Khi user bấm dòng hoạt động ở tab Tài khoản -> điền sẵn ô lọc theo tên tài khoản.
  accountFilter?: { id: string; label: string } | null
  onClearAccountFilter?: () => void
}): JSX.Element {
  const { confirm } = useUiFeedback()
  const { accountFilter, onClearAccountFilter } = props
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [filterEventType, setFilterEventType] = useState<string | null>(null)
  // Lọc chỉ hiện dòng LỖI — độc lập với lọc loại (kết hợp AND).
  const [onlyErrors, setOnlyErrors] = useState(false)
  // Ô lọc theo tên tài khoản (server-side LIKE trên account_label). Điền sẵn từ tab Tài khoản.
  const [accountQuery, setAccountQuery] = useState(accountFilter?.label ?? '')

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const refresh = useCallback(
    async (
      p: number = page,
      ev: string | null = filterEventType,
      errs: boolean = onlyErrors,
      acct: string = accountQuery
    ) => {
      setLoading(true)
      try {
        const result = await window.aviary.logs.list({
          page: p,
          pageSize: PAGE_SIZE,
          eventType: ev,
          onlyErrors: errs,
          accountQuery: acct
        })
        setLogs(result.rows)
        setTotal(result.total)
      } finally {
        setLoading(false)
      }
    },
    [page, filterEventType, onlyErrors, accountQuery]
  )

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Điều hướng từ tab Tài khoản (bấm dòng hoạt động) -> điền tên tài khoản vào ô lọc.
  useEffect(() => {
    if (accountFilter) setAccountQuery(accountFilter.label)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountFilter?.id])

  // Debounce ô lọc tài khoản: gõ xong 300ms mới truy vấn lại (tránh query mỗi phím).
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1)
      refresh(1, filterEventType, onlyErrors, accountQuery)
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountQuery])

  // Đổi bộ lọc loại: reset về trang 1 và tải lại theo loại mới (giữ nguyên cờ lỗi).
  function handleFilterChange(ev: string | null): void {
    setFilterEventType(ev)
    setPage(1)
    refresh(1, ev, onlyErrors)
  }

  // Bật/tắt lọc chỉ-lỗi (giữ nguyên loại đang chọn).
  function toggleOnlyErrors(): void {
    const next = !onlyErrors
    setOnlyErrors(next)
    setPage(1)
    refresh(1, filterEventType, next)
  }

  // Xoá ô lọc tài khoản (đồng thời báo App bỏ trạng thái điều hướng từ tab Tài khoản).
  function clearAccountQuery(): void {
    setAccountQuery('')
    onClearAccountFilter?.()
  }

  async function clearAll(): Promise<void> {
    await confirm({ title: 'Xóa toàn bộ nhật ký?', description: 'Tất cả sự kiện và ảnh chụp lỗi liên quan sẽ bị xóa vĩnh viễn.', confirmLabel: 'Xóa nhật ký', tone: 'danger', action: async () => { await window.aviary.logs.clear(); setPage(1); await refresh(1) } })
  }

  function goToPage(p: number): void {
    const next = Math.max(1, Math.min(totalPages, p))
    setPage(next)
    refresh(next)
  }

  const isFiltered = filterEventType !== null || onlyErrors || accountQuery.trim() !== ''

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
        <span className="badge count-badge">
          {total} dòng{isFiltered ? ' (đã lọc)' : ''}
        </span>
      </div>

      {/* Hàng chip lọc — đồng bộ với các tab khác. Lọc loại (single-select) + chip Lỗi (toggle riêng). */}
      <div className="filter-bar">
        <div className="filter-chips">
          <span className="filter-label">
            <Filter size={13} /> Loại:
          </span>
          {FILTER_OPTIONS.map((opt) => {
            const active = filterEventType === opt.value
            const Icon = opt.Icon
            return (
              <button
                key={opt.label}
                className={`filter-chip${active ? ' active' : ''}${active && opt.cls ? ` ${opt.cls}` : ''}`}
                onClick={() => handleFilterChange(opt.value)}
              >
                {Icon && <Icon size={12} />} {opt.label}
              </button>
            )
          })}
        </div>
        <div className="filter-chips">
          <span className="filter-label">Trạng thái:</span>
          <button
            className={`filter-chip${onlyErrors ? ' active ev-error-chip' : ''}`}
            onClick={toggleOnlyErrors}
            title="Chỉ hiện các dòng lỗi"
          >
            <XCircle size={12} /> Lỗi
          </button>
          {/* Ô lọc theo tài khoản (tên) — điền sẵn khi bấm dòng hoạt động ở tab Tài khoản. */}
          <div className="search-box logs-account-search">
            <Search size={14} className="search-icon" />
            <input
              type="text"
              value={accountQuery}
              onChange={(e) => setAccountQuery(e.target.value)}
              placeholder="Lọc theo tài khoản (tên)…"
              spellCheck={false}
            />
            {accountQuery && (
              <button className="search-clear" title="Xoá lọc tài khoản" onClick={clearAccountQuery}>
                <X size={14} />
              </button>
            )}
          </div>
          {isFiltered && (
            <button
              className="filter-clear"
              onClick={() => {
                setFilterEventType(null)
                setOnlyErrors(false)
                setAccountQuery('')
                setPage(1)
                onClearAccountFilter?.()
                refresh(1, null, false, '')
              }}
            >
              <XCircle size={13} /> Xoá lọc
            </button>
          )}
        </div>
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
                          <ErrorText text={l.error || l.caption || ''} step={l.step} />
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
