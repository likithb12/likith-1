import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button, Card, Spinner, cx } from './primitives'
import { describeError, isBackendUnreachable } from '../lib/supabase'

export function LoadingState({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx('flex items-center justify-center gap-2 py-10 text-sm text-content-muted', className)}
    >
      <Spinner />
      <span>{label}</span>
    </div>
  )
}

/** Placeholder rows that hold the layout while data loads. */
export function SkeletonRows({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cx('space-y-2 p-4', className)} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-lg bg-surface-hover" />
      ))}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {icon && <div className="text-content-faint">{icon}</div>}
      <div>
        <p className="text-sm font-medium text-content">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-md text-sm text-content-muted">{description}</p>}
      </div>
      {action}
    </div>
  )
}

/**
 * Error display that separates "the backend is unreachable" from everything
 * else. A paused free-tier Supabase project fails as an opaque network error,
 * and telling the user that plainly is the difference between a five-second
 * fix and an afternoon of confusion.
 */
export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown
  onRetry?: () => void
  className?: string
}) {
  const unreachable = isBackendUnreachable(error)

  return (
    <Card className={cx('border-negative/40 bg-negative/5', className)}>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="mt-0.5 text-lg leading-none">
            {unreachable ? '🔌' : '⚠️'}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-content">
              {unreachable ? 'Cannot reach the backend' : 'Something went wrong'}
            </p>
            <p className="mt-1 text-sm text-content-muted">{describeError(error)}</p>
          </div>
        </div>
        {onRetry && (
          <div>
            <Button size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}

/** Non-blocking warning strip. Used for stale data and missing FX rates. */
export function WarningBanner({
  messages,
  className,
}: {
  messages: string[]
  className?: string
}) {
  if (messages.length === 0) return null
  return (
    <div
      className={cx(
        'rounded-xl border border-caution/30 bg-caution/10 px-4 py-3 text-sm text-caution',
        className,
      )}
    >
      <ul className="space-y-1">
        {messages.map((message) => (
          <li key={message} className="flex items-start gap-2">
            <span aria-hidden="true">⚠</span>
            <span>{message}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface BoundaryProps {
  children: ReactNode
  /** Shown instead of the default panel. */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface BoundaryState {
  error: Error | null
}

/**
 * Catches render-time crashes so one broken chart cannot blank the whole app.
 */
export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error', error, info)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)

    return (
      <div className="p-4">
        <ErrorState error={error} onRetry={this.reset} />
      </div>
    )
  }
}
