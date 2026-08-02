import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireSupabase } from '../lib/supabase'
import { useUserId } from '../auth/AuthProvider'
import { queryKeys } from './keys'
import { fetchAllPages, normaliseRows } from './rows'
import { NetWorthEngine } from '../lib/networth'
import { FxTable } from '../lib/fx'
import { toDb } from '../lib/money'
import { todayISO, type ISODate } from '../lib/dates'
import { useAccounts } from './accounts'
import { useBalanceSnapshots } from './balances'
import { useBaseCurrency } from './profile'
import { useObligations } from './obligations'
import { useFxRates, useHoldings, usePricePoints } from './investments'
import type { BalanceSnapshot, FxRate, Holding, NetWorthSnapshot, Obligation, PricePoint } from '../types'

/**
 * The materialised trend table.
 *
 * Recomputation is a single idempotent path: compute every date on which an
 * input changed, upsert on (user_id, as_at), then delete rows for dates that
 * are no longer significant. Re-running any range produces the same result and
 * never duplicates. See DECISIONS.md D19 for why this lives here rather than
 * in a Postgres function.
 */

export function useNetWorthSnapshots() {
  return useQuery({
    queryKey: queryKeys.netWorthSnapshots,
    queryFn: async (): Promise<NetWorthSnapshot[]> => {
      const supabase = requireSupabase()
      const rows = await fetchAllPages<NetWorthSnapshot>((from, to) =>
        supabase
          .from('net_worth_snapshots')
          .select('*')
          .order('as_at', { ascending: true })
          .range(from, to),
      )
      return normaliseRows(rows as unknown as Record<string, unknown>[], [
        'total_assets_base',
        'total_liabilities_base',
        'net_worth_base',
      ]) as unknown as NetWorthSnapshot[]
    },
  })
}

/** Everything the calculation reads. */
async function fetchEngineInputs(supabase: SupabaseClient) {
  const accounts = await fetchAllPages((from, to) =>
    supabase.from('accounts').select('*').order('display_order').range(from, to),
  )
  const snapshotRows = await fetchAllPages((from, to) =>
    supabase.from('balance_snapshots').select('*').order('as_at').range(from, to),
  )
  const snapshots = normaliseRows(
    snapshotRows as unknown as Record<string, unknown>[],
    ['balance'],
  ) as unknown as BalanceSnapshot[]

  const obligationRows = await fetchAllPages((from, to) =>
    supabase.from('obligations').select('*').range(from, to),
  )
  const obligations = normaliseRows(obligationRows as unknown as Record<string, unknown>[], [
    'amount_total',
    'amount_settled',
  ]) as unknown as Obligation[]

  const holdingRows = await fetchAllPages((from, to) =>
    supabase.from('holdings').select('*').range(from, to),
  )
  const holdings = normaliseRows(holdingRows as unknown as Record<string, unknown>[], [
    'units',
    'avg_cost_per_unit',
  ]) as unknown as Holding[]

  const priceRows = await fetchAllPages((from, to) =>
    supabase.from('price_points').select('*').order('as_at').range(from, to),
  )
  const pricePoints = normaliseRows(priceRows as unknown as Record<string, unknown>[], [
    'price',
  ]) as unknown as PricePoint[]

  const fxRows = await fetchAllPages((from, to) =>
    supabase.from('fx_rates').select('*').order('as_at').range(from, to),
  )
  const fxRates = normaliseRows(fxRows as unknown as Record<string, unknown>[], [
    'rate',
  ]) as unknown as FxRate[]

  return { accounts: accounts as never[], snapshots, obligations, holdings, pricePoints, fxRates }
}

/** Engine built from the currently cached queries, for rendering. */
export function useNetWorthEngine(): { engine: NetWorthEngine; isLoading: boolean } {
  const accounts = useAccounts()
  const snapshots = useBalanceSnapshots()
  const obligations = useObligations()
  const holdings = useHoldings()
  const pricePoints = usePricePoints()
  const fxRates = useFxRates()
  const baseCurrency = useBaseCurrency()

  const engine = useMemo(
    () =>
      new NetWorthEngine({
        baseCurrency,
        accounts: accounts.data ?? [],
        balanceSnapshots: snapshots.data ?? [],
        obligations: obligations.data ?? [],
        holdings: holdings.data ?? [],
        pricePoints: pricePoints.data ?? [],
        fx: new FxTable(fxRates.data ?? []),
      }),
    [
      accounts.data,
      snapshots.data,
      obligations.data,
      holdings.data,
      pricePoints.data,
      fxRates.data,
      baseCurrency,
    ],
  )

  return { engine, isLoading: accounts.isLoading || snapshots.isLoading }
}

/**
 * Recompute and persist the materialised trend.
 *
 * Fetches its own inputs rather than reading the query cache: it runs straight
 * after a mutation, and a cache that has not yet refetched would silently
 * materialise the pre-mutation numbers.
 */
export function useRecomputeNetWorth() {
  const queryClient = useQueryClient()
  const userId = useUserId()
  const baseCurrency = useBaseCurrency()

  return useMutation({
    mutationFn: async (): Promise<number> => {
      const supabase = requireSupabase()
      const { accounts, snapshots, obligations, holdings, pricePoints, fxRates } =
        await fetchEngineInputs(supabase)

      const engine = new NetWorthEngine({
        baseCurrency,
        accounts,
        balanceSnapshots: snapshots,
        obligations,
        holdings,
        pricePoints,
        fx: new FxTable(fxRates),
      })

      const today = todayISO()
      const dates = [...new Set([...engine.significantDates(), today])].sort()

      if (dates.length === 0) {
        // Nothing to chart. Clear any leftovers so the table matches reality.
        const { error } = await supabase.from('net_worth_snapshots').delete().eq('user_id', userId)
        if (error) throw error
        return 0
      }

      const rows = dates.map((asAt) => {
        const result = engine.computeAt(asAt)
        return {
          user_id: userId,
          as_at: asAt,
          total_assets_base: toDb(result.totalAssetsBase),
          total_liabilities_base: toDb(result.totalLiabilitiesBase),
          net_worth_base: toDb(result.netWorthBase),
          base_currency: baseCurrency,
          computed_at: new Date().toISOString(),
        }
      })

      const { error: upsertError } = await supabase
        .from('net_worth_snapshots')
        .upsert(rows, { onConflict: 'user_id,as_at' })
      if (upsertError) throw upsertError

      // Drop dates that are no longer significant — e.g. the user deleted the
      // balance snapshot that created them. Without this the chart keeps
      // showing points that no longer correspond to any recorded balance.
      const { data: existing, error: readError } = await supabase
        .from('net_worth_snapshots')
        .select('as_at')
        .eq('user_id', userId)
      if (readError) throw readError

      const keep = new Set(dates)
      const orphans = (existing ?? [])
        .map((row) => (row as { as_at: ISODate }).as_at)
        .filter((asAt) => !keep.has(asAt))

      if (orphans.length > 0) {
        const { error: deleteError } = await supabase
          .from('net_worth_snapshots')
          .delete()
          .eq('user_id', userId)
          .in('as_at', orphans)
        if (deleteError) throw deleteError
      }

      return rows.length
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.netWorthSnapshots }),
  })
}
