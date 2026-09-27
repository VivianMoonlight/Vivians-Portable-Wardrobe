import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

function dashboard() {
  const elements = new Map()
  const requests = []
  for (const id of [
    'key-form', 'key', 'connection', 'connected-controls', 'refresh', 'disconnect', 'message',
    'data', 'revision', 'outfits', 'tags', 'size', 'updated', 'search', 'list-note', 'outfit-list', 'export',
  ]) {
    elements.set(`vpw-${id}`, {
      value: '', hidden: id === 'data' || id === 'connected-controls', textContent: '', listeners: {},
      classList: { toggle() {} }, addEventListener(name, listener) { this.listeners[name] = listener },
      replaceChildren() {}, append() {},
    })
  }
  const document = { getElementById: id => elements.get(id), createElement: () => ({ append() {} }) }
  const fetch = () => new Promise(resolve => requests.push(resolve))
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
  vm.runInNewContext(source, { document, fetch, TextEncoder, URL, Blob, setTimeout })
  return { elements, requests }
}

const success = name => ({
  ok: true,
  json: async () => ({ revision: 1, updatedAt: null, index: {
    outfits: { a: { id: 'a', name, tagIds: [] } }, tags: {}, tombstones: { outfits: {}, tags: {} },
  } }),
})

test('disconnect keeps a late cloud response from restoring the dashboard', async () => {
  const { elements, requests } = dashboard()
  elements.get('vpw-key').value = 'vpw1_test'
  elements.get('vpw-key-form').listeners.submit({ preventDefault() {} })
  assert.equal(requests.length, 1)
  elements.get('vpw-disconnect').listeners.click()
  requests[0](success('Old outfit'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(elements.get('vpw-data').hidden, true)
  assert.equal(elements.get('vpw-connection').textContent, '未连接')
  assert.equal(elements.get('vpw-message').textContent, '已断开连接。')
})

test('late response for an old key cannot replace a newer key dashboard', async () => {
  const { elements, requests } = dashboard()
  const connect = value => {
    elements.get('vpw-key').value = value
    elements.get('vpw-key-form').listeners.submit({ preventDefault() {} })
  }
  connect('vpw1_old')
  elements.get('vpw-disconnect').listeners.click()
  connect('vpw1_new')
  requests[1](success('New outfit'))
  await new Promise(resolve => setImmediate(resolve))
  requests[0](success('Old outfit'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(elements.get('vpw-data').hidden, false)
  assert.equal(elements.get('vpw-connection').textContent, '已连接')
  assert.equal(elements.get('vpw-list-note').textContent, '找到 1 件衣物。')
})
