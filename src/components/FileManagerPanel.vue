<template>
    <transition name="fade-zoom">
        <div :class="themeClass">
            <div v-if="visible" class="fm-panel-shell" :style="{
                width: panel.w + 'px',
                height: panel.h + 'px',
                left: panel.x + 'px',
                top: panel.y + 'px',
                zIndex: panelZ
            }" role="dialog" :aria-label="t('fileManagerPanel.ariaLabel')" tabindex="0" @mousedown="bringToFront"
                @focus="bringToFront">
                <header class="fm-panel-header" @mousedown.stop.prevent="startDrag">
                    <div class="fm-title">{{ t('fileManagerPanel.title') }}</div>
                    <div class="fm-header-actions">
                        <button class="header-btn"
                            :title="t('fileManagerPanel.importPlayerWardrobe') || 'Import Player Wardrobe'"
                            @click.stop="importPlayerWardrobe">📥
                        </button>
                        <button class="header-btn" :title="t('fileManagerPanel.saveBackup')"
                            @click.stop="saveBackup">💾</button>
                        <button class="header-btn" :title="t('fileManagerPanel.importBackup')"
                            @click.stop="importBackup">📂</button>
                        <button class="header-btn"
                            :title="showHistory ? t('historyViewer.toggleToFileManager') : t('historyViewer.toggleToHistory')"
                            @click.stop="toggleView">{{ showHistory ? '📁' : '🕒' }}</button>
                        <button class="header-btn" :title="t('fileManagerPanel.toggleTheme')"
                            @click.stop="toggleTheme">🌓</button>

                        <!--button class="header-btn" title="保存当前 (active) 到当前文件夹" @click.stop="saveCurrentToFolder">
                        💾 当前到文件夹
                    </button>
                    <button class="header-btn" title="保存 character 到当前文件夹" @click.stop="saveCharacterToFolder">
                        💾 Character到文件夹
                    </button>
                    <button class="header-btn" title="应用当前 activeItem 到目标角色" @click.stop="applyActiveToCharacter">
                        🎭 应用当前
                    </button-->
                        <button class="header-btn" @click="openStudio">🎨</button>
                        <button class="close-btn" @click="requestClose" aria-label="关闭">&times;</button>
                    </div>
                </header>

                <div class="fm-panel-body" :style="{ height: (panel.h - 56) + 'px' }">
                    <aside class="fm-side" aria-hidden="false">
                        <div class="side-preview-wrap" style="height:calc(100% - 40px);">
                            <SidePreview />
                        </div>

                        <!-- 左下角两个美化按钮 -->
                        <div class="fm-side-left-actions" role="group" aria-label="侧栏操作">
                            <button class="left-action-btn save-btn" :title="t('fileManagerPanel.saveCharacter')"
                                @click.stop="saveCharacterToFolder">

                                <span class="la-text">Save</span>
                            </button>
                            <button class="left-action-btn import-btn" :title="t('fileManagerPanel.importBCX')"
                                @click.stop="importBCX">

                                <span class="la-text">Import BCX</span>
                            </button>
                        </div>
                    </aside>
                    <main class="fm-main">
                        <FileManager v-if="!showHistory" :embedded="true" @close="requestClose" />
                        <HistoryViewer v-else :embedded="true" />
                    </main>
                    <aside class="main-right">
                        <FilterManager />
                    </aside>
                </div>

                <div class="resize-handle top" @mousedown.stop.prevent="startResize('top', $event)"></div>
                <div class="resize-handle right" @mousedown.stop.prevent="startResize('right', $event)"></div>
                <div class="resize-handle bottom" @mousedown.stop.prevent="startResize('bottom', $event)"></div>
                <div class="resize-handle left" @mousedown.stop.prevent="startResize('left', $event)"></div>
                <div class="resize-handle corner top-left" @mousedown.stop.prevent="startResize('top-left', $event)">
                </div>
                <div class="resize-handle corner top-right" @mousedown.stop.prevent="startResize('top-right', $event)">
                </div>
                <div class="resize-handle corner bottom-right"
                    @mousedown.stop.prevent="startResize('bottom-right', $event)"></div>
                <div class="resize-handle corner bottom-left"
                    @mousedown.stop.prevent="startResize('bottom-left', $event)">
                </div>
            </div>
        </div>
    </transition>

    <!-- Studio 弹窗 -->
    <Studio :visible="StudioVisible" @close="closeStudio" />
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import LZString from 'lz-string'
import FileManager from '@/components/FileManager.vue'
import HistoryViewer from '@/components/HistoryViewer.vue'
import SidePreview from '@/components/SidePreview.vue'
import FilterManager from '@/components/FilterManager.vue'
import { useFileSystemStore } from '@/stores/fileSystemStore.js'
import Studio from '@/components/Studio/Studio.vue'
import { ExternalAdapter } from '@/utils/external_adapters.js'
import { useStudioStore } from '@/stores/studioStore.js'
import { PlayerHost, hostWindow, doc } from '@/utils/host-window.js'
import { useTheme, injectTheme } from '@/composables/useTheme'
import * as DialogService from '@/services/DialogService.js'

