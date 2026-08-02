import { Card } from '../ui/primitives'

/**
 * Shown when the build has no Supabase URL/anon key. Without this the app
 * would render a sign-in form that silently fails, which reads as a bug
 * rather than as missing configuration.
 */
export function NotConfigured() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-lg p-6">
        <h1 className="text-lg font-semibold text-content">Backend not configured</h1>
        <p className="mt-2 text-sm text-content-muted">
          This build has no Supabase connection details, so there is nothing to sign in to.
        </p>

        <p className="mt-4 text-sm text-content-muted">
          Set these two values and rebuild. They are public by design and belong in GitHub{' '}
          <strong className="text-content">repository variables</strong>, not secrets:
        </p>

        <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface p-3 text-xs text-content">
          <code>
            VITE_SUPABASE_URL=https://&lt;project-ref&gt;.supabase.co{'\n'}
            VITE_SUPABASE_ANON_KEY=&lt;anon key&gt;
          </code>
        </pre>

        <p className="mt-4 text-sm text-content-muted">
          Locally, copy <code className="text-content">app/.env.example</code> to{' '}
          <code className="text-content">app/.env.local</code>. See the README for the full setup,
          including applying the migrations in <code className="text-content">supabase/migrations</code>.
        </p>
      </Card>
    </main>
  )
}
