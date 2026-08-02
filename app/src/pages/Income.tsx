import { useEffect, useMemo, useState } from 'react'
import { AmountInput, Badge, Button, Card, CardHeader, Checkbox, Field, Input, PageHeader, Select, cx } from '../ui/primitives'
import { EmptyState, ErrorState, SkeletonRows } from '../ui/feedback'
import { Modal } from '../ui/Modal'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/toast'
import { MonthComparisonChart } from '../components/SpendingChart'
import { useAccounts } from '../data/accounts'
import {
  useDeleteIncomeEvent,
  useDeleteIncomeSource,
  useIncomeEvents,
  useIncomeSources,
  useRecordIncomeEvent,
  useSaveIncomeSource,
  useMatchIncomeToTransaction,
} from '../data/income'
import { useTransactions } from '../data/transactions'
import { useBaseCurrency } from '../data/profile'
import { monthlySavings, monthlyTotals, trailingTwelveMonths } from '../lib/spending'
import { formatMoney, formatPercent, parseMoneyInput } from '../lib/money'
import {
  addMonths,
  formatDate,
  formatMonth,
  frequencyPerYear,
  monthEnd,
  monthRange,
  monthStart,
  relativeDays,
  todayISO,
  type Frequency,
} from '../lib/dates'
import { FREQUENCY_LABELS, type IncomeSource } from '../types'
import { COMMON_CURRENCIES } from '../lib/fx'
import { describeError } from '../lib/supabase'

