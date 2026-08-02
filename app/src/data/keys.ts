/**
 * Query keys, in one place so invalidation after a mutation is a single call
 * rather than a hunt through components.
 */
export const queryKeys = {
  profile: ['profile'] as const,
  accounts: ['accounts'] as const,
  balanceSnapshots: (accountId?: string) =>
    accountId ? (['balance_snapshots', accountId] as const) : (['balance_snapshots'] as const),
  netWorthSnapshots: ['net_worth_snapshots'] as const,
  holdings: ['holdings'] as const,
  pricePoints: ['price_points'] as const,
  fxRates: ['fx_rates'] as const,
  categories: ['categories'] as const,
  transactions: (filters?: unknown) =>
    filters ? (['transactions', filters] as const) : (['transactions'] as const),
  budgets: ['budgets'] as const,
  categorisationRules: ['categorisation_rules'] as const,
  csvProfiles: ['csv_import_profiles'] as const,
  importBatches: ['import_batches'] as const,
  obligations: ['obligations'] as const,
  obligationPayments: (obligationId?: string) =>
    obligationId
      ? (['obligation_payments', obligationId] as const)
      : (['obligation_payments'] as const),
  incomeSources: ['income_sources'] as const,
  incomeEvents: ['income_events'] as const,
}

/** Everything that feeds the net worth calculation. */
export const netWorthInputKeys = [
  queryKeys.accounts,
  queryKeys.balanceSnapshots(),
  queryKeys.holdings,
  queryKeys.pricePoints,
  queryKeys.fxRates,
  queryKeys.obligations,
]
