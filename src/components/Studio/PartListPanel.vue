<template>
  <div class="partlist-panel" role="region" :aria-label="t('partList.ariaLabel')" ref="rootEl">
    <div class="header">
      <h4>{{ t('partList.title') }}</h4>

      <!-- All-level controls: eye (toggle all visibility for selected element) and delete (click once to arm, click again to confirm) -->
      <div class="header-controls">
        <button
          class="icon-btn eye-btn"
          :class="{ active: isAllVisible }"
          :disabled="!hasSelected"
          @click="toggleAllVisibility"
          :title="t('partList.toggleAllVisibilityTitle')"
        >{{ isAllVisible ? '👁' : '—' }}</button>

        <button
          class="icon-btn delete-btn"
          :class="{ armed: armedAll }"
          :disabled="!hasSelected"
          @click.stop="armAllDelete"
          data-delete-button
          data-delete-key="__ALL__"
          :title="t('partList.armAllTitle')"
        >{{ armedAll ? '⚠' : '✖' }}</button>
      </div>
    </div>

    <!-- Search / controls -->
    <div class="controls">
      <input
        v-model="searchTerm"
        type="search"
        :placeholder="t('partList.searchPlaceholder')"
        class="search"
        @input="onSearchInput"
      />
      <div class="control-buttons">
        <button @click="expandAll" :disabled="!hasGroups">{{ t('partList.expandAll') }}</button>
        <button @click="collapseAll" :disabled="!hasGroups">{{ t('partList.collapseAll') }}</button>
      </div>
    </div>

    <div class="toggle-row">
      <label class="toggle-label">
        <input type="checkbox" v-model="showHiddenGroups" />
        <span>{{ t('partList.showHiddenGroups') }}</span>
      </label>
      <label class="toggle-label">
        <input type="checkbox" v-model="showEmptySlots" />
        <span>{{ t('partList.showEmptySlots') }}</span>
      </label>
    </div>

    <div class="body scrollable">
      <div v-if="!hasSelected" class="placeholder">{{ t('partList.noSelectionPlaceholder') }}</div>

      <div v-else class="groups">
        <div v-for="(groupData, gid) in displayGrouped" :key="gid" class="group-card"
          :class="{ 'hidden-group': isHiddenGroup(gid) }">
          <div class="group-header">
            <div class="title" @click="toggleGroup(gid)">
              <button class="chev" :aria-expanded="!isCollapsed(gid)">{{ isCollapsed(gid) ? '▸' : '▾' }}</button>
              <span class="gid">{{ getGroupDisplayName(gid) }}</span>
              <span v-if="isHiddenGroup(gid)" class="hidden-badge">{{ t('partList.hiddenBadge') }}</span>
              <span class="count">({{ groupData.parts.length }} / {{ groupData.totalSlots }})</span>
            </div>

            <!-- Group-level controls: eye & delete -->
            <div class="group-controls">
              <button
                class="icon-btn eye-btn"
                :class="{ active: isGroupVisible(gid) }"
                :disabled="!hasSelected"
                @click.stop="toggleGroupVisibility(gid)"
                :title="t('partList.groupToggleVisibilityTitle')"
              >{{ isGroupVisible(gid) ? '👁' : '—' }}</button>

              <button
                class="icon-btn delete-btn"
                :class="{ armed: isGroupArmed(gid) }"
                :disabled="!hasSelected"
                @click.stop="armGroupDelete(gid)"
                data-delete-button
                :data-delete-key="`GROUP::${gid}`"
                :title="t('partList.groupDeleteTitle')"
              >{{ isGroupArmed(gid) ? '⚠' : '✖' }}</button>
            </div>
          </div>

          <transition name="fade">
            <div v-show="!isCollapsed(gid)" class="group-body">
              <!-- 显示已有的 parts -->
              <div v-for="(p, idx) in groupData.parts" :key="gid + '::part::' + (p.Name || idx)" class="part-row"
                :class="{ focused: isFocused(p) }" @click="focusPart(p)">
                <div class="row-content">
                  <div class="left-col">
                    <div class="slot-name">{{ partGroupDescription(p) }}</div>
                    <div class="item-name" :title="partDescription(p)">{{ partDescription(p) }}</div>
                  </div>

                  <!-- per-part control buttons -->
                  <div class="part-controls">
                    <!-- replace (mutually exclusive with focus) -->
                    <button
                      class="icon-btn replace-btn"
                      :class="{ active: isPartReplaceArmed(p, idx, gid) }"
                      @click.stop="toggleReplaceForPart(p, idx, gid)"
                      :title="t('partList.partReplaceTitle')"
                    >⇄</button>

                    <!-- eye: toggle visibility for this part (group name) -->
                    <button
                      class="icon-btn eye-btn"
                      :class="{ active: isPartVisible(p) }"
                      @click.stop="togglePartVisibility(p)"
                      :disabled="!hasSelected"
                      :title="t('partList.partVisibilityTitle')"
                    >{{ isPartVisible(p) ? '👁' : '—' }}</button>

                    <!-- delete: single click arm, single click again confirm -->
                    <button
                      class="icon-btn delete-btn"
                      :class="{ armed: isPartArmed(p, idx, gid) }"
                      @click.stop="armPartDelete(p, idx, gid)"
                      data-delete-button
                      :data-delete-key="partUniqueKey(p, idx, gid)"
                      :title="t('partList.partDeleteTitle')"
                    >{{ isPartArmed(p, idx, gid) ? '⚠' : '✖' }}</button>
                  </div>
                </div>
              </div>

              <!-- 显示空槽位：现在点击直接进入替换模式 -->
              <div v-if="showEmptySlots" v-for="slot in groupData.emptySlots" :key="gid + '::empty::' + slot.Name"
                class="part-row empty-slot clickable" :class="{ focused: isFocusedSlot(slot) }"
                @click="enterReplaceForEmptySlot(slot, gid)">
                <div class="row-content">
                  <div class="left-col">
                    <div class="slot-name">{{ slot.Description || slot.Name }}</div>
                    <div class="item-name empty">{{ t('partList.emptySlotLabel') }}</div>
                  </div>

                  <div class="part-controls">
                    <!-- no extra replace button for empty slots; clicking the row enters replace mode -->
                  </div>
                </div>
              </div>

              <div v-if="groupData.parts.length === 0 && (!showEmptySlots || groupData.emptySlots.length === 0)"
                class="muted">{{ t('partList.emptyGroupLabel') }}</div>
            </div>
          </transition>
        </div>

        <div v-if="Object.keys(displayGrouped).length === 0" class="placeholder">{{ t('partList.noMatch') }}</div>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStudioStore } from '@/stores/studioStore'
