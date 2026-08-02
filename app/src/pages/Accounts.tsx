import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, CardHeader, PageHeader, cx } from '../ui/primitives'
import { EmptyState, ErrorState, SkeletonRows } from '../ui/feedback'
import { ConfirmDialog } from '../ui/Modal'
import { Icon } from '../ui/Icon'
import { Sparkline } from '../ui/Sparkline'
import { FreshnessBadge } from '../ui/Freshness'
import { HoldingsPanel } from './HoldingsPanel'
import { useToast } from '../ui/toast'
import { AccountForm } from './AccountForm'
import {
  useAccounts,
  useCloseAccount,
  useCreateAccount,
  useDeleteAccount,
  useUpdateAccount,
  type AccountInput,
} from '../data/accounts'
import { useBalanceSnapshots, useDeleteSnapshot } from '../data/balances'
import { useNetWorthEngine, useRecomputeNetWorth } from '../data/netWorth'
import { useBaseCurrency } from '../data/profile'
import { formatMoney } from '../lib/money'
import { formatDate, todayISO } from '../lib/dates'
import { ACCOUNT_TYPE_LABELS, type Account, type BalanceSnapshot } from '../types'
import type { AccountValuation } from '../lib/networth'
import { describeError } from '../lib/supabase'

export function Accounts() {
  const accounts = useAccounts()
  const snapshots = useBalanceSnapshots()
  const baseCurrency = useBaseCurrency()
  const { engine } = useNetWorthEngine()
  const { notify } = useToast()

  const createAccount = useCreateAccount()
  const updateAccount = useUpdateAccount()
  const deleteAccount = useDeleteAccount()
  const closeAccount = useCloseAccount()
  const recompute = useRecomputeNetWorth()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Account | null>(null)
  const [confirmClose, setConfirmClose] = useState<Account | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const valuationById = useMemo(() => {
    const valuations = engine.valueAccounts(todayISO())
    return new Map(valuations.map((v) => [v.account.id, v]))
  }, [engine])

  const snapshotsByAccount = useMemo(() => {
    const map = new Map<string, BalanceSnapshot[]>()
    for (const snapshot of snapshots.data ?? []) {
      const list = map.get(snapshot.account_id)
      if (list) list.push(snapshot)
      else map.set(snapshot.account_id, [snapshot])
    }
    return map
  }, [snapshots.data])

  async function submitAccount(input: AccountInput) {
    try {
      if (editing) {
        await updateAccount.mutateAsync({ id: editing.id, patch: input })
        notify('Account updated.', { tone: 'success' })
      } else {
        await createAccount.mutateAsync(input)
        notify('Account added. Record a balance for it next.', { tone: 'success' })
      }
      setFormOpen(false)
      setEditing(null)
      await recompute.mutateAsync()
    } catch (error) {
      notify(describeError(error), { tone: 'error' })
    }
  }

  if (accounts.isError) {
    return (
      <div className="space-y-5">
        <PageHeader title="Accounts" />
        <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
      </div>
    )
  }

  const all = accounts.data ?? []
  const assets = all.filter((account) => account.class === 'asset')
  const liabilities = all.filter((account) => account.class === 'liability')

  const openForm = (account: Account | null) => {
    setEditing(account)
    setFormOpen(true)
  }

  const groupProps = {
    valuationById,
    snapshotsByAccount,
    baseCurrency,
    expanded,
    setExpanded,
    onEdit: openForm,
    onDelete: setConfirmDelete,
    onCloseAccount: setConfirmClose,
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Accounts"
        subtitle="Everything that counts toward net worth, and anything you want to watch alongside it."
        actions={
          <>
            <Link
              to="/balances"
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-3.5 py-2 text-sm font-medium text-content transition-colors hover:bg-surface-hover"
            >
              Update balances
            </Link>
            <Button variant="primary" size="md" onClick={() => openForm(null)}>
              <Icon name="plus" />
              New account
            </Button>
          </>
        }
      />

      {accounts.isLoading ? (
        <Card>
          <SkeletonRows rows={4} />
        </Card>
      ) : all.length === 0 ? (
        <Card>
          <EmptyState
            title="No accounts yet"
            description="Add your bank accounts, super, loans and cards. Then record a balance for each — the trend chart is built from those balances over time, so the history starts the day you start recording."
            action={
              <Button variant="primary" onClick={() => openForm(null)}>
                <Icon name="plus" />
                Add your first account
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <AccountGroup title="Assets" accounts={assets} {...groupProps} />
          <AccountGroup title="Liabilities" accounts={liabilities} {...groupProps} />
        </>
      )}

      <AccountForm
        open={formOpen}
        account={editing}
        defaultCurrency={baseCurrency}
        busy={createAccount.isPending || updateAccount.isPending}
        onClose={() => {
          setFormOpen(false)
          setEditing(null)
        }}
        onSubmit={(input) => void submitAccount(input)}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        busy={deleteAccount.isPending}
        title="Delete this account?"
        confirmLabel="Delete permanently"
        message={
          <>
            <p>
              <strong className="text-content">{confirmDelete?.name}</strong> and its entire balance
              history will be deleted. Your net worth trend will change shape, because the history that
              produced it is gone.
            </p>
            <p className="mt-2">
              If the account has simply been closed, close it instead — that keeps the history and stops
              it counting from today.
            </p>
          </>
        }
        onConfirm={async () => {
          if (!confirmDelete) return
          try {
            await deleteAccount.mutateAsync(confirmDelete.id)
            setConfirmDelete(null)
            notify('Account deleted.', { tone: 'success' })
            await recompute.mutateAsync()
          } catch (error) {
            notify(describeError(error), { tone: 'error' })
          }
        }}
      />

      <ConfirmDialog
        open={confirmClose !== null}
        onClose={() => setConfirmClose(null)}
        busy={closeAccount.isPending}
        destructive={false}
        title="Close this account?"
        confirmLabel="Close account"
        message={
          <>
            <p>
              <strong className="text-content">{confirmClose?.name}</strong> will be marked inactive and a
              zero balance recorded for today, so it stops counting toward net worth from now on.
            </p>
            <p className="mt-2">Its history stays intact and the past trend is unchanged.</p>
          </>
        }
        onConfirm={async () => {
          if (!confirmClose) return
          try {
            await closeAccount.mutateAsync({ account: confirmClose, asAt: todayISO() })
            setConfirmClose(null)
            notify('Account closed.', { tone: 'success' })
            await recompute.mutateAsync()
          } catch (error) {
            notify(describeError(error), { tone: 'error' })
          }
        }}
      />
    </div>
  )
}

interface GroupProps {
  title: string
  accounts: Account[]
  valuationById: Map<string, AccountValuation>
  snapshotsByAccount: Map<string, BalanceSnapshot[]>
  baseCurrency: string
  expanded: string | null
  setExpanded: (id: string | null) => void
  onEdit: (account: Account) => void
  onDelete: (account: Account) => void
  onCloseAccount: (account: Account) => void
}

function AccountGroup({
  title,
  accounts,
  valuationById,
  snapshotsByAccount,
  baseCurrency,
  expanded,
  setExpanded,
  onEdit,
  onDelete,
  onCloseAccount,
}: GroupProps) {
  if (accounts.length === 0) return null

  const total = accounts.reduce((running, account) => {
    const valuation = valuationById.get(account.id)
    if (!valuation || !account.include_in_net_worth) return running
    return running + valuation.balanceBase.toNumber()
  }, 0)

  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={`${accounts.length} account${accounts.length === 1 ? '' : 's'}`}
        action={<span className="tabular text-sm font-semibold">{formatMoney(total, baseCurrency)}</span>}
      />
      <ul className="divide-y divide-line">
        {accounts.map((account) => {
          const valuation = valuationById.get(account.id)
          const history = snapshotsByAccount.get(account.id) ?? []
          const isOpen = expanded === account.id

          return (
            <li key={account.id}>
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : account.id)}
                >
                  <Icon
                    name="chevron-right"
                    className={cx(
                      'size-4 shrink-0 text-content-faint transition-transform',
                      isOpen && 'rotate-90',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-content">{account.name}</span>
                      {!account.is_active && <Badge tone="neutral">Inactive</Badge>}
                      {!account.include_in_net_worth && (
                        <Badge tone="neutral" title="Tracked, but excluded from the net worth total">
                          Excluded
                        </Badge>
                      )}
                      {account.currency !== baseCurrency && <Badge tone="brand">{account.currency}</Badge>}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-content-faint">
                      {[account.institution, ACCOUNT_TYPE_LABELS[account.type]].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>

                <div className="hidden text-content-faint sm:block">
                  <Sparkline
                    values={history.map((snapshot) => snapshot.balance)}
                    label={`${account.name} balance trend`}
                  />
                </div>

                <div className="shrink-0 text-right">
                  <p className="tabular text-sm font-semibold text-content">
                    {valuation?.hasData ? formatMoney(valuation.balanceNative, account.currency) : '—'}
                  </p>
                  <div className="mt-0.5 flex justify-end">
                    <FreshnessBadge
                      asAt={valuation?.asAtUsed ?? null}
                      ageDays={valuation?.ageDays ?? null}
                      hasData={valuation?.hasData ?? false}
                    />
                  </div>
                </div>
              </div>

              {isOpen && (
                <AccountDetail
                  account={account}
                  valuation={valuation}
                  history={history}
                  onEdit={() => onEdit(account)}
                  onDelete={() => onDelete(account)}
                  onCloseAccount={() => onCloseAccount(account)}
                />
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function AccountDetail({
  account,
  valuation,
  history,
  onEdit,
  onDelete,
  onCloseAccount,
}: {
  account: Account
  valuation?: AccountValuation
  history: BalanceSnapshot[]
  onEdit: () => void
  onDelete: () => void
  onCloseAccount: () => void
}) {
  const deleteSnapshot = useDeleteSnapshot()
  const recompute = useRecomputeNetWorth()
  const { notify } = useToast()

  const ordered = [...history].sort((a, b) => (a.as_at < b.as_at ? 1 : -1))

  return (
    <div className="border-t border-line bg-surface/40 px-4 py-3">
      <div className="mb-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={onEdit}>
          Edit
        </Button>
        {account.is_active && (
          <Button size="sm" onClick={onCloseAccount}>
            Close account
          </Button>
        )}
        <Button size="sm" variant="danger" onClick={onDelete}>
          <Icon name="trash" className="size-3.5" />
          Delete
        </Button>
      </div>

      {account.type === 'brokerage' && (
        <div className="mb-4 border-b border-line pb-4">
          <HoldingsPanel account={account} valuation={valuation} />
        </div>
      )}

      {ordered.length === 0 ? (
        <p className="py-2 text-xs text-content-faint">
          No balances recorded yet. Use “Update balances” to add one.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Balance history for {account.name}</caption>
            <thead>
              <tr className="text-left text-xs text-content-faint">
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  Date
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                  Balance
                </th>
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  Source
                </th>
                <th scope="col" className="py-1.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {ordered.slice(0, 24).map((snapshot) => (
                <tr key={snapshot.id}>
                  <td className="py-1.5 pr-3 text-content-muted">{formatDate(snapshot.as_at)}</td>
                  <td className="tabular py-1.5 pr-3 text-right text-content">
                    {formatMoney(snapshot.balance, snapshot.currency)}
                  </td>
                  <td className="py-1.5 pr-3 text-xs text-content-faint">{snapshot.source}</td>
                  <td className="py-1.5 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete balance recorded for ${formatDate(snapshot.as_at)}`}
                      onClick={async () => {
                        try {
                          await deleteSnapshot.mutateAsync(snapshot.id)
                          await recompute.mutateAsync()
                          notify('Balance deleted.', { tone: 'success' })
                        } catch (error) {
                          notify(describeError(error), { tone: 'error' })
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
          {ordered.length > 24 && (
            <p className="pt-2 text-xs text-content-faint">
              Showing the 24 most recent of {ordered.length} balances.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
