/*
 * Service worker.
 *
 * Written by hand rather than generated: the whole requirement is "offline
 * read of cached data", and a build-time PWA plugin would add more surface
 * than the ~120 lines below.
 *
 * Three strategies:
 *   - Navigations: network first, falling back to the cached shell, so a
 *     reload while offline still opens the app.
 *   - Static assets: cache first. Vite content-hashes them, so a cached asset
 *     is never stale — a new build has new filenames.
 *   - Supabase reads: network first, falling back to the last good response.
 *     This is what makes the data readable offline.
 *
 * PRIVACY: the API cache holds your financial data on this device, in the
 * browser's Cache Storage. It is cleared on sign-out (the app posts
 * `clear-api-cache`), and cleared when the worker updates. Signing out on a
 * shared device removes it.
 */

const VERSION = 'v1'
const SHELL_CACHE = `networth-shell-${VERSION}`
const ASSET_CACHE = `networth-assets-${VERSION}`
const API_CACHE = `networth-api-${VERSION}`

const SHELL_URL = new URL('./index.html', self.registration.scope).pathname

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll([SHELL_URL, new URL('./', self.registration.scope).pathname]))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('networth-') && !key.endsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
  if (event.data === 'clear-api-cache') {
    event.waitUntil(caches.delete(API_CACHE))
  }
})

function isSupabaseRead(request, url) {
  if (request.method !== 'GET') return false
  if (!/\.supabase\.(co|in)$/.test(url.hostname)) return false
  // Never cache auth: tokens and session state must not be served from disk.
  return url.pathname.startsWith('/rest/v1/')
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Anything that changes data goes straight to the network. A queued write
  // replayed later could silently duplicate a transaction.
  if (request.method !== 'GET') return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(SHELL_CACHE).then((cache) => cache.put(SHELL_URL, copy)).catch(() => undefined)
          return response
        })
        .catch(() => caches.match(SHELL_URL).then((cached) => cached ?? Response.error())),
    )
    return
  }

  if (isSupabaseRead(request, url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(API_CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined)
          }
          return response
        })
        .catch(async () => {
          const cached = await caches.match(request)
          if (cached) {
            // Marked so the app can tell the user they are looking at a
            // snapshot rather than live data.
            const headers = new Headers(cached.headers)
            headers.set('X-Served-From-Cache', 'true')
            return new Response(cached.body, {
              status: cached.status,
              statusText: cached.statusText,
              headers,
            })
          }
          return Response.error()
        }),
    )
    return
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok && response.type === 'basic') {
              const copy = response.clone()
              caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined)
            }
            return response
          }),
      ),
    )
  }
})