import {
  classifyToGroup,
  isHiddenGroup as checkIsHiddenGroup,
  getGroupDisplayName as getDisplayName,
  getAllGroupIDs
} from '@/config/filterGroupConfig'
import { AssetApi } from '@/utils/AssetApi'
import { hostWindow, doc } from '@/utils/host-window.js'

const { t } = useI18n()
const store = useStudioStore()
const selected = computed(() => store.selectedElement)
const hasSelected = computed(() => !!selected.value && Array.isArray(selected.value.data))

// root element ref for global click handling
const rootEl = ref(null)

// UI state
const searchQueryRaw = ref('')
const searchTerm = searchQueryRaw // keep original var name used by template
const collapsed = ref(new Set()) // set of groupIDs that are collapsed
const showHiddenGroups = ref(false) // 是否显示隐藏分组
const showEmptySlots = ref(true) // 是否显示空槽位

// Armed / UI states for delete actions (delete arms kept local)
const armedParts = ref(new Set()) // keys for parts prepared to delete (only one active at a time by behavior)
const armedGroups = ref(new Set()) // groupIDs prepared to delete (only one)
const armedAll = ref(false)        // prepared to delete entire selection

/* ----------------------
   Helpers for keys
   ---------------------- */
function partUniqueKey(p, idx, gid) {
  // create a stable key using group id, slot name and index
  const slot = (p && (p.Group || (p.Asset && p.Asset.Group && (p.Asset.Group.Name || p.Asset.Group.name)))) || ''
  const name = p && (p.Name || p.Asset?.Name) || ''
  return `${gid}::${slot}::${name}::${idx}`
}
function emptySlotKey(slot, gid) {
  return `${gid}::empty::${slot?.Name || slot?.Name}`
}

/* ----------------------
   Search / collapse helpers
   ---------------------- */