const { t } = useI18n()
const injectedTheme = injectTheme()
const themeClass = computed(() => injectedTheme.themeClass())
const theme = useTheme()
const { initTheme, themeClass: getThemeClass, toggleTheme, currentTheme } = theme

const WINDOW_MARGIN = 12 // 保持与 CSS 中的 margin/间距一致

const props = defineProps({
    visible: { type: Boolean, default: false }
})
const emit = defineEmits(['close'])

const fs = useFileSystemStore()
const studioStore = useStudioStore()

const StudioVisible = ref(false)
async function openStudio() {
    await studioStore.loadAssetData()
    StudioVisible.value = true
}
function closeStudio() {
    StudioVisible.value = false
}

// History toggle state
const showHistory = ref(false)
function toggleView() {
    showHistory.value = !showHistory.value
}

const panel = ref({
    x: null,
    y: null,
    w: 1000,
    h: 640,
    dragging: false,
    resizing: false,
    resizeDir: null,
    pointerStart: { x: 0, y: 0 },
    startRect: { x: 0, y: 0, w: 0, h: 0 }
})

// z-index 管理：默认值与聚焦时的提升值
const panelZ = ref(2200)
const FOCUSED_Z = 10050

function bringToFront() {
    // 提升 z-index 让窗体在最上层
    panelZ.value = FOCUSED_Z
}

function clampToViewport() {
    // 保证面板尺寸和位置不会超出视窗（避免出现横向滚动）
    const maxW = Math.max(320, hostWindow.innerWidth - WINDOW_MARGIN)
    const maxH = Math.max(220, hostWindow.innerHeight - WINDOW_MARGIN)
    panel.value.w = Math.min(panel.value.w, maxW)
    panel.value.h = Math.min(panel.value.h, maxH)

    // 调整 x,y 保持在视窗内
    panel.value.x = Math.max(6, Math.min(panel.value.x, hostWindow.innerWidth - panel.value.w - 6))
    panel.value.y = Math.max(6, Math.min(panel.value.y, hostWindow.innerHeight - panel.value.h - 6))
}

function ensurePanelDefaults() {
    if (panel.value.x === null || panel.value.y === null) {
        panel.value.w = Math.min(1200, Math.round(hostWindow.innerWidth * 0.8))
        panel.value.h = Math.min(1000, Math.round(hostWindow.innerHeight * 0.72))
        // 确保不超过视窗
        panel.value.w = Math.min(panel.value.w, hostWindow.innerWidth - WINDOW_MARGIN)
        panel.value.h = Math.min(panel.value.h, hostWindow.innerHeight - WINDOW_MARGIN)
        panel.value.x = Math.max(12, Math.round((hostWindow.innerWidth - panel.value.w) / 2))
        panel.value.y = Math.max(12, Math.round((hostWindow.innerHeight - panel.value.h) / 2))
    } else {
        clampToViewport()
    }
}

