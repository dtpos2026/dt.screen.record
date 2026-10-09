import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@renderer': resolve(__dirname, 'src/renderer/src')
}

// Every runtime dependency is bundled (they are devDependencies), so the
// packaged app ships no node_modules folder and stays small.
export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      outDir: 'out/main',
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } }
    }
  },
  preload: {
    resolve: { alias },
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        // Sandboxed preloads must be a single CommonJS file.
        output: { format: 'cjs', entryFileNames: '[name].cjs', inlineDynamicImports: true }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias },
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          engine: resolve(__dirname, 'src/renderer/engine.html'),
          toolbar: resolve(__dirname, 'src/renderer/toolbar.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay.html'),
          countdown: resolve(__dirname, 'src/renderer/countdown.html'),
          webcam: resolve(__dirname, 'src/renderer/webcam.html'),
          border: resolve(__dirname, 'src/renderer/border.html'),
          splash: resolve(__dirname, 'src/renderer/splash.html')
        }
      }
    }
  }
})
