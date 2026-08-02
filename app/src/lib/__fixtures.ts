import type { Account, BalanceSnapshot, Holding, Obligation, PricePoint } from '../types'

/** Test factories. Keep these minimal — they exist to make tests readable. */

const USER = 'user-1'

export function account(overrides: Partial<Account> & { id: string }): Account {
  return {
    user_id: USER,
    name: overrides.id,
    institution: null,
    class: 'asset',
    type: 'cash',
    currency: 'AUD',
    is_active: true,
    include_in_net_worth: true,
    display_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

export function snapshot(
  overrides: Partial<BalanceSnapshot> & { account_id: string; as_at: string; balance: string },
): BalanceSnapshot {
  return {
    id: `snap-${overrides.account_id}-${overrides.as_at}`,
    user_id: USER,
    currency: 'AUD',
    source: 'manual',
    note: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

export function holding(
  overrides: Partial<Holding> & { id: string; account_id: string; ticker: string; units: string },
): Holding {
  return {
    user_id: USER,
    exchange: 'ASX',
    avg_cost_per_unit: null,
    currency: 'AUD',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

export function price(
  overrides: Partial<PricePoint> & { ticker: string; as_at: string; price: string },
): PricePoint {
  return {
    id: `price-${overrides.ticker}-${overrides.as_at}`,
    user_id: USER,
    exchange: 'ASX',
    currency: 'AUD',
    source: 'manual',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

export function obligation(
  overrides: Partial<Obligation> & { id: string; amount_total: string },
): Obligation {
  return {
    user_id: USER,
    direction: 'payable',
    counterparty: 'Someone',
    description: null,
    currency: 'AUD',
    amount_settled: '0.00',
    due_date: null,
    status: 'open',
    linked_account_id: null,
    recurrence: 'none',
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}
