<template>
    <div class="layer-manager-panel" role="region" :aria-label="t('layerManager.ariaLabel') || t('layerManager.title')">
        <!-- Header (Simple Title) -->
        <div class="lm-header">
            <div class="lm-title">
                <span class="icon">≡</span> {{ t('layerManager.title') || 'Layer Order' }}
            </div>
        </div>

        <p class="sr-only" aria-live="polite">{{ liveMessage }}</p>

        <!-- List Area -->
        <div class="lm-body custom-scroll" ref="listBodyRef">
            <div v-if="displayList.length === 0" class="empty-tip">
                {{ emptyTip }}
            </div>

            <div v-else class="layer-list" role="listbox" :aria-label="t('layerManager.listAriaLabel')">
                <div v-for="item in displayList" :key="item.uniqueId" class="layer-item" :class="{
                    'is-group': item.isGroup,
                    'is-locked': item.locked,
                    'active': isPartActive(item.partUid),
                    'is-focused': isFocusedItem(item),
                    'drag-over-top': dropTarget === item.uniqueId && dropPosition === 'top',
                    'drag-over-bottom': dropTarget === item.uniqueId && dropPosition === 'bottom',
                    'drag-over-middle': dropTarget === item.uniqueId && dropPosition === 'middle'
                }" :id="`lm-item-${item.uniqueId}`" :data-lm-id="item.uniqueId" :tabindex="getTabIndex(item)"
                    :aria-selected="isFocusedItem(item) ? 'true' : 'false'" :aria-disabled="item.locked ? 'true' : 'false'"
                    :aria-grabbed="draggedItem && draggedItem.uniqueId === item.uniqueId ? 'true' : 'false'"
                    :title="item.locked ? t('layerManager.lockedReason') : (item.isGroup ? t('layerManager.groupHint', { count: item.children.length }) : t('layerManager.dragHint'))"
                    :draggable="!item.locked" @dragstart="onDragStart($event, item)"
                    @dragover.prevent="onDragOver($event, item)" @dragleave="onDragLeave($event, item)"
                    @drop="onDrop($event, item)" @dragend="onDragEnd" @focus="onItemFocus(item)"
                    @keydown.stop="onItemKeydown($event, item)" @click="handleItemClick(item)">
                    <!-- Color Strip -->
                    <div class="color-strip" :style="{ background: item.color }"></div>

                    <!-- Content -->
                    <div class="item-content">
                        <div class="drag-handle" :class="{ 'is-hidden': item.locked }" aria-hidden="true">⋮⋮</div>

                        <!-- Icon: Lock or Fold state -->
                        <div class="item-icon" @click.stop="toggleGroup(item)">
                            <span v-if="item.locked">🔒</span>
                            <span v-else-if="item.isGroup" class="fold-icon">
                                {{ isGroupExpanded(item) ? '▾' : '▸' }}
                            </span>
                            <span v-else>●</span>
                        </div>

                        <!-- Text Info -->
                        <div class="item-info">
                            <div class="item-primary">
                                <span class="part-name">{{ item.partName }}</span>
                                <span v-if="!item.isGroup" class="layer-suffix"> - {{ item.layerName }}</span>
                                <span v-else class="group-badge">{{ item.children.length }} {{ t('layerManager.layersBadge') }}</span>
                            </div>
                            <div class="item-meta">
                                {{ t('priorityArrangement.priority') }} {{ item.priority }}
                            </div>
                        </div>
                    </div>

                    <!-- Sub-list (Only if group and expanded) -->
                    <div v-if="item.isGroup && isGroupExpanded(item)" class="sub-list-container">
                        <div v-for="child in item.children" :key="child.uniqueId" class="sub-item" :id="`lm-item-${child.uniqueId}`"
                            :data-lm-id="child.uniqueId" :tabindex="getTabIndex(child)" :class="{
                                'is-focused': isFocusedItem(child),
                            'drag-over-top': dropTarget === child.uniqueId && dropPosition === 'top',
                            'drag-over-bottom': dropTarget === child.uniqueId && dropPosition === 'bottom',
                            'drag-over-middle': dropTarget === child.uniqueId && dropPosition === 'middle'
                        }" :aria-selected="isFocusedItem(child) ? 'true' : 'false'"
                            :aria-grabbed="draggedItem && draggedItem.uniqueId === child.uniqueId ? 'true' : 'false'"
                            :title="t('layerManager.dragHint')" draggable="true"
                            @dragstart.stop="onDragStart($event, child)" @focus="onItemFocus(child)"
                            @dragover.prevent.stop="onDragOver($event, child)"
                            @dragleave.stop="onDragLeave($event, child)" @drop.stop="onDrop($event, child)"
                            @dragend.stop="onDragEnd" @keydown.stop="onItemKeydown($event, child)"
                            @click.stop="handleItemClick(child)">
                            <span class="sub-drag-handle" aria-hidden="true">⋮⋮</span>
                            <span class="sub-color-dot" :style="{ background: item.color }"></span>
                            <span class="sub-name">{{ child.layerName }}</span>
                            <span class="sub-prio">{{ child.priority }}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStudioStore } from '@/stores/studioStore'
