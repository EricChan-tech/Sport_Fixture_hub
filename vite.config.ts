import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { scheduleDevPlugin } from './pipeline/dev-plugin.mjs'

export default defineConfig({
  plugins: [vue(), tailwindcss(), scheduleDevPlugin()],
  server: {
    host: '0.0.0.0',
    port: 43123,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 43123,
    strictPort: true,
  },
})
