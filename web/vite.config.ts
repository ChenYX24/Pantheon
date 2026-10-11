import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The build lands directly in the Go module's embed directory. Keeping the
// artefact anywhere else would mean a copy step that someone eventually forgets,
// and a binary shipping a stale UI is very hard to notice.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // index.html keeps absolute /assets/ paths, which the server rewrites for a
  // mounted instance (/dev). Chunks loaded from JavaScript cannot be rewritten,
  // so they resolve against the importing module instead and work at any mount.
  experimental: {
    renderBuiltUrl(filename, { hostType }) {
      return hostType === 'js' ? { relative: true } : '/' + filename
    },
  },
  build: {
    outDir: '../internal/webui/dist',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        // Libraries change far less often than the panel; keeping them in
        // their own chunks lets a browser keep them across panel updates.
        advancedChunks: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'xterm', test: /node_modules[\\/]@xterm[\\/]/ },
            { name: 'icons', test: /node_modules[\\/]lucide-react[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5273,
    proxy: {
      '/api': 'http://127.0.0.1:7788',
      // ws:true is what makes the terminal work under `npm run dev`; without
      // it the upgrade request is proxied as plain HTTP and every session
      // silently fails to connect.
      '/ws': { target: 'ws://127.0.0.1:7788', ws: true },
    },
  },
})