function onSearchInput() {
  if (!searchTerm.value) return
  for (const gid of Object.keys(grouped.value)) {
    const groupData = grouped.value[gid]
    if (!groupData) continue
    const parts = groupData.parts || []
    const matched = parts.some(p => store.matchesSearchForPart ? store.matchesSearchForPart(p, searchTerm.value) : true)
    if (matched) collapsed.value.delete(gid)
  }
}

function expandAll() { collapsed.value = new Set() }
function collapseAll() { collapsed.value = new Set(Object.keys(grouped.value || {})) }
function toggleGroup(gid) {
  if (collapsed.value.has(gid)) {
    collapsed.value.delete(gid)
  } else {
    collapsed.value.add(gid)
  }
}
function isCollapsed(gid) { return collapsed.value.has(gid) }

// 使用统一配置的分组工具函数
function isHiddenGroup(gid) {
  return checkIsHiddenGroup(gid)
}

function getGroupDisplayName(gid) {
  return getDisplayName(gid)
}

// 使用统一的分类函数
function classifyGroup(part) {
  if (!part) return 'Appearance'

  const rawGroup = store.findAssetGroupEntryForPart ? store.findAssetGroupEntryForPart(part) : null

  return classifyToGroup(rawGroup && rawGroup.data ? rawGroup.data : null)
}

// 获取所有可用的槽位信息（从 studioStore 的 assetGroupsRaw 中获取）
function getAllSlotsForGroup(groupID) {
  const assetGroups = (store.assetGroupsRaw || []).map(g => g.data) || []
  const slots = []

  for (const group of assetGroups) {
    if (!group || !group.Name) continue
    const gid = classifyToGroup({
      Name: group.Name,
      BodyCosplay: group.BodyCosplay,
      Category: group.Category
    })
    if (gid === groupID) {
      slots.push({
        Name: group.Name,
        Description: group.Description || group.Name,
        BodyCosplay: group.BodyCosplay,
        Category: group.Category
      })
    }
  }

  return slots
}

// 获取 part 所属的槽位名称
function getPartSlotName(part) {
  const rawGroup = store.findAssetGroupEntryForPart ? store.findAssetGroupEntryForPart(part) : null
  if (rawGroup && rawGroup.data) {
    return rawGroup.data.Name || rawGroup.data.name || ''
  }
  return ''
}

const hasGroups = computed(() => Object.keys(grouped.value).length > 0)

const grouped = computed(() => {
  const out = {}
  if (!hasSelected.value) return out
  const parts = selected.value.data || []

  // 首先收集所有已使用的槽位
  const usedSlots = new Map() // slotName -> [parts]

  for (const p of parts) {
    const gid = classifyGroup(p)
    const slotName = getPartSlotName(p)

    if (!out[gid]) {
      out[gid] = {
        parts: [],
        allSlots: getAllSlotsForGroup(gid),
        emptySlots: [],
        totalSlots: 0
      }
    }
    out[gid].parts.push(p)

    if (slotName) {
      if (!usedSlots.has(gid)) {
        usedSlots.set(gid, new Set())
      }
      usedSlots.get(gid).add(slotName)
    }
  }

  // 计算空槽位
  for (const gid of Object.keys(out)) {
    const groupData = out[gid]
    const usedSet = usedSlots.get(gid) || new Set()

    groupData.emptySlots = groupData.allSlots.filter(slot => !usedSet.has(slot.Name))
    groupData.totalSlots = groupData.allSlots.length
  }

  // 如果需要显示空槽位，也需要添加完全为空的分组
  if (showEmptySlots.value) {
    const allGroupIDs = getAllGroupIDs()
    for (const gid of allGroupIDs) {
      if (!out[gid]) {
        const allSlots = getAllSlotsForGroup(gid)
        if (allSlots.length > 0) {
          out[gid] = {
            parts: [],
            allSlots: allSlots,
            emptySlots: allSlots,
            totalSlots: allSlots.length
          }
        }
      }
    }
  }

  // 按优先级排序
  const allGroupIDs = getAllGroupIDs()
  const ordered = {}
  for (const k of allGroupIDs) {
    if (out[k]) ordered[k] = out[k]
  }
  // 添加不在预定义列表中的分组
  for (const k of Object.keys(out)) {
    if (!ordered[k]) ordered[k] = out[k]
  }
  return ordered
})

// 根据 showHiddenGroups 过滤显示的分组
const visibleGrouped = computed(() => {
  const out = {}
  for (const [gid, groupData] of Object.entries(grouped.value)) {
    if (!checkIsHiddenGroup(gid)) {
      out[gid] = groupData
    }
  }
  return out
})

