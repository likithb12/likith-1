import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { Button, Card, Field, Input } from '../ui/primitives'
import { describeError } from '../lib/supabase'

export function SignIn() {
  const { sendMagicLink } = useAuth()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) {
      setError('Enter your email address.')
      return
    }
    setStatus('sending')
    setError(null)
    try {
      await sendMagicLink(trimmed)
      setStatus('sent')
    } catch (caught) {
      setError(describeError(caught))
      setStatus('idle')
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-content">Net Worth</h1>
          <p className="mt-1 text-sm text-content-muted">Private personal finance tracking.</p>
        </div>

        <Card className="p-5">
          {status === 'sent' ? (
            <div className="space-y-3 text-center">
              <p className="text-2xl" aria-hidden="true">
                📬
              </p>
              <p className="text-sm font-medium text-content">Check your email</p>
              <p className="text-sm text-content-muted">
                A sign-in link is on its way to <span className="text-content">{email.trim()}</span>. Open
                it on this device — the link signs you in where it is opened.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStatus('idle')
                  setError(null)
                }}
              >
                Use a different email
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <Field
                label="Email address"
                required
                error={error}
                hint="We email you a one-time sign-in link. There is no password to remember or reset."
              >
                {(props) => (
                  <Input
                    {...props}
                    type="email"
                    name="email"
                    autoComplete="email"
                    inputMode="email"
                    autoFocus
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                )}
              </Field>

              <Button type="submit" variant="primary" className="w-full" loading={status === 'sending'}>
                Email me a sign-in link
              </Button>
            </form>
          )}
        </Card>

        <p className="mt-4 text-center text-xs text-content-faint">
          Your data is stored in Supabase (Sydney) and isolated by row-level security. It is not
          encrypted from the platform — see the README.
        </p>
      </div>
    </main>
  )
}
