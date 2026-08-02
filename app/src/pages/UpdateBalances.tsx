import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { AmountInput, Badge, Button, Card, CardHeader, Field, Input, PageHeader } from '../ui/primitives'
import { EmptyState, ErrorState, SkeletonRows } from '../ui/feedback'
import { FreshnessBadge } from '../ui/Freshness'
import { useToast } from '../ui/toast'
import { useAccounts } from '../data/accounts'
import { useSaveSnapshots } from '../data/balances'
import { useNetWorthEngine, useRecomputeNetWorth } from '../data/netWorth'
import { useBaseCurrency } from '../data/profile'
import { Decimal, formatMoney, formatSigned, parseMoneyInput } from '../lib/money'
import { formatDate, todayISO } from '../lib/dates'
import { ACCOUNT_TYPE_LABELS } from '../types'
import { describeError } from '../lib/supabase'

/**
 * The primary recurring interaction: one screen, every active account, one
 * date, one save.
 *
 * Keyboard behaviour matters more than anything else here — this is someone
 * working down a list of tabs in their banking app. Enter moves to the next
 * account, Cmd/Ctrl+Enter saves.
 */
export function UpdateBalances() {
  const accounts = useAccounts()
  const baseCurrency = useBaseCurrency()
  const { engine } = useNetWorthEngine()
  const saveSnapshots = useSaveSnapshots()
  const recompute = useRecomputeNetWorth()
  const { notify } = useToast()

  const [asAt, setAsAt] = useState(todayISO())
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  const active = useMemo(
    () => (accounts.data ?? []).filter((account) => account.is_active),
    [accounts.data],
  )

  // Valued as at the chosen date, so "last known" means last known *before
  // that date* — back-dating an entry shows what was true then, not today.
  const valuationById = useMemo(() => {
    const valuations = engine.valueAccounts(asAt)
    return new Map(valuations.map((valuation) => [valuation.account.id, valuation]))
  }, [engine, asAt])

  const parsed = useMemo(() => {
    const out = new Map<string, Decimal>()
    for (const [accountId, raw] of Object.entries(drafts)) {
      if (raw.trim() === '') continue
      const value = parseMoneyInput(raw)
      if (value) out.set(accountId, value)
    }
    return out
  }, [drafts])

  /** Net worth as it would stand once these drafts are saved. */
  const preview = useMemo(() => {
    const current = engine.computeAt(asAt).netWorthBase
    let assets = new Decimal(0)
    let liabilities = new Decimal(0)

    for (const account of accounts.data ?? []) {
      if (!account.include_in_net_worth) continue
      const valuation = valuationById.get(account.id)
      const draft = parsed.get(account.id)
      const value = draft ?? (valuation?.hasData ? valuation.balanceBase : null)
      if (value === null || value === undefined) continue
      if (account.class === 'asset') assets = assets.plus(value)
      else liabilities = liabilities.plus(value)
    }

    const projected = assets.minus(liabilities)
    return { projected, delta: projected.minus(current) }
  }, [engine, asAt, accounts.data, valuationById, parsed])

  function setDraft(accountId: string, value: string) {
    setDrafts((current) => ({ ...current, [accountId]: value }))
    setErrors((current) => {
      if (!current[accountId]) return current
      const { [accountId]: _removed, ...rest } = current
      return rest
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void save()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      // Wrap to the top so a long list stays a single loop.
      const next = inputRefs.current[index + 1] ?? inputRefs.current[0]
      next?.focus()
      next?.select()
    }
  }

  function prefillFromLastKnown() {
    const next: Record<string, string> = {}
    for (const account of active) {
      const valuation = valuationById.get(account.id)
      if (valuation?.hasData) next[account.id] = valuation.balanceNative.toFixed(2)
    }
    setDrafts(next)
  }

  async function save() {
    const nextErrors: Record<string, string> = {}
    const inputs: { account_id: string; as_at: string; balance: string; currency: string }[] = []

    for (const account of active) {
      const raw = drafts[account.id]
      if (raw === undefined || raw.trim() === '') continue

      const value = parseMoneyInput(raw)
      if (!value) {
        nextErrors[account.id] = 'Not a number'
        continue
      }
      inputs.push({
        account_id: account.id,
        as_at: asAt,
        balance: value.toFixed(2),
        currency: account.currency,
      })
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      notify('Some balances could not be read. Fix the highlighted fields.', { tone: 'error' })
      return
    }

    if (inputs.length === 0) {
      notify('Nothing to save — enter at least one balance.', { tone: 'error' })
      return
    }

    try {
      await saveSnapshots.mutateAsync(inputs)
      await recompute.mutateAsync()
      setDrafts({})
      setErrors({})
      notify(`Saved ${inputs.length} balance${inputs.length === 1 ? '' : 's'} for ${formatDate(asAt)}.`, {
        tone: 'success',
      })
    } catch (error) {
      notify(describeError(error), { tone: 'error' })
    }
  }

  if (accounts.isError) {
    return (
      <div className="space-y-5">
        <PageHeader title="Update balances" />
        <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
      </div>
    )
  }

  const entered = parsed.size
  const busy = saveSnapshots.isPending || recompute.isPending

  return (
    <div className="space-y-5">
      <PageHeader
        title="Update balances"
        subtitle="One pass through every active account. Leave a field blank to skip it."
      />

      {accounts.isLoading ? (
        <Card>
          <SkeletonRows rows={5} />
        </Card>
      ) : active.length === 0 ? (
        <Card>
          <EmptyState
            title="No active accounts"
            description="Add an account first, then come back here to record its balance."
            action={
              <Link
                to="/accounts"
                className="inline-flex items-center rounded-lg bg-brand-strong px-3.5 py-2 text-sm font-medium text-white hover:bg-brand"
              >
                Go to accounts
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-end justify-between gap-4 p-4">
              <Field label="Balances as at" className="w-44" hint="Back-date to fill in history.">
                {(props) => (
                  <Input
                    {...props}
                    type="date"
                    value={asAt}
                    max={todayISO()}
                    onChange={(event) => setAsAt(event.target.value)}
                  />
                )}
              </Field>

              <Button size="sm" onClick={prefillFromLastKnown}>
                Prefill with last known
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Accounts"
              subtitle={`${entered} of ${active.length} filled in`}
              action={
                <Button variant="primary" size="sm" onClick={() => void save()} loading={busy}>
                  Save{entered > 0 ? ` ${entered}` : ''}
                </Button>
              }
            />

            <ul className="divide-y divide-line">
              {active.map((account, index) => {
                const valuation = valuationById.get(account.id)
                const error = errors[account.id]
                const isLiability = account.class === 'liability'

                return (
                  <li key={account.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-content">{account.name}</span>
                        {isLiability && (
                          <Badge tone="negative" title="Enter the amount owed as a positive number">
                            Owed
                          </Badge>
                        )}
                        {account.currency !== baseCurrency && <Badge tone="brand">{account.currency}</Badge>}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-content-faint">
                        {[account.institution, ACCOUNT_TYPE_LABELS[account.type]].filter(Boolean).join(' · ')}
                      </p>
                    </div>

                    <div className="hidden w-40 shrink-0 text-right sm:block">
                      <p className="tabular text-xs text-content-muted">
                        {valuation?.hasData
                          ? formatMoney(valuation.balanceNative, account.currency)
                          : 'No balance yet'}
                      </p>
                      <div className="mt-0.5 flex justify-end">
                        <FreshnessBadge
                          asAt={valuation?.asAtUsed ?? null}
                          ageDays={valuation?.ageDays ?? null}
                          hasData={valuation?.hasData ?? false}
                        />
                      </div>
                    </div>

                    <div className="w-full sm:w-40">
                      <label htmlFor={`balance-${account.id}`} className="sr-only">
                        {isLiability ? 'Amount owed' : 'Balance'} for {account.name} in {account.currency}
                      </label>
                      <AmountInput
                        id={`balance-${account.id}`}
                        ref={(element) => {
                          inputRefs.current[index] = element
                        }}
                        value={drafts[account.id] ?? ''}
                        placeholder={isLiability ? 'Amount owed' : '0.00'}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? `balance-error-${account.id}` : undefined}
                        onChange={(event) => setDraft(account.id, event.target.value)}
                        onKeyDown={(event) => onKeyDown(event, index)}
                        onFocus={(event) => event.target.select()}
                      />
                      {error && (
                        <p
                          id={`balance-error-${account.id}`}
                          role="alert"
                          className="mt-1 text-xs text-negative"
                        >
                          {error}
                        </p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
              <p className="text-xs text-content-faint">
                <kbd className="rounded border border-line px-1">Enter</kbd> next account ·{' '}
                <kbd className="rounded border border-line px-1">⌘/Ctrl + Enter</kbd> save
              </p>
              <Button variant="primary" size="sm" onClick={() => void save()} loading={busy}>
                Save balances
              </Button>
            </div>
          </Card>

          {entered > 0 && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-xs text-content-muted">Net worth after saving</p>
                  <p className="tabular mt-0.5 text-lg font-semibold text-content">
                    {formatMoney(preview.projected, baseCurrency)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-content-muted">Change</p>
                  <p
                    className={`tabular mt-0.5 text-sm font-semibold ${
                      preview.delta.isNegative() ? 'text-negative' : 'text-positive'
                    }`}
                  >
                    {formatSigned(preview.delta, baseCurrency)}
                  </p>
                </div>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