watch(
    () => props.visible,
    async (v) => {
        if (v) {
            await nextTick()
            ensurePanelDefaults()
            // 初始化文件系统（使用当前角色或 Player）
            const target = hostWindow.CurrentCharacter || hostWindow.Player || null
            fs.initialize(target)

            // 当打开时，自动提升 z-index 以确保可视
            panelZ.value = FOCUSED_Z

            // 防止页面出现全局横向滚动条（只在面板打开时生效）
            try {
                prevOverflowX.value = doc.docElement.style.overflowX || ''
                doc.docElement.style.overflowX = 'hidden'
            } catch (e) {
                // ignore
            }
        } else {
            // 恢复 overflowX
            try {
                doc.docElement.style.overflowX = prevOverflowX.value || ''
            } catch (e) {
                // ignore
            }
        }
    }
)

function requestClose() {
    emit('close')
}

/* Drag / Resize logic */
function startDrag(e) {
    if (e.button !== 0) return
    panel.value.dragging = true
    panel.value.pointerStart = { x: e.clientX, y: e.clientY }
    panel.value.startRect = { x: panel.value.x, y: panel.value.y, w: panel.value.w, h: panel.value.h }
    doc.body.style.userSelect = 'none'
}

function startResize(dir, e) {
    if (e.button !== 0) return
    panel.value.resizing = true
    panel.value.resizeDir = dir
    panel.value.pointerStart = { x: e.clientX, y: e.clientY }
    panel.value.startRect = { x: panel.value.x, y: panel.value.y, w: panel.value.w, h: panel.value.h }
    doc.body.style.userSelect = 'none'
}

function onPointerMove(e) {
    if (!props.visible) return
    const dx = e.clientX - panel.value.pointerStart.x
    const dy = e.clientY - panel.value.pointerStart.y

    if (panel.value.dragging) {
        panel.value.x = Math.max(6, Math.min(hostWindow.innerWidth - panel.value.w - 6, panel.value.startRect.x + dx))
        panel.value.y = Math.max(6, Math.min(hostWindow.innerHeight - panel.value.h - 6, panel.value.startRect.y + dy))
    } else if (panel.value.resizing) {
        const dir = panel.value.resizeDir || ''
        let nx = panel.value.startRect.x
        let ny = panel.value.startRect.y
        let nw = panel.value.startRect.w
        let nh = panel.value.startRect.h

        if (dir.includes('left')) {
            nw = Math.max(320, panel.value.startRect.w - dx)
            nx = panel.value.startRect.x + (panel.value.startRect.w - nw)
        }
        if (dir.includes('right')) {
            nw = Math.max(320, panel.value.startRect.w + dx)
        }
        if (dir.includes('top')) {
            nh = Math.max(220, panel.value.startRect.h - dy)
            ny = panel.value.startRect.y + (panel.value.startRect.h - nh)
        }
        if (dir.includes('bottom')) {
            nh = Math.max(220, panel.value.startRect.h + dy)
        }

        // 限制到窗口范围，防止拉大导致横向溢出
        nx = Math.max(6, Math.min(nx, hostWindow.innerWidth - 64))
        ny = Math.max(6, Math.min(ny, hostWindow.innerHeight - 64))
        nw = Math.min(nw, hostWindow.innerWidth - nx - 6)
        nh = Math.min(nh, hostWindow.innerHeight - ny - 6)

        panel.value.x = nx
        panel.value.y = ny
        panel.value.w = nw
        panel.value.h = nh
    }
}

function onPointerUp() {
    if (panel.value.dragging || panel.value.resizing) {
        panel.value.dragging = false
        panel.value.resizing = false
        panel.value.resizeDir = null
        doc.body.style.userSelect = ''
    }
}

function _defaultFilename(prefix) {
    const t = new Date().toISOString().replace(/[:.]/g, '-')
    return `${prefix}_${t}`
}

/* ------------------- 修正后的：备份 / 导入 / BCX（基于提供的 FileSystem 与 Pinia store） ------------------- */

/**
 * 把解析后的数据应用到 pinia store / 内部 FileSystem。
 * 这个实现参考了 src/stores/fileSystemStore.js 与 src/services/FileSystem.js 的接口。
 */
