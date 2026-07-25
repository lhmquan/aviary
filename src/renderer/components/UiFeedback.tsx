import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react'

type NoticeTone = 'info' | 'success' | 'warning' | 'danger'

type ConfirmOptions = {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'warning' | 'danger'
  busyLabel?: string
  action?: () => void | Promise<void>
}

type ToastOptions = {
  title: string
  description?: string
  tone?: NoticeTone
  duration?: number
}

type ConfirmRequest = ConfirmOptions & {
  resolve: (accepted: boolean) => void
}

type ToastItem = ToastOptions & { id: number }

type UiFeedbackApi = {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  toast: (options: ToastOptions) => void
}

const UiFeedbackContext = createContext<UiFeedbackApi | null>(null)

export function UiFeedbackProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const dialogRef = useRef<HTMLDialogElement>(null)
  const toastId = useRef(0)

  useEffect(() => {
    const dialog = dialogRef.current
    if (request && dialog && !dialog.open) dialog.showModal()
  }, [request])

  const settle = useCallback((accepted: boolean) => {
    if (busy) return
    dialogRef.current?.close()
    setRequest((current) => {
      current?.resolve(accepted)
      return null
    })
  }, [busy])

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => setRequest({ ...options, resolve }))
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((items) => items.filter((item) => item.id !== id))
  }, [])

  const toast = useCallback((options: ToastOptions) => {
    const id = ++toastId.current
    setToasts((items) => [...items.slice(-3), { ...options, id }])
    window.setTimeout(() => dismissToast(id), options.duration ?? 5000)
  }, [dismissToast])

  async function accept(): Promise<void> {
    if (!request) return
    if (!request.action) {
      settle(true)
      return
    }
    setBusy(true)
    try {
      await request.action()
      setBusy(false)
      settle(true)
    } catch (error) {
      setBusy(false)
      toast({
        title: 'Không thể hoàn tất thao tác',
        description: (error as Error).message,
        tone: 'danger'
      })
    }
  }

  const ToneIcon = request?.tone === 'danger' ? XCircle : AlertTriangle

  return (
    <UiFeedbackContext.Provider value={{ confirm, toast }}>
      {children}
      <dialog
        ref={dialogRef}
        className={`app-dialog confirm-dialog ${request?.tone ?? 'warning'}`}
        aria-labelledby="app-confirm-title"
        aria-describedby="app-confirm-description"
        onCancel={(event) => {
          event.preventDefault()
          settle(false)
        }}
      >
        {request && (
          <div className="dialog-content">
            <div className={`dialog-icon ${request.tone ?? 'warning'}`}>
              <ToneIcon size={22} />
            </div>
            <div className="dialog-copy">
              <span className="dialog-eyebrow">Xác nhận thao tác</span>
              <h2 id="app-confirm-title">{request.title}</h2>
              <p id="app-confirm-description">{request.description}</p>
            </div>
            <div className="dialog-actions">
              <button className="btn" disabled={busy} onClick={() => settle(false)}>
                {request.cancelLabel ?? 'Hủy'}
              </button>
              <button
                className={`btn ${request.tone === 'danger' ? 'danger' : 'primary'}`}
                disabled={busy}
                onClick={() => void accept()}
                autoFocus
              >
                {busy && <Loader2 size={15} className="spin" />}
                {busy ? request.busyLabel ?? 'Đang xử lý…' : request.confirmLabel ?? 'Tiếp tục'}
              </button>
            </div>
          </div>
        )}
      </dialog>
      <div className="toast-region" aria-live="polite" aria-atomic="false">
        {toasts.map((item) => {
          const Icon = item.tone === 'success' ? CheckCircle2 : item.tone === 'danger' ? XCircle : item.tone === 'warning' ? AlertTriangle : Info
          return (
            <div key={item.id} className={`app-toast ${item.tone ?? 'info'}`} role="status">
              <Icon size={19} />
              <div>
                <strong>{item.title}</strong>
                {item.description && <p>{item.description}</p>}
              </div>
              <button aria-label="Đóng thông báo" onClick={() => dismissToast(item.id)}>
                <X size={15} />
              </button>
            </div>
          )
        })}
      </div>
    </UiFeedbackContext.Provider>
  )
}

export function useUiFeedback(): UiFeedbackApi {
  const value = useContext(UiFeedbackContext)
  if (!value) throw new Error('useUiFeedback phải được dùng bên trong UiFeedbackProvider')
  return value
}
