import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'

const OUT_USERSCRIPT_NAME = 'Vivians-Portable-Wardrobe.user.js'
const LOADER_FILE_NAME = 'ViviansPortableWardrobeLoader.user.js'
const VALID_MODES = new Set(['patch', 'minor', 'major', 'beta', 'ci'])

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}
function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf-8')
}
function parseSemver(version) {
  const normalized = String(version || '0.0.0').trim()
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/)
  if (!match) throw new Error(`Invalid semver version: ${version}`)
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || ''
  }
}
function bump(version, type) {
  const { major, minor, patch, prerelease } = parseSemver(version)
  if (type === 'major') return `${major + 1}.0.0`
  if (type === 'minor') return `${major}.${minor + 1}.0`
  if (type === 'patch') return `${major}.${minor}.${patch + 1}`
  if (type === 'beta') {
    const betaMatch = prerelease.match(/^beta\.(\d+)$/)
    if (betaMatch) {
      return `${major}.${minor}.${patch}-beta.${Number(betaMatch[1]) + 1}`
    }
    return `${major}.${minor}.${patch + 1}-beta.1`
  }
  return version
}
function syncLoaderVersion(loaderPath, version) {
  if (!fs.existsSync(loaderPath)) return
  const before = fs.readFileSync(loaderPath, 'utf-8')
  const after = before.replace(/^\/\/\s*@version\s+.+$/m, `// @version      ${version}`)
  if (after !== before) {
    fs.writeFileSync(loaderPath, after, 'utf-8')
    console.log(`Updated ${LOADER_FILE_NAME} @version -> ${version}`)
  }
}
async function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts })
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`)))
  })
}

async function main() {
  const mode = process.argv[2] || 'patch'
  if (!VALID_MODES.has(mode)) {
    throw new Error(`Unsupported release mode: ${mode}. Use one of: ${Array.from(VALID_MODES).join(', ')}`)
  }

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const pkgPath = path.join(root, 'package.json')
  const distDir = path.join(root, 'dist')
  const outDir = path.join(root, 'out')
  const loaderPath = path.join(root, LOADER_FILE_NAME)

  const pkg = readJSON(pkgPath)

  if (mode !== 'ci') {
    const next = bump(pkg.version || '0.0.0', mode)
    pkg.version = next
    writeJSON(pkgPath, pkg)
    console.log(`Version bumped to ${next}`)
  } else {
    console.log(`CI mode: using version ${pkg.version}`)
  }

  syncLoaderVersion(loaderPath, pkg.version)

  // Build
  await run('npm', ['run', 'build'])

  // Ensure out directory
  fs.mkdirSync(outDir, { recursive: true })

  // Find built userscript in dist
  const files = fs.readdirSync(distDir)
  const userJs = files.find(f => f.toLowerCase().endsWith('.user.js'))
  if (!userJs) throw new Error('No .user.js file found in dist')

  const src = path.join(distDir, userJs)
  const dest = path.join(outDir, OUT_USERSCRIPT_NAME)

  fs.copyFileSync(src, dest)
  console.log(`Copied ${userJs} -> out/${OUT_USERSCRIPT_NAME}`)

  if (fs.existsSync(loaderPath)) {
    const loaderOutPath = path.join(outDir, LOADER_FILE_NAME)
    fs.copyFileSync(loaderPath, loaderOutPath)
    console.log(`Copied ${LOADER_FILE_NAME} -> out/${LOADER_FILE_NAME}`)
  }

  console.log('Release preparation complete.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
