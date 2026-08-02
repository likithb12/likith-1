type IconName =
  | 'dashboard'
  | 'accounts'
  | 'balances'
  | 'expenses'
  | 'obligations'
  | 'income'
  | 'settings'
  | 'plus'
  | 'download'
  | 'upload'
  | 'warning'
  | 'check'
  | 'chevron-right'
  | 'search'
  | 'trash'

const paths: Record<IconName, string> = {
  dashboard: 'M3 13h6V3H3v10Zm0 8h6v-6H3v6Zm8 0h10V11H11v10Zm0-18v6h10V3H11Z',
  accounts: 'M3 6h18v12H3zM3 10h18M7 14h4',
  balances: 'M12 3v18M5 8h14M5 16h14',
  expenses: 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h4',
  obligations: 'M12 3v9l6 3M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  income: 'M3 17l6-6 4 4 8-8M21 7v6h-6',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8.4-3a8.4 8.4 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a8.3 8.3 0 0 0-2.2-1.3L15.3 2h-4l-.4 2.4a8.3 8.3 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a8.4 8.4 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a8.3 8.3 0 0 0 2.2 1.3l.4 2.4h4l.4-2.4a8.3 8.3 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.06-.43.1-.86.1-1.3Z',
  plus: 'M12 5v14M5 12h14',
  download: 'M12 3v12m0 0 4-4m-4 4-4-4M4 19h16',
  upload: 'M12 21V9m0 0 4 4M12 9 8 13M4 5h16',
  warning: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  check: 'M4 12.5 9 17.5 20 6.5',
  'chevron-right': 'M9 6l6 6-6 6',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
}

export function Icon({
  name,
  className = 'size-4',
  filled = false,
}: {
  name: IconName
  className?: string
  filled?: boolean
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  )
}

export type { IconName }
