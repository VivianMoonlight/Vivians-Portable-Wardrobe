import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import monkey from 'vite-plugin-monkey'
import path from 'path'

const hosts = [
  'https://bondageprojects.elementfx.com/*',
  'https://www.bondageprojects.elementfx.com/*',
  'https://bondage-europe.com/*',
  'https://www.bondage-europe.com/*',
  'https://bondage-asia.com/*',
  'https://www.bondage-asia.com/*',
  'http://localhost:5173/*',
  'http://localhost:5174/*',
]

export default defineConfig({
  plugins: [
    vue(),
    monkey({
      entry: path.resolve(__dirname, 'src/main.js'),
      userscript: {
        name: 'Vivians Portable Wardrobe',
        namespace: 'http://tampermonkey.net/',
        version: '0.5.dev',
        description: 'Loader for Portable Wardrobe and Vue floating panel',
        match: hosts,
        // 建议使用相对路径或稳定托管的 URL（不要在示例中写入个人用户名）
        // 若你在仓库里有 public/icon.png，使用 '/public/icon.png' 或 './icon.png' 并在 build 时内联/打包
        //icon: '/public/icon.png',
        grant: [
          'GM_setValue', 'GM_getValue', 'GM_deleteValue', 'GM_listValues',
          'GM_info', 'GM.setValue', 'GM.getValue', 'GM.deleteValue', 'GM.listValues'
        ],
        // 你可以在这里补充 @updateURL/@downloadURL（发布时替换为 release/raw 链接）
      },
      server: {
        port: 5173,
        open: true,
      },
      build: {
        externalGlobals: {},
      },
    }),
  ],
  build: {
    outDir: 'dist',
    sourcemap: true,
    // 把所有静态资源尽可能内联，避免生成需要额外请求的文件
    assetsInlineLimit: 10000000,
    // rollup 配置：尝试把动态 import 的内容内联为单一包（避免生成相对 chunk）
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})