import { isHiddenGroup } from '@/config/filterGroupConfig'
import { throttle } from '@/utils/performance.js'
import { showUndoToast } from '@/services/DialogService.js'

const { t } = useI18n()
const store = useStudioStore()

// --- Refs ---
const listBodyRef = ref(null)

// --- Drag State ---
const dropTarget = ref(null) // uniqueId
const dropPosition = ref(null) // 'top' | 'middle' | 'bottom'
const draggedItem = ref(null)
const focusedItemId = ref(null)
const liveMessage = ref('')

// --- Grouping State ---
const expandedGroupKeys = ref(new Set())
let dismissUndoToast = null

const emptyTip = computed(() => {
    if (!store.selectedElement) {
        return t('layerManager.emptyTipNoSelection')
    }
    return t('layerManager.emptyTipNoLayers')
})

// --- Data Calculation ---

function partDescription(p) {
  if (!p) return t('partList.unnamed')
  const asset = store.resolveAssetForPart ? store.resolveAssetForPart(p) : null
  if (asset) return asset.Description || asset.Desc || asset.description || t('partList.unnamed')
  const groupDesc = store.getGroupDescriptionForPart ? store.getGroupDescriptionForPart(p) : null
  return groupDesc || p.Asset?.Description || p.Asset?.Group?.Description || t('partList.unnamed')
}


// Color Generator (String Hash)
function generateColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const r = (hash >> 16) & 0xff;
    const g = (hash >> 8) & 0xff;
    const b = hash & 0xff;
    return `rgb(${r}, ${g}, ${b})`;
}

const displayList = computed(() => {
    const stack = store.selectedElement
    if (!stack || !stack.data) return []

    // 1. Extract all layers
    let flatList = []
    stack.data.forEach(part => {
        // Check locked status
        const locked = isHiddenGroup(part.Group) || (part.Asset && isHiddenGroup(part.Asset.Group?.Name))
        const pColor = generateColor(part.Name || part._uid)
        const pName = partDescription(part) || part.Name || part.Asset?.Name || 'Unnamed'

        if (Array.isArray(part.layerEntries)) {
            part.layerEntries.forEach((layer, idx) => {
                const pri = (layer.overridePriority !== undefined && layer.overridePriority !== null)
                    ? layer.overridePriority
                    : (layer.defaultPriority || 0)

                flatList.push({
                    uniqueId: `${part._uid}_${idx}`,
                    partUid: part._uid,
                    partName: pName,
                    layerIndex: idx,
                    layerName: layer.name || layer.displayName || `#${idx}`,
                    priority: pri,
                    locked: !!locked,
                    color: pColor,
                    rawLayer: layer,
                    rawPart: part
                })
            })
        }
    })

    // 2. Sort: Priority DESC, PartUid, LayerIndex
    flatList.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority
        if (a.partUid !== b.partUid) return a.partUid.localeCompare(b.partUid)
        return a.layerIndex - b.layerIndex
    })

    // 3. Grouping (Collapse same Part & Priority items)
    const groupedList = []
    let currentGroup = null

    for (const item of flatList) {
        if (currentGroup &&
            currentGroup.partUid === item.partUid &&
            currentGroup.priority === item.priority) {
            currentGroup.children.push(item)
        } else {
            // Start new group/item
            currentGroup = {
                ...item, // copy props from first item
                isGroup: true, // initial assumption, check later
                children: [item]
            }
            groupedList.push(currentGroup)
        }
    }

    // Mark single items vs groups
    groupedList.forEach(g => {
        if (g.children.length === 1) {
            g.isGroup = false
        } else {
            g.uniqueId = `group_${g.partUid}_${g.priority}` // Group ID
        }
    })

    return groupedList
})

