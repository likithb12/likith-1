import { useMemo, useState } from 'react'
import { Badge, Button, Card, CardHeader, Field, Input, Select, cx } from '../../ui/primitives'
import { EmptyState } from '../../ui/feedback'
import { useToast } from '../../ui/toast'
import { useAccounts } from '../../data/accounts'
import { useUserId } from '../../auth/AuthProvider'
import {
  buildDuplicateReport,
  useCommitImport,
  useCsvProfiles,
  useSaveCsvProfile,
  useUndoImport,
  type DuplicateReport,
} from '../../data/imports'
import { useBaseCurrency } from '../../data/profile'
import { detectDelimiter, DATE_FORMATS, guessDateFormat, parseCsv, toRecord } from '../../lib/csv'
import { mapRows, suggestMapping, type MappingProfile } from '../../lib/importer'
import { formatMoney } from '../../lib/money'
import { formatDate } from '../../lib/dates'
import { describeError } from '../../lib/supabase'
import type { AmountConvention, CsvImportProfile } from '../../types'

type Step = 'upload' | 'map' | 'review' | 'done'

const EMPTY_PROFILE: MappingProfile = {
  date_column: '',
  date_format: 'DD/MM/YYYY',
  amount_column: null,
  amount_convention: 'single_signed',
  debit_column: null,
  credit_column: null,
  description_columns: [],
  skip_rows: 0,
  delimiter: ',',
}