async function applyImportedData(parsed) {
    if (!parsed) {
        await DialogService.alert('导入的数据为空')
        return
    }

    try {
        // 1) 完整备份（FileSystem 根节点对象： type==='folder' && children）
        const isFsRoot = parsed && parsed.type === 'folder' && Array.isArray(parsed.children)
        if (isFsRoot) {
            // 合并到当前 fs.root：使用 fromMultipleJSON 将现有和新备份合并
            try {
                const existing = fs.fs.toJSON()
                fs.fs.fromMultipleJSON([existing, parsed])
                fs.saveAll()
                await DialogService.alert('备份已导入并合并到现有文件系统')
                return
            } catch (e) {
                console.warn('merge root fallback', e)
                // fallback: 替换整个文件树
                try {
                    fs.fs.fromJSON(parsed)
                    fs.saveAll()
                    await DialogService.alert('已用导入备份替换当前文件系统')
                    return
                } catch (e2) {
                    console.error('replace root failed', e2)
                    await DialogService.alert('应用备份失败，请查看控制台')
                    return
                }
            }
        }

        // 2) 单个文件对象（含 type && data） -> 添加到当前路径
        if (parsed.type && parsed.data) {
            try {
                // store 提供 addFile(file) 方法（会将文件添加到 currentPath 并保存）
                await fs.addFile(parsed)
                await DialogService.alert('已将导入项添加为文件到当前文件夹')
                return
            } catch (e) {
                console.warn('fs.addFile failed, attempting direct merge', e)
                // fallback: 尝试把它直接合并到 fs.root.children
                try {
                    fs.fs.root.children.push(parsed)
                    fs.saveAll()
                    await DialogService.alert('已将导入项直接添加到根目录（fallback）')
                    return
                } catch (e2) {
                    console.error('fallback add file failed', e2)
                }
            }
        }

        // 3) 数组 -> 视作 outfit 数据，提示文件名并作为文件添加
        if (Array.isArray(parsed)) {
            const defaultName = _defaultFilename('imported')
            const name = await DialogService.prompt('请输入导入文件名：', defaultName)
            if (!name) {
                await DialogService.alert('已取消导入')
                return
            }
            const file = { name, type: 'outfit', data: parsed }
            if (typeof fs.addFile === 'function') {
                await fs.addFile(file)
                await DialogService.alert('数组数据已作为文件导入到当前文件夹')
                return
            } else {
                // fallback: push into root
                fs.fs.root.children.push(file)
                fs.saveAll()
                await DialogService.alert('数组数据已作为文件导入（fallback）')
                return
            }
        }

        // 4) 试图作为整个 store/state 导入（如果包含 fs 字段）
        if (parsed.fs && typeof parsed.fs === 'object') {
            // 如果 parsed.fs 是 FileSystem 可序列化结构
            try {
                fs.fs.fromMultipleJSON([fs.fs.toJSON(), parsed.fs])
                fs.saveAll()
                await DialogService.alert('已从导入数据恢复文件系统（从 parsed.fs）')
                return
            } catch (e) {
                console.error('apply parsed.fs failed', e)
            }
        }

        // 回退：无法识别的结构
        await DialogService.alert('导入完成，但未能识别数据结构以自动应用，请检查 JSON 内容。')
    } catch (e) {
        console.error('applyImportedData failed', e)
        await DialogService.alert('导入失败，请查看控制台')
    }
}

/**
 * 保存当前文件系统为本地 JSON 文件（备份）
 * 使用 store 内部的 FileSystem.toJSON() 以获得剥离缩略图的纯结构
 */
