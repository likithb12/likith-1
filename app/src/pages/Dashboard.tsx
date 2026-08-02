import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, CardHeader, PageHeader, cx } from '../ui/primitives'
import { EmptyState, ErrorState, SkeletonRows, WarningBanner } from '../ui/feedback'
import { FreshnessBadge } from '../ui/Freshness'
import { NetWorthTrend, rangeStart, type TrendRange } from '../components/NetWorthTrend'
import { CompositionChart } from '../components/CompositionChart'
import { useAccounts } from '../data/accounts'
import { useBalanceSnapshots } from '../data/balances'
import { useNetWorthEngine, useNetWorthSnapshots, useRecomputeNetWorth } from '../data/netWorth'
import { useBaseCurrency } from '../data/profile'
import { formatMoney, formatPercent, formatSigned, percentChange } from '../lib/money'
import { addMonths, todayISO, type ISODate } from '../lib/dates'
import { STALE_AFTER_DAYS } from '../types'
import { useToast } from '../ui/toast'
import { describeError } from '../lib/supabase'

export function Dashboard() {
  const accounts = useAccounts()
  const snapshots = useBalanceSnapshots()
  const netWorthSnapshots = useNetWorthSnapshots()
  const baseCurrency = useBaseCurrency()
  const { engine } = useNetWorthEngine()
  const recompute = useRecomputeNetWorth()
  const { notify } = useToast()

  const [range, setRange] = useState<TrendRange>('1Y')

  const today = todayISO()
  const current = useMemo(() => engine.computeAt(today), [engine, today])

  const changes = useMemo(
    () =>
      ([
        { label: '1 month', months: 1 },
        { label: '3 months', months: 3 },
        { label: '12 months', months: 12 },
      ] as const).map(({ label, months }) => {
        const then = engine.computeAt(addMonths(today, -months))
        const delta = current.netWorthBase.minus(then.netWorthBase)
        return {
          label,
          delta,
          percent: percentChange(then.netWorthBase, current.netWorthBase),
          // Before any history exists the "change" is just the opening
          // balance, which is not a change at all.
          meaningful: then.hasAnyData,
        }
      }),
    [engine, current, today],
  )

  /** Dates for the composition chart: every date an input changed, plus today. */
  const compositionDates = useMemo<ISODate[]>(() => {
    const start = rangeStart(range, today)
    const significant = engine
      .significantDates()
      .filter((date) => (start ? date >= start : true))
    return [...new Set([...significant, today])].sort()
  }, [engine, range, today])

  const staleAccounts = current.staleAccounts
  const isLoading = accounts.isLoading || snapshots.isLoading

  if (accounts.isError || snapshots.isError) {
    return (
      <div className="space-y-5">
        <PageHeader title="Dashboard" />
        <ErrorState
          error={accounts.error ?? snapshots.error}
          onRetry={() => {
            void accounts.refetch()
            void snapshots.refetch()
          }}
        />
      </div>
    )
  }

  const hasAccounts = (accounts.data ?? []).length > 0

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        actions={
          <Link
            to="/balances"
            className="inline-flex items-center rounded-lg bg-brand-strong px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand"
          >
            Update balances
          </Link>
        }
      />

      {isLoading ? (
        <Card>
          <SkeletonRows rows={4} />
        </Card>
      ) : !hasAccounts ? (
        <Card>
          <EmptyState
            title="Welcome — let's get your first number on the board"
            description="Add your accounts, then record a balance for each. Net worth is tracked from balance snapshots over time, so the trend starts the day you start recording."
            action={
              <Link
                to="/accounts"
                className="inline-flex items-center rounded-lg bg-brand-strong px-3.5 py-2 text-sm font-medium text-white hover:bg-brand"
              >
                Add your first account
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          {current.warnings.length > 0 && <WarningBanner messages={current.warnings} />}

          {/* The headline number. */}
          <Card>
            <div className="p-5">
              <p className="text-xs font-medium tracking-wide text-content-muted uppercase">
                Net worth
              </p>
              <p className="tabular mt-1 text-4xl font-semibold tracking-tight text-content sm:text-5xl">
                {current.hasAnyData ? formatMoney(current.netWorthBase, baseCurrency) : '—'}
              </p>
              <p className="mt-1 text-xs text-content-faint">
                {baseCurrency} · {formatMoney(current.totalAssetsBase, baseCurrency)} assets −{' '}
                {formatMoney(current.totalLiabilitiesBase, baseCurrency)} liabilities
              </p>

              <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {changes.map((change) => (
                  <div key={change.label} className="rounded-lg border border-line bg-surface px-3 py-2.5">
                    <dt className="text-xs text-content-muted">vs {change.label} ago</dt>
                    <dd className="mt-0.5">
                      {change.meaningful ? (
                        <>
                          <span
                            className={cx(
                              'tabular text-sm font-semibold',
                              change.delta.isNegative() ? 'text-negative' : 'text-positive',
                            )}
                          >
                            {formatSigned(change.delta, baseCurrency)}
                          </span>
                          <span className="tabular ml-2 text-xs text-content-faint">
                            {formatPercent(change.percent)}
                          </span>
                        </>
                      ) : (
                        <span className="text-sm text-content-faint" title="No balances recorded that far back">
                          Not enough history
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Net worth over time"
              subtitle="Built from your recorded balances."
              action={
                <Button
                  size="sm"
                  variant="ghost"
                  loading={recompute.isPending}
                  onClick={async () => {
                    try {
                      const count = await recompute.mutateAsync()
                      notify(`Recomputed ${count} data point${count === 1 ? '' : 's'}.`, {
                        tone: 'success',
                      })
                    } catch (error) {
                      notify(describeError(error), { tone: 'error' })
                    }
                  }}
                >
                  Recompute
                </Button>
              }
            />
            <NetWorthTrend
              snapshots={netWorthSnapshots.data ?? []}
              baseCurrency={baseCurrency}
              range={range}
              onRangeChange={setRange}
            />
          </Card>

          <Card>
            <CardHeader
              title="What it is made of"
              subtitle="Assets by type above the line, what you owe below it."
            />
            <CompositionChart engine={engine} dates={compositionDates} baseCurrency={baseCurrency} />
          </Card>

          {/*
            The stale-data problem is the main failure mode of a manual
            tracker, so every input's age is on the front page rather than
            buried in the accounts screen.
          */}
          <Card>
            <CardHeader
              title="How current is this?"
              subtitle={
                staleAccounts.length > 0
                  ? `${staleAccounts.length} account${staleAccounts.length === 1 ? '' : 's'} not updated in over ${STALE_AFTER_DAYS} days`
                  : 'Every account has been updated recently.'
              }
              action={
                <Link to="/balances" className="text-xs font-medium text-brand underline underline-offset-2">
                  Update
                </Link>
              }
            />
            <ul className="divide-y divide-line">
              {current.accounts
                .filter((valuation) => valuation.account.is_active || valuation.hasData)
                .sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1))
                .map((valuation) => (
                  <li
                    key={valuation.account.id}
                    className="flex items-center justify-between gap-3 px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-content">{valuation.account.name}</p>
                      {!valuation.account.include_in_net_worth && (
                        <Badge tone="neutral" className="mt-0.5">
                          Excluded from total
                        </Badge>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="tabular text-sm text-content-muted">
                        {valuation.hasData
                          ? formatMoney(valuation.balanceNative, valuation.currency)
                          : '—'}
                      </span>
                      <FreshnessBadge
                        asAt={valuation.asAtUsed}
                        ageDays={valuation.ageDays}
                        hasData={valuation.hasData}
                      />
                    </div>
                  </li>
                ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}
