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
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
