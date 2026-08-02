import { useEffect, useState } from 'react'
import { AmountInput, Button, Checkbox, Field, Input, Select } from '../../ui/primitives'
import { Modal } from '../../ui/Modal'
import { useToast } from '../../ui/toast'
import { CategorySelect } from './CategorySelect'
import { useAccounts } from '../../data/accounts'
import { useCategories } from '../../data/categories'
import { useCreateTransaction } from '../../data/transactions'
import { useBaseCurrency } from '../../data/profile'
import { parseMoneyInput } from '../../lib/money'
import { todayISO } from '../../lib/dates'
import { describeError } from '../../lib/supabase'
import type { TxnDirection } from '../../types'

export function TransactionForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const accounts = useAccounts()
  const categories = useCategories()
  const baseCurrency = useBaseCurrency()
  const createTransaction = useCreateTransaction()
  const { notify } = useToast()

  const [txnDate, setTxnDate] = useState(todayISO())
  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState<TxnDirection>('debit')
  const [accountId, setAccountId] = useState<string>('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [isTransfer, setIsTransfer] = useState(false)
  const [errors, setErrors] = useState<{ amount?: string; description?: string }>({})

  useEffect(() => {
    if (!open) return
    setTxnDate(todayISO())
    setAmount('')
    setDirection('debit')
    setAccountId(accounts.data?.[0]?.id ?? '')
    setCategoryId(null)
    setDescription('')
    setIsTransfer(false)
    setErrors({})
  }, [open, accounts.data])

  async function submit() {
    const parsed = parseMoneyInput(amount)
    const nextErrors: typeof errors = {}
    if (!parsed || parsed.lte(0)) nextErrors.amount = 'Enter an amount greater than zero.'
    if (!description.trim()) nextErrors.description = 'Give the transaction a description.'

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    try {
      const account = (accounts.data ?? []).find((entry) => entry.id === accountId)
      await createTransaction.mutateAsync({
        account_id: accountId || null,
        txn_date: txnDate,
        // Stored as a positive magnitude; the sign lives in `direction`.
        amount: parsed!.abs(),
        direction,
        currency: account?.currency ?? baseCurrency,
        description: description.trim(),
        category_id: categoryId,
        is_transfer: isTransfer,
      })
      notify('Transaction added.', { tone: 'success' })
      onClose()
    } catch (error) {
      notify(describeError(error), { tone: 'error' })
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add transaction"
      footer={
        <>
          <Button onClick={onClose} disabled={createTransaction.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={createTransaction.isPending} onClick={() => void submit()}>
            Add
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" required>
            {(props) => (
              <Input {...props} type="date" value={txnDate} onChange={(event) => setTxnDate(event.target.value)} />
            )}
          </Field>

          <Field label="Direction">
            {(props) => (
              <Select
                {...props}
                value={direction}
                onChange={(event) => setDirection(event.target.value as TxnDirection)}
              >
                <option value="debit">Money out</option>
                <option value="credit">Money in</option>
              </Select>
            )}
          </Field>
        </div>

        <Field label="Amount" required error={errors.amount} hint="Always positive — direction is set above.">
          {(props) => (
            <AmountInput
              {...props}
              value={amount}
              placeholder="0.00"
              autoFocus
              onChange={(event) => setAmount(event.target.value)}
            />
          )}
        </Field>

        <Field label="Description" required error={errors.description}>
          {(props) => (
            <Input
              {...props}
              value={description}
              placeholder="Woolworths"
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Account">
            {(props) => (
              <Select {...props} value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                <option value="">No account</option>
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
                categories={categories.data ?? []}
                value={categoryId}
                kind={direction === 'debit' ? 'expense' : 'income'}
                onChange={setCategoryId}
              />
            )}
          </Field>
        </div>

        <Checkbox
          label="This is a transfer between my own accounts"
          description="Transfers are excluded from spending and income totals."
          checked={isTransfer}
          onChange={(event) => setIsTransfer(event.target.checked)}
        />
      </div>
    </Modal>
  )
}
