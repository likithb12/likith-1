import { Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import { Layout } from './ui/Layout'
import { LoadingState } from './ui/feedback'
import { NotConfigured } from './pages/NotConfigured'
import { SignIn } from './pages/SignIn'
import { Dashboard } from './pages/Dashboard'
import { Accounts } from './pages/Accounts'
import { UpdateBalances } from './pages/UpdateBalances'
import { Expenses } from './pages/Expenses'
import { Obligations } from './pages/Obligations'
import { Income } from './pages/Income'
import { Settings } from './pages/Settings'
import { NotFound } from './pages/NotFound'

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
        <Route path="accounts" element={<Accounts />} />
        <Route path="balances" element={<UpdateBalances />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="obligations" element={<Obligations />} />
        <Route path="income" element={<Income />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
