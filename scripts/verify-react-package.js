import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const loaderName = 'ViviansPortableWardrobeReactLoader.user.js'
const bundleName = 'Vivians-Portable-Wardrobe.user.js'
const cdnBase = 'https://cdn.jsdelivr.net/gh/VivianMoonlight/Vivians-Portable-Wardrobe@wardrobe-react/'

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function metadata(contents, field) {
  return contents.match(new RegExp(`^//\\s*@${field}\\s+(\\S+)`, 'm'))?.[1]
}

const loader = read(loaderName)
const copiedLoader = read(`out/${loaderName}`)
const bundle = read(`out/${bundleName}`)

if (loader !== copiedLoader) throw new Error('The packaged React loader differs from the installed loader')
for (const [name, contents, expectedURL] of [
  [loaderName, loader, `${cdnBase}${loaderName}`],
  [bundleName, bundle, `${cdnBase}out/${bundleName}`],
]) {
  if (metadata(contents, 'version') !== version) {
    throw new Error(`${name} @version does not match package.json ${version}`)
  }
  for (const field of ['updateURL', 'downloadURL']) {
    if (metadata(contents, field) !== expectedURL) {
      throw new Error(`${name} @${field} does not point to the published branch file`)
    }
  }
}

console.log(`Verified React preview artifacts ${version}`)
