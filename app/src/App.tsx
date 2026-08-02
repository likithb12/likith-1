import { Suspense, lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import { Layout } from './ui/Layout'
import { LoadingState } from './ui/feedback'
import { NotConfigured } from './pages/NotConfigured'
import { SignIn } from './pages/SignIn'
import { Dashboard } from './pages/Dashboard'

/*
 * The dashboard is the landing page and is loaded eagerly. Every other screen
 * is split out, which keeps the first paint off the critical path of code the
 * user has not asked for yet — §8 wants the dashboard interactive in under two
 * seconds on mobile, and Recharts plus the import wizard are most of the
 * bundle.
 */
const Accounts = lazy(() => import('./pages/Accounts').then((m) => ({ default: m.Accounts })))
const UpdateBalances = lazy(() =>
  import('./pages/UpdateBalances').then((m) => ({ default: m.UpdateBalances })),
)
const Expenses = lazy(() => import('./pages/Expenses').then((m) => ({ default: m.Expenses })))
const Obligations = lazy(() => import('./pages/Obligations').then((m) => ({ default: m.Obligations })))
const Income = lazy(() => import('./pages/Income').then((m) => ({ default: m.Income })))
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })))
const NotFound = lazy(() => import('./pages/NotFound').then((m) => ({ default: m.NotFound })))

export function App() {
  const { status } = useAuth()

  if (status === 'unconfigured') return <NotConfigured />

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <LoadingState label="Signing you in…" />
      </div>
    )
  }

  if (status === 'signed_out') return <SignIn />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route
          path="accounts"
          element={
            <Suspense fallback={<LoadingState />}>
              <Accounts />
            </Suspense>
          }
        />
        <Route
          path="balances"
          element={
            <Suspense fallback={<LoadingState />}>
              <UpdateBalances />
            </Suspense>
          }
        />
        <Route
          path="expenses"
          element={
            <Suspense fallback={<LoadingState />}>
              <Expenses />
            </Suspense>
          }
        />
        <Route
          path="obligations"
          element={
            <Suspense fallback={<LoadingState />}>
              <Obligations />
            </Suspense>
          }
        />
        <Route
          path="income"
          element={
            <Suspense fallback={<LoadingState />}>
              <Income />
            </Suspense>
          }
        />
        <Route
          path="settings"
          element={
            <Suspense fallback={<LoadingState />}>
              <Settings />
            </Suspense>
          }
        />
        <Route
          path="*"
          element={
            <Suspense fallback={<LoadingState />}>
              <NotFound />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  )
}