function saveBackup() {
    try {
        const jsonObj = fs.fs.toJSON()
        const jsonStr = JSON.stringify(jsonObj, null, 2)
        const blob = new Blob([jsonStr], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = doc.createElement('a')
        a.href = url
        a.download = _defaultFilename('fm-backup') + '.json'
        doc.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        DialogService.alert('备份已生成并触发下载')
    } catch (e) {
        console.error('saveBackup failed', e)
        DialogService.alert('保存备份失败，请查看控制台')
    }
}

/**
 * 从本地 JSON 文件导入备份
 */
function importBackup() {
    const input = doc.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.style.display = 'none'
    input.addEventListener('change', async (ev) => {
        const file = ev.target.files && ev.target.files[0]
        if (!file) {
            await DialogService.alert('未选择文件')
            input.remove()
            return
        }
        try {
            const text = await file.text()
            const parsed = JSON.parse(text)
            await applyImportedData(parsed)
        } catch (e) {
            console.error('importBackup failed', e)
            await DialogService.alert('解析备份文件失败，请确认是合法 JSON')
        } finally {
            input.remove()
        }
    })
    doc.body.appendChild(input)
    input.click()
}

/**
 * 从 BCX 文本导入（用户粘贴 code）
 * BCX 解码规则： code => JSON.parse(LZString.decompressFromBase64(code.trim()));
 */
async function importBCX() {
    const code = await DialogService.prompt('请粘贴 BCX code（base64 + LZString 压缩）：')
    if (!code) return
    try {
        const trimmed = code.trim()
        const decompressed = LZString.decompressFromBase64(trimmed)
        if (decompressed === null) {
            throw new Error('LZString 解压返回 null（可能不是有效的 BCX）')
        }
        const parsed = JSON.parse(decompressed)
        await applyImportedData(parsed)
    } catch (e) {
        console.error('importBCX failed', e)
        await DialogService.alert('BCX 解码或解析失败，请检查输入（打开控制台查看详细错误）')
    }
}

/* ------------------- 现有功能（保持不变） ------------------- */

async function saveCurrentToFolder() {
    if (!fs.activeItem || !fs.activeItem.data || !Array.isArray(fs.activeItem.data)) {
        await DialogService.alert('当前没有可保存的 active 数据')
        return
    }
    const defaultName = _defaultFilename('current')
    const name = await DialogService.prompt('保存当前 active 到当前文件夹，文件名：', defaultName)
    if (!name) return
    const file = {
        name: name,
        type: 'outfit',
        data: JSON.parse(JSON.stringify(fs.activeItem.data))
    }
    try {
        fs.addFile(file)
        await DialogService.alert(`已保存 "${name}" 到当前文件夹`)
    } catch (e) {
        console.error('saveCurrentToFolder failed', e)
        await DialogService.alert('保存失败，请查看控制台')
    }
}

async function saveCharacterToFolder() {
    if (!fs.characterItem || !Array.isArray(fs.characterItem)) {
        await DialogService.alert('当前没有 character 数据可以保存')
        return
    }
    const defaultName = _defaultFilename('character')
    const name = await DialogService.prompt('保存 character 到当前文件夹，文件名：', defaultName)
    if (!name) return
    const file = {
        name: name,
        type: 'character',
        data: JSON.parse(JSON.stringify(fs.characterItem))
    }
    try {
        fs.addFile(file)
        ExternalAdapter.sendRetriveOutfitNotification(toRaw(fs.character))
        await DialogService.alert(`已保存 "${name}" 到当前文件夹`)
    } catch (e) {
        console.error('saveCharacterToFolder failed', e)
        await DialogService.alert('保存失败，请查看控制台')
    }
}

async function applyActiveToCharacter() {
    const preview = fs.previewItem
    if (!preview || !preview.data || !Array.isArray(preview.data) || preview.data.length === 0) {
        await DialogService.alert('当前 active 数据为空，未应用')
        return
    }
    const target = fs.character || hostWindow.CurrentCharacter || hostWindow.Player
    if (!target) {
        await DialogService.alert('未找到目标角色')
        return
    }
    try {
        // 使用外部适配器将预览数据应用到角色
        ExternalAdapter.applyOutfitToCharacter(toRaw(fs.character), toRaw(preview.data))
        await DialogService.alert('已应用当前active数据到目标角色')
    } catch (e) {
        console.error('applyActiveToCharacter失败', e)
        await DialogService.alert('应用失败，请查看控制台')
    }
}

/**
 * Import outfits from Player.Wardrobe into a new folder
 */
async function importPlayerWardrobe() {
    try {
        // Check if Player data exists
        if (!hostWindow.Player || !hostWindow.Player.Wardrobe || !hostWindow.Player.WardrobeCharacterNames) {
            await DialogService.alert('Player Wardrobe data not available')
            return
        }

        const wardrobeData = hostWindow.Player.Wardrobe
        const wardrobeNames = hostWindow.Player.WardrobeCharacterNames

        // Create folder with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const folderName = `Player_Wardrobe_${timestamp}`

        // Create folder in current directory
        fs.fs.addFolder(fs.currentPath, folderName)

        // Navigate into the new folder
        const newPath = [...fs.currentPath, folderName]
        fs.moveTo(newPath)

        // Import each outfit
        let importCount = 0
        for (let i = 0; i < wardrobeData.length; i++) {
            const outfitData = wardrobeData[i]
            if (outfitData === null || outfitData === undefined) {
                continue // Skip null entries
            }

            // Validate that outfit data is a non-empty array
            if (Array.isArray(outfitData) && outfitData.length > 0) {
                const outfitName = (wardrobeNames[i] && wardrobeNames[i].trim()) || `Outfit_${i}`
                const file = {
                    name: outfitName,
                    type: 'outfit',
                    data: JSON.parse(JSON.stringify(outfitData))
                }
                fs.addFile(file)
                importCount++
            }
        }

        await DialogService.alert(`Successfully imported ${importCount} outfits into "${folderName}"`)
    } catch (e) {
        console.error('importPlayerWardrobe failed', e)
        await DialogService.alert('Failed to import Player Wardrobe. Check console for details.')
    }
}

function escHandler(e) {
    if (e.key === 'Escape') requestClose()
}

const prevOverflowX = ref('')

onMounted(() => {
    hostWindow.addEventListener('mousemove', onPointerMove)
    hostWindow.addEventListener('mouseup', onPointerUp)
    hostWindow.addEventListener('keydown', escHandler)
    hostWindow.addEventListener('resize', onWindowResize)
    // 当组件挂载时确保 panel 不超出（处理首次渲染时）
    ensurePanelDefaults()
})

onBeforeUnmount(() => {
    hostWindow.removeEventListener('mousemove', onPointerMove)
    hostWindow.removeEventListener('mouseup', onPointerUp)
    hostWindow.removeEventListener('keydown', escHandler)
    hostWindow.removeEventListener('resize', onWindowResize)
    // 恢复 overflowX（以防万一）
    try {
        doc.docElement.style.overflowX = prevOverflowX.value || ''
    } catch (e) {
        // ignore
    }
})

function onWindowResize() {
    if (!props.visible) {
        // 仍然要限制 panel 尺寸，即使不可见也防止未来显示时超出
        clampToViewport()
        return
    }
    // 在窗口变化时调整面板大小和位置，避免溢出与出现横向滚动
    const maxW = Math.max(320, hostWindow.innerWidth - WINDOW_MARGIN)
    const maxH = Math.max(220, hostWindow.innerHeight - WINDOW_MARGIN)

    // 如果当前宽度超出最大宽度，则缩小并保持居中或保持 x 在视窗内
    if (panel.value.w > maxW) {
        panel.value.w = maxW
    }
    if (panel.value.h > maxH) {
        panel.value.h = maxH
    }
    panel.value.x = Math.max(6, Math.min(panel.value.x, hostWindow.innerWidth - panel.value.w - 6))
    panel.value.y = Math.max(6, Math.min(panel.value.y, hostWindow.innerHeight - panel.value.h - 6))
}
</script>

<style scoped>
/* 防止面板导致页面横向滚动：在面板打开时我们会设置 doc.docElement.style.overflowX = 'hidden' */
/* 面板本身限制最大宽高以确保在缩放时不会溢出 */
.fm-panel-shell {
    position: fixed;
    /* z-index 移到内联样式绑定 (panelZ) */
    background: var(--color-bg-base, #ffffff);
    border-radius: var(--radius-xl, 12px);
    box-shadow: var(--shadow-2xl, 0 18px 60px rgba(10, 20, 40, 0.14));
    border: 1px solid var(--color-border-base, rgba(200, 210, 230, 0.6));
    overflow: visible;
    display: flex;
    flex-direction: column;
    user-select: none;
    transition: box-shadow var(--transition-base, 0.18s) ease, transform 0s;

    /* 始终限制最大尺寸到视窗（考虑 margin） */
    max-width: calc(100vw - 24px);
    max-height: calc(100vh - 24px);
    box-sizing: border-box;
}

/* 当获得聚焦时（z-index 已由 script 提升），添加更明显的阴影 */
.fm-panel-shell:focus {
    outline: none;
    box-shadow: 0 28px 80px rgba(10, 20, 40, 0.22);
}

/* header */
.fm-panel-header {
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-sm, 8px) var(--space-md, 12px);
    border-bottom: 1px solid var(--color-border-base, rgba(220, 230, 240, 0.6));
    background: var(--color-bg-base, rgba(255, 255, 255, 0.95));
    cursor: move;
    border-top-left-radius: var(--radius-xl, 12px);
    border-top-right-radius: var(--radius-xl, 12px);
}

.fm-title {
    font-size: var(--font-size-xl, 17px);
    font-weight: var(--font-weight-bold, 700);
    color: var(--color-text-primary, #23324a);
    margin-left: var(--space-sm, 8px);
}

.fm-header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-sm, 8px);
    margin-right: var(--space-sm, 6px);
}

