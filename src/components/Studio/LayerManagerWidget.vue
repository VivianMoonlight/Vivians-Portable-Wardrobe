<template>
    <div class="layer-manager-panel">
        <!-- Header (Simple Title) -->
        <div class="lm-header">
            <div class="lm-title">
                <span class="icon">≡</span> {{ t('layerManager.title') || 'Layer Order' }}
            </div>
        </div>

        <!-- List Area -->
        <div class="lm-body custom-scroll" ref="listBodyRef">
            <div v-if="displayList.length === 0" class="empty-tip">
                {{ t('layerManager.emptyTip') }}
            </div>

            <div v-else class="layer-list">
                <div v-for="item in displayList" :key="item.uniqueId" class="layer-item" :class="{
                    'is-group': item.isGroup,
                    'is-locked': item.locked,
                    'is-active': isPartActive(item.partUid),
                    'drag-over-top': dropTarget === item.uniqueId && dropPosition === 'top',
                    'drag-over-bottom': dropTarget === item.uniqueId && dropPosition === 'bottom',
                    'drag-over-middle': dropTarget === item.uniqueId && dropPosition === 'middle'
                }" :draggable="!item.locked" @dragstart="onDragStart($event, item)"
                    @dragover.prevent="onDragOver($event, item)" @dragleave="onDragLeave($event, item)"
                    @drop="onDrop($event, item)" @dragend="onDragEnd" @click="focusItemPart(item)">
                    <!-- Color Strip -->
                    <div class="color-strip" :style="{ background: item.color }"></div>

                    <!-- Content -->
                    <div class="item-content">
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
                        <div v-for="child in item.children" :key="child.uniqueId" class="sub-item" :class="{
                            'drag-over-top': dropTarget === child.uniqueId && dropPosition === 'top',
                            'drag-over-bottom': dropTarget === child.uniqueId && dropPosition === 'bottom',
                            'drag-over-middle': dropTarget === child.uniqueId && dropPosition === 'middle'
                        }" draggable="true" @dragstart.stop="onDragStart($event, child)"
                            @dragover.prevent.stop="onDragOver($event, child)"
                            @dragleave.stop="onDragLeave($event, child)" @drop.stop="onDrop($event, child)"
                            @dragend.stop="onDragEnd" @click.stop="focusItemPart(child)">
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
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStudioStore } from '@/stores/studioStore'
import { isHiddenGroup } from '@/config/filterGroupConfig'
import throttle from 'lodash.throttle'

const { t } = useI18n()
const store = useStudioStore()

// --- Refs ---
const listBodyRef = ref(null)

// --- Drag State ---
const dropTarget = ref(null) // uniqueId
const dropPosition = ref(null) // 'top' | 'middle' | 'bottom'
const draggedItem = ref(null)

// --- Grouping State ---
const expandedGroupKeys = ref(new Set())

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

// --- Interactions ---

function isPartActive(uid) {
    return store.focusedPart && store.focusedPart._uid === uid
}

function focusItemPart(item) {
    if (item.rawPart) {
        store.focusPart(item.rawPart)
        // If single layer, try to focus that layer property
        if (!item.isGroup) {
            store.setFocusedProperty({
                part: item.rawPart,
                layerIndex: item.layerIndex,
                property: 'priority'
            })
        }
    }
}

function toggleGroup(item) {
    if (!item.isGroup) return
    const k = item.uniqueId
    if (expandedGroupKeys.value.has(k)) {
        expandedGroupKeys.value.delete(k)
    } else {
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
    e.dataTransfer.effectAllowed = 'move'
}

// Throttle Store Updates
const throttledStoreUpdate = throttle(async (updates) => {
    // updates: Array of { part, layerIndex, priority }

    // 1. Group by Part
    const partsMap = new Map() // partUid -> { part, entries }

    for (const up of updates) {
        const p = up.part
        if (!partsMap.has(p._uid)) {
            // Deep clone entries
            const entries = p.layerEntries.map(e => ({ ...e }))
            partsMap.set(p._uid, { part: p, entries })
        }
        const group = partsMap.get(p._uid)
        if (group.entries[up.layerIndex]) {
            group.entries[up.layerIndex].overridePriority = up.priority
            group.entries[up.layerIndex].isOverridePriority = true
        }
    }

    // 2. Commit all
    for (const val of partsMap.values()) {
        store.updatePartLayerEntries(val.part, val.entries)
    }

    store.refreshMergedAppearanceData()
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
    const updates = []
    if (draggedItem.value.isGroup) {
        draggedItem.value.children.forEach(c => {
            updates.push({ part: c.rawPart, layerIndex: c.layerIndex, priority: newPri })
        })
    } else {
        updates.push({
            part: draggedItem.value.rawPart,
            layerIndex: draggedItem.value.layerIndex,
            priority: newPri
        })
    }

    throttledStoreUpdate(updates)
}

function onDragLeave(e, item) {
    // Optional debounce clearing
}

function onDrop(e, targetItem) {
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
    border-radius: 3px;
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

.layer-item.is-active {
    background: var(--color-info-bg, #eef6ff);
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
    border-radius: 4px;
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
</style>