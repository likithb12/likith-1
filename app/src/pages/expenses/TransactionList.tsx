import { useMemo, useState } from 'react'
import { Badge, Button, Card, CardHeader, Checkbox, Field, Input, Select, cx } from '../../ui/primitives'
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/feedback'
import { Icon } from '../../ui/Icon'
import { useToast } from '../../ui/toast'
import { CategorySelect, categoryLabel } from './CategorySelect'
import { TransactionForm } from './TransactionForm'
import { useCategories } from '../../data/categories'
import { useAccounts } from '../../data/accounts'
import {
  useBulkCategorise,
  useBulkSetTransfer,
  useDeleteTransactions,
  useTransactions,
  useUpdateTransaction,
  type TransactionFilters,
} from '../../data/transactions'
import { formatMoney } from '../../lib/money'
import { addMonths, formatDate, monthStart, todayISO } from '../../lib/dates'
import { describeError } from '../../lib/supabase'
import type { Transaction } from '../../types'

export function TransactionList() {
  const today = todayISO()
  const [filters, setFilters] = useState<TransactionFilters>({
    from: monthStart(addMonths(today, -2)),
    to: today,
    includeTransfers: true,
  })
  const [searchDraft, setSearchDraft] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [formOpen, setFormOpen] = useState(false)
  const [bulkCategory, setBulkCategory] = useState<string | null>(null)

  const transactions = useTransactions(filters)
  const categories = useCategories()
  const accounts = useAccounts()
  const updateTransaction = useUpdateTransaction()
  const bulkCategorise = useBulkCategorise()
  const bulkSetTransfer = useBulkSetTransfer()
  const deleteTransactions = useDeleteTransactions()
  const { notify } = useToast()

  const rows = transactions.data ?? []
  const allCategories = categories.data ?? []

  const totals = useMemo(() => {
    let spend = 0
    let income = 0
    for (const row of rows) {
      if (row.is_transfer) continue
      if (row.direction === 'debit') spend += Number(row.amount)
      else income += Number(row.amount)
    }
    return { spend, income }
  }, [rows])

  const allSelected = rows.length > 0 && selected.size === rows.length

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function runBulk(action: () => Promise<unknown>, message: string) {
    try {
      await action()
      setSelected(new Set())
      notify(message, { tone: 'success' })
    } catch (error) {
      notify(describeError(error), { tone: 'error' })
    }
  }

  if (transactions.isError) {
    return <ErrorState error={transactions.error} onRetry={() => void transactions.refetch()} />
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Filters"
          action={
            <Button variant="primary" size="sm" onClick={() => setFormOpen(true)}>
              <Icon name="plus" />
              Add transaction
            </Button>
          }
        />
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="From">
            {(props) => (
              <Input
                {...props}
                type="date"
                value={filters.from ?? ''}
                onChange={(event) => setFilters((f) => ({ ...f, from: event.target.value || null }))}
              />
            )}
          </Field>
          <Field label="To">
            {(props) => (
              <Input
                {...props}
                type="date"
                value={filters.to ?? ''}
                onChange={(event) => setFilters((f) => ({ ...f, to: event.target.value || null }))}
              />
            )}
          </Field>
          <Field label="Account">
            {(props) => (
              <Select
                {...props}
                value={filters.accountId ?? ''}
                onChange={(event) => setFilters((f) => ({ ...f, accountId: event.target.value || null }))}
              >
                <option value="">All accounts</option>
                {(accounts.data ?? []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Category">
            {(props) => (
              <CategorySelect
                {...props}
                categories={allCategories}
                value={filters.categoryId ?? null}
                includeBlank="All categories"
                onChange={(categoryId) => setFilters((f) => ({ ...f, categoryId }))}
              />
            )}
          </Field>
          <Field label="Search">
            {(props) => (
              <div className="flex gap-2">
                <Input
                  {...props}
                  type="search"
                  placeholder="Description contains…"
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setFilters((f) => ({ ...f, search: searchDraft }))
                  }}
                />
                <Button size="sm" onClick={() => setFilters((f) => ({ ...f, search: searchDraft }))}>
                  <Icon name="search" />
                  <span className="sr-only">Search</span>
                </Button>
              </div>
            )}
          </Field>
          <div className="flex flex-col justify-end gap-2 pb-1">
            <Checkbox
              label="Uncategorised only"
              checked={filters.uncategorisedOnly ?? false}
              onChange={(event) => setFilters((f) => ({ ...f, uncategorisedOnly: event.target.checked }))}
            />
            <Checkbox
              label="Include transfers"
              checked={filters.includeTransfers !== false}
              onChange={(event) => setFilters((f) => ({ ...f, includeTransfers: event.target.checked }))}
            />
          </div>
        </div>
      </Card>

      {selected.size > 0 && (
        <Card className="border-brand/40 bg-brand/5">
          <div className="flex flex-wrap items-center gap-3 p-3">
            <span className="text-sm font-medium text-content">{selected.size} selected</span>

            <div className="flex items-center gap-2">
              <CategorySelect
                categories={allCategories}
                value={bulkCategory}
                includeBlank="Choose category…"
                aria-label="Category to apply to selected transactions"
                className="w-48"
                onChange={setBulkCategory}
              />
              <Button
                size="sm"
                variant="primary"
                disabled={!bulkCategory}
                loading={bulkCategorise.isPending}
                onClick={() =>
                  void runBulk(
                    () => bulkCategorise.mutateAsync({ ids: [...selected], categoryId: bulkCategory }),
                    `Categorised ${selected.size} transactions.`,
                  )
                }
              >
                Apply
              </Button>
            </div>

            <Button
              size="sm"
              loading={bulkSetTransfer.isPending}
              onClick={() =>
                void runBulk(
                  () => bulkSetTransfer.mutateAsync({ ids: [...selected], isTransfer: true }),
                  `Marked ${selected.size} as transfers — they no longer count as spending.`,
                )
              }
            >
              Mark as transfer
            </Button>

            <Button
              size="sm"
              variant="danger"
              loading={deleteTransactions.isPending}
              onClick={() =>
                void runBulk(
                  () => deleteTransactions.mutateAsync([...selected]),
                  `Deleted ${selected.size} transactions.`,
                )
              }
            >
              Delete
            </Button>

            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title={`${rows.length} transaction${rows.length === 1 ? '' : 's'}`}
          subtitle={
            rows.length > 0
              ? `${formatMoney(totals.spend)} out · ${formatMoney(totals.income)} in (transfers excluded)`
              : undefined
          }
        />

        {transactions.isLoading ? (
          <SkeletonRows rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No transactions match"
            description="Widen the date range, or import a bank statement from the Import tab."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Transactions</caption>
              <thead>
                <tr className="border-b border-line text-left text-xs text-content-faint">
                  <th scope="col" className="w-8 py-2 pl-4">
                    <input
                      type="checkbox"
                      aria-label="Select all transactions"
                      className="size-4 rounded border-line-strong bg-surface accent-brand-strong"
                      checked={allSelected}
                      onChange={(event) =>
                        setSelected(event.target.checked ? new Set(rows.map((row) => row.id)) : new Set())
                      }
                    />
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Date
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Description
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Category
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <TransactionRow
                    key={row.id}
                    transaction={row}
                    categories={allCategories}
                    selected={selected.has(row.id)}
                    onToggle={() => toggle(row.id)}
                    onCategorise={async (categoryId) => {
                      try {
                        await updateTransaction.mutateAsync({ id: row.id, patch: { category_id: categoryId } })
                      } catch (error) {
                        notify(describeError(error), { tone: 'error' })
                      }
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <TransactionForm open={formOpen} onClose={() => setFormOpen(false)} />
    </div>
  )
}

function TransactionRow({
  transaction,
  categories,
  selected,
  onToggle,
  onCategorise,
}: {
  transaction: Transaction
  categories: Parameters<typeof categoryLabel>[0]
  selected: boolean
  onToggle: () => void
  onCategorise: (categoryId: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const isDebit = transaction.direction === 'debit'

  return (
    <tr className={cx(selected && 'bg-brand/5')}>
      <td className="py-2 pl-4 align-top">
        <input
          type="checkbox"
          aria-label={`Select transaction ${transaction.description ?? ''} on ${formatDate(transaction.txn_date)}`}
          className="size-4 rounded border-line-strong bg-surface accent-brand-strong"
          checked={selected}
          onChange={onToggle}
        />
      </td>
      <td className="py-2 pr-3 align-top whitespace-nowrap text-content-muted">
        {formatDate(transaction.txn_date)}
      </td>
      <td className="py-2 pr-3 align-top">
        <p className="text-content">{transaction.description || transaction.description_raw || '—'}</p>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {transaction.is_transfer && (
            <Badge tone="brand" title="Excluded from spending totals">
              Transfer
            </Badge>
          )}
          {transaction.source === 'csv' && <Badge tone="neutral">Imported</Badge>}
        </div>
      </td>
      <td className="py-2 pr-3 align-top">
        {editing ? (
          <CategorySelect
            categories={categories}
            value={transaction.category_id}
            aria-label="Category"
            className="w-44"
            onChange={(categoryId) => {
              onCategorise(categoryId)
              setEditing(false)
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={cx(
              'rounded px-1.5 py-0.5 text-left text-xs transition-colors hover:bg-surface-hover',
              transaction.category_id ? 'text-content-muted' : 'text-caution',
            )}
          >
            {categoryLabel(categories, transaction.category_id)}
          </button>
        )}
      </td>
      <td
        className={cx(
          'tabular py-2 pr-4 text-right align-top font-medium whitespace-nowrap',
          transaction.is_transfer ? 'text-content-faint' : isDebit ? 'text-content' : 'text-positive',
        )}
      >
        {isDebit ? '−' : '+'}
        {formatMoney(transaction.amount, transaction.currency)}
      </td>
    </tr>
  )
}