const visibleFlatItems = computed(() => {
    const rows = []
    for (const item of displayList.value) {
        rows.push(item)
        if (item.isGroup && isGroupExpanded(item)) {
            rows.push(...item.children)
        }
    }
    return rows
})

watch(visibleFlatItems, (rows) => {
    if (!rows.length) {
        focusedItemId.value = null
        return
    }

    const exists = rows.some(row => row.uniqueId === focusedItemId.value)
    if (!exists) {
        focusedItemId.value = rows[0].uniqueId
    }
}, { immediate: true })

// --- Interactions ---

function isPartActive(uid) {
    return store.focusedPart && store.focusedPart._uid === uid
}

function isFocusedItem(item) {
    return focusedItemId.value === item.uniqueId
}

function getTabIndex(item) {
    if (!visibleFlatItems.value.length) return -1
    if (!focusedItemId.value) {
        return visibleFlatItems.value[0].uniqueId === item.uniqueId ? 0 : -1
    }
    return isFocusedItem(item) ? 0 : -1
}

function onItemFocus(item) {
    focusedItemId.value = item.uniqueId
}

function focusRowByOffset(currentUniqueId, offset) {
    const rows = visibleFlatItems.value
    if (!rows.length) return

    let currentIndex = rows.findIndex(row => row.uniqueId === currentUniqueId)
    if (currentIndex < 0) currentIndex = 0

    const nextIndex = Math.max(0, Math.min(rows.length - 1, currentIndex + offset))
    const target = rows[nextIndex]
    if (!target) return

    focusedItemId.value = target.uniqueId

    nextTick(() => {
        const el = listBodyRef.value?.querySelector(`[data-lm-id="${target.uniqueId}"]`)
        if (el && typeof el.focus === 'function') {
            el.focus()
        }
        if (el && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'nearest' })
        }
    })
}

function buildPriorityUpdates(item, newPri) {
    if (!item || item.locked) return []

    if (item.isGroup) {
        return item.children.map(c => ({
            part: c.rawPart,
            layerIndex: c.layerIndex,
            priority: newPri
        }))
    }

    return [{
        part: item.rawPart,
        layerIndex: item.layerIndex,
        priority: newPri
    }]
}

function announcePriorityChange(item, newPri) {
    if (!item) return
    const label = item.isGroup
        ? `${item.partName} (${item.children.length} ${t('layerManager.layersBadge')})`
        : `${item.partName} - ${item.layerName}`

    liveMessage.value = t('layerManager.reorderAnnounce', {
        name: label,
        priority: String(newPri)
    })
}

function showReorderFeedback(item, newPri) {
    if (dismissUndoToast && typeof dismissUndoToast === 'function') {
        dismissUndoToast()
    }

    const label = item.isGroup ? item.partName : item.layerName
    dismissUndoToast = showUndoToast({
        message: t('layerManager.reorderToast', {
            name: label,
            priority: String(newPri)
        }),
        undoLabel: t('layerManager.undoLabel'),
        duration: 3600,
        onUndo: () => store.undo()
    })
}

function applyPriorityDelta(item, delta) {
    if (!item || item.locked) return
    const nextPriority = Number(item.priority) + Number(delta)
    if (!Number.isFinite(nextPriority)) return

    const updates = buildPriorityUpdates(item, nextPriority)
    if (!updates.length) return

    applyLayerPriorityUpdates(updates)
    announcePriorityChange(item, nextPriority)
    showReorderFeedback(item, nextPriority)
}

