import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',  // relative paths — required for Electron file:// protocol
  server: { port: 3000, strictPort: true },
})
