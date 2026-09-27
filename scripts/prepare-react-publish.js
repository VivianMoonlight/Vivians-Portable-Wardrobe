import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const versionPattern = /^(\d+)\.(\d+)\.(\d+)-react\.(\d+)$/

export function parseReactVersion(version) {
  const match = versionPattern.exec(version)
  if (!match) throw new Error(`Expected a React preview version, got ${version}`)
  return match.slice(1).map(Number)
}

export function selectReactPublishVersion(current, previous) {
  const currentParts = parseReactVersion(current)
  if (!previous) return current

  const previousParts = parseReactVersion(previous)
  const comparison = currentParts.findIndex((part, index) => part !== previousParts[index])
  if (comparison === -1) {
    return `${currentParts[0]}.${currentParts[1]}.${currentParts[2]}-react.${currentParts[3] + 1}`
  }
  if (currentParts[comparison] < previousParts[comparison]) {
    throw new Error(`React preview version must increase: ${previous} -> ${current}`)
  }
  return current
}

function readPreviousVersion(commit) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Expected the previous push commit SHA')
  if (/^0+$/.test(commit)) return null
  const contents = execFileSync('git', ['show', `${commit}:package.json`], { cwd: root, encoding: 'utf8' })
  return JSON.parse(contents).version
}

function main() {
  const previous = readPreviousVersion(process.argv[2] || '')
  const packagePath = path.join(root, 'package.json')
  const lockPath = path.join(root, 'package-lock.json')
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  const version = selectReactPublishVersion(pkg.version, previous)

  if (pkg.version !== version || lock.version !== version || lock.packages[''].version !== version) {
    pkg.version = version
    lock.version = version
    lock.packages[''].version = version
    fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)
    fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
  }
  console.log(`React preview publication: ${previous || 'new branch'} -> ${version}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