const filteredGrouped = computed(() => {
  const source = showHiddenGroups.value ? grouped.value : visibleGrouped.value
  const out = {}
  if (!hasSelected.value) return out
  const term = searchTerm.value && searchTerm.value.trim().toLowerCase()

  for (const [gid, groupData] of Object.entries(source)) {
    if (!groupData) continue

    const filteredParts = term
      ? groupData.parts.filter(p => store.matchesSearchForPart ? store.matchesSearchForPart(p, term) : true)
      : groupData.parts.slice()

    // 过滤空槽位（如果有搜索词）
    const filteredEmptySlots = term
      ? groupData.emptySlots.filter(slot => {
        const slotText = (slot.Description || slot.Name || '').toLowerCase()
        return slotText.includes(term)
      })
      : groupData.emptySlots.slice()

    out[gid] = {
      ...groupData,
      parts: filteredParts,
      emptySlots: filteredEmptySlots
    }
  }

  if (term) {
    const pruned = {}
    for (const [k, v] of Object.entries(out)) {
      if ((v.parts && v.parts.length > 0) || (showEmptySlots.value && v.emptySlots && v.emptySlots.length > 0)) {
        pruned[k] = v
      }
    }
    return pruned
  }
  return out
})

// 最终用于显示的分组
const displayGrouped = computed(() => filteredGrouped.value)

function partDescription(p) {
  if (!p) return t('partList.unnamed')
  const asset = store.resolveAssetForPart ? store.resolveAssetForPart(p) : null
  if (asset) return asset.Description || asset.Desc || asset.description || t('partList.unnamed')
  const groupDesc = store.getGroupDescriptionForPart ? store.getGroupDescriptionForPart(p) : null
  return groupDesc || p.Asset?.Description || p.Asset?.Group?.Description || t('partList.unnamed')
}

function partGroupDescription(p) {
  if (!p) return t('partList.noGroup')
  const entry = store.findAssetGroupEntryForPart ? store.findAssetGroupEntryForPart(p) : null
  const rawGroup = entry && entry.data ? entry.data : null
  if (rawGroup) {
    return rawGroup.Description || rawGroup.Name || t('partList.noGroup')
  }
  return p.Asset?.Group?.Description || p.Asset?.Group?.Name || t('partList.noGroup')
}

// focus handling
function focusPart(part) {
  // focusing a part cancels replace mode (mutual exclusivity)
  if (store.focusPart) {
    store.focusPart(part)
  }
  // store.focusPart clears replaceTarget already
}

function isFocused(part) {
  if (!store.focusedPart) return false
  try {
    return JSON.stringify(store.focusedPart) === JSON.stringify(part)
  } catch (e) {
    return store.focusedPart === part
  }
}

/* -------------------------
   Empty slot selection support
   ------------------------- */

function enterReplaceForEmptySlot(slot, gid) {
  if (!slot) return
  const placeholder = {
    Name: slot.Name,
    Description: slot.Description || slot.Name,
    Group: slot.Name,
  }
  const key = emptySlotKey(slot, gid)
  store.setReplaceTarget(placeholder, key, true)
}

function isFocusedSlot(slot) {
  if (!slot) return false
  if (!store.focusedPart) return false
  try {
    if (store.focusedPart.Name && store.focusedPart.Name === slot.Name) return true
    return false
  } catch (e) {
    return false
  }
}

/* -------------------------
   Visibility helpers (eye button)
   Operate on selected element's filterList
   ------------------------- */

function _ensureFilterListForSelected() {
  if (!hasSelected.value) return null
  const sel = selected.value
  if (!sel.filterList || !Array.isArray(sel.filterList)) {
    // initialize to list of all slot names present in element.data
    const names = new Set()
    for (const p of sel.data || []) {
      const n = getPartSlotName(p)
      if (n) names.add(n)
    }
    const arr = Array.from(names)
    // set reactively: assign a new array
    store.stacks[store.selectedIndex].filterList = arr
    return arr
  }
  return sel.filterList.slice()
}

function isPartVisible(part) {
  if (!hasSelected.value || !part) return true
  const sel = selected.value
  if (!sel.filterList || !Array.isArray(sel.filterList)) return true
  const slotName = getPartSlotName(part)
  if (!slotName) return true
  return sel.filterList.includes(slotName)
}

