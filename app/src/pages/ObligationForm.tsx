import { useEffect, useState } from 'react'
import { AmountInput, Button, Field, Input, Select, Textarea } from '../ui/primitives'
import { Modal } from '../ui/Modal'
import { COMMON_CURRENCIES } from '../lib/fx'
import { parseMoneyInput } from '../lib/money'
import { RECURRENCE_LABELS, type Obligation, type ObligationDirection } from '../types'
import type { Recurrence } from '../lib/dates'
import type { ObligationInput } from '../data/obligations'
import type { Account } from '../types'

export function ObligationForm({
  open,
  onClose,
  onSubmit,
  obligation,
  accounts,
  defaultCurrency,
  defaultDirection = 'payable',
  busy,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (input: ObligationInput) => void
  obligation?: Obligation | null
  accounts: Account[]
  defaultCurrency: string
  defaultDirection?: ObligationDirection
  busy?: boolean
}) {
  const [direction, setDirection] = useState<ObligationDirection>(defaultDirection)
  const [counterparty, setCounterparty] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(defaultCurrency)
  const [dueDate, setDueDate] = useState('')
  const [linkedAccountId, setLinkedAccountId] = useState('')
  const [recurrence, setRecurrence] = useState<Recurrence>('none')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<{ counterparty?: string; amount?: string }>({})

  useEffect(() => {
    if (!open) return
    setDirection(obligation?.direction ?? defaultDirection)
    setCounterparty(obligation?.counterparty ?? '')
    setDescription(obligation?.description ?? '')
    setAmount(obligation ? String(obligation.amount_total) : '')
    setCurrency(obligation?.currency ?? defaultCurrency)
    setDueDate(obligation?.due_date ?? '')
    setLinkedAccountId(obligation?.linked_account_id ?? '')
    setRecurrence(obligation?.recurrence ?? 'none')
    setNotes(obligation?.notes ?? '')
    setErrors({})
  }, [open, obligation, defaultCurrency, defaultDirection])

  const linkedAccount = accounts.find((account) => account.id === linkedAccountId)
  const willBeDisplayOnly = Boolean(linkedAccount?.include_in_net_worth)

  function submit() {
    const parsed = parseMoneyInput(amount)
    const nextErrors: typeof errors = {}
    if (!counterparty.trim()) nextErrors.counterparty = 'Who is this with?'
    if (!parsed || parsed.lte(0)) nextErrors.amount = 'Enter an amount greater than zero.'

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    onSubmit({
      direction,
      counterparty: counterparty.trim(),
      description: description.trim() || null,
      amount_total: parsed!,
      currency,
      due_date: dueDate || null,
      linked_account_id: linkedAccountId || null,
      recurrence,
      notes: notes.trim() || null,
    })
  }

  const currencies = [...new Set([defaultCurrency, ...COMMON_CURRENCIES])]

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={obligation ? 'Edit obligation' : 'New obligation'}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            {obligation ? 'Save changes' : 'Add'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Direction">
          {(props) => (
            <Select
              {...props}
              value={direction}
              onChange={(event) => setDirection(event.target.value as ObligationDirection)}
            >
              <option value="payable">I owe this</option>
              <option value="receivable">I am owed this</option>
            </Select>
          )}
        </Field>

        <Field label="Counterparty" required error={errors.counterparty}>
          {(props) => (
            <Input
              {...props}
              value={counterparty}
              autoFocus
              placeholder={direction === 'payable' ? 'ATO' : 'Dad'}
              onChange={(event) => setCounterparty(event.target.value)}
            />
          )}
        </Field>

        <Field label="What is it for">
          {(props) => (
            <Input
              {...props}
              value={description}
              placeholder="2025-26 tax assessment"
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Total amount" required error={errors.amount}>
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
                {currencies.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Due date">
            {(props) => (
              <Input {...props} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            )}
          </Field>

          <Field label="Repeats">
            {(props) => (
              <Select
                {...props}
                value={recurrence}
                onChange={(event) => setRecurrence(event.target.value as Recurrence)}
              >
                {Object.entries(RECURRENCE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <Field
          label="Linked account"
          hint={
            willBeDisplayOnly
              ? 'This obligation will be display-only: the linked account already carries this debt, and counting both would double it.'
              : 'Link a loan or credit card if this obligation is the same debt that account tracks.'
          }
        >
          {(props) => (
            <Select
              {...props}
              value={linkedAccountId}
              onChange={(event) => setLinkedAccountId(event.target.value)}
            >
              <option value="">Not linked</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Notes">
          {(props) => (
            <Textarea {...props} value={notes} onChange={(event) => setNotes(event.target.value)} />
          )}
        </Field>
      </div>
    </Modal>
  )
}