function onItemKeydown(e, item) {
    if (!item) return

    const key = e.key
    const hasNoModifier = !e.altKey && !e.ctrlKey && !e.metaKey

    if (key === 'ArrowDown' && hasNoModifier) {
        e.preventDefault()
        focusRowByOffset(item.uniqueId, 1)
        return
    }

    if (key === 'ArrowUp' && hasNoModifier) {
        e.preventDefault()
        focusRowByOffset(item.uniqueId, -1)
        return
    }

    if ((key === 'Enter' || key === ' ') && hasNoModifier) {
        e.preventDefault()
        handleItemClick(item)
        return
    }

    if (item.isGroup && (key === 'ArrowRight' || key === 'ArrowLeft') && hasNoModifier) {
        e.preventDefault()
        if (key === 'ArrowRight' && !isGroupExpanded(item)) {
            toggleGroup(item, true)
        }
        if (key === 'ArrowLeft' && isGroupExpanded(item)) {
            toggleGroup(item, false)
        }
        return
    }

    if ((key === 'ArrowUp' || key === 'ArrowDown') && e.altKey) {
        e.preventDefault()
        const delta = key === 'ArrowUp' ? 1 : -1
        applyPriorityDelta(item, delta)
    }
}

function focusItemPart(item) {
    if (item.rawPart) {
        store.focusPart(item.rawPart)
        // If single layer, focus that layer and its priority property
        if (!item.isGroup) {
            // Get stackIndex and partIndex
            const stackIndex = store.selectedIndex
            const partIndex = store.selectedElement.data.findIndex(p => p._uid === item.partUid)
            
            if (stackIndex >= 0 && partIndex >= 0) {
                store.focusLayer({
                    stackIndex,
                    partIndex,
                    layerIndex: item.layerIndex
                })
                store.setPropertyFocus('priority')
            }
        }
    }
}

function handleItemClick(item) {
    focusedItemId.value = item.uniqueId
    focusItemPart(item)
}

function toggleGroup(item, forceExpanded = null) {
    if (!item.isGroup || item.locked) return
    const k = item.uniqueId

    if (forceExpanded === true) {
        expandedGroupKeys.value.add(k)
        return
    }

    if (forceExpanded === false) {
        expandedGroupKeys.value.delete(k)
        return
    }

    if (expandedGroupKeys.value.has(k)) {
        expandedGroupKeys.value.delete(k)
    }
    else {
        expandedGroupKeys.value.add(k)
    }
}
function isGroupExpanded(item) {
    return expandedGroupKeys.value.has(item.uniqueId)
}

// --- Drag and Drop Logic ---

function onDragStart(e, item) {
    if (item.locked) {
        e.preventDefault()
        return
    }
    draggedItem.value = item
    focusedItemId.value = item.uniqueId
    e.dataTransfer.effectAllowed = 'move'
}

function applyLayerPriorityUpdates(updates) {
    // updates: Array of { part, layerIndex, priority }
    const partsMap = new Map() // partUid -> { part, deltas }

    for (const up of updates) {
        const p = up?.part
        if (!p) continue

        const layerIndex = Number(up?.layerIndex)
        if (!Number.isFinite(layerIndex)) continue

        const priority = Number(up?.priority)
        if (!Number.isFinite(priority)) continue

        const key = p._uid || p
        if (!partsMap.has(key)) {
            partsMap.set(key, { part: p, deltas: [] })
        }

        partsMap.get(key).deltas.push({
            layerIndex,
            isOverridePriority: true,
            overridePriority: priority
        })
    }

    const updatesPayload = Array.from(partsMap.values()).filter(up => Array.isArray(up.deltas) && up.deltas.length > 0)
    if (updatesPayload.length > 0) {
        store.execute({
            type: 'layer.batchApplyLayerDeltas',
            payload: { updates: updatesPayload }
        })
    }
}

// Throttle Store Updates
const throttledStoreUpdate = throttle(async (updates) => {
    applyLayerPriorityUpdates(updates)
}, 200)

