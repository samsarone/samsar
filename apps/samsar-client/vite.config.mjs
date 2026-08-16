import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'


export default defineConfig({
  plugins: [react(),
    tailwindcss()
  ],
  build: {
    outDir: 'dist_build',
    // Preserve Vite 6's effective browser floor across the Vite 8 migration.
    target: ['chrome87', 'edge88', 'firefox78', 'safari14'],
    // Route-level code splitting keeps the largest editor chunks below this budget.
    chunkSizeWarningLimit: 700,
  },
})
