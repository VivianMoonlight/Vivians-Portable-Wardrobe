const elements = Object.fromEntries([
  'key-form', 'key', 'connection', 'connected-controls', 'refresh', 'disconnect', 'message',
  'data', 'revision', 'outfits', 'tags', 'size', 'updated', 'search', 'list-note', 'outfit-list', 'export',
].map(id => [id, document.getElementById(`vpw-${id}`)]))

let key = ''
let documentData = null
let requestGeneration = 0

function message(text) {
  elements.message.textContent = text
}

function showConnection(connected) {
  elements.connection.textContent = connected ? '已连接' : '未连接'
  elements.connection.classList.toggle('vpw-badge-connected', connected)
  elements['connected-controls'].hidden = !connected
  elements.data.hidden = !connected
  elements['key-form'].hidden = connected
}

function currentOutfits() {
  const index = documentData?.index
  if (!index) return []
  const deleted = index.tombstones?.outfits || {}
  return Object.values(index.outfits || {}).filter(outfit => !Object.hasOwn(deleted, outfit.id))
}

function renderList() {
  const index = documentData?.index
  const term = elements.search.value.normalize('NFKC').trim().toLocaleLowerCase()
  const tags = index?.tags || {}
  const found = currentOutfits().filter(outfit => {
    const names = (outfit.tagIds || []).map(id => tags[id]?.name || '').join(' ')
    return `${outfit.name} ${names}`.normalize('NFKC').toLocaleLowerCase().includes(term)
  })
  elements['outfit-list'].replaceChildren()
  for (const outfit of found.slice(0, 100)) {
    const item = document.createElement('li')
    const title = document.createElement('strong')
    title.textContent = outfit.name || '未命名衣物'
    const tagLine = document.createElement('span')
    tagLine.textContent = (outfit.tagIds || []).map(id => tags[id]?.name).filter(Boolean).join(' · ') || '无标签'
    item.append(title, tagLine)
    elements['outfit-list'].append(item)
  }
  elements['list-note'].textContent = found.length === 0
    ? (term ? '没有找到匹配的衣物。' : '这把密钥下还没有云端衣物。如果你原本有数据，请检查恢复密钥。')
    : `找到 ${found.length} 件衣物${found.length > 100 ? '，当前显示前 100 件' : ''}。`
}

function renderData() {
  const { revision, index, updatedAt } = documentData
  const deletedTags = index?.tombstones?.tags || {}
  elements.revision.textContent = String(revision)
  elements.outfits.textContent = String(currentOutfits().length)
  elements.tags.textContent = String(Object.values(index?.tags || {})
    .filter(tag => !Object.hasOwn(deletedTags, tag.id)).length)
  const bytes = index ? new TextEncoder().encode(JSON.stringify(index)).byteLength : 0
  elements.size.textContent = `${(bytes / 1024).toFixed(1)} KiB`
  elements.updated.textContent = updatedAt ? `最近写入：${new Date(updatedAt).toLocaleString()}` : '云端尚无衣柜数据。'
  renderList()
}

async function refresh() {
  const generation = ++requestGeneration
  const requestedKey = key
  message('正在读取云端衣柜…')
  try {
    const response = await fetch('/api/wardrobe', {
      headers: { Authorization: `Bearer ${requestedKey}` },
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
    })
    const result = await response.json()
    if (generation !== requestGeneration) return
    if (!response.ok) throw new Error(result.error === 'invalid-key'
      ? '恢复密钥格式不正确。请从插件设置中完整复制。'
      : '读取失败，请稍后重试。')
    documentData = result
    showConnection(true)
    renderData()
    message('云端数据已更新。')
  } catch (error) {
    if (generation !== requestGeneration) return
    if (!documentData) showConnection(false)
    message(error.message)
  }
}

elements['key-form'].addEventListener('submit', event => {
  event.preventDefault()
  key = elements.key.value.trim()
  elements.key.value = ''
  refresh()
})

elements.refresh.addEventListener('click', refresh)
elements.disconnect.addEventListener('click', () => {
  requestGeneration++
  key = ''
  documentData = null
  elements.search.value = ''
  showConnection(false)
  message('已断开连接。')
})
elements.search.addEventListener('input', renderList)
elements.export.addEventListener('click', () => {
  if (!documentData) return
  const blob = new Blob([JSON.stringify(documentData, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `vpw-cloud-backup-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  message('JSON 备份已开始下载。')
})