.header-btn {
    background: transparent;
    border: 1px solid var(--color-border-base, rgba(200, 210, 230, 0.6));
    padding: var(--space-sm, 6px) 10px;
    border-radius: var(--radius-md, 8px);
    color: var(--color-text-primary, #23324a);
    cursor: pointer;
    transition: all var(--transition-fast, 0.15s) ease;
}

.header-btn:hover {
    background: var(--color-bg-hover, #f1f5f9);
    border-color: var(--color-border-strong, #cbd5e1);
}

/* close 按钮 */
.close-btn {
    background: var(--color-bg-base, #fff);
    border: 1px solid var(--color-border-base, rgba(200, 210, 230, 0.7));
    padding: var(--space-sm, 6px) 10px;
    font-size: var(--font-size-xl, 18px);
    border-radius: var(--radius-md, 8px);
    color: var(--color-text-primary, #23324a);
    cursor: pointer;
    transition: all var(--transition-fast, 0.15s) ease;
}

.close-btn:hover {
    background: var(--color-error-bg, #fee2e2);
    border-color: var(--color-error, #ef4444);
}

/* body layout */
.fm-panel-body {
    display: flex;
    gap: var(--space-md, 12px);
    padding: var(--space-md, 12px);
    box-sizing: border-box;
    align-items: stretch;
    width: 100%;

    /* 防止 body 本身产生横向滚动；内部区域（fm-main）可以垂直滚动 */
    overflow-x: hidden;
    overflow-y: hidden;
    min-height: 0;
    /* allow children to shrink for proper overflow handling */
}

/* left side preview area */
/* 使用灵活的宽度，同时保留一个合适的最小值，避免在小屏幕时撑出横向滚动 */
.fm-side {
    flex: 0 0 300px;
    /* 默认固定 300px 宽度 */
    max-width: 40%;
    min-width: 220px;
    height: auto;
    background: linear-gradient(180deg, var(--color-bg-base), var(--color-bg-surface));
    border-radius: 8px;
    padding: 0px;
    box-sizing: border-box;
    border: 1px solid var(--color-border-base);
    overflow: hidden;
    position: relative;
}

/* 将侧栏原先的 bottom actions 隐藏（我们使用新的美化按钮） */
.fm-side .fm-header-actions {
    display: none;
}

/* 美化：左下角动作按钮组 */
.fm-side-left-actions {
    position: relative;
    left: 12px;
    display: flex;
    flex-direction: row;
    gap: 8px;
    z-index: 10;
}

/* 通用样式 */
.left-action-btn {
    width: 45%;
    height: 36px;
    padding: 0;
    border-radius: 8px;
    border: 1px solid var(--color-border-base, rgba(200, 210, 230, 0.7));
    background: var(--color-bg-base, #ffffff);
    color: var(--color-text-primary, #23324a);
    cursor: pointer;
    font-size: 15px;
    /* increased button text size */
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
}


/* icon 和文字样式 */
.left-action-btn .la-icon {
    font-size: 16px;
    line-height: 1;
    display: inline-block;
    width: 20px;
    text-align: center;
    filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.06));
}

.left-action-btn .la-text {
    font-size: 14px;
    color: var(--color-text-primary);
}

/* hover / active */
.left-action-btn:hover {
    box-shadow: 0 1px 3px rgba(15, 42, 68, 0.12);
    opacity: 1;
}

.left-action-btn:active {
    transform: translateY(-2px) scale(0.995);
}

/* main content area where FileManager sits */
.fm-main {
    flex: 0.7 0.7 480px;
    min-width: 240px;
    height: 100%;
    background: transparent;
    border-radius: 8px;
    overflow-y: auto;
    /* 允许纵向滚动，但禁止横向滚动 */
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    box-sizing: border-box;
}

/* right aside */
.main-right {
    flex: 0.3 0.3 320px;
    min-width: 240px;
    max-width: 32%;
    box-sizing: border-box;
    overflow-y: auto;
    overflow-x: hidden;
}

/* resize handles: thin edges + corner squares */
.resize-handle {
    position: absolute;
    z-index: 2220;
    background: transparent;
}

/* edge handles (thin grab strips) */
.resize-handle.top {
    left: 8px;
    right: 8px;
    top: -6px;
    height: 12px;
    cursor: ns-resize;
}

.resize-handle.bottom {
    left: 8px;
    right: 8px;
    bottom: -6px;
    height: 12px;
    cursor: ns-resize;
}

.resize-handle.left {
    top: 8px;
    bottom: 8px;
    left: -6px;
    width: 12px;
    cursor: ew-resize;
}

.resize-handle.right {
    top: 8px;
    bottom: 8px;
    right: -6px;
    width: 12px;
    cursor: ew-resize;
}

/* corner handles (small visible squares) */
.resize-handle.corner {
    width: 14px;
    height: 14px;
    background: rgba(20, 30, 60, 0.06);
    border-radius: 3px;
}

.resize-handle.corner.top-left {
    left: -8px;
    top: -8px;
    cursor: nwse-resize;
}

.resize-handle.corner.top-right {
    right: -8px;
    top: -8px;
    cursor: nesw-resize;
}

.resize-handle.corner.bottom-right {
    right: -8px;
    bottom: -8px;
    cursor: nwse-resize;
}

.resize-handle.corner.bottom-left {
    left: -8px;
    bottom: -8px;
    cursor: nesw-resize;
}

/* subtle appear effect for the handles on hover of panel */
.fm-panel-shell:hover .resize-handle.corner {
    background: rgba(20, 30, 60, 0.09);
}

/* transition */
.fade-zoom-enter-active,
.fade-zoom-leave-active {
    transition: opacity .18s, transform .18s;
}

.fade-zoom-enter-from,
.fade-zoom-leave-to {
    opacity: 0;
    transform: scale(.98);
}

.fade-zoom-enter-to,
.fade-zoom-leave-from {
    opacity: 1;
    transform: scale(1);
}

/* responsive adjustments */
@media (max-width: 900px) {
    .fm-panel-shell {
        width: 94vw !important;
        height: 84vh !important;
        left: 3vw !important;
        top: 6vh !important;
        max-width: calc(100vw - 24px);
        max-height: calc(100vh - 24px);
    }

    .fm-side {
        width: 100%;
        max-width: none;
        min-width: 0;
        object-fit: contain;
        overflow: auto;
        flex: 0 0 auto;
    }

    .fm-panel-body {
        flex-direction: column;
        gap: 8px;
        padding: 10px;
        overflow-x: hidden;
    }

    .fm-side-left-actions {
        left: 10px;
        bottom: 10px;
        flex-direction: row;
    }

    .main-right {
        width: 100%;
        max-width: none;
        flex: 0 0 auto;
    }

    .fm-main {
        min-width: 0;
    }
}
</style>