function togglePartVisibility(part) {
  if (!hasSelected.value || !part) return
  const idx = store.selectedIndex
  if (idx < 0) return
  const slotName = getPartSlotName(part)
  if (!slotName) return
  let fl = selected.value.filterList
  if (!Array.isArray(fl)) {
    // initialize to all present
    fl = _ensureFilterListForSelected() || []
  } else {
    fl = fl.slice()
  }
  const pos = fl.indexOf(slotName)
  if (pos === -1) fl.push(slotName)
  else fl.splice(pos, 1)
  store.stacks[idx].filterList = fl
  try { store.refreshMergedAppearanceData() } catch (e) { /* ignore */ }
}

/* Group visibility: toggle all slot names for group (based on getAllSlotsForGroup) */
function isGroupVisible(gid) {
  if (!hasSelected.value) return true
  const sel = selected.value
  if (!sel.filterList || !Array.isArray(sel.filterList)) return true
  const allSlots = getAllSlotsForGroup(gid).map(s => s.Name)
  if (allSlots.length === 0) return true
  // visible if any slot from this group is present in filterList
  return allSlots.some(n => sel.filterList.includes(n))
}

function toggleGroupVisibility(gid) {
  if (!hasSelected.value) return
  const idx = store.selectedIndex
  if (idx < 0) return
  let fl = selected.value.filterList
  if (!Array.isArray(fl)) {
    fl = _ensureFilterListForSelected() || []
  } else {
    fl = fl.slice()
  }
  const groupSlots = getAllSlotsForGroup(gid).map(s => s.Name).filter(Boolean)
  if (groupSlots.length === 0) return
  const anyPresent = groupSlots.some(n => fl.includes(n))
  if (anyPresent) {
    // remove all
    fl = fl.filter(n => !groupSlots.includes(n))
  } else {
    // add all (avoid duplicates)
    const s = new Set(fl)
    groupSlots.forEach(n => s.add(n))
    fl = Array.from(s)
  }
  store.stacks[idx].filterList = fl
  try { store.refreshMergedAppearanceData() } catch (e) { /* ignore */ }
}

/* All visibility: toggle show/hide all for selected element */
const isAllVisible = computed(() => {
  if (!hasSelected.value) return false
  const sel = selected.value
  if (!sel.filterList || !Array.isArray(sel.filterList)) return true
  // if there exists at least one filterList entry, consider visible
  return (sel.filterList.length > 0)
})

function toggleAllVisibility() {
  if (!hasSelected.value) return
  const idx = store.selectedIndex
  if (idx < 0) return
  const sel = selected.value
  if (!sel.filterList || !Array.isArray(sel.filterList)) {
    // currently considered visible; toggle to hide -> set empty filterList
    store.stacks[idx].filterList = []
  } else {
    // if empty -> restore to all present slots in element
    if (sel.filterList.length === 0) {
      const names = new Set()
      for (const p of sel.data || []) {
        const n = getPartSlotName(p)
        if (n) names.add(n)
      }
      store.stacks[idx].filterList = Array.from(names)
    } else {
      // currently visible (non-empty) -> hide (empty)
      store.stacks[idx].filterList = []
    }
  }
  try { store.refreshMergedAppearanceData() } catch (e) { /* ignore */ }
}

/* -------------------------
   Delete logic (single click arm, single click again confirm)
   ------------------------- */

function clearArmedStates() {
  armedParts.value.clear()
  armedGroups.value.clear()
  armedAll.value = false
}

function armPartDelete(part, idx, gid) {
  const key = partUniqueKey(part, idx, gid)
  // if this part already armed -> confirm delete
  if (armedParts.value.has(key)) {
    confirmPartDelete(part, idx, gid)
    return
  }
  // otherwise arm this part and clear others
  armedParts.value = new Set([key])
  armedGroups.value.clear()
  armedAll.value = false
}

function isPartArmed(part, idx, gid) {
  const key = partUniqueKey(part, idx, gid)
  return armedParts.value.has(key)
}

