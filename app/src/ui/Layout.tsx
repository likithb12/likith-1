import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Icon, type IconName } from './Icon'
import { Button, cx } from './primitives'
import { ErrorBoundary } from './feedback'

interface NavItem {
  to: string
  label: string
  icon: IconName
  /** Shown in the mobile tab bar. The rest live behind "More". */
  primary?: boolean
}

const navItems: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', primary: true },
  { to: '/accounts', label: 'Accounts', icon: 'accounts', primary: true },
  { to: '/balances', label: 'Update balances', icon: 'balances', primary: true },
  { to: '/expenses', label: 'Expenses', icon: 'expenses', primary: true },
  { to: '/obligations', label: 'Obligations', icon: 'obligations', primary: true },
  { to: '/income', label: 'Income', icon: 'income' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

export function Layout() {
  const { user, signOut } = useAuth()

  return (
    <div className="min-h-dvh lg:flex">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <nav
        aria-label="Main"
        className="hidden w-56 shrink-0 flex-col border-r border-line bg-surface-raised lg:flex"
      >
        <div className="px-4 py-5">
          <p className="text-sm font-semibold tracking-tight text-content">Net Worth</p>
          <p className="mt-0.5 truncate text-xs text-content-faint" title={user?.email ?? ''}>
            {user?.email}
          </p>
        </div>

        <ul className="flex-1 space-y-0.5 px-2">
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cx(
                    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-brand/10 font-medium text-brand'
                      : 'text-content-muted hover:bg-surface-hover hover:text-content',
                  )
                }
              >
                <Icon name={item.icon} />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="p-2">
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </nav>

      {/* Mobile header */}
      <header className="flex items-center justify-between border-b border-line bg-surface-raised px-4 py-3 lg:hidden">
        <p className="text-sm font-semibold text-content">Net Worth</p>
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
      </header>

      <main id="main" className="min-w-0 flex-1 pb-20 lg:pb-0">
        <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-8">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>

      {/* Mobile tab bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface-raised/95 backdrop-blur lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ul className="grid grid-cols-6">
          {navItems
            .filter((item) => item.primary)
            .map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    cx(
                      'flex flex-col items-center gap-1 px-1 py-2 text-[10px] transition-colors',
                      isActive ? 'text-brand' : 'text-content-faint hover:text-content',
                    )
                  }
                >
                  <Icon name={item.icon} className="size-5" />
                  <span className="max-w-full truncate">{item.label.split(' ')[0]}</span>
                </NavLink>
              </li>
            ))}
          <li>
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                cx(
                  'flex flex-col items-center gap-1 px-1 py-2 text-[10px] transition-colors',
                  isActive ? 'text-brand' : 'text-content-faint hover:text-content',
                )
              }
            >
              <Icon name="settings" className="size-5" />
              <span>More</span>
            </NavLink>
          </li>
        </ul>
      </nav>
    </div>
  )
}
