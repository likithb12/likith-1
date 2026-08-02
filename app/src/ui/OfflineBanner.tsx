import { useEffect, useState } from 'react'

/**
 * Offline indicator.
 *
 * Reads are served from the service worker's cache while offline, so the app
 * keeps working — but a net worth figure that might be a week old must not be
 * presented as if it were live.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(() => !navigator.onLine)

  useEffect(() => {
    const goOnline = () => setOffline(false)
    const goOffline = () => setOffline(true)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (!offline) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-caution/15 px-4 py-1.5 text-xs text-caution"
    >
      <span aria-hidden="true">⚡</span>
      <span>Offline — showing the last data loaded on this device. Changes cannot be saved.</span>
    </div>
  )
}
