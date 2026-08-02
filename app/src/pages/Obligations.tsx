import { useMemo, useState } from 'react'
import { AmountInput, Badge, Button, Card, CardHeader, Field, Input, PageHeader, cx } from '../ui/primitives'
import { EmptyState, ErrorState, SkeletonRows } from '../ui/feedback'
import { ConfirmDialog, Modal } from '../ui/Modal'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/toast'
import { ObligationForm } from './ObligationForm'
import { useAccounts } from '../data/accounts'
import {
  useDeleteObligation,
  useObligationPayments,
  useRecordPayment,
  useSaveObligation,
  useUpdateObligationStatus,
  type ObligationInput,
} from '../data/obligations'
import { useNetWorthEngine, useRecomputeNetWorth } from '../data/netWorth'
import { useBaseCurrency } from '../data/profile'
import { Decimal, d, formatMoney, parseMoneyInput } from '../lib/money'
import { formatDate, relativeDays, todayISO } from '../lib/dates'
import { OBLIGATION_STATUS_LABELS, RECURRENCE_LABELS, type Obligation, type ObligationDirection } from '../types'
import type { ObligationValuation } from '../lib/networth'
import { describeError } from '../lib/supabase'

type Filter = 'all' | ObligationDirection

export function Obligations() {
  const accounts = useAccounts()
  const baseCurrency = useBaseCurrency()
  const { engine } = useNetWorthEngine()
  const saveObligation = useSaveObligation()
  const deleteObligation = useDeleteObligation()
  const updateStatus = useUpdateObligationStatus()
  const recompute = useRecomputeNetWorth()
  const { notify } = useToast()

  const [filter, setFilter] = useState<Filter>('all')
  const [showSettled, setShowSettled] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Obligation | null>(null)
  const [paying, setPaying] = useState<Obligation | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Obligation | null>(null)

  const today = todayISO()
  const valuations = useMemo(() => engine.valueObligations(today), [engine, today])

  const visible = useMemo(() => {
    return valuations
      .filter((entry) => (filter === 'all' ? true : entry.obligation.direction === filter))
      .filter((entry) =>
        showSettled
          ? true
          : entry.obligation.status !== 'settled' && entry.obligation.status !== 'written_off',
      )
      .sort((a, b) => {
        // Overdue first, then by due date, then undated last.
        const dueA = a.obligation.due_date
        const dueB = b.obligation.due_date
        if (dueA && dueB) return dueA < dueB ? -1 : dueA > dueB ? 1 : 0
        if (dueA) return -1
        if (dueB) return 1
        return 0
      })
  }, [valuations, filter, showSettled])

  const totals = useMemo(() => {
    let owed = new Decimal(0)
    let owedToMe = new Decimal(0)
    for (const entry of valuations) {
      if (entry.obligation.status === 'settled' || entry.obligation.status === 'written_off') continue
      if (entry.obligation.direction === 'payable') owed = owed.plus(entry.outstandingBase)
      else owedToMe = owedToMe.plus(entry.outstandingBase)
    }
    return { owed, owedToMe, net: owedToMe.minus(owed) }
  }, [valuations])

  async function submit(input: ObligationInput) {
    try {
      await saveObligation.mutateAsync({ id: editing?.id, input })
      setFormOpen(false)
      setEditing(null)
      await recompute.mutateAsync()
      notify(editing ? 'Obligation updated.' : 'Obligation added.', { tone: 'success' })
    } catch (error) {
      notify(describeError(error), { tone: 'error' })
    }
  }

  if (accounts.isError) {
    return (
      <div className="space-y-5">
        <PageHeader title="Obligations" />
        <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
      </div>
    )
  }

  const displayOnlyCount = valuations.filter(
    (entry) => entry.excludedReason === 'linked_to_account',
  ).length

  return (
    <div className="space-y-5">
      <PageHeader
        title="Obligations"
        subtitle="What you owe, and what you are owed."
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
          >
            <Icon name="plus" />
            New obligation
          </Button>
        }
      />

      <Card>
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
          <Total label="I owe" value={formatMoney(totals.owed, baseCurrency)} tone="negative" />
          <Total label="Owed to me" value={formatMoney(totals.owedToMe, baseCurrency)} tone="positive" />
          <Total
            label="Net position"
            value={formatMoney(totals.net, baseCurrency)}
            tone={totals.net.isNegative() ? 'negative' : 'positive'}
          />
        </div>
        {displayOnlyCount > 0 && (
          <p className="border-t border-line px-4 py-2 text-xs text-content-faint">
            {displayOnlyCount} obligation{displayOnlyCount === 1 ? ' is' : 's are'} linked to an account
            that already carries the debt, so {displayOnlyCount === 1 ? 'it is' : 'they are'} shown here
            but not counted again against net worth.
          </p>
        )}
      </Card>

      <Card>
        <CardHeader
          title="All obligations"
          subtitle={`${visible.length} shown`}
          action={
            <div className="flex flex-wrap items-center gap-1">
              {(['all', 'payable', 'receivable'] as Filter[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={filter === option}
                  onClick={() => setFilter(option)}
                  className={cx(
                    'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                    filter === option
                      ? 'bg-brand/15 text-brand'
                      : 'text-content-faint hover:bg-surface-hover hover:text-content',
                  )}
                >
                  {option === 'all' ? 'All' : option === 'payable' ? 'I owe' : 'Owed to me'}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={showSettled}
                onClick={() => setShowSettled((current) => !current)}
                className={cx(
                  'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                  showSettled
                    ? 'bg-brand/15 text-brand'
                    : 'text-content-faint hover:bg-surface-hover hover:text-content',
                )}
              >
                Settled
              </button>
            </div>
          }
        />

        {accounts.isLoading ? (
          <SkeletonRows rows={4} />
        ) : visible.length === 0 ? (
          <EmptyState
            title={valuations.length === 0 ? 'Nothing tracked yet' : 'Nothing matches this filter'}
            description={
              valuations.length === 0
                ? 'Track a tax bill, a loan from family, or money a friend owes you. Anything outstanding in either direction.'
                : undefined
            }
            action={
              valuations.length === 0 ? (
                <Button
                  variant="primary"
                  onClick={() => {
                    setEditing(null)
                    setFormOpen(true)
                  }}
                >
                  Add one
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {visible.map((entry) => (
              <ObligationRow
                key={entry.obligation.id}
                valuation={entry}
                baseCurrency={baseCurrency}
                today={today}
                onEdit={() => {
                  setEditing(entry.obligation)
                  setFormOpen(true)
                }}
                onPay={() => setPaying(entry.obligation)}
                onDelete={() => setConfirmDelete(entry.obligation)}
                onWriteOff={async () => {
                  try {
                    await updateStatus.mutateAsync({ id: entry.obligation.id, status: 'written_off' })
                    await recompute.mutateAsync()
                    notify('Written off.', { tone: 'success' })
                  } catch (error) {
                    notify(describeError(error), { tone: 'error' })
                  }
                }}
              />
            ))}
          </ul>
        )}
      </Card>

      <ObligationForm
        open={formOpen}
        obligation={editing}
        accounts={accounts.data ?? []}
        defaultCurrency={baseCurrency}
        defaultDirection={filter === 'receivable' ? 'receivable' : 'payable'}
        busy={saveObligation.isPending}
        onClose={() => {
          setFormOpen(false)
          setEditing(null)
        }}
        onSubmit={(input) => void submit(input)}
      />

      <PaymentDialog obligation={paying} onClose={() => setPaying(null)} />

      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        busy={deleteObligation.isPending}
        title="Delete this obligation?"
        confirmLabel="Delete"
        message={
          <p>
            <strong className="text-content">{confirmDelete?.counterparty}</strong> — this obligation and
            all payments recorded against it will be deleted.
          </p>
        }
        onConfirm={async () => {
          if (!confirmDelete) return
          try {
            await deleteObligation.mutateAsync(confirmDelete.id)
            setConfirmDelete(null)
            await recompute.mutateAsync()
            notify('Obligation deleted.', { tone: 'success' })
          } catch (error) {
            notify(describeError(error), { tone: 'error' })
          }
        }}
      />
    </div>
  )
}

function ObligationRow({
  valuation,
  baseCurrency,
  today,
  onEdit,
  onPay,
  onDelete,
  onWriteOff,
}: {
  valuation: ObligationValuation
  baseCurrency: string
  today: string
  onEdit: () => void
  onPay: () => void
  onDelete: () => void
  onWriteOff: () => void
}) {
  const { obligation } = valuation
  const isPayable = obligation.direction === 'payable'
  const overdue = Boolean(
    obligation.due_date && obligation.due_date < today && valuation.outstandingNative.gt(0),
  )
  const paid = d(obligation.amount_settled)
  const total = d(obligation.amount_total)
  const percent = total.isZero() ? 0 : paid.div(total).times(100).toNumber()

  return (
    <li className={cx('px-4 py-3', overdue && 'bg-negative/5')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-medium text-content">{obligation.counterparty}</span>
            <Badge tone={isPayable ? 'negative' : 'positive'}>{isPayable ? 'I owe' : 'Owed to me'}</Badge>
            {overdue && <Badge tone="negative">Overdue</Badge>}
            {obligation.status !== 'open' && (
              <Badge tone={obligation.status === 'settled' ? 'positive' : 'neutral'}>
                {OBLIGATION_STATUS_LABELS[obligation.status]}
              </Badge>
            )}
            {obligation.recurrence !== 'none' && (
              <Badge tone="brand">{RECURRENCE_LABELS[obligation.recurrence]}</Badge>
            )}
            {valuation.excludedReason === 'linked_to_account' && (
              <Badge
                tone="neutral"
                title="The linked account already carries this debt, so counting it again would double it"
              >
                Not double-counted
              </Badge>
            )}
          </div>

          {obligation.description && (
            <p className="mt-0.5 truncate text-xs text-content-muted">{obligation.description}</p>
          )}

          <p className="mt-0.5 text-xs text-content-faint">
            {obligation.due_date
              ? `Due ${formatDate(obligation.due_date)} · ${relativeDays(obligation.due_date, today)}`
              : 'No due date'}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="tabular text-sm font-semibold text-content">
            {formatMoney(valuation.outstandingNative, obligation.currency)}
          </p>
          {paid.gt(0) && (
            <p className="tabular text-xs text-content-faint">
              {formatMoney(paid, obligation.currency)} of {formatMoney(total, obligation.currency)} paid
            </p>
          )}
          {obligation.currency !== baseCurrency && (
            <p className="tabular text-xs text-content-faint">
              ≈ {formatMoney(valuation.outstandingBase, baseCurrency)}
            </p>
          )}
        </div>
      </div>

      {paid.gt(0) && paid.lt(total) && (
        <div
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-hover"
          role="progressbar"
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${obligation.counterparty} settled`}
        >
          <div className="h-full rounded-full bg-brand-strong" style={{ width: `${Math.min(100, percent)}%` }} />
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {valuation.outstandingNative.gt(0) && obligation.status !== 'written_off' && (
          <Button size="sm" variant="primary" onClick={onPay}>
            Record {isPayable ? 'payment' : 'receipt'}
          </Button>
        )}
        <Button size="sm" onClick={onEdit}>
          Edit
        </Button>
        {obligation.status !== 'written_off' && valuation.outstandingNative.gt(0) && (
          <Button size="sm" onClick={onWriteOff}>
            Write off
          </Button>
        )}
        <Button size="sm" variant="ghost" aria-label="Delete obligation" onClick={onDelete}>
          <Icon name="trash" className="size-3.5" />
        </Button>
      </div>
    </li>
  )
}

function PaymentDialog({ obligation, onClose }: { obligation: Obligation | null; onClose: () => void }) {
  const recordPayment = useRecordPayment()
  const recompute = useRecomputeNetWorth()
  const payments = useObligationPayments(obligation?.id)
  const { notify } = useToast()

  const [paidOn, setPaidOn] = useState(todayISO())
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)

  const outstanding = obligation
    ? Decimal.max(d(obligation.amount_total).minus(d(obligation.amount_settled)), 0)
    : new Decimal(0)

  async function submit() {
    if (!obligation) return
    const parsed = parseMoneyInput(amount)
    if (!parsed || parsed.lte(0)) {
      setError('Enter an amount greater than zero.')
      return
    }
    if (parsed.gt(outstanding)) {
      setError(`That is more than the ${formatMoney(outstanding, obligation.currency)} outstanding.`)
      return
    }

    try {
      const result = await recordPayment.mutateAsync({ obligation, paidOn, amount: parsed })
      await recompute.mutateAsync()
      setAmount('')
      setError(null)
      onClose()

      if (result.nextInstanceId) {
        notify('Settled — the next occurrence has been created.', { tone: 'success' })
      } else if (result.settled) {
        notify('Settled in full.', { tone: 'success' })
      } else {
        notify('Payment recorded.', { tone: 'success' })
      }
    } catch (caught) {
      notify(describeError(caught), { tone: 'error' })
    }
  }

  const isPayable = obligation?.direction === 'payable'

  return (
    <Modal
      open={obligation !== null}
      onClose={onClose}
      title={isPayable ? 'Record a payment' : 'Record a receipt'}
      description={obligation ? `${obligation.counterparty} — ${formatMoney(outstanding, obligation.currency)} outstanding` : undefined}
      footer={
        <>
          <Button onClick={onClose} disabled={recordPayment.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={recordPayment.isPending} onClick={() => void submit()}>
            Record
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" required>
            {(props) => (
              <Input {...props} type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
            )}
          </Field>

          <Field label="Amount" required error={error}>
            {(props) => (
              <AmountInput
                {...props}
                value={amount}
                autoFocus
                placeholder={outstanding.toFixed(2)}
                onChange={(event) => {
                  setAmount(event.target.value)
                  setError(null)
                }}
              />
            )}
          </Field>
        </div>

        <Button size="sm" onClick={() => setAmount(outstanding.toFixed(2))}>
          Pay the full {formatMoney(outstanding, obligation?.currency ?? 'AUD')}
        </Button>

        {obligation?.recurrence !== 'none' && (
          <p className="rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-xs text-content-muted">
            This repeats {RECURRENCE_LABELS[obligation?.recurrence ?? 'none'].toLowerCase()}. Settling it in
            full creates the next occurrence automatically.
          </p>
        )}

        {(payments.data ?? []).length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-content-muted">Payments so far</p>
            <ul className="space-y-1">
              {(payments.data ?? []).map((payment) => (
                <li key={payment.id} className="flex justify-between text-xs">
                  <span className="text-content-faint">{formatDate(payment.paid_on)}</span>
                  <span className="tabular text-content">
                    {formatMoney(payment.amount, payment.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}

function Total({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'positive' | 'negative'
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
      <p className="text-xs text-content-muted">{label}</p>
      <p
        className={cx(
          'tabular mt-0.5 text-lg font-semibold',
          tone === 'negative' ? 'text-negative' : 'text-positive',
        )}
      >
        {value}
      </p>
    </div>
  )
}
