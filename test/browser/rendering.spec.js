import { test, expect } from '@playwright/test'

function figureSvg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="1000" viewBox="0 0 500 1000">
    <rect width="500" height="1000" rx="35" fill="#f5f3ee"/>
    <ellipse cx="250" cy="925" rx="120" ry="24" fill="#ddd8cf"/>
    <path d="M190 210 Q140 50 250 50 Q360 50 310 210" fill="#43342f"/>
    <ellipse cx="250" cy="155" rx="64" ry="86" fill="#e8bda1"/>
    <path d="M215 222 L215 272 L180 290 L140 490 L174 504 L215 365 L285 365 L326 504 L360 490 L320 290 L285 272 L285 222" fill="#e8bda1"/>
    <path d="M180 290 L215 264 L250 285 L285 264 L320 290 L294 448 L335 705 L165 705 L206 448Z" fill="${color}"/>
    <path d="M196 705 L190 882 L228 882 L243 705 M257 705 L272 882 L310 882 L304 705" fill="#e8bda1"/>
    <path d="M188 876 L229 876 L234 922 L174 922Z M271 876 L312 876 L326 922 L266 922Z" fill="#43342f"/>
    <path d="M207 425 L293 425" stroke="#fff" stroke-opacity=".45" stroke-width="10"/>
  </svg>`
}

/** Test-only BC renderer; real browser Image objects deliver the asynchronous events. */
async function installHost(page, outfits) {
  await page.goto('/')
  await page.evaluate(async (fixtures) => {
    const probe = window.__renderProbe = { loads: [], draws: 0, builds: 0, created: [], deleted: [], live: [], imagesLoaded: 0 }
    const imageCache = new Map()
    window.DrawGetImage = (url) => {
      if (!imageCache.has(url)) {
        const image = new Image()
        image.errorcount = 0
        image.addEventListener('load', () => { probe.imagesLoaded++ })
        image.src = url
        imageCache.set(url, image)
      }
      return imageCache.get(url)
    }
    window.CharacterLoadSimple = (name) => {
      probe.created.push(name)
      probe.live.push(name)
      return { Name: name, AssetFamily: 'Female3DCG', Appearance: [], MustDraw: true }
    }
    window.CharacterDelete = (character) => {
      probe.deleted.push(character.Name)
      probe.live = probe.live.filter(name => name !== character.Name)
    }
    window.CharacterNaked = (character) => { character.bundle = [] }
    window.ServerAppearanceLoadFromBundle = (character, _family, data) => {
      character.bundle = data
      probe.loads.push({ character: character.Name, urls: data.map(part => part.Property?.imageUrl).filter(Boolean) })
    }
    window.CharacterAppearanceBuildCanvas = (character) => {
      probe.builds++
      character.Canvas ||= document.createElement('canvas')
      character.Canvas.width = 500
      character.Canvas.height = 1000
      const context = character.Canvas.getContext('2d')
      context.fillStyle = '#eceff4'
      context.fillRect(0, 0, 500, 1000)
      for (const part of character.bundle || []) {
        if (!part.Property?.imageUrl) continue
        const image = window.DrawGetImage(part.Property.imageUrl)
        if (image.complete && image.naturalWidth > 0) context.drawImage(image, 0, 0, 500, 1000)
      }
      character.MustDraw = false
    }
    window.CharacterRefresh = character => window.CharacterAppearanceBuildCanvas(character)
    window.DrawCharacter = (character, x, y, zoom, _allowHeight, context) => {
      probe.draws++
      if (character.MustDraw || !character.Canvas) window.CharacterAppearanceBuildCanvas(character)
      context.drawImage(character.Canvas, x, y, 500 * zoom, 1000 * zoom)
    }
    // Mock mode serves source files through Vite's /@fs URLs, including HMR versions.
    const moduleUrl = suffix => performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(url => new URL(url).pathname.endsWith(suffix))
    const { installRenderHooks } = await import(moduleUrl('/src/utils/RenderApi.js'))
    installRenderHooks({
      hookFunction(name, _priority, callback) {
        const original = window[name]
        window[name] = (...args) => callback(args, nextArgs => original(...nextArgs))
        return () => { window[name] = original }
      },
    })

    probe.storeUrl = moduleUrl('/src/stores/fileSystemStore.js')
    const { useFileSystemStore } = await import(probe.storeUrl)
    const fs = useFileSystemStore.getState()
    for (const outfit of [...fs.outfits]) fs.removeOutfit(outfit.id)
    const tags = new Map()
    for (const fixture of fixtures) {
      if (!tags.has(fixture.tag)) tags.set(fixture.tag, fs.createTag(fixture.tag))
      fs.addOutfit({
        name: fixture.name, type: 'outfit', tagIds: [tags.get(fixture.tag)], cloudSync: false,
        data: [{ Name: fixture.name, Group: 'Cloth', Property: { imageUrl: fixture.url } }],
      })
    }
  }, outfits)
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  await expect(page.getByText('Shared cloud storage', { exact: true })).toBeVisible()
}

function card(page, name) {
  return page.locator('button.vpw-outfit-select').filter({ has: page.getByText(name, { exact: true }) })
}

async function centerPixel(canvas) {
  return canvas.evaluate(element => [...element.getContext('2d').getImageData(
    Math.floor(element.width / 2), Math.floor(element.height / 2), 1, 1,
  ).data])
}

async function selectTag(page, name) {
  const sidebar = page.locator('.vpw-library-sidebar')
  await sidebar.getByRole('button').filter({ has: page.getByText(name, { exact: true }) }).first().click()
}

async function rendererWork(page) {
  return page.evaluate(async () => {
    const { useFileSystemStore } = await import(window.__renderProbe.storeUrl)
    const renderer = useFileSystemStore.getState().renderer
    return {
      pending: [...renderer.entries.values()].filter(entry => ['active', 'queued'].includes(entry.phase)).length,
      queued: [...renderer.entries.values()].filter(entry => entry.phase === 'queued').length,
      live: [...window.__renderProbe.live],
      loads: window.__renderProbe.loads.length,
    }
  })
}

test('BC image loads update visible cards; the sidebar and adjustment preview share cached renders', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  let releaseImages
  const imagesReady = new Promise(resolve => { releaseImages = resolve })
  await page.route('**/render-fixture/*.svg', async (route) => {
    await imagesReady
    await route.fulfill({ contentType: 'image/svg+xml', body: figureSvg(route.request().url().includes('amber') ? '#bd793e' : '#3c9786') })
  })
  try {
    await installHost(page, [
      { name: 'Amber coat', tag: 'Warm colors', url: '/render-fixture/amber.svg' },
      { name: 'Teal dress', tag: 'Cool colors', url: '/render-fixture/teal.svg' },
    ])
    const amber = card(page, 'Amber coat')
    const teal = card(page, 'Teal dress')
    await expect(page.locator('.vpw-workspace-preview canvas')).toHaveCount(0)
    await expect(amber.locator('.vpw-thumbnail')).toHaveAttribute('aria-busy', 'true')
    await expect(teal.locator('.vpw-thumbnail')).toHaveAttribute('aria-busy', 'true')
    await expect.poll(() => centerPixel(amber.locator('canvas'))).toEqual([236, 239, 244, 255])
    const beforeImages = await page.evaluate(() => window.__renderProbe.loads.filter(load => load.urls.length).length)
    expect(beforeImages).toBe(2)

    releaseImages()
    await expect(amber.locator('.vpw-thumbnail')).toHaveAttribute('aria-busy', 'false')
    await expect(teal.locator('.vpw-thumbnail')).toHaveAttribute('aria-busy', 'false')
    await expect.poll(() => centerPixel(amber.locator('canvas'))).toEqual([189, 121, 62, 255])
    await expect.poll(() => centerPixel(teal.locator('canvas'))).toEqual([60, 151, 134, 255])
    expect(await page.evaluate(() => window.__renderProbe.loads.filter(load => load.urls.length).length)).toBe(beforeImages)
    await expect.poll(async () => (await rendererWork(page)).live.length).toBe(0)

    await amber.click()
    await expect(page.getByRole('button', { name: 'Apply to Tester', exact: true })).toBeVisible()
    await expect(amber).toBeVisible()
    const preview = page.locator('.vpw-workspace-preview canvas')
    await expect.poll(() => centerPixel(preview)).toEqual([189, 121, 62, 255])
    await expect.poll(() => centerPixel(amber.locator('canvas'))).toEqual([189, 121, 62, 255])
    const warmLoads = await page.evaluate(() => window.__renderProbe.loads.length)
    await page.locator('.vpw-preview-actions').getByRole('button', { name: 'Adjust outfit', exact: true }).click()
    const adjustments = page.getByRole('dialog', { name: 'Outfit adjustments', exact: true })
    await expect.poll(() => centerPixel(adjustments.locator('canvas'))).toEqual([189, 121, 62, 255])
    expect(await page.evaluate(() => window.__renderProbe.loads.length)).toBe(warmLoads)
    await adjustments.getByRole('button', { name: 'Done adjusting', exact: true }).click()
    await page.screenshot({ path: test.info().outputPath('rendered-outfit-preview.png'), fullPage: true, animations: 'disabled' })
    await page.getByRole('button', { name: 'Close preview', exact: true }).click()
    await expect(page.locator('.vpw-workspace-preview canvas')).toHaveCount(0)
    await expect(amber.locator('.vpw-thumbnail')).toHaveAttribute('aria-busy', 'false')
    await expect.poll(() => centerPixel(amber.locator('canvas'))).toEqual([189, 121, 62, 255])
    expect(await page.evaluate(() => window.__renderProbe.loads.length)).toBe(warmLoads)
    await selectTag(page, 'Cool colors')
    await expect(amber).toHaveCount(0)
    await selectTag(page, 'All outfits')
    await expect(amber.locator('.vpw-thumbnail')).toHaveAttribute('aria-busy', 'false')
    await expect.poll(() => centerPixel(amber.locator('canvas'))).toEqual([189, 121, 62, 255])
    expect(await page.evaluate(() => window.__renderProbe.loads.length)).toBe(warmLoads)
    await page.screenshot({ path: test.info().outputPath('rendered-wardrobe-desktop.png'), fullPage: true, animations: 'disabled' })
    expect(errors).toEqual([])
  } finally { releaseImages() }
})

test('offscreen and closed wardrobe consumers cancel queued renders and temporary characters', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  let releaseImages
  const imagesReady = new Promise(resolve => { releaseImages = resolve })
  const responses = []
  await page.route('**/render-fixture/*.svg', async (route) => {
    const response = imagesReady.then(() => route.fulfill({ contentType: 'image/svg+xml', body: figureSvg('#3c9786') }))
    responses.push(response)
    await response
  })
  try {
    await installHost(page, Array.from({ length: 30 }, (_, index) => ({
      name: `Outfit ${String(index + 1).padStart(2, '0')}`, tag: 'Render queue', url: `/render-fixture/outfit-${index}.svg`,
    })))
    await expect.poll(async () => (await rendererWork(page)).live.length).toBe(2)
    await expect.poll(async () => (await rendererWork(page)).queued).toBeGreaterThan(0)
    const initial = await rendererWork(page)
    await page.locator('.vpw-thumbnail').first().evaluate(element => {
      let container = element.parentElement
      while (container && !(getComputedStyle(container).overflowY === 'auto' && container.scrollHeight > container.clientHeight)) container = container.parentElement
      if (!container) throw new Error('Wardrobe scroll container not found')
      container.scrollTop = container.scrollHeight
    })
    await expect.poll(async () => (await rendererWork(page)).live.every(id => !initial.live.includes(id))).toBe(true)
    await expect.poll(async () => (await rendererWork(page)).live.length).toBe(2)
    await expect.poll(async () => (await rendererWork(page)).loads).toBeGreaterThan(initial.loads)
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByText('Shared cloud storage', { exact: true })).toHaveCount(0)
    await expect.poll(() => rendererWork(page)).toMatchObject({ pending: 0, queued: 0, live: [] })
    const afterClose = await rendererWork(page)

    releaseImages()
    await Promise.all(responses)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(await rendererWork(page)).toEqual(afterClose)
    expect(errors).toEqual([])
  } finally { releaseImages(); await Promise.allSettled(responses) }
})
