import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const base = 'https://cdn.jsdelivr.net/gh/VivianMoonlight/Vivians-Portable-Wardrobe@wardrobe-react/'
const files = [
  ['ViviansPortableWardrobeReactLoader.user.js', 'ViviansPortableWardrobeReactLoader.user.js'],
  ['out/Vivians-Portable-Wardrobe.user.js', 'out/Vivians-Portable-Wardrobe.user.js'],
]

async function purge(relativePath) {
  const url = `${base}${relativePath}`.replace('https://cdn.jsdelivr.net/', 'https://purge.jsdelivr.net/')
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`jsDelivr purge failed for ${relativePath}: HTTP ${response.status}`)
}

async function matchesPublishedFile(relativePath, localPath) {
  const response = await fetch(`${base}${relativePath}`, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`jsDelivr download failed for ${relativePath}: HTTP ${response.status}`)
  const expected = fs.readFileSync(path.join(root, localPath))
  const actual = Buffer.from(await response.arrayBuffer())
  return actual.equals(expected)
}

let needsPurge = true
let lastError
let verified = false
for (let attempt = 0; attempt < 12; attempt += 1) {
  try {
    if (needsPurge || attempt % 3 === 0) {
      await Promise.all(files.map(([relativePath]) => purge(relativePath)))
      needsPurge = false
    }
    const results = await Promise.all(files.map(([relativePath, localPath]) => matchesPublishedFile(relativePath, localPath)))
    if (results.every(Boolean)) {
      verified = true
      break
    }
    lastError = new Error('CDN content differs from the committed userscripts')
  } catch (error) {
    lastError = error
    needsPurge = true
    console.warn(`CDN refresh attempt ${attempt + 1}/12 failed: ${error.message}`)
  }
  if (attempt < 11) {
    console.log(`Waiting for React preview CDN refresh (${attempt + 1}/12)`)
    await new Promise((resolve) => setTimeout(resolve, 10000))
  }
}

if (verified) {
  console.log('The React loader and bundle on jsDelivr match the published branch.')
} else {
  throw new Error(`jsDelivr did not serve the published React loader and bundle: ${lastError?.message}`)
}
