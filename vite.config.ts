/// <reference types="vitest/config" />
import { defineConfig, build, type Plugin } from 'vite';
import { resolve } from 'node:path';

/**
 * Builds content.js as a standalone IIFE bundle without code-splitting.
 * Chrome Extension content scripts in Manifest V3 are classic scripts and CANNOT use ES module imports.
 */
function buildContentScript(): Plugin {
  return {
    name: 'build-content-script',
    async closeBundle() {
      // 1. Build content.js (Isolated World)
      await build({
        configFile: false,
        resolve: {
          alias: {
            '@domain': resolve(__dirname, 'src/domain'),
            '@application': resolve(__dirname, 'src/application'),
            '@infrastructure': resolve(__dirname, 'src/infrastructure'),
            '@extension': resolve(__dirname, 'src/extension'),
          },
        },
        build: {
          outDir: 'dist',
          emptyOutDir: false,
          target: 'es2022',
          rollupOptions: {
            input: {
              content: resolve(__dirname, 'src/extension/content/content.ts'),
            },
            output: {
              format: 'iife',
              entryFileNames: 'content.js',
              extend: true,
            },
          },
        },
      });

      // 2. Build content-main.js (Main / Page World Bridge)
      await build({
        configFile: false,
        resolve: {
          alias: {
            '@domain': resolve(__dirname, 'src/domain'),
            '@application': resolve(__dirname, 'src/application'),
            '@infrastructure': resolve(__dirname, 'src/infrastructure'),
            '@extension': resolve(__dirname, 'src/extension'),
          },
        },
        build: {
          outDir: 'dist',
          emptyOutDir: false,
          target: 'es2022',
          rollupOptions: {
            input: {
              'content-main': resolve(__dirname, 'src/extension/content/page-bridge.ts'),
            },
            output: {
              format: 'iife',
              entryFileNames: 'content-main.js',
              extend: true,
            },
          },
        },
      });
    },
  };
}

export default defineConfig({
  plugins: process.env.VITEST ? [] : [buildContentScript()],
  resolve: {
    alias: {
      '@domain': resolve(__dirname, 'src/domain'),
      '@application': resolve(__dirname, 'src/application'),
      '@infrastructure': resolve(__dirname, 'src/infrastructure'),
      '@extension': resolve(__dirname, 'src/extension'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/extension/popup/popup.html'),
        background: resolve(__dirname, 'src/extension/background/service-worker.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') {
            return '[name].js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/domain/**', 'src/application/**', 'src/extension/popup/Popup*.ts'],
    },
  },
});
