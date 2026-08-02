import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The app is mounted as a sub-path of the existing GitHub Pages site
// (https://likithb12.github.io/likith-1/networth/). Without a correct `base`
// every asset URL 404s. Overridable so the same build works elsewhere.
const base = process.env.VITE_BASE_PATH ?? '/likith-1/networth/'

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split the big, stable dependencies into their own chunks so a code
        // change does not invalidate them, and so the charting library is not
        // on the critical path of the first paint.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          supabase: ['@supabase/supabase-js'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
