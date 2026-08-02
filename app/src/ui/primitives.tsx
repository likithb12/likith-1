import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md'

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-brand-strong text-white hover:bg-brand disabled:hover:bg-brand-strong',
  secondary: 'bg-surface-raised text-content border border-line hover:bg-surface-hover',
  ghost: 'text-content-muted hover:text-content hover:bg-surface-hover',
  danger: 'bg-negative/15 text-negative border border-negative/40 hover:bg-negative/25',
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1.5 text-xs gap-1.5',
  md: 'px-3.5 py-2 text-sm gap-2',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="size-3.5" />}
      {children}
    </button>
  )
})

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cx('animate-spin', className ?? 'size-4')}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Form fields
//
// Every control is wrapped by Field, which owns the label/description/error
// wiring. Accessibility is a requirement, so the association is structural
// rather than something each call site has to remember.
// ---------------------------------------------------------------------------

interface FieldProps {
  label: string
  children: (props: { id: string; 'aria-describedby': string | undefined; 'aria-invalid': boolean | undefined }) => ReactNode
  hint?: ReactNode
  error?: string | null
  required?: boolean
  className?: string
}

export function Field({ label, children, hint, error, required, className }: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-medium text-content-muted">
        {label}
        {required && (
          <span className="text-negative" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-content-faint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-negative">
          {error}
        </p>
      )}
    </div>
  )
}

const controlClasses =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-content placeholder:text-content-faint ' +
  'transition-colors hover:border-line-strong focus:border-brand focus:outline-none ' +
  'aria-[invalid=true]:border-negative disabled:opacity-50 disabled:cursor-not-allowed'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cx(controlClasses, className)} {...rest} />
  },
)

/** Right-aligned tabular input for amounts, so columns of figures line up. */
export const AmountInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function AmountInput({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        className={cx(controlClasses, 'text-right tabular', className)}
        {...rest}
      />
    )
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cx(controlClasses, 'appearance-none pr-8', className)} {...rest}>
        {children}
      </select>
    )
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} rows={3} className={cx(controlClasses, 'resize-y', className)} {...rest} />
  },
)

export function Checkbox({
  label,
  description,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; description?: string }) {
  const id = useId()
  return (
    <div className={cx('flex items-start gap-2.5', className)}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 rounded border-line-strong bg-surface accent-brand-strong"
        {...rest}
      />
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-sm text-content">
          {label}
        </label>
        {description && <p className="text-xs text-content-faint">{description}</p>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export function Card({
  children,
  className,
  as: Tag = 'section',
}: {
  children: ReactNode
  className?: string
  as?: 'section' | 'div' | 'article'
}) {
  return (
    <Tag className={cx('rounded-xl border border-line bg-surface-raised', className)}>{children}</Tag>
  )
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex items-start justify-between gap-3 border-b border-line px-4 py-3', className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-content">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-content-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

type BadgeTone = 'neutral' | 'positive' | 'negative' | 'caution' | 'brand'

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-hover text-content-muted border-line',
  positive: 'bg-positive/10 text-positive border-positive/30',
  negative: 'bg-negative/10 text-negative border-negative/30',
  caution: 'bg-caution/10 text-caution border-caution/30',
  brand: 'bg-brand/10 text-brand border-brand/30',
}

export function Badge({
  children,
  tone = 'neutral',
  className,
  title,
}: {
  children: ReactNode
  tone?: BadgeTone
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap',
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Section heading used at the top of every page. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-content">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-content-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