export function Income() {
  const today = todayISO()
  const sources = useIncomeSources()
  const events = useIncomeEvents()
  const baseCurrency = useBaseCurrency()
  const deleteSource = useDeleteIncomeSource()
  const deleteEvent = useDeleteIncomeEvent()
  const { notify } = useToast()

  // Thirteen months so the trailing-twelve window is fully covered.
  const transactions = useTransactions({ from: monthStart(addMonths(today, -12)), to: monthEnd(today) })

  const [sourceFormOpen, setSourceFormOpen] = useState(false)
  const [editingSource, setEditingSource] = useState<IncomeSource | null>(null)
  const [eventFormOpen, setEventFormOpen] = useState(false)

  const rows = transactions.data ?? []
  const allEvents = events.data ?? []

  const months = useMemo(() => monthRange(addMonths(today, -11), today), [today])

  const savings = useMemo(
    () => monthlySavings(rows, allEvents, months),
    [rows, allEvents, months],
  )

  const trailing = useMemo(
    () => trailingTwelveMonths(rows, allEvents, today),
    [rows, allEvents, today],
  )

  const thisMonth = savings[savings.length - 1]

  // The chart uses transaction-derived totals so both series come from one
  // source; unmatched income events are surfaced separately below.
  const chartMonths = useMemo(() => monthlyTotals(rows), [rows])

  const annualisedExpected = useMemo(() => {
    let total = 0
    for (const source of sources.data ?? []) {
      if (!source.is_active || !source.gross_amount) continue
      const perYear = frequencyPerYear(source.frequency)
      if (perYear === null) continue
      total += Number(source.gross_amount) * perYear
    }
    return total
  }, [sources.data])

  if (sources.isError) {
    return (
      <div className="space-y-5">
        <PageHeader title="Income" />
        <ErrorState error={sources.error} onRetry={() => void sources.refetch()} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Income"
        subtitle="What comes in, and how much of it you keep."
        actions={
          <>
            <Button onClick={() => setEventFormOpen(true)}>Record income</Button>
            <Button
              variant="primary"
              onClick={() => {
                setEditingSource(null)
                setSourceFormOpen(true)
              }}
            >
              <Icon name="plus" />
              New source
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader title="Savings rate" subtitle="(income − spending) ÷ income. Transfers excluded." />
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
          <Metric
            label={`This month (${formatMonth(monthStart(today))})`}
            value={formatPercent(thisMonth?.rate ?? null)}
            sub={
              thisMonth
                ? `${formatMoney(thisMonth.income, baseCurrency)} in · ${formatMoney(thisMonth.spend, baseCurrency)} out`
                : undefined
            }
            tone={thisMonth?.rate?.isNegative() ? 'negative' : 'positive'}
          />
          <Metric
            label="Trailing 12 months"
            value={formatPercent(trailing.rate)}
            sub={`${formatMoney(trailing.income, baseCurrency)} in · ${formatMoney(trailing.spend, baseCurrency)} out`}
            tone={trailing.rate?.isNegative() ? 'negative' : 'positive'}
          />
          <Metric
            label="Expected income a year"
            value={annualisedExpected > 0 ? formatMoney(annualisedExpected, baseCurrency) : '—'}
            sub="From active sources with a regular frequency."
          />
        </div>
        {trailing.rate === null && (
          <p className="border-t border-line px-4 py-2 text-xs text-content-faint">
            No income recorded in the last twelve months, so there is no rate to show. A percentage of
            zero income would be meaningless rather than zero.
          </p>
        )}
      </Card>

      <Card>
        <CardHeader title="Income vs expenses" subtitle="By month, from your transactions." />
        <MonthComparisonChart months={chartMonths} baseCurrency={baseCurrency} />
      </Card>

      <Card>
        <CardHeader title="Sources" subtitle={`${(sources.data ?? []).length} tracked`} />
        {sources.isLoading ? (
          <SkeletonRows rows={3} />
        ) : (sources.data ?? []).length === 0 ? (
          <EmptyState
            title="No income sources yet"
            description="Add your salary or any regular income so the app knows what to expect and when."
            action={
              <Button
                variant="primary"
                onClick={() => {
                  setEditingSource(null)
                  setSourceFormOpen(true)
                }}
              >
                Add a source
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {(sources.data ?? []).map((source) => (
              <li key={source.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-content">{source.name}</span>
                    <Badge tone="neutral">{FREQUENCY_LABELS[source.frequency]}</Badge>
                    {!source.is_active && <Badge tone="neutral">Inactive</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-content-faint">
                    {[
                      source.employer,
                      source.next_expected_date
                        ? `next ${formatDate(source.next_expected_date)} (${relativeDays(source.next_expected_date, today)})`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'No schedule set'}
                  </p>
                </div>

                <span className="tabular text-sm font-semibold text-content">
                  {source.gross_amount ? formatMoney(source.gross_amount, source.currency) : '—'}
                </span>

                <div className="flex gap-1">
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditingSource(source)
                      setSourceFormOpen(true)
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete ${source.name}`}
                    onClick={async () => {
                      try {
                        await deleteSource.mutateAsync(source.id)
                        notify('Source deleted.', { tone: 'success' })
                      } catch (error) {
                        notify(describeError(error), { tone: 'error' })
                      }
                    }}
                  >
                    <Icon name="trash" className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Received"
          subtitle="Income events. Ones matched to an imported transaction are not counted twice."
        />
        {events.isLoading ? (
          <SkeletonRows rows={3} />
        ) : allEvents.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            description="Record income as it arrives, or rely on imported credit transactions — both feed the savings rate, and a matched pair only counts once."
          />
        ) : (
          <ul className="divide-y divide-line">
            {allEvents.map((event) => {
              const source = (sources.data ?? []).find((entry) => entry.id === event.income_source_id)
              return (
                <li key={event.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-content">{source?.name ?? 'Income'}</p>
                    <p className="text-xs text-content-faint">{formatDate(event.received_on)}</p>
                  </div>
                  {event.transaction_id ? (
                    <Badge tone="brand" title="Matched to an imported transaction, so it is not double counted">
                      Matched
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Unmatched</Badge>
                  )}
                  <span className="tabular text-sm font-semibold text-content">
                    {formatMoney(event.net_amount, event.currency)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Delete income event"
                    onClick={async () => {
                      try {
                        await deleteEvent.mutateAsync(event.id)
                        notify('Removed.', { tone: 'success' })
                      } catch (error) {
                        notify(describeError(error), { tone: 'error' })
                      }
                    }}
                  >
                    <Icon name="trash" className="size-3.5" />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <SourceForm
        open={sourceFormOpen}
        source={editingSource}
        defaultCurrency={baseCurrency}
        onClose={() => {
          setSourceFormOpen(false)
          setEditingSource(null)
        }}
      />

      <IncomeEventForm open={eventFormOpen} onClose={() => setEventFormOpen(false)} />
    </div>
  )
}

function Metric({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string
  value: string
  sub?: string
  tone?: 'neutral' | 'positive' | 'negative'
}) {
  const tones = { neutral: 'text-content', positive: 'text-positive', negative: 'text-negative' }
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
      <p className="text-xs text-content-muted">{label}</p>
      <p className={cx('tabular mt-0.5 text-xl font-semibold', tones[tone])}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-content-faint">{sub}</p>}
    </div>
  )
}

function SourceForm({
  open,
  onClose,
  source,
  defaultCurrency,
}: {
  open: boolean
  onClose: () => void
  source: IncomeSource | null
  defaultCurrency: string
}) {
  const saveSource = useSaveIncomeSource()
  const { notify } = useToast()

  const [name, setName] = useState('')
  const [employer, setEmployer] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(defaultCurrency)
  const [frequency, setFrequency] = useState<Frequency>('fortnightly')
  const [nextDate, setNextDate] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(source?.name ?? '')
    setEmployer(source?.employer ?? '')
    setAmount(source?.gross_amount ? String(source.gross_amount) : '')
    setCurrency(source?.currency ?? defaultCurrency)
    setFrequency(source?.frequency ?? 'fortnightly')
    setNextDate(source?.next_expected_date ?? '')
    setIsActive(source?.is_active ?? true)
    setError(null)
  }, [open, source, defaultCurrency])

  async function submit() {
    if (!name.trim()) {
      setError('Give the source a name.')
      return
    }
    try {
      await saveSource.mutateAsync({
        id: source?.id,
        input: {
          name: name.trim(),
          employer: employer.trim() || null,
          gross_amount: amount.trim() ? (parseMoneyInput(amount) ?? null) : null,
          currency,
          frequency,
          next_expected_date: nextDate || null,
          is_active: isActive,
        },
      })
      notify(source ? 'Source updated.' : 'Source added.', { tone: 'success' })
      onClose()
    } catch (caught) {
      notify(describeError(caught), { tone: 'error' })
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={source ? 'Edit income source' : 'New income source'}
      footer={
        <>
          <Button onClick={onClose} disabled={saveSource.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={saveSource.isPending} onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" required error={error}>
          {(props) => (
            <Input
              {...props}
              value={name}
              autoFocus
              placeholder="Salary"
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>

        <Field label="Employer">
          {(props) => (
            <Input
              {...props}
              value={employer}
              placeholder="ACME Pty Ltd"
              onChange={(event) => setEmployer(event.target.value)}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Gross amount each time">
            {(props) => (
              <AmountInput
                {...props}
                value={amount}
                placeholder="0.00"
                onChange={(event) => setAmount(event.target.value)}
              />
            )}
          </Field>

          <Field label="Currency">
            {(props) => (
              <Select {...props} value={currency} onChange={(event) => setCurrency(event.target.value)}>
                {[...new Set([defaultCurrency, ...COMMON_CURRENCIES])].map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Frequency">
            {(props) => (
              <Select
                {...props}
                value={frequency}
                onChange={(event) => setFrequency(event.target.value as Frequency)}
              >
                {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Next expected">
            {(props) => (
              <Input
                {...props}
                type="date"
                value={nextDate}
                onChange={(event) => setNextDate(event.target.value)}
              />
            )}
          </Field>
        </div>

        <Checkbox
          label="Active"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
        />
      </div>
    </Modal>
  )
}

function IncomeEventForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sources = useIncomeSources()
  const accounts = useAccounts()
  const baseCurrency = useBaseCurrency()
  const recordEvent = useRecordIncomeEvent()
  const matchTransaction = useMatchIncomeToTransaction()
  const { notify } = useToast()

  const today = todayISO()
  const [receivedOn, setReceivedOn] = useState(today)
  const [sourceId, setSourceId] = useState('')
  const [net, setNet] = useState('')
  const [gross, setGross] = useState('')
  const [accountId, setAccountId] = useState('')
  const [transactionId, setTransactionId] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Candidate credit transactions near the chosen date, to match against.
  const candidates = useTransactions({
    from: addMonths(receivedOn, -1),
    to: addMonths(receivedOn, 1),
    includeTransfers: false,
  })
  const creditCandidates = (candidates.data ?? []).filter(
    (transaction) => transaction.direction === 'credit',
  )

  async function submit() {
    const parsed = parseMoneyInput(net)
    if (!parsed || parsed.lte(0)) {
      setError('Enter the amount received.')
      return
    }

    const source = (sources.data ?? []).find((entry) => entry.id === sourceId) ?? null

    try {
      await recordEvent.mutateAsync({
        input: {
          income_source_id: sourceId || null,
          received_on: receivedOn,
          gross_amount: gross.trim() ? (parseMoneyInput(gross) ?? null) : null,
          net_amount: parsed,
          currency: source?.currency ?? baseCurrency,
          account_id: accountId || null,
          transaction_id: transactionId || null,
        },
        source,
      })
      setNet('')
      setGross('')
      setTransactionId('')
      setError(null)
      onClose()
      notify('Income recorded.', { tone: 'success' })
    } catch (caught) {
      notify(describeError(caught), { tone: 'error' })
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record income"
      footer={
        <>
          <Button onClick={onClose} disabled={recordEvent.isPending || matchTransaction.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={recordEvent.isPending} onClick={() => void submit()}>
            Record
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Received on" required>
            {(props) => (
              <Input
                {...props}
                type="date"
                value={receivedOn}
                onChange={(event) => setReceivedOn(event.target.value)}
              />
            )}
          </Field>

          <Field label="Source">
            {(props) => (
              <Select {...props} value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
                <option value="">Not from a tracked source</option>
                {(sources.data ?? []).map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Net received" required error={error}>
            {(props) => (
              <AmountInput
                {...props}
                value={net}
                autoFocus
                placeholder="0.00"
                onChange={(event) => {
                  setNet(event.target.value)
                  setError(null)
                }}
              />
            )}
          </Field>

          <Field label="Gross (optional)">
            {(props) => (
              <AmountInput
                {...props}
                value={gross}
                placeholder="0.00"
                onChange={(event) => setGross(event.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Into account">
          {(props) => (
            <Select {...props} value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">Not specified</option>
              {(accounts.data ?? []).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Matches this imported transaction"
          hint="Matching prevents the same money being counted twice in the savings rate."
        >
          {(props) => (
            <Select
              {...props}
              value={transactionId}
              onChange={(event) => setTransactionId(event.target.value)}
            >
              <option value="">Not matched</option>
              {creditCandidates.slice(0, 50).map((transaction) => (
                <option key={transaction.id} value={transaction.id}>
                  {formatDate(transaction.txn_date)} · {formatMoney(transaction.amount, transaction.currency)} ·{' '}
                  {transaction.description ?? transaction.description_raw ?? ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  )
}
