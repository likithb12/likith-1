/**
 * Progressive web app plumbing: service worker registration, the install
 * prompt, and online/offline state.
 *
 * Kept out of React so registration happens once, at startup, rather than
 * being tied to a component's lifecycle.
 */

let deferredPrompt: BeforeInstallPromptEvent | null = null
const installListeners = new Set<(available: boolean) => void>()

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return
  // A worker registered from a dev server would cache Vite's module graph and
  // make hot reloading behave bizarrely.
  if (import.meta.env.DEV) return

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch((error) => {
        console.warn('Service worker registration failed', error)
      })
  })
}

/** Drop cached API responses. Called on sign-out. */
export function clearApiCache(): void {
  navigator.serviceWorker?.controller?.postMessage('clear-api-cache')
}

export function initInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Chrome shows its own mini-infobar unless this is prevented; the app
    // offers a button in Settings instead, at a moment that makes sense.
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    installListeners.forEach((listener) => listener(true))
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    installListeners.forEach((listener) => listener(false))
  })
}

export function isInstallAvailable(): boolean {
  return deferredPrompt !== null
}

export function onInstallAvailabilityChange(listener: (available: boolean) => void): () => void {
  installListeners.add(listener)
  return () => installListeners.delete(listener)
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredPrompt) return 'unavailable'
  await deferredPrompt.prompt()
  const { outcome } = await deferredPrompt.userChoice
  deferredPrompt = null
  installListeners.forEach((listener) => listener(false))
  return outcome
}

/** True when running from the home screen rather than a browser tab. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari predates the display-mode media query.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  )
}
