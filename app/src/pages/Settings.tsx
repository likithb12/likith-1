import { useEffect, useRef, useState } from 'react'
import { Button, Card, CardHeader, Checkbox, Field, Input, PageHeader, Select } from '../ui/primitives'
import { ErrorState } from '../ui/feedback'
import { useToast } from '../ui/toast'
import { useProfile, useUpdateProfile } from '../data/profile'
import {
  downloadExport,
  parseExportFile,
  useExportData,
  useImportData,
  type ExportFile,
} from '../data/backup'
import { useRecomputeNetWorth } from '../data/netWorth'
import { COMMON_CURRENCIES } from '../lib/fx'
import { describeError, supabaseUrl } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { PricesAndFx } from './PricesAndFx'
import { isInstallAvailable, isStandalone, onInstallAvailabilityChange, promptInstall } from '../pwa'

export function Settings() {
  const profile = useProfile()
  const updateProfile = useUpdateProfile()
  const exportData = useExportData()
  const importData = useImportData()
  const recompute = useRecomputeNetWorth()
  const { user } = useAuth()
  const { notify } = useToast()

  const [installAvailable, setInstallAvailable] = useState(() => isInstallAvailable())
  const [pendingImport, setPendingImport] = useState<ExportFile | null>(null)
  const [replaceExisting, setReplaceExisting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => onInstallAvailabilityChange(setInstallAvailable), [])

  if (profile.isError) {
    return (
      <div className="space-y-5">
        <PageHeader title="Settings" />
        <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
      </div>
    )
  }

  const baseCurrency = profile.data?.base_currency ?? 'AUD'
  const secondaryCurrency = profile.data?.secondary_currency ?? ''

  async function saveProfile(patch: Parameters<typeof updateProfile.mutateAsync>[0]) {
    try {
      await updateProfile.mutateAsync(patch)
      notify('Saved.', { tone: 'success' })
    } catch (error) {
      notify(describeError(error), { tone: 'error' })
    }
  }

  async function onExport() {
    try {
      const file = await exportData.mutateAsync()
      downloadExport(file)
      const rows = Object.values(file.data).reduce((sum, list) => sum + (list?.length ?? 0), 0)
      notify(`Exported ${rows} rows.`, { tone: 'success' })
    } catch (error) {
      notify(describeError(error), { tone: 'error' })
    }
  }

  async function onFileChosen(file: File | undefined) {
    if (!file) return
    try {
      const parsed = parseExportFile(await file.text())
      setPendingImport(parsed)
      setReplaceExisting(false)
    } catch (error) {
      notify(describeError(error), { tone: 'error' })
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function runImport() {
    if (!pendingImport) return
    try {
      const result = await importData.mutateAsync({ file: pendingImport, replaceExisting })
      await recompute.mutateAsync()
      setPendingImport(null)
      notify(`Imported ${result.total} rows.`, { tone: 'success' })
    } catch (error) {
      notify(describeError(error), { tone: 'error' })
    }
  }

  const currencies = [...new Set([baseCurrency, ...COMMON_CURRENCIES])]
  const importCounts = pendingImport
    ? Object.entries(pendingImport.data)
        .filter(([, rows]) => (rows?.length ?? 0) > 0)
        .map(([table, rows]) => `${rows?.length} ${table.replace(/_/g, ' ')}`)
    : []

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="Currencies, your data, and where it lives." />

      <Card>
        <CardHeader title="Currencies" subtitle="Everything is reported in your base currency." />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Base currency" hint="All totals and charts use this.">
            {(props) => (
              <Select
                {...props}
                value={baseCurrency}
                onChange={(event) => void saveProfile({ base_currency: event.target.value })}
              >
                {currencies.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Secondary currency" hint="Optional. Shown alongside the base currency.">
            {(props) => (
              <Select
                {...props}
                value={secondaryCurrency}
                onChange={(event) =>
                  void saveProfile({ secondary_currency: event.target.value || null })
                }
              >
                <option value="">None</option>
                {COMMON_CURRENCIES.filter((code) => code !== baseCurrency).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Display name">
            {(props) => (
              <Input
                {...props}
                defaultValue={profile.data?.display_name ?? ''}
                placeholder="Your name"
                onBlur={(event) => {
                  const next = event.target.value.trim() || null
                  if (next !== (profile.data?.display_name ?? null)) {
                    void saveProfile({ display_name: next })
                  }
                }}
              />
            )}
          </Field>
        </div>
      </Card>

      <PricesAndFx />

      <Card>
        <CardHeader
          title="Your data"
          subtitle="Export everything, any time. You should never be locked in."
        />
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-content">Export to JSON</p>
              <p className="text-xs text-content-faint">
                Every account, balance, transaction, obligation and setting, in one file.
              </p>
            </div>
            <Button variant="primary" size="sm" loading={exportData.isPending} onClick={() => void onExport()}>
              Export
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div className="min-w-0">
              <p className="text-sm text-content">Import from JSON</p>
              <p className="text-xs text-content-faint">Restore a file produced by the export above.</p>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              id="import-file"
              onChange={(event) => void onFileChosen(event.target.files?.[0])}
            />
            <label
              htmlFor="import-file"
              className="inline-flex cursor-pointer items-center rounded-lg border border-line bg-surface-raised px-3.5 py-2 text-sm font-medium text-content transition-colors hover:bg-surface-hover"
            >
              Choose file
            </label>
          </div>

          {pendingImport && (
            <div className="space-y-3 rounded-lg border border-caution/30 bg-caution/5 p-3">
              <p className="text-sm text-content">
                Ready to import an export from{' '}
                <strong>{new Date(pendingImport.exported_at).toLocaleDateString('en-AU')}</strong>.
              </p>
              <p className="text-xs text-content-muted">{importCounts.join(' · ') || 'No rows found.'}</p>

              <Checkbox
                label="Replace all my existing data first"
                description="Deletes everything currently stored, then imports. Leave off to add these rows alongside what you already have — which will create duplicate accounts if this is a re-import."
                checked={replaceExisting}
                onChange={(event) => setReplaceExisting(event.target.checked)}
              />

              <div className="flex flex-wrap gap-2">
                <Button
                  variant={replaceExisting ? 'danger' : 'primary'}
                  size="sm"
                  loading={importData.isPending || recompute.isPending}
                  onClick={() => void runImport()}
                >
                  {replaceExisting ? 'Replace everything and import' : 'Import'}
                </Button>
                <Button size="sm" onClick={() => setPendingImport(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div className="min-w-0">
              <p className="text-sm text-content">Recompute net worth history</p>
              <p className="text-xs text-content-faint">
                Rebuilds the trend from your balances. Safe to run at any time.
              </p>
            </div>
            <Button
              size="sm"
              loading={recompute.isPending}
              onClick={async () => {
                try {
                  const count = await recompute.mutateAsync()
                  notify(`Recomputed ${count} data point${count === 1 ? '' : 's'}.`, { tone: 'success' })
                } catch (error) {
                  notify(describeError(error), { tone: 'error' })
                }
              }}
            >
              Recompute
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Install on this device"
          subtitle="Adds it to your home screen and lets it open without browser chrome."
        />
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="min-w-0 text-sm text-content-muted">
            {isStandalone()
              ? 'Already installed — you are running it from the home screen.'
              : installAvailable
                ? 'Your browser can install this app.'
                : 'On iPhone or iPad, use Share → Add to Home Screen. On desktop Chrome, look for the install icon in the address bar.'}
          </p>
          {installAvailable && !isStandalone() && (
            <Button
              variant="primary"
              size="sm"
              onClick={async () => {
                const outcome = await promptInstall()
                if (outcome === 'accepted') notify('Installed.', { tone: 'success' })
              }}
            >
              Install
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Where your data lives" />
        <div className="space-y-3 p-4 text-sm text-content-muted">
          <dl className="space-y-1.5">
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-content-faint">Signed in as</dt>
              <dd className="text-content">{user?.email}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-content-faint">Backend</dt>
              <dd className="truncate text-content">{supabaseUrl || 'Not configured'}</dd>
            </div>
          </dl>

          <p className="border-t border-line pt-3">
            For offline reading, this device keeps a copy of the data it has already loaded in the
            browser's cache. Signing out clears it.
          </p>

          <p>
            Row-level security isolates your rows from every other user. It does{' '}
            <strong className="text-content">not</strong> hide your data from Supabase or AWS, who can
            read the database in plaintext. Amounts are not encrypted. This trade-off is described in
            full in the project README.
          </p>
        </div>
      </Card>
    </div>
  )
}
