import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}
function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf-8')
}
function bump(version, type) {
  const [maj, min, pat] = version.split('.').map(n => parseInt(n, 10) || 0)
  if (type === 'major') return `${maj + 1}.0.0`
  if (type === 'minor') return `${maj}.${min + 1}.0`
  if (type === 'patch') return `${maj}.${min}.${pat + 1}`
  return version
}
async function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts })
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`)))
  })
}

async function main() {
  const mode = process.argv[2] || 'patch'
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
  const pkgPath = path.join(root, 'package.json')
  const distDir = path.join(root, 'dist')
  const outDir = path.join(root, 'out')

  const pkg = readJSON(pkgPath)

  if (mode !== 'ci') {
    const next = bump(pkg.version || '0.0.0', mode)
    pkg.version = next
    writeJSON(pkgPath, pkg)
    console.log(`Version bumped to ${next}`)
  } else {
    console.log(`CI mode: using version ${pkg.version}`)
  }

  // Build
  await run('npm', ['run', 'build'])

  // Ensure out directory
  fs.mkdirSync(outDir, { recursive: true })

  // Find built userscript in dist
  const files = fs.readdirSync(distDir)
  const userJs = files.find(f => f.toLowerCase().endsWith('.user.js'))
  if (!userJs) throw new Error('No .user.js file found in dist')

  const src = path.join(distDir, userJs)
  const dest = path.join(outDir, 'ViviansPortableWardrobeLoader.user.js')

  fs.copyFileSync(src, dest)
  console.log(`Copied ${userJs} -> out/ViviansPortableWardrobeLoader.user.js`)

  console.log('Release preparation complete.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
