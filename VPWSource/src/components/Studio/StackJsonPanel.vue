<template>
  <div class="json-panel" role="region" aria-label="Stack JSON 面板">
    <div class="panel-header">
      <h4>Stack JSON</h4>
      <div class="header-actions">
        <button @click="toggleFormat" :title="format === 'pretty' ? '显示紧凑' : '显示美化'">
          {{ format === 'pretty' ? '美化' : '紧凑' }}
        </button>
        <button @click="copy" :disabled="!hasData" title="复制到剪贴板">复制</button>
        <button @click="download" :disabled="!hasData" title="下载 JSON">下载</button>
      </div>
    </div>

    <div class="panel-body">
      <div v-if="!hasData" class="placeholder">请选择一个 stack 项以查看 JSON</div>

      <div v-else class="json-content">
        <!-- 使用 pre 显示，便于选择；同时显示类型和名称 -->
        <div class="meta">
          <div class="meta-row"><strong>Name:</strong> {{ selected?.name ?? '(unnamed)' }}</div>
          <div class="meta-row"><strong>Parts:</strong> {{ (selected?.data?.length ?? 0) }}</div>
        </div>

        <pre class="code-block" ref="preRef" v-text="jsonText"></pre>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useStudioStore } from '@/stores/studioStore'

const store = useStudioStore()
const selected = computed(() => store.selectedElement)
const hasData = computed(() => !!selected.value && Array.isArray(selected.value.data))
const format = ref('pretty') // 'pretty' or 'compact'
const preRef = ref(null)

const jsonText = computed(() => {
  if (!hasData.value) return ''
  const payload = selected.value.data
  return format.value === 'pretty' ? JSON.stringify(payload, null, 2) : JSON.stringify(payload)
})

// 切换格式
function toggleFormat() {
  format.value = format.value === 'pretty' ? 'compact' : 'pretty'
}

// 复制到剪贴板
async function copy() {
  if (!hasData.value) return
  try {
    await navigator.clipboard.writeText(jsonText.value)
    // 简单的反馈（可以改为 toast）
    console.info('JSON copied to clipboard')
  } catch (e) {
    // 若 clipboard API 不可用，fallback to selection
    try {
      const pre = preRef.value
      if (pre) {
        const range = document.createRange()
        range.selectNodeContents(pre)
        const sel = window.getSelection()
        sel.removeAllRanges()
        sel.addRange(range)
        document.execCommand('copy')
        sel.removeAllRanges()
      }
    } catch (err) {
      console.warn('Copy failed', err)
    }
  }
}

// 下载 JSON 文件
function download() {
  if (!hasData.value) return
  const blob = new Blob([jsonText.value], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const name = (selected.value?.name ? selected.value.name.replace(/[^\w\-_.]/g, '_') : 'stack') + '.json'
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// 当选中项变化时滚回顶部
watch(selected, () => {
  if (preRef.value) preRef.value.scrollTop = 0
})
</script>

<style scoped>
.json-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-sizing: border-box;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.panel-header h4 { margin: 0; font-size: 15px; color: #21314a; }
.header-actions button {
  margin-left: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid #e6eef6;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}

.panel-body {
  flex: 1;
  overflow: auto;
  padding: 8px;
  border-radius: 8px;
  background: linear-gradient(180deg,#fff,#fbfdff);
  border: 1px solid rgba(220,230,240,0.6);
}

.placeholder {
  color: #7d8795;
  padding: 12px;
  text-align: center;
}

.meta {
  margin-bottom: 8px;
  display:flex;
  gap: 12px;
  flex-wrap:wrap;
}
.meta-row { color:#46536b; font-size:13px; }

.code-block {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Courier New", monospace;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre;
  overflow: auto;
  max-height: calc(100% - 44px);
  padding: 10px;
  border-radius: 8px;
  background: #0f1720;
  color: #dbeafe;
  box-shadow: inset 0 -8px 20px rgba(0,0,0,0.08);
  border: 1px solid rgba(8,12,20,0.25);
}
</style>