function checkAutoScroll(e) {
    if (!listBodyRef.value) return

    const { top, height } = listBodyRef.value.getBoundingClientRect()
    const relY = e.clientY - top
    const threshold = 40 // px
    const speed = 10 // px per event

    if (relY < threshold) {
        listBodyRef.value.scrollTop -= speed
    } else if (relY > height - threshold) {
        listBodyRef.value.scrollTop += speed
    }
}

function onDragOver(e, targetItem) {
    // Check auto scroll first
    checkAutoScroll(e)

    if (!draggedItem.value) return
    if (targetItem.uniqueId === draggedItem.value.uniqueId) return

    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const h = rect.height

    // Tri-State Logic
    let pos = 'middle'
    if (y < h * 0.25) pos = 'top'
    else if (y > h * 0.75) pos = 'bottom'

    dropTarget.value = targetItem.uniqueId
    dropPosition.value = pos

    // Calculate expected priority
    let newPri = targetItem.priority
    if (pos === 'top') newPri = targetItem.priority + 1
    if (pos === 'bottom') newPri = targetItem.priority - 1

    // If priority hasn't changed, skip update
    if (draggedItem.value.priority === newPri) return

    // Build updates
    const updates = buildPriorityUpdates(draggedItem.value, newPri)

    throttledStoreUpdate(updates)
}

function onDragLeave(e, item) {
    // Optional debounce clearing
}

function onDrop(e, targetItem) {
    if (draggedItem.value && targetItem && targetItem.uniqueId !== draggedItem.value.uniqueId) {
        let finalPriority = targetItem.priority
        if (dropPosition.value === 'top') finalPriority = targetItem.priority + 1
        if (dropPosition.value === 'bottom') finalPriority = targetItem.priority - 1

        if (draggedItem.value.priority !== finalPriority) {
            const updates = buildPriorityUpdates(draggedItem.value, finalPriority)
            applyLayerPriorityUpdates(updates)
            announcePriorityChange(draggedItem.value, finalPriority)
            showReorderFeedback(draggedItem.value, finalPriority)
        }
    }

    onDragEnd()
}

function onDragEnd() {
    dropTarget.value = null
    dropPosition.value = null
    draggedItem.value = null
    throttledStoreUpdate.cancel()
}

</script>

<style scoped>
.layer-manager-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    /* Fill parent */
    overflow: hidden;
    background: var(--color-bg-surface, #fafbfc);
}