export function ImportWizard() {
  const accounts = useAccounts()
  const profiles = useCsvProfiles()
  const saveProfile = useSaveCsvProfile()
  const commitImport = useCommitImport()
  const undoImport = useUndoImport()
  const baseCurrency = useBaseCurrency()
  const userId = useUserId()
  const { notify } = useToast()

  const [step, setStep] = useState<Step>('upload')
  const [filename, setFilename] = useState('')
  const [text, setText] = useState('')
  const [accountId, setAccountId] = useState('')
  const [profileId, setProfileId] = useState<string | null>(null)
  const [mapping, setMapping] = useState<MappingProfile>(EMPTY_PROFILE)
  const [saveAsName, setSaveAsName] = useState('')
  const [report, setReport] = useState<DuplicateReport | null>(null)
  const [building, setBuilding] = useState(false)
  const [result, setResult] = useState<{ batchId: string; imported: number; skipped: number; categorised: number } | null>(null)

  // Re-parsed on every mapping change so the preview is always the truth.
  const parsed = useMemo(() => {
    if (!text) return null
    return parseCsv(text, { delimiter: mapping.delimiter, skipRows: mapping.skip_rows })
  }, [text, mapping.delimiter, mapping.skip_rows])

  const mapped = useMemo(() => {
    if (!parsed || !mapping.date_column) return null
    return mapRows(parsed, mapping)
  }, [parsed, mapping])

  async function onFile(file: File | undefined) {
    if (!file) return
    const content = await file.text()
    const delimiter = detectDelimiter(content)
    const firstPass = parseCsv(content, { delimiter })
    const suggestion = suggestMapping(firstPass.headers)

    const dateColumn = suggestion.date_column ?? firstPass.headers[0] ?? ''
    const samples = firstPass.rows.slice(0, 20).map((row) => toRecord(firstPass.headers, row)[dateColumn] ?? '')

    setFilename(file.name)
    setText(content)
    setMapping({
      ...EMPTY_PROFILE,
      ...suggestion,
      date_column: dateColumn,
      date_format: guessDateFormat(samples.filter(Boolean)),
      delimiter,
    })
    setSaveAsName(file.name.replace(/\.[^.]+$/, ''))
    setProfileId(null)
    setReport(null)
    setResult(null)
    setStep('map')
  }

  function applyProfile(profile: CsvImportProfile) {
    setProfileId(profile.id)
    setMapping({
      date_column: profile.date_column,
      date_format: profile.date_format,
      amount_column: profile.amount_column,
      amount_convention: profile.amount_convention,
      debit_column: profile.debit_column,
      credit_column: profile.credit_column,
      description_columns: profile.description_columns,
      skip_rows: profile.skip_rows,
      delimiter: profile.delimiter,
    })
    if (profile.default_account_id) setAccountId(profile.default_account_id)
  }

  async function goToReview() {
    if (!mapped || !accountId) return
    setBuilding(true)
    try {
      const built = await buildDuplicateReport(userId, accountId, mapped.drafts)
      setReport(built)
      setStep('review')
    } catch (error) {
      notify(describeError(error), { tone: 'error' })
    } finally {
      setBuilding(false)
    }
  }

  async function commit() {
    if (!report || !mapped) return
    const account = (accounts.data ?? []).find((entry) => entry.id === accountId)
    try {
      const outcome = await commitImport.mutateAsync({
        accountId,
        profileId,
        filename,
        currency: account?.currency ?? baseCurrency,
        report,
        rowsFailed: mapped.errors.length,
      })
      setResult({
        batchId: outcome.batchId,
        imported: outcome.imported,
        skipped: outcome.skippedDuplicates,
        categorised: outcome.categorised,
      })
      setStep('done')
    } catch (error) {
      notify(describeError(error), { tone: 'error' })
    }
  }

  function reset() {
    setStep('upload')
    setText('')
    setFilename('')
    setReport(null)
    setResult(null)
    setMapping(EMPTY_PROFILE)
  }

  const steps: { id: Step; label: string }[] = [
    { id: 'upload', label: '1. File' },
    { id: 'map', label: '2. Columns' },
    { id: 'review', label: '3. Duplicates' },
    { id: 'done', label: '4. Done' },
  ]

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-2 text-xs">
        {steps.map((entry) => (
          <li
            key={entry.id}
            aria-current={step === entry.id ? 'step' : undefined}
            className={cx(
              'rounded-md border px-2 py-1',
              step === entry.id
                ? 'border-brand/40 bg-brand/10 text-brand'
                : 'border-line text-content-faint',
            )}
          >
            {entry.label}
          </li>
        ))}
      </ol>

      {step === 'upload' && (
        <Card>
          <CardHeader title="Choose a statement" subtitle="A CSV exported from your bank." />
          <div className="space-y-4 p-4">
            <input
              type="file"
              id="csv-file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              onChange={(event) => void onFile(event.target.files?.[0])}
            />
            <label
              htmlFor="csv-file"
              className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong px-6 py-10 text-center transition-colors hover:border-brand hover:bg-surface-hover"
            >
              <span className="text-2xl" aria-hidden="true">
                📄
              </span>
              <span className="text-sm font-medium text-content">Choose a CSV file</span>
              <span className="text-xs text-content-faint">
                Columns are detected automatically, and you can correct them on the next step.
              </span>
            </label>

            {(profiles.data ?? []).length > 0 && (
              <p className="text-xs text-content-faint">
                You have {profiles.data?.length} saved import profile
                {profiles.data?.length === 1 ? '' : 's'}. You can pick one after choosing a file.
              </p>
            )}
          </div>
        </Card>
      )}

      {step === 'map' && parsed && (
        <>
          <Card>
            <CardHeader title="Where does this go?" subtitle={filename} />
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <Field label="Import into account" required hint="Duplicate detection is per account.">
                {(props) => (
                  <Select {...props} value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                    <option value="">Choose an account…</option>
                    {(accounts.data ?? []).map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Start from a saved profile">
                {(props) => (
                  <Select
                    {...props}
                    value={profileId ?? ''}
                    onChange={(event) => {
                      const profile = (profiles.data ?? []).find((entry) => entry.id === event.target.value)
                      if (profile) applyProfile(profile)
                      else setProfileId(null)
                    }}
                  >
                    <option value="">Detected from the file</option>
                    {(profiles.data ?? []).map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Column mapping"
              subtitle={`${parsed.headers.length} columns, ${parsed.rows.length} data rows`}
            />
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Date column" required>
                {(props) => (
                  <Select
                    {...props}
                    value={mapping.date_column}
                    onChange={(event) => setMapping((m) => ({ ...m, date_column: event.target.value }))}
                  >
                    {parsed.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Date format" hint="Australian exports are usually day first.">
                {(props) => (
                  <Select
                    {...props}
                    value={mapping.date_format}
                    onChange={(event) => setMapping((m) => ({ ...m, date_format: event.target.value }))}
                  >
                    {DATE_FORMATS.map((format) => (
                      <option key={format} value={format}>
                        {format}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Amount style">
                {(props) => (
                  <Select
                    {...props}
                    value={mapping.amount_convention}
                    onChange={(event) =>
                      setMapping((m) => ({ ...m, amount_convention: event.target.value as AmountConvention }))
                    }
                  >
                    <option value="single_signed">One signed column</option>
                    <option value="separate_debit_credit">Separate debit and credit</option>
                  </Select>
                )}
              </Field>

              {mapping.amount_convention === 'single_signed' ? (
                <Field label="Amount column" required>
                  {(props) => (
                    <Select
                      {...props}
                      value={mapping.amount_column ?? ''}
                      onChange={(event) => setMapping((m) => ({ ...m, amount_column: event.target.value || null }))}
                    >
                      <option value="">Choose…</option>
                      {parsed.headers.map((header) => (
                        <option key={header} value={header}>
                          {header}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : (
                <>
                  <Field label="Debit column" required>
                    {(props) => (
                      <Select
                        {...props}
                        value={mapping.debit_column ?? ''}
                        onChange={(event) => setMapping((m) => ({ ...m, debit_column: event.target.value || null }))}
                      >
                        <option value="">Choose…</option>
                        {parsed.headers.map((header) => (
                          <option key={header} value={header}>
                            {header}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Credit column" required>
                    {(props) => (
                      <Select
                        {...props}
                        value={mapping.credit_column ?? ''}
                        onChange={(event) => setMapping((m) => ({ ...m, credit_column: event.target.value || null }))}
                      >
                        <option value="">Choose…</option>
                        {parsed.headers.map((header) => (
                          <option key={header} value={header}>
                            {header}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </>
              )}

              <Field label="Rows to skip before the header">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min={0}
                    value={mapping.skip_rows}
                    onChange={(event) =>
                      setMapping((m) => ({ ...m, skip_rows: Math.max(0, Number(event.target.value) || 0) }))
                    }
                  />
                )}
              </Field>

              <fieldset className="sm:col-span-2 lg:col-span-3">
                <legend className="mb-1.5 text-xs font-medium text-content-muted">Description columns</legend>
                <div className="flex flex-wrap gap-2">
                  {parsed.headers.map((header) => {
                    const checked = mapping.description_columns.includes(header)
                    return (
                      <label
                        key={header}
                        className={cx(
                          'cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors',
                          checked
                            ? 'border-brand/40 bg-brand/10 text-brand'
                            : 'border-line text-content-muted hover:bg-surface-hover',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={checked}
                          onChange={() =>
                            setMapping((m) => ({
                              ...m,
                              description_columns: checked
                                ? m.description_columns.filter((entry) => entry !== header)
                                : [...m.description_columns, header],
                            }))
                          }
                        />
                        {header}
                      </label>
                    )
                  })}
                </div>
              </fieldset>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Preview"
              subtitle="The first 10 rows, as they will be imported."
              action={
                mapped && mapped.errors.length > 0 ? (
                  <Badge tone="caution">{mapped.errors.length} rows unreadable</Badge>
                ) : undefined
              }
            />
            {!mapped ? (
              <EmptyState title="Choose a date column to see the preview" />
            ) : mapped.drafts.length === 0 ? (
              <EmptyState
                title="No rows could be read"
                description={mapped.errors[0]?.reason ?? 'Check the column mapping above.'}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Preview of parsed transactions</caption>
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-content-faint">
                      <th scope="col" className="py-2 pl-4 pr-3 font-medium">Date</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Description</th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {mapped.drafts.slice(0, 10).map((draft) => (
                      <tr key={draft.rowIndex}>
                        <td className="py-1.5 pl-4 pr-3 whitespace-nowrap text-content-muted">
                          {formatDate(draft.txn_date)}
                        </td>
                        <td className="py-1.5 pr-3 text-content">{draft.description_raw || '—'}</td>
                        <td
                          className={cx(
                            'tabular py-1.5 pr-4 text-right',
                            draft.direction === 'debit' ? 'text-content' : 'text-positive',
                          )}
                        >
                          {draft.direction === 'debit' ? '−' : '+'}
                          {formatMoney(draft.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {mapped && mapped.errors.length > 0 && (
              <details className="border-t border-line px-4 py-3">
                <summary className="cursor-pointer text-xs text-caution">
                  {mapped.errors.length} row{mapped.errors.length === 1 ? '' : 's'} could not be read — they
                  will be counted as failed, not imported
                </summary>
                <ul className="mt-2 space-y-1 text-xs text-content-faint">
                  {mapped.errors.slice(0, 8).map((error) => (
                    <li key={error.rowIndex}>
                      Row {error.rowIndex + 1}: {error.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>

          <Card>
            <div className="flex flex-wrap items-end justify-between gap-3 p-4">
              <Field label="Save this mapping as a profile" className="min-w-56 flex-1" hint="Optional.">
                {(props) => (
                  <Input
                    {...props}
                    value={saveAsName}
                    placeholder="CBA Transaction Export"
                    onChange={(event) => setSaveAsName(event.target.value)}
                  />
                )}
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!saveAsName.trim()}
                  loading={saveProfile.isPending}
                  onClick={async () => {
                    try {
                      const id = await saveProfile.mutateAsync({
                        id: profileId ?? undefined,
                        input: {
                          name: saveAsName.trim(),
                          ...mapping,
                          encoding: 'utf-8',
                          default_account_id: accountId || null,
                        },
                      })
                      setProfileId(id)
                      notify('Profile saved.', { tone: 'success' })
                    } catch (error) {
                      notify(describeError(error), { tone: 'error' })
                    }
                  }}
                >
                  Save profile
                </Button>
                <Button size="sm" onClick={reset}>
                  Start over
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={building}
                  disabled={!accountId || !mapped || mapped.drafts.length === 0}
                  onClick={() => void goToReview()}
                >
                  Check for duplicates
                </Button>
              </div>
            </div>
            {!accountId && (
              <p className="border-t border-line px-4 py-2 text-xs text-caution">
                Choose an account before continuing.
              </p>
            )}
          </Card>
        </>
      )}

      {step === 'review' && report && mapped && (
        <>
          <Card>
            <CardHeader title="Before anything is written" subtitle={filename} />
            <dl className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
              <Stat label="Rows in file" value={String(mapped.drafts.length + mapped.errors.length)} />
              <Stat label="New" value={String(report.newRows.length)} tone="positive" />
              <Stat label="Already imported" value={String(report.duplicates.length)} tone="caution" />
              <Stat label="Unreadable" value={String(mapped.errors.length)} tone={mapped.errors.length > 0 ? 'negative' : 'neutral'} />
            </dl>

            {report.duplicates.length > 0 && (
              <details className="border-t border-line px-4 py-3">
                <summary className="cursor-pointer text-xs text-content-muted">
                  Show the {report.duplicates.length} rows already in your account
                </summary>
                <ul className="mt-2 space-y-1 text-xs text-content-faint">
                  {report.duplicates.slice(0, 10).map((entry) => (
                    <li key={entry.dedupeHash}>
                      {formatDate(entry.row.txn_date)} · {entry.row.description_raw} ·{' '}
                      {formatMoney(entry.row.amount)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>

          <Card>
            <div className="flex flex-wrap justify-end gap-2 p-4">
              <Button size="sm" onClick={() => setStep('map')}>
                Back
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={commitImport.isPending}
                disabled={report.newRows.length === 0}
                onClick={() => void commit()}
              >
                Import {report.newRows.length} transaction{report.newRows.length === 1 ? '' : 's'}
              </Button>
            </div>
            {report.newRows.length === 0 && (
              <p className="border-t border-line px-4 py-2 text-xs text-content-muted">
                Every row in this file is already in your account. Nothing to import — which is exactly
                what should happen when you re-import an overlapping statement.
              </p>
            )}
          </Card>
        </>
      )}

      {step === 'done' && result && (
        <Card>
          <CardHeader title="Import complete" subtitle={filename} />
          <dl className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
            <Stat label="Imported" value={String(result.imported)} tone="positive" />
            <Stat label="Skipped as duplicates" value={String(result.skipped)} />
            <Stat label="Auto-categorised" value={String(result.categorised)} />
          </dl>
          <div className="flex flex-wrap justify-end gap-2 border-t border-line p-4">
            <Button
              variant="danger"
              size="sm"
              loading={undoImport.isPending}
              onClick={async () => {
                try {
                  const removed = await undoImport.mutateAsync(result.batchId)
                  notify(`Undone — ${removed} transactions removed.`, { tone: 'success' })
                  reset()
                } catch (error) {
                  notify(describeError(error), { tone: 'error' })
                }
              }}
            >
              Undo this import
            </Button>
            <Button variant="primary" size="sm" onClick={reset}>
              Import another file
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'positive' | 'caution' | 'negative'
}) {
  const tones = {
    neutral: 'text-content',
    positive: 'text-positive',
    caution: 'text-caution',
    negative: 'text-negative',
  }
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <dt className="text-xs text-content-muted">{label}</dt>
      <dd className={cx('tabular mt-0.5 text-lg font-semibold', tones[tone])}>{value}</dd>
    </div>
  )
}
