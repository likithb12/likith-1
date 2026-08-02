import { useState } from 'react'
import { AmountInput, Badge, Button, Field, Input, Select } from '../ui/primitives'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/toast'
import { useDeleteHolding, useHoldings, useSaveHolding } from '../data/investments'
import { useRecomputeNetWorth } from '../data/netWorth'
import { formatMoney, parseMoneyInput } from '../lib/money'
import { COMMON_CURRENCIES } from '../lib/fx'
import { describeError } from '../lib/supabase'
import type { Account } from '../types'
import type { AccountValuation } from '../lib/networth'

/**
 * Holdings for a brokerage account.
 *
 * A brokerage account with holdings has no single balance field — its value is
 * derived from units × the latest price, so entering a balance as well would
 * create two competing sources of truth for the same number.
 */
export function HoldingsPanel({
  account,
  valuation,
}: {
  account: Account
  valuation?: AccountValuation
}) {
  const holdings = useHoldings()
  const saveHolding = useSaveHolding()
  const deleteHolding = useDeleteHolding()
  const recompute = useRecomputeNetWorth()
  const { notify } = useToast()

  const [ticker, setTicker] = useState('')
  const [units, setUnits] = useState('')
  const [avgCost, setAvgCost] = useState('')
  const [currency, setCurrency] = useState(account.currency)
  const [error, setError] = useState<string | null>(null)

  const mine = (holdings.data ?? []).filter((holding) => holding.account_id === account.id)

  async function add() {
    const parsedUnits = parseMoneyInput(units)
    if (!ticker.trim()) {
      setError('Enter a ticker.')
      return
    }
    if (!parsedUnits || parsedUnits.lte(0)) {
      setError('Enter the number of units held.')
      return
    }

    try {
      await saveHolding.mutateAsync({
        input: {
          account_id: account.id,
          ticker: ticker.trim().toUpperCase(),
          exchange: ticker.trim().toUpperCase().endsWith('.AX') ? 'ASX' : null,
          units: parsedUnits,
          avg_cost_per_unit: avgCost.trim() ? (parseMoneyInput(avgCost) ?? null) : null,
          currency,
        },
      })
      setTicker('')
      setUnits('')
      setAvgCost('')
      setError(null)
      await recompute.mutateAsync()
      notify('Holding added.', { tone: 'success' })
    } catch (caught) {
      notify(describeError(caught), { tone: 'error' })
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-content-muted">Holdings</p>
        {valuation?.derivedFromHoldings && (
          <span className="tabular text-xs text-content-faint">
            Valued at {formatMoney(valuation.balanceNative, account.currency)}
            {valuation.pricesStale && ' · using a stale or fallback price'}
          </span>
        )}
      </div>

      {mine.length === 0 ? (
        <p className="text-xs text-content-faint">
          No holdings yet. Until one is added, this account uses manually entered balances.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Holdings in {account.name}</caption>
            <thead>
              <tr className="text-left text-xs text-content-faint">
                <th scope="col" className="py-1.5 pr-3 font-medium">Ticker</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">Units</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">Avg cost</th>
                <th scope="col" className="py-1.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {mine.map((holding) => (
                <tr key={holding.id}>
                  <td className="py-1.5 pr-3">
                    <span className="text-content">{holding.ticker}</span>
                    {holding.currency !== account.currency && (
                      <Badge tone="brand" className="ml-1.5">
                        {holding.currency}
                      </Badge>
                    )}
                  </td>
                  <td className="tabular py-1.5 pr-3 text-right text-content-muted">
                    {Number(holding.units).toLocaleString('en-AU', { maximumFractionDigits: 6 })}
                  </td>
                  <td className="tabular py-1.5 pr-3 text-right text-content-muted">
                    {holding.avg_cost_per_unit
                      ? formatMoney(holding.avg_cost_per_unit, holding.currency)
                      : '—'}
                  </td>
                  <td className="py-1.5 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete holding ${holding.ticker}`}
                      onClick={async () => {
                        try {
                          await deleteHolding.mutateAsync(holding.id)
                          await recompute.mutateAsync()
                          notify('Holding removed.', { tone: 'success' })
                        } catch (caught) {
                          notify(describeError(caught), { tone: 'error' })
                        }
                      }}
                    >
                      <Icon name="trash" className="size-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-5">
        <Field label="Ticker" error={error} className="sm:col-span-2">
          {(props) => (
            <Input
              {...props}
              value={ticker}
              placeholder="VAS.AX"
              onChange={(event) => {
                setTicker(event.target.value)
                setError(null)
              }}
            />
          )}
        </Field>
        <Field label="Units">
          {(props) => (
            <AmountInput
              {...props}
              value={units}
              placeholder="0"
              onChange={(event) => setUnits(event.target.value)}
            />
          )}
        </Field>
        <Field label="Avg cost" hint="Used if no price.">
          {(props) => (
            <AmountInput
              {...props}
              value={avgCost}
              placeholder="0.00"
              onChange={(event) => setAvgCost(event.target.value)}
            />
          )}
        </Field>
        <Field label="Currency">
          {(props) => (
            <Select {...props} value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {[...new Set([account.currency, ...COMMON_CURRENCIES])].map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <Button size="sm" variant="primary" loading={saveHolding.isPending} onClick={() => void add()}>
        <Icon name="plus" />
        Add holding
      </Button>
    </div>
  )
}
