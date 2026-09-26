import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const loaderName = 'ViviansPortableWardrobeReactLoader.user.js'
const loaderPath = path.join(root, loaderName)
const loader = fs.readFileSync(loaderPath, 'utf8')
  .replace(/^\/\/\s*@version\s+.+$/m, `// @version      ${version}`)

// Run Vite directly so packaging also works outside an npm script on Windows.
const built = spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], {
  cwd: root,
  stdio: 'inherit',
})
if (built.error) throw built.error
if (built.status !== 0) process.exit(built.status || 1)

fs.writeFileSync(loaderPath, loader)
fs.mkdirSync(path.join(root, 'out'), { recursive: true })
fs.copyFileSync(path.join(root, 'dist/vivians-portable-wardrobe.user.js'), path.join(root, 'out/Vivians-Portable-Wardrobe.user.js'))
fs.copyFileSync(loaderPath, path.join(root, 'out', loaderName))
console.log(`Packaged React preview ${version} for wardrobe-react`)
