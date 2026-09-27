import { readFile } from 'node:fs/promises'
import LZString from 'lz-string'
import { test, expect } from '@playwright/test'

const key = 'VPWardrobe_VPWardrobe_history_12345'

function historyTree(name) {
  return {
    name: 'History', type: 'folder', children: [{
      name: 'Record_2026-09-01T00:00:00.000Z', type: 'outfit',
      data: [{ Group: 'Cloth', Name: name, Color: ['Default'] }],
    }],
  }
}

async function readHistoryState(page) {
  return page.evaluate(async key => {
    const storeUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(url => new URL(url).pathname.endsWith('/src/stores/fileSystemStore.js'))
    const { useFileSystemStore } = await import(storeUrl)
    const store = useFileSystemStore.getState()
    await store._historySession.readyPromise
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('VPWardrobeLocalHistory', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const { stored, archives } = await new Promise((resolve, reject) => {
      const transaction = database.transaction('history', 'readonly')
      const request = transaction.objectStore('history').get('12345')
      const archivedRequest = transaction.objectStore('history').get('legacyCopies:12345')
      transaction.oncomplete = () => resolve({ stored: request.result, archives: archivedRequest.result || [] })
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
    return {
      status: store.historyStorageStatus,
      current: store.getHistoryRecords().map(record => record.data[0].Name),
      stored: stored?.children?.map(record => record.data[0].Name),
      archived: archives.map(copy => copy.raw),
      legacy: localStorage.getItem(key),
      blockedWrites: window.__blockedHistoryWrites || 0,
    }
  }, key)
}

test('legacy history migrates to IndexedDB despite localStorage history write rejection', async ({ page }) => {
  const storageErrors = []
  const historyWarnings = []
  page.on('console', message => {
    if (message.text().includes('[StorageAdapter] saveLocal failed')) storageErrors.push(message.text())
    if (message.text().includes('[VPW] History storage unavailable')) historyWarnings.push(message.text())
  })
  await page.goto('/')
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  const legacy = LZString.compressToBase64(JSON.stringify(historyTree('legacy-shirt')))
  await page.evaluate(({ key, legacy }) => localStorage.setItem(key, legacy), { key, legacy })
  await page.addInitScript(key => {
    const original = Storage.prototype.setItem
    window.__blockedHistoryWrites = 0
    Storage.prototype.setItem = function (storageKey, value) {
      if (storageKey === key) {
        window.__blockedHistoryWrites++
        throw new DOMException('History key quota exceeded', 'QuotaExceededError')
      }
      return original.call(this, storageKey, value)
    }
  }, key)

  await page.reload()
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  const initialState = await readHistoryState(page)
  expect(initialState, historyWarnings.join('\n')).toMatchObject({
    status: 'ready', current: ['legacy-shirt'], stored: ['legacy-shirt'], legacy: null, blockedWrites: 0,
  })

  await page.evaluate(async () => {
    const storeUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(url => new URL(url).pathname.endsWith('/src/stores/fileSystemStore.js'))
    const { useFileSystemStore } = await import(storeUrl)
    const store = useFileSystemStore.getState()
    store.history.filter = ['Cloth']
    store.addToHistory([{ Group: 'Cloth', Name: 'new-shirt', Color: ['Default'] }])
    await store._historySession.writePromise
  })
  expect(await readHistoryState(page)).toMatchObject({
    status: 'ready', current: ['new-shirt', 'legacy-shirt'],
    stored: ['new-shirt', 'legacy-shirt'], legacy: null, blockedWrites: 0,
  })
  expect(storageErrors).toEqual([])
})

test('different legacy and IndexedDB history copies are both preserved', async ({ page }) => {
  await page.goto('/')
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  const oldCopy = LZString.compressToBase64(JSON.stringify(historyTree('legacy-shirt')))
  await page.evaluate(async ({ key, oldCopy, newer }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('VPWardrobeLocalHistory', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('history', 'readwrite')
      transaction.objectStore('history').put(newer, '12345')
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
    localStorage.setItem(key, oldCopy)
  }, { key, oldCopy, newer: historyTree('database-shirt') })

  await page.reload()
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  expect(await readHistoryState(page)).toMatchObject({
    status: 'archived', current: ['database-shirt'], stored: ['database-shirt'],
    archived: [oldCopy], legacy: null,
  })

  await page.getByRole('tab', { name: 'History' }).click()
  await expect(page.getByText('Older history copy preserved')).toBeVisible()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export history' }).click(),
  ])
  const backup = JSON.parse(await readFile(await download.path(), 'utf8'))
  expect(backup.current.children[0].data[0].Name).toBe('database-shirt')
  expect(backup.archivedLegacyCopies[0].raw).toBe(oldCopy)
  expect(backup.archivedLegacyCopies[0].data.children[0].data[0].Name).toBe('legacy-shirt')

  await page.reload()
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  expect(await readHistoryState(page)).toMatchObject({
    status: 'archived', current: ['database-shirt'], stored: ['database-shirt'],
    archived: [oldCopy], legacy: null,
  })
})

test('0.10.1-react.9 UTF-16 history migrates without losing records', async ({ page }) => {
  await page.goto('/')
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  const legacy = '~VPWH1:' + LZString.compressToUTF16(JSON.stringify(historyTree('utf16-shirt')))
  await page.evaluate(({ key, legacy }) => localStorage.setItem(key, legacy), { key, legacy })

  await page.reload()
  await page.getByTitle("Vivian's Portable Wardrobe", { exact: true }).click()
  expect(await readHistoryState(page)).toMatchObject({
    status: 'ready', current: ['utf16-shirt'], stored: ['utf16-shirt'], legacy: null,
  })
})
