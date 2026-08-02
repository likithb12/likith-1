import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { AuthProvider } from './auth/AuthProvider'
import { ToastProvider } from './ui/toast'
import { ErrorBoundary } from './ui/feedback'
import { isBackendUnreachable } from './lib/supabase'
import './index.css'

/*
 * HashRouter, not BrowserRouter. GitHub Pages has no SPA fallback: a deep link
 * to /networth/accounts would 404 because no such file exists. The alternative
 * is copying index.html to 404.html, which works but shows a real 404 in the
 * network log and breaks the back button in some browsers. See DECISIONS.md.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Retrying a paused Supabase project just delays the honest error.
        if (isBackendUnreachable(error)) return false
        return failureCount < 2
      },
    },
  },
})

const container = document.getElementById('root')
if (!container) throw new Error('Root element missing from index.html')

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <HashRouter>
              <App />
            </HashRouter>
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
