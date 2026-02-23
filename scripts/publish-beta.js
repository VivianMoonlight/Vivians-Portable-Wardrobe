import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      ...opts,
    })

    let stdout = ''
    let stderr = ''

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString()
        stdout += text
        process.stdout.write(text)
      })
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString()
        stderr += text
        process.stderr.write(text)
      })
    }

    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))
      }
    })
  })
}

async function output(cmd, args, cwd) {
  const result = await run(cmd, args, { cwd })
  return result.stdout.trim()
}

async function ensureCleanWorkingTree(root) {
  const status = await output('git', ['status', '--porcelain'], root)
  if (status) {
    throw new Error('Working tree is not clean. Commit or stash changes before running publish:beta.')
  }
}

async function ensureOnBetaBranch(root) {
  const branch = await output('git', ['rev-parse', '--abbrev-ref', 'HEAD'], root)
  if (branch !== 'beta') {
    throw new Error(`publish:beta must run on beta branch (current: ${branch})`)
  }
}

async function ensureTagNotExists(root, tagName) {
  const existing = await output('git', ['tag', '--list', tagName], root)
  if (existing === tagName) {
    throw new Error(`Tag already exists: ${tagName}`)
  }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

  await ensureCleanWorkingTree(root)
  await ensureOnBetaBranch(root)

  await run('npm', ['run', 'release:beta'], { cwd: root, stdio: 'inherit' })

  const pkg = readJSON(path.join(root, 'package.json'))
  const version = pkg.version || ''
  if (!/\-beta\.\d+$/.test(version)) {
    throw new Error(`Expected beta version after release:beta, got ${version}`)
  }

  const tagName = `v${version}`
  await ensureTagNotExists(root, tagName)

  await run('git', ['add', 'package.json', 'ViviansPortableWardrobeLoader.user.js', 'out/Vivians-Portable-Wardrobe.user.js', 'out/ViviansPortableWardrobeLoader.user.js'], { cwd: root, stdio: 'inherit' })
  await run('git', ['commit', '-m', `chore(release): beta ${tagName}`], { cwd: root, stdio: 'inherit' })
  await run('git', ['tag', tagName], { cwd: root, stdio: 'inherit' })
  await run('git', ['push', 'origin', 'beta'], { cwd: root, stdio: 'inherit' })
  await run('git', ['push', 'origin', tagName], { cwd: root, stdio: 'inherit' })

  console.log(`Beta published successfully: ${tagName}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
