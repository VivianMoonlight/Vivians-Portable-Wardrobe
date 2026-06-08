import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import monkey from 'vite-plugin-monkey'
import path from 'path'
import fs from 'fs'

// Read version from package.json (single source of truth)
const pkgJson = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url)))
const VERSION = pkgJson.version || '0.0.0'

const hosts = [
  'https://bondageprojects.elementfx.com/*',
  'https://www.bondageprojects.elementfx.com/*',
  'https://bondage-europe.com/*',
  'https://www.bondage-europe.com/*',
  'https://bondage-asia.com/*',
  'https://www.bondage-asia.com/*',
  //'http://localhost:5173/*',
  //'http://localhost:5174/*',
]

/**
 * Two modes share one config:
 *
 * - default (build / `dev:userscript`) → vite-plugin-monkey, emits the Tampermonkey
 *   userscript and serves a dev userscript that loads into the real game page.
 * - `--mode mock` (`npm run dev`) → plain React app served from `dev/`, which mounts
 *   the wardrobe UI into a Shadow DOM with mocked game globals. Instant local UI
 *   preview without the Bondage Club runtime. The `$` (monkey virtual module) is
 *   stubbed so host-window.js resolves outside monkey.
 */
export default defineConfig(({ mode }) => {
  const isMock = mode === 'mock'

  const alias = { '@': path.resolve(__dirname, './src') }
  if (isMock) {
    alias.$ = path.resolve(__dirname, './dev/monkey-shim.js')
  }

  return {
    root: isMock ? path.resolve(__dirname, 'dev') : __dirname,
    plugins: isMock
      ? [react()]
      : [
          react(),
          monkey({
            entry: path.resolve(__dirname, 'src/main.tsx'),
            userscript: {
              name: 'Vivians Portable Wardrobe',
              namespace: 'http://tampermonkey.net/',
              version: VERSION,
              description: 'Portable Wardrobe for Bondage Club (React + Mantine, Shadow DOM isolated)',
              match: hosts,
              // Tampermonkey auto-update URLs (served via GitHub Pages)
              updateURL: 'https://vivianmoonlight.github.io/Vivians-Portable-Wardrobe/ViviansPortableWardrobeLoader.user.js',
              downloadURL: 'https://vivianmoonlight.github.io/Vivians-Portable-Wardrobe/ViviansPortableWardrobeLoader.user.js',
              //icon: '/public/icon.png',
              grant: [
                'GM_setValue', 'GM_getValue', 'GM_deleteValue', 'GM_listValues',
                'GM_info', 'GM.setValue', 'GM.getValue', 'GM.deleteValue', 'GM.listValues',
              ],
            },
            server: {
              port: 5173,
              open: true,
            },
            build: {
              externalGlobals: {},
              // All UI CSS is imported via `?inline` and injected into the Shadow DOM
              // manually (see src/ui/shadow.ts); nothing is injected into the host page.
            },
          }),
        ],
    server: {
      port: isMock ? 5180 : 5173,
      open: true,
    },
    // Keep the dep pre-bundle cache at the repo root (stable across modes, and
    // not under dev/ which has no node_modules) and pre-declare the heavy deps so
    // Vite optimizes them up-front instead of mid-session — the latter is what
    // triggers "504 (Outdated Optimize Dep)".
    cacheDir: path.resolve(__dirname, 'node_modules/.vite'),
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        '@mantine/core',
        '@mantine/hooks',
        'i18next',
        'react-i18next',
        'zustand',
        'zustand/vanilla',
      ],
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      // Inline all static assets so the userscript stays a single file (no extra requests).
      assetsInlineLimit: 10000000,
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
    resolve: { alias },
  }
})