.lm-header {
    height: var(--button-height-lg, 36px);
    background: var(--color-bg-panel, #f0f2f5);
    border-bottom: 1px solid var(--color-border-base, #dce1e6);
    display: flex;
    align-items: center;
    padding: 0 var(--space-sm, 8px);
    user-select: none;
    flex-shrink: 0;
}

.lm-title {
    font-size: var(--font-size-base, 13px);
    font-weight: var(--font-weight-bold, 700);
    color: var(--color-text-primary, #333);
    display: flex;
    align-items: center;
    gap: var(--space-sm, 6px);
}

.lm-body {
    flex: 1;
    overflow-y: auto;
    background: var(--color-bg-surface, #fafbfc);
    padding: var(--space-xs, 4px) 0;
}

/* Custom Scrollbar */
.custom-scroll::-webkit-scrollbar {
    width: 6px;
}

.custom-scroll::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb, #ccc);
    border-radius: var(--radius-2xs, 3px);
}

.custom-scroll::-webkit-scrollbar-track {
    background: var(--scrollbar-track, transparent);
}

.empty-tip {
    text-align: center;
    color: var(--color-text-muted, #999);
    margin-top: 40px;
    font-size: var(--font-size-base, 13px);
}

.layer-item {
    display: flex;
    flex-direction: column;
    position: relative;
    background: var(--color-bg-base, #fff);
    border-bottom: 1px solid var(--color-border-light, #eee);
    cursor: pointer;
    user-select: none;
    transition: background var(--transition-fast, 0.1s);
}

.layer-item:hover {
    background: var(--color-bg-hover, #f4f8ff);
}

.layer-item.active {
    background: var(--color-info-bg, #eef6ff);
}

.layer-item.is-focused,
.sub-item.is-focused {
    box-shadow: inset 0 0 0 2px var(--color-selection-single-border, rgba(65, 122, 237, 0.2));
}

.layer-item.is-locked {
    background: var(--color-bg-panel, #f9f9f9);
    cursor: not-allowed;
    opacity: 0.8;
}

/* Drag Indicators */
.layer-item.drag-over-top {
    border-top: 2px solid var(--color-primary, #2563eb);
    margin-top: -2px;
}

.layer-item.drag-over-bottom {
    border-bottom: 2px solid var(--color-primary, #2563eb);
    margin-bottom: -1px;
}

.layer-item.drag-over-middle {
    background: var(--color-selection-single-bg, rgba(65, 122, 237, 0.08));
    outline: 2px dashed var(--color-selection-single, #417aed);
    outline-offset: -2px;
}

/* Internal Layout */
.color-strip {
    width: 4px;
    flex-shrink: 0;
    /* Make sure it covers full height of the item row, not sublist */
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
}

.item-content {
    display: flex;
    align-items: center;
    padding: 6px 8px 6px 12px;
    /* indent for color strip */
    min-height: 32px;
    gap: 8px;
}

.drag-handle {
    width: 12px;
    color: var(--color-text-muted, #94a3b8);
    font-size: 11px;
    letter-spacing: -1px;
    flex-shrink: 0;
}

.drag-handle.is-hidden {
    visibility: hidden;
}

.item-icon {
    width: 20px;
    text-align: center;
    font-size: 12px;
    color: var(--color-text-tertiary, #64748b);
    cursor: pointer;
}

.fold-icon {
    font-weight: bold;
    font-size: 14px;
}

.item-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    line-height: 1.2;
}

.item-primary {
    font-size: 13px;
    color: var(--color-text-primary, #0f172a);
    display: flex;
    align-items: center;
    flex-wrap: wrap;
}

.part-name {
    font-weight: 600;
}

.layer-suffix {
    font-weight: 400;
    color: var(--color-text-secondary, #475569);
    margin-left: 4px;
}

.group-badge {
    font-size: 10px;
    background: var(--color-border-light, #f1f5f9);
    padding: 1px 4px;
    border-radius: var(--radius-xs, 4px);
    margin-left: 6px;
    color: var(--color-text-secondary, #475569);
}

.item-meta {
    font-size: 11px;
    color: var(--color-text-tertiary, #64748b);
}

/* Sub-list */
.sub-list-container {
    background: var(--color-bg-panel, #f1f5f9);
    padding-left: 4px;
    /* Space for main color strip */
    border-top: 1px dotted var(--color-border-light, #f1f5f9);
}

.sub-item {
    display: flex;
    align-items: center;
    font-size: 12px;
    color: var(--color-text-secondary, #475569);
    padding: 4px 8px 4px 34px;
    cursor: grab;
    border-top: 1px solid transparent;
    border-bottom: 1px solid transparent;
}

.sub-item:focus-visible,
.layer-item:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--color-selection-single, #417aed);
}

.sub-drag-handle {
    width: 12px;
    color: var(--color-text-muted, #94a3b8);
    font-size: 10px;
    letter-spacing: -1px;
    margin-right: 6px;
    flex-shrink: 0;
}

.sub-item:hover {
    background: var(--color-bg-hover, #f1f5f9);
}

.sub-item:active {
    cursor: grabbing;
}

.sub-color-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    margin-right: 8px;
    display: inline-block;
}

.sub-name {
    flex: 1;
}

.sub-prio {
    font-size: 10px;
    color: var(--color-text-tertiary, #64748b);
    margin-left: 4px;
}

/* Sub-item Drag Indicators */
.sub-item.drag-over-top {
    border-top: 2px solid var(--color-selection-single, #417aed);
}

.sub-item.drag-over-bottom {
    border-bottom: 2px solid var(--color-selection-single, #417aed);
}

.sub-item.drag-over-middle {
    background: var(--color-selection-single-bg, rgba(65, 122, 237, 0.08));
}

.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}
</style>