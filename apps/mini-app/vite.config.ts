import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Individual Phosphor modules are ESM; serve them directly when changing icons in dev.
  optimizeDeps: { exclude: ['@phosphor-icons/react'] },
})
