import type { ISODate, Frequency, Recurrence } from './lib/dates'

/**
 * Domain types as the data layer produces them.
 *
 * Every monetary/quantity field is a `string` here, not a number: it is parsed
 * into Decimal at the point of arithmetic and written back as a fixed-scale
 * string. See lib/money.ts.
 */

export type UUID = string
export type MoneyString = string

export type AccountClass = 'asset' | 'liability'
export type AccountType =
  | 'cash'
  | 'savings'
  | 'offset'
  | 'super'
  | 'brokerage'
  | 'loan'
  | 'credit_card'
  | 'other'

export type SnapshotSource = 'manual' | 'derived_holdings' | 'csv'
export type PriceSource = 'api' | 'manual'
export type TxnDirection = 'debit' | 'credit'
export type TxnSource = 'manual' | 'csv'
export type CategoryKind = 'expense' | 'income'
export type ObligationDirection = 'payable' | 'receivable'
export type ObligationStatus = 'open' | 'partial' | 'settled' | 'written_off'
export type MatchType = 'contains' | 'starts_with' | 'regex'
export type AmountConvention = 'single_signed' | 'separate_debit_credit'

export interface Profile {
  user_id: UUID
  display_name: string | null
  base_currency: string
  secondary_currency: string | null
  created_at: string
}

export interface Account {
  id: UUID
  user_id: UUID
  name: string
  institution: string | null
  class: AccountClass
  type: AccountType
  currency: string
  is_active: boolean
  include_in_net_worth: boolean
  display_order: number
  created_at: string
}

export interface BalanceSnapshot {
  id: UUID
  user_id: UUID
  account_id: UUID
  as_at: ISODate
  balance: MoneyString
  currency: string
  source: SnapshotSource
  note: string | null
  created_at: string
}

export interface NetWorthSnapshot {
  id: UUID
  user_id: UUID
  as_at: ISODate
  total_assets_base: MoneyString
  total_liabilities_base: MoneyString
  net_worth_base: MoneyString
  base_currency: string
  computed_at: string
}

export interface Holding {
  id: UUID
  user_id: UUID
  account_id: UUID
  ticker: string
  exchange: string | null
  units: MoneyString
  avg_cost_per_unit: MoneyString | null
  currency: string
  created_at: string
}

export interface PricePoint {
  id: UUID
  user_id: UUID
  ticker: string
  exchange: string | null
  as_at: ISODate
  price: MoneyString
  currency: string
  source: PriceSource
  created_at: string
}

export interface FxRate {
  id: UUID
  user_id: UUID
  base_currency: string
  quote_currency: string
  as_at: ISODate
  rate: MoneyString
  source: string
  created_at: string
}

export interface Category {
  id: UUID
  user_id: UUID
  name: string
  parent_id: UUID | null
  kind: CategoryKind
  colour: string | null
  created_at: string
}

export interface Transaction {
  id: UUID
  user_id: UUID
  account_id: UUID | null
  txn_date: ISODate
  amount: MoneyString
  direction: TxnDirection
  currency: string
  description_raw: string | null
  description: string | null
  category_id: UUID | null
  is_transfer: boolean
  transfer_pair_id: UUID | null
  source: TxnSource
  import_batch_id: UUID | null
  dedupe_hash: string
  created_at: string
}

export interface Budget {
  id: UUID
  user_id: UUID
  category_id: UUID
  period_month: ISODate
  amount: MoneyString
  currency: string
  created_at: string
}

export interface Obligation {
  id: UUID
  user_id: UUID
  direction: ObligationDirection
  counterparty: string
  description: string | null
  amount_total: MoneyString
  currency: string
  amount_settled: MoneyString
  due_date: ISODate | null
  status: ObligationStatus
  linked_account_id: UUID | null
  recurrence: Recurrence
  notes: string | null
  created_at: string
}

export interface ObligationPayment {
  id: UUID
  user_id: UUID
  obligation_id: UUID
  paid_on: ISODate
  amount: MoneyString
  currency: string
  transaction_id: UUID | null
  created_at: string
}

export interface IncomeSource {
  id: UUID
  user_id: UUID
  name: string
  employer: string | null
  gross_amount: MoneyString | null
  currency: string
  frequency: Frequency
  next_expected_date: ISODate | null
  is_active: boolean
  created_at: string
}

export interface IncomeEvent {
  id: UUID
  user_id: UUID
  income_source_id: UUID | null
  received_on: ISODate
  gross_amount: MoneyString | null
  net_amount: MoneyString
  currency: string
  account_id: UUID | null
  transaction_id: UUID | null
  created_at: string
}

export interface CsvImportProfile {
  id: UUID
  user_id: UUID
  name: string
  date_column: string
  date_format: string
  amount_column: string | null
  amount_convention: AmountConvention
  debit_column: string | null
  credit_column: string | null
  description_columns: string[]
  skip_rows: number
  delimiter: string
  encoding: string
  default_account_id: UUID | null
  created_at: string
}

export interface ImportBatch {
  id: UUID
  user_id: UUID
  account_id: UUID | null
  profile_id: UUID | null
  filename: string
  imported_at: string
  rows_total: number
  rows_imported: number
  rows_skipped_duplicate: number
  rows_failed: number
}

export interface CategorisationRule {
  id: UUID
  user_id: UUID
  match_type: MatchType
  pattern: string
  category_id: UUID
  priority: number
  created_at: string
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: 'Cash',
  savings: 'Savings',
  offset: 'Offset',
  super: 'Superannuation',
  brokerage: 'Brokerage',
  loan: 'Loan',
  credit_card: 'Credit card',
  other: 'Other',
}

/** Which class an account type usually belongs to, used to prefill the form. */
export const DEFAULT_CLASS_FOR_TYPE: Record<AccountType, AccountClass> = {
  cash: 'asset',
  savings: 'asset',
  offset: 'asset',
  super: 'asset',
  brokerage: 'asset',
  loan: 'liability',
  credit_card: 'liability',
  other: 'asset',
}

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  none: 'One-off',
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
}

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
  irregular: 'Irregular',
}

export const OBLIGATION_STATUS_LABELS: Record<ObligationStatus, string> = {
  open: 'Open',
  partial: 'Partially paid',
  settled: 'Settled',
  written_off: 'Written off',
}

/** Accounts not updated for this many days are flagged as stale on the dashboard. */
export const STALE_AFTER_DAYS = 30
