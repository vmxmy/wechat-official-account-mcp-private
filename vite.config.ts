import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

// https://vite.dev/config/
export default defineConfig({
  root: 'web',
  plugins: [
    tanstackRouter({
      target: 'react',
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
      quoteStyle: 'single',
      semicolons: true,
      addExtensions: '.js',
      autoCodeSplitting: true,
    }),
    react(),
    tsconfigPaths(),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@astryxdesign')) return 'vendor-astryx';
          if (id.includes('@tanstack')) return 'vendor-tanstack';
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('/scheduler/')) return 'vendor-react';
          if (id.includes('lucide-react')) return 'vendor-icons';
          return undefined;
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (_proxyReq) => {
            console.log('Proxying request to:', _proxyReq.path);
          });
          proxy.on('proxyRes', (_proxyRes, _req) => {
            console.log('Received response from:', _req.url);
          });
          proxy.on('error', (_err) => {
            console.error('Proxy error:', _err);
          });
        },
      },
    },
  },
});