function confirmPartDelete(part, idx, gid) {
  if (!hasSelected.value) return
  const key = partUniqueKey(part, idx, gid)
  // perform deletion: remove matching part from selected element.data
  const si = store.selectedIndex
  if (si < 0) return
  try {
    const orig = selected.value.data || []
    const str = JSON.stringify(part)
    const newData = orig.filter(p => {
      try { return JSON.stringify(p) !== str } catch (e) { return p !== part }
    })
    store.stacks[si] = Object.assign({}, store.stacks[si], { data: newData })
    // cleanup armed state
    armedParts.value.delete(key)
    store.pushHistorySnapshot()
    // refresh preview
    try { store.refreshMergedAppearanceData() } catch (e) { /* ignore */ }
  } catch (e) {
    console.error('confirmPartDelete failed', e)
  }
}

/* Group delete */
function armGroupDelete(gid) {
  if (armedGroups.value.has(gid)) {
    confirmGroupDelete(gid)
    return
  }
  // arm this group and clear others
  armedGroups.value = new Set([gid])
  armedParts.value.clear()
  armedAll.value = false
}

function isGroupArmed(gid) {
  return armedGroups.value.has(gid)
}

function confirmGroupDelete(gid) {
  if (!hasSelected.value) return
  const si = store.selectedIndex
  if (si < 0) return
  try {
    const orig = selected.value.data || []
    const newData = orig.filter(p => classifyGroup(p) !== gid)
    store.stacks[si] = Object.assign({}, store.stacks[si], { data: newData })
    armedGroups.value.delete(gid)
    // also clear any per-part armed keys that belonged to this group
    for (const key of Array.from(armedParts.value)) {
      if (String(key).startsWith(gid + '::')) armedParts.value.delete(key)
    }
    try { store.refreshMergedAppearanceData() } catch (e) { /* ignore */ }
  } catch (e) {
    console.error('confirmGroupDelete failed', e)
  }
}

/* All delete */
function armAllDelete() {
  if (armedAll.value) {
    confirmAllDelete()
    return
  }
  armedAll.value = true
  armedGroups.value.clear()
  armedParts.value.clear()
}

function confirmAllDelete() {
  if (!hasSelected.value) return
  const si = store.selectedIndex
  if (si < 0) return
  try {
    store.stacks[si] = Object.assign({}, store.stacks[si], { data: [] })
    armedAll.value = false
    // clear related armed states
    armedGroups.value.clear()
    armedParts.value.clear()
    try { store.refreshMergedAppearanceData() } catch (e) { /* ignore */ }
  } catch (e) {
    console.error('confirmAllDelete failed', e)
  }
}

/* -------------------------
   Replace mode (mutually exclusive with focus)
   - uses studioStore.replaceTarget for cross-component visibility
   ------------------------- */

function toggleReplaceForPart(part, idx, gid) {
  const key = partUniqueKey(part, idx, gid)
  const current = store.replaceTarget
  if (current && current.active && current.key === key) {
    // currently in replace mode for this key -> clear
    store.clearReplaceTarget()
  } else {
    // enter replace mode for this part
    store.setReplaceTarget(part, key, false)
  }
}

function isPartReplaceArmed(part, idx, gid) {
  const key = partUniqueKey(part, idx, gid)
  const current = store.replaceTarget
  return !!(current && current.active && current.key === key)
}

/* -------------------------
   Cleanup watchers: reset armed when selection changes
   ------------------------- */
   
// Watch for index changes (switching between different outfits/stacks)
// Only reset the view state (collapsed groups, search) when the user actively switches stacks.
watch(() => store.selectedIndex, () => {
  searchTerm.value = ''
  collapsed.value = new Set()
})

// Watch for data changes (content updates within same stack OR stack switch)
// Clear transient interaction states (delete confirmation, replace target) to ensure safety.
watch(selected, () => {
  clearArmedStates()
  store.clearReplaceTarget()
})

/* -------------------------
   Global click handling to disarm when clicking elsewhere
   ------------------------- */
function onDocumentClick(e) {
  const target = e.target
  if (!rootEl.value) return
  const clickedInsideRoot = rootEl.value.contains(target)
  // if clicked outside the panel -> clear all armed states
  if (!clickedInsideRoot) {
    clearArmedStates()
    return
  }
  // clicked inside: if clicked on a delete button, do nothing (let its handler manage arm/confirm)
  const deleteBtn = target.closest ? target.closest('[data-delete-button]') : null
  if (deleteBtn) {
    // clicked a delete button -> don't auto-clear
    return
  }
  clearArmedStates()
}

