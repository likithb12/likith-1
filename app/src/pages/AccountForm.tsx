import { useEffect, useState, type FormEvent } from 'react'
import { Button, Checkbox, Field, Input, Select } from '../ui/primitives'
import { Modal } from '../ui/Modal'
import { COMMON_CURRENCIES } from '../lib/fx'
import {
  ACCOUNT_TYPE_LABELS,
  DEFAULT_CLASS_FOR_TYPE,
  type Account,
  type AccountClass,
  type AccountType,
} from '../types'
import type { AccountInput } from '../data/accounts'

const ACCOUNT_TYPES = Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]

export function AccountForm({
  open,
  onClose,
  onSubmit,
  account,
  defaultCurrency,
  busy,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (input: AccountInput) => void
  account?: Account | null
  defaultCurrency: string
  busy?: boolean
}) {
  const [name, setName] = useState('')
  const [institution, setInstitution] = useState('')
  const [type, setType] = useState<AccountType>('savings')
  const [accountClass, setAccountClass] = useState<AccountClass>('asset')
  const [currency, setCurrency] = useState(defaultCurrency)
  const [isActive, setIsActive] = useState(true)
  const [includeInNetWorth, setIncludeInNetWorth] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(account?.name ?? '')
    setInstitution(account?.institution ?? '')
    setType(account?.type ?? 'savings')
    setAccountClass(account?.class ?? 'asset')
    setCurrency(account?.currency ?? defaultCurrency)
    setIsActive(account?.is_active ?? true)
    setIncludeInNetWorth(account?.include_in_net_worth ?? true)
    setError(null)
  }, [open, account, defaultCurrency])

  function onTypeChange(next: AccountType) {
    setType(next)
    // Only prefill the class for a new account. Overriding it on an edit would
    // silently flip an existing loan to an asset.
    if (!account) setAccountClass(DEFAULT_CLASS_FOR_TYPE[next])
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      setError('Give the account a name.')
      return
    }
    onSubmit({
      name: name.trim(),
      institution: institution.trim() || null,
      class: accountClass,
      type,
      currency,
      is_active: isActive,
      include_in_net_worth: includeInNetWorth,
    })
  }

  const currencies = [...new Set([defaultCurrency, ...COMMON_CURRENCIES])]

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={account ? 'Edit account' : 'New account'}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {account ? 'Save changes' : 'Add account'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Name" required error={error}>
          {(props) => (
            <Input
              {...props}
              value={name}
              autoFocus
              placeholder="ING Savings Maximiser"
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>

        <Field label="Institution">
          {(props) => (
            <Input
              {...props}
              value={institution}
              placeholder="ING"
              onChange={(event) => setInstitution(event.target.value)}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">
            {(props) => (
              <Select
                {...props}
                value={type}
                onChange={(event) => onTypeChange(event.target.value as AccountType)}
              >
                {ACCOUNT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {ACCOUNT_TYPE_LABELS[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Class"
            hint={accountClass === 'liability' ? 'Balances are entered as the amount owed.' : undefined}
          >
            {(props) => (
              <Select
                {...props}
                value={accountClass}
                onChange={(event) => setAccountClass(event.target.value as AccountClass)}
              >
                <option value="asset">Asset</option>
                <option value="liability">Liability</option>
              </Select>
            )}
          </Field>
        </div>

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

        <div className="space-y-3 border-t border-line pt-4">
          <Checkbox
            label="Active"
            description="Inactive accounts are hidden from the update balances screen."
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
          />
          <Checkbox
            label="Include in net worth"
            description="Turn off to track an account without it affecting the total."
            checked={includeInNetWorth}
            onChange={(event) => setIncludeInNetWorth(event.target.checked)}
          />
        </div>

        {/* Lets Enter submit the form without a visible duplicate button. */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  )
}
