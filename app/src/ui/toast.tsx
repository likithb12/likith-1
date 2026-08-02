import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { cx } from './primitives'

type ToastTone = 'info' | 'success' | 'error'

interface Toast {
  id: number
  tone: ToastTone
  message: string
  /** Optional single action, used for "Undo" after an import. */
  action?: { label: string; onClick: () => void }
}

interface ToastContextValue {
  notify: (message: string, options?: { tone?: ToastTone; action?: Toast['action']; durationMs?: number }) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const notify = useCallback<ToastContextValue['notify']>(
    (message, options) => {
      const id = nextId++
      const toast: Toast = { id, tone: options?.tone ?? 'info', message, action: options?.action }
      setToasts((current) => [...current, toast])

      // Errors and anything with an action stay until dismissed; a message the
      // user must act on should not disappear while they are reading it.
      const duration = options?.durationMs ?? (toast.tone === 'error' || toast.action ? 12_000 : 4_000)
      window.setTimeout(() => dismiss(id), duration)
    },
    [dismiss],
  )

  const value = useMemo(() => ({ notify }), [notify])

  const tones: Record<ToastTone, string> = {
    info: 'border-line bg-surface-raised text-content',
    success: 'border-positive/40 bg-positive/10 text-positive',
    error: 'border-negative/40 bg-negative/10 text-negative',
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cx(
              'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-3.5 py-2.5 shadow-lg backdrop-blur',
              tones[toast.tone],
            )}
          >
            <p className="min-w-0 flex-1 text-sm">{toast.message}</p>
            {toast.action && (
              <button
                type="button"
                className="shrink-0 text-sm font-medium underline underline-offset-2"
                onClick={() => {
                  toast.action?.onClick()
                  dismiss(toast.id)
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss notification"
              className="shrink-0 text-content-faint hover:text-content"
              onClick={() => dismiss(toast.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside a ToastProvider')
  return context
}