onMounted(() => {
  doc.addEventListener('click', onDocumentClick, true) // use capture to be more robust
})

onBeforeUnmount(() => {
  doc.removeEventListener('click', onDocumentClick, true)
})
</script>

<style scoped>
.partlist-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
  padding: 8px;
}

/* header */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header h4 {
  margin: 0;
  font-size: 14px;
  color: var(--color-text-primary, #0f172a);
}

.header-controls {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* Global: remove all button focus shadow/ring to avoid layout jump */
button:focus,
.icon-btn:focus,
.control-buttons button:focus,
.chev:focus {
  outline: none;
  box-shadow: none !important;
}

/* Icon buttons: 关键调整
   - 固定尺寸（width/height）以保证垂直对齐
   - padding 归一化为 0，使用内联居中对齐图标/文字
   - box-sizing: border-box 确保 border 不会改变外部布局尺寸
   - 增大文字大小以满足可读性要求
*/
.icon-btn {
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-base);
  background: var(--color-bg-base);
  cursor: pointer;
  font-size: 15px;
  /* increased button text size */
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  color: var(--color-text-primary, #0f172a);
}

/* 保持禁用/状态样式，但不改变 border 宽度 */
.icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon-btn.active {
  background: var(--color-interactive-hover);
  /* border-color: var(--color-border-focus); */
}

.icon-btn.armed {
  background: var(--color-warning-bg, rgba(245, 158, 11, 0.15));
  border-color: var(--color-warning, #f59e0b);
}

/* 去掉 focus 默认外边框导致的布局跳动：全局禁止 focus 的 box-shadow（见上方） */
/* 为 keyboard focus 保留不改变尺寸的视觉提示（可选，使用 subtle outline inset） */
.icon-btn:focus-visible {
  outline: none;
}

/* controls */
.controls {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 4px 0;
  flex-wrap: wrap;
}

.search {
  flex: 1;
  padding: 8px 10px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-light, #f1f5f9);
  background: var(--color-bg-base, #fff);
  font-size: 13px;
  min-width: 120px;
  box-sizing: border-box;
}

.control-buttons {
  display: flex;
  gap: 6px;
  align-items: center;
}

.control-buttons button {
  padding: 6px 8px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-light, #f1f5f9);
  background: var(--color-bg-base, #fff);
  cursor: pointer;
  font-size: 13px;
  color: var(--color-text-primary, #0f172a);
  /* increased text size for control buttons */
}

.control-buttons button:hover {
  background: var(--color-bg-hover, #f1f5f9);
  border-color: var(--color-border-strong, #cbd5e1);
}

.control-buttons button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* toggle row */
.toggle-row {
  display: flex;
  gap: 16px;
  padding: 4px 0;
  flex-wrap: wrap;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text-secondary, #475569);
  cursor: pointer;
  white-space: nowrap;
}

.toggle-label input {
  cursor: pointer;
}

/* body: scrollable area */
.body {
  flex: 1 1 auto;
  overflow: auto;
  padding: 8px;
  border-radius: var(--radius-md, 8px);
  background: linear-gradient(180deg, var(--color-bg-base), var(--color-bg-surface));
  border: 1px solid var(--color-border-base);
  min-height: 0;
  box-sizing: border-box;
}

/* group card: 保持平面化 */
.group-card {
  border-radius: var(--radius-sm, 6px);
  background: var(--color-bg-base);
  border: 1px solid var(--color-border-base);
  padding: 8px;
  margin-bottom: 8px;
  box-shadow: none;
}

.group-card.hidden-group {
  background: var(--color-bg-panel, #f1f5f9);
  border-color: var(--color-border-strong, #cbd5e1);
  opacity: 0.95;
}

.group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.group-header .title {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  flex: 1;
}

.chev {
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  border: none;
  font-weight: 700;
  cursor: pointer;
  font-size: 14px;
  /* slightly larger for readability */
}

.gid {
  font-weight: 700;
  color: var(--color-text-primary, #0f172a);
  font-size: 13px;
}

.hidden-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: var(--radius-xs, 4px);
  background: var(--color-border-light, #f1f5f9);
  color: var(--color-text-secondary, #475569);
  font-weight: 500;
  margin-left: 4px;
}

.count {
  font-size: 12px;
  color: var(--color-text-tertiary, #64748b);
  margin-left: 6px;
}

.group-controls {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* part row: 平面化并铺满宽度，统一高度，垂直居中对齐 */
.part-row {
  display: flex;
  align-items: center;
  border-radius: 0;
  border: 0;
  margin: 0 0 4px 0;
  box-shadow: none;
  transition: none;
  width: 100%;
  box-sizing: border-box;
  min-height: 48px;
  /* 固定最小高度，便于对齐 */
  cursor: pointer;
}

/* hover 只做非常细微的颜色变化，不改变尺寸或边框宽度 */
.part-row:hover {
  background: var(--color-bg-hover);
}

/* 选中状态：使用左栏加背景色来标识（不影响水平对齐） */
.part-row.focused {
  border-left: 3px solid var(--color-selection-single);
  background: var(--color-selection-single-bg);
  padding-left: 9px;
  /* 保持内容对齐（minimize shift: 9 = 12 - 3） */
}

/* empty slot 行同样处理 */
.part-row.empty-slot {
  background: transparent;
  cursor: default;
}

.part-row.empty-slot.clickable {
  cursor: pointer;
}

.part-row.empty-slot.clickable:hover {
  background: var(--color-bg-hover);
}

/* 内容区：撑满宽度以便右侧按钮对齐 */
.row-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
}

/* 左侧文字列 */
.left-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.slot-name {
  font-size: 12px;
  color: var(--color-text-tertiary, #64748b);
  flex-shrink: 0;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--color-text-primary, #0f172a);
  text-align: left;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-name.empty {
  color: var(--color-text-muted, #94a3b8);
  font-weight: 400;
  font-style: italic;
}

/* per-part controls：保证高度、垂直居中，按钮固定大小以便严格对齐 */
.part-controls {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-left: 12px;
  flex: 0 0 auto;
}

/* 保证 icon-btn 在 part-controls 区域里的呈现完全一致（避免文字大小影响高度） */
.part-controls .icon-btn {
  width: 36px;
  height: 36px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* 删除按钮等视觉微调（不改变尺寸） */
.icon-btn.delete-btn {
  background: var(--color-bg-base, #fff);
}

.icon-btn.eye-btn {
  background: var(--color-bg-base, #fff);
}

.icon-btn.replace-btn {
  background: var(--color-bg-base, #fff);
}

/* 对于内联图标（emoji）或字体图标，确保垂直居中 */
.icon-btn>* {
  display: inline-block;
  line-height: 1;
}

/* ---------- 增强选中/预览/删除效果 ---------- */

/* Eye (可见/隐藏) 的选中效果：更明显的背景与边框，配合图标颜色变化 */
.icon-btn.eye-btn.active,
.icon-btn.eye-btn[aria-pressed="true"] {
  background: var(--color-bg-panel, #f1f5f9);
  /* border-color: rgba(161, 166, 180, 0.65); */
  /* color: #4b4f56; */
}

/* Replace (替换) 的选中效果：明确的强调色 */
.icon-btn.replace-btn.active,
.icon-btn.replace-btn[aria-pressed="true"] {
  background: var(--color-warning-bg, rgba(245, 158, 11, 0.15));
  border-color: var(--color-warning);
  color: var(--color-warning);
}

/* Delete 的预备删除（armed）效果：更强调的危险色调，注意不改变尺寸 */
.icon-btn.delete-btn.armed,
.icon-btn.delete-btn[data-armed="true"] {
  background: var(--color-error-bg);
  border-color: var(--color-error);
  /* subtle inner highlight to draw attention without changing layout */
  box-shadow: inset 0 0 0 1px var(--color-error-bg);
}

/* hover state for delete when not yet armed: mild warning on hover */
.icon-btn.delete-btn:hover:not(.disabled):not(.armed) {
  background: var(--color-error-bg);
  border-color: var(--color-error);
}

/* 统一按钮字体大小（包括 group-level controls）以保证视觉一致 */
.group-controls .icon-btn,
.header-controls .icon-btn,
.part-controls .icon-btn {
  font-size: 15px;
}

/* transitions: 删除视觉动画带来的尺寸闪烁 */
.fade-enter-active,
.fade-leave-active {
  transition: none;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 1;
  transform: none;
}
</style>


<style>
.vc-input__input {
  background-color: var(--color-bg-base, #fff) !important;
  color: var(--color-text-primary, #0f172a) !important;
  font-size: 16px !important;
}
</style>