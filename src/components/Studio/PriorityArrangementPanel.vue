
<template>
  <div class="priority-panel" role="region" :aria-label="t('priorityArrangement.ariaLabel')">
    <div class="header">
      <h4>{{ t('priorityArrangement.title') }}</h4>
      <div class="actions">
        <button @click="refresh" :disabled="!hasSelected">{{ t('priorityArrangement.refresh') }}</button>
      </div>
    </div>

    <div class="body" ref="bodyRef">
      <div v-if="!hasSelected" class="placeholder">{{ t('priorityArrangement.placeholder') }}</div>

      <div v-else>
        <div class="meta">
          <div><strong>{{ t('priorityArrangement.name') }}</strong> {{ selected?.name || '(unnamed)' }}</div>
          <div><strong>{{ t('priorityArrangement.parts') }}</strong> {{ (selected?.data?.length ?? 0) }}</div>
        </div>

        <div v-if="priorityList.length === 0" class="placeholder">{{ t('priorityArrangement.emptyStack') }}</div>

        <div v-else class="groups-list" ref="groupsListRef">
          <div
            v-for="(grp, idx) in priorityList"
            :key="groupKey(grp, idx)"
            class="group-card"
            :data-prio="String(grp.priority)"
            @dragover.prevent
            @drop.prevent="onDropToGroup($event, grp)"
          >
            <div class="group-header">
              <div class="left" @click="toggleGroupCollapse(idx)">
                <div class="fold-arrow" :class="{ collapsed: isGroupCollapsed(idx) }">{{ isGroupCollapsed(idx) ? '▸' : '▾' }}</div>
                <div class="tag">{{ t('priorityArrangement.priority') }} <strong>{{ formatPriority(grp.priority) }}</strong></div>
                <div class="prio">{{ t('priorityArrangement.layers') }} {{ countLayersInGroup(grp) }}</div>
              </div>

              <div class="right">
                <span class="hint">{{ t('priorityArrangement.dropHint') }}</span>
              </div>
            </div>

            <transition name="collapse-fast">
              <div v-show="!isGroupCollapsed(idx)" class="group-body">
                <div v-for="part in grp.parts" :key="part.partIndex" class="part-block">
                  <div class="part-header"
                       draggable="true"
                       @dragstart="onDragStartPart($event, part.partIndex)"
                       @click="togglePartCollapse(idx, part.partIndex)"
                  >
                    <div class="part-title">{{ part.description || ('part#' + part.partIndex) }}</div>
                    <div class="part-fold">{{ isPartCollapsed(idx, part.partIndex) ? '▸' : '▾' }}</div>
                  </div>

                  <transition name="collapse-fast">
                    <div v-show="!isPartCollapsed(idx, part.partIndex)" class="part-body">
                      <div
                        v-for="layer in part.layers"
                        :key="part.partIndex + '-' + layer.layerIndex"
                        class="layer-row"
                        draggable="true"
                        @dragstart="onDragStartLayer($event, part.partIndex, layer.layerIndex)"
                      >
                        <div class="layer-name">{{ layer.displayName || layer.name || ('#' + (layer.layerIndex + 1)) }}</div>
                        <div class="layer-meta">part #{{ layer.partIndex }}</div>
                      </div>
                    </div>
                  </transition>
                </div>
              </div>
            </transition>
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

const { t } = useI18n()

const store = useStudioStore()
const selected = computed(() => store.selectedElement)
const hasSelected = computed(() => !!selected.value)

const priorityList = computed(() => {
  // dynamic computed representation built from selected element
  return store.getPriorityListForSelected() || []
})

/* local collapse state keyed by group index and part index */
const collapsedGroups = ref(new Set())
const collapsedPartsMap = ref({}) // groupIdx -> Set(partIndex)

watch(priorityList, () => {
  // reset collapse state when list changes
  collapsedGroups.value = new Set(priorityList.value.map((_, i) => i))
  const m = {}
  for (let i = 0; i < priorityList.value.length; i++) {
    const g = priorityList.value[i]
    const set = new Set()
    for (const p of g.parts) set.add(p.partIndex)
    m[i] = set
  }
  collapsedPartsMap.value = m
}, { immediate: true, deep: true })

function toggleGroupCollapse(i) {
  const s = new Set(collapsedGroups.value)
  if (s.has(i)) s.delete(i)
  else s.add(i)
  collapsedGroups.value = s
}
function isGroupCollapsed(i) { return collapsedGroups.value.has(i) }

function togglePartCollapse(groupIdx, partIndex) {
  const m = Object.assign({}, collapsedPartsMap.value)
  if (!m[groupIdx]) m[groupIdx] = new Set()
  const s = new Set(m[groupIdx])
  if (s.has(partIndex)) s.delete(partIndex)
  else s.add(partIndex)
  m[groupIdx] = s
  collapsedPartsMap.value = m
}
function isPartCollapsed(groupIdx, partIndex) {
  const m = collapsedPartsMap.value || {}
  if (!m[groupIdx]) return true
  return m[groupIdx].has(partIndex)
}

/* Drag & Drop
   - When dragging a part: we send type 'part' + partIndex
   - When dragging a layer: send type 'layer' + partIndex + layerIndex
*/

function onDragStartPart(e, partIndex) {
  try {
    e.dataTransfer.setData('application/json', JSON.stringify({ type: 'part', partIndex }))
    e.dataTransfer.effectAllowed = 'move'
  } catch (err) {}
}
function onDragStartLayer(e, partIndex, layerIndex) {
  try {
    e.dataTransfer.setData('application/json', JSON.stringify({ type: 'layer', partIndex, layerIndex }))
    e.dataTransfer.effectAllowed = 'move'
  } catch (err) {}
}

async function onDropToGroup(e, group) {
  if (!hasSelected.value) return
  let payload = null
  try {
    const txt = e.dataTransfer.getData('application/json')
    payload = txt ? JSON.parse(txt) : null
  } catch (err) {
    payload = null
  }
  if (!payload) return

  const updates = []
  if (payload.type === 'part') {
    updates.push({ type: 'part', partIndex: payload.partIndex, newPriority: group.priority })
  } else if (payload.type === 'layer') {
    updates.push({ type: 'layer', partIndex: payload.partIndex, layerIndex: payload.layerIndex, newPriority: group.priority })
  }

  if (updates.length) {
    // ask store to apply updates immutably
    store.updatePrioritiesForSelected(updates)
    // after update the computed priorityList will refresh automatically
  }
}

function refresh() {
  // recompute (no-op but kept for explicit refresh button)
  store.recomputePrioritiesForSelected()
}

/* helpers for display */
function formatPriority(p) {
  if (p === null || p === undefined) return 'default'
  return String(p)
}
function groupKey(grp, idx) {
  return String(grp.priority) + '::' + idx
}
function countLayersInGroup(grp) {
  let c = 0
  for (const p of grp.parts) c += (p.layers || []).length
  return c
}
</script>

<style scoped>
.priority-panel {
  height: 100%;
  display:flex;
  flex-direction:column;
  gap:8px;
  padding-left:8px;
  box-sizing:border-box;
}
.header { display:flex; align-items:center; justify-content:space-between; }
.header h4 { margin:0; font-size:15px; color:var(--color-text-primary, #0f172a); }
.header .actions button { margin-left:8px; padding:6px 10px; border-radius: var(--radius-md, 8px); border:1px solid var(--color-border-light, #f1f5f9); background:var(--color-bg-base, #fff); cursor:pointer; font-size:13px; }

.body {
  flex:1;
  overflow:auto;
  padding:8px;
  border-radius: var(--radius-md, 8px);
  background:linear-gradient(180deg,var(--color-bg-base, #fff),var(--color-bg-surface, #f8fafc));
  border:1px solid var(--color-border-base, #e2e8f0);
  min-height:0;
}
.placeholder { color:var(--color-text-tertiary, #64748b); padding:12px; text-align:center; }

.meta { color:var(--color-text-secondary, #475569); font-size:13px; display:flex; gap:12px; margin-bottom:8px; }

.groups-list { display:flex; flex-direction:column; gap:10px; position:relative; padding:8px 0; }

/* group card */
.group-card {
  border-radius: var(--radius-md, 8px);
  background:var(--color-bg-base, #fff);
  border:1px solid var(--color-border-base, #e2e8f0);
  padding:8px;
  user-select: none;
}
.clear-card { border-style:dashed; background: linear-gradient(180deg,var(--color-bg-surface, #f8fafc),var(--color-bg-base, #fff)); }
.group-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
.group-header .left { display:flex; align-items:center; gap:8px; min-width:0; }
.tag { font-weight:700; color:var(--color-text-primary, #0f172a); }
.prio { font-size:12px; color:var(--color-text-tertiary, #64748b); margin-left:4px; }

.fold-arrow { font-size:12px; color:var(--color-text-tertiary, #64748b); width:18px; display:inline-flex; align-items:center; justify-content:center; }

/* part block */
.part-block { border-radius: var(--radius-sm, 6px); border:1px dashed var(--color-border-light, #f1f5f9); padding:6px; background:linear-gradient(180deg,var(--color-bg-surface, #f8fafc),var(--color-bg-base, #ffffff)); margin-bottom:8px; }
.part-header { display:flex; justify-content:space-between; align-items:center; padding:4px 6px; cursor:grab; }
.part-title { font-weight:700; color:var(--color-text-primary, #0f172a); }
.part-fold { color:var(--color-text-tertiary, #64748b); font-size:12px; }

/* part body / layer rows */
.part-body { padding-top:6px; display:flex; flex-direction:column; gap:6px; }
.layer-row { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px; border-radius: var(--radius-sm, 6px); background:linear-gradient(180deg,var(--color-bg-base, #ffffff),var(--color-bg-surface, #f8fafc)); border:1px solid var(--color-border-light, #f1f5f9); cursor:grab; }
.layer-name { font-weight:600; color:var(--color-text-primary, #0f172a); }
.layer-meta { font-size:12px; color:var(--color-text-tertiary, #64748b); }

/* small placeholder inside clear bucket */
.placeholder.small { padding:6px; font-size:12px; color:var(--color-text-muted, #94a3b8); }

/* visual drop hint */
.group-card.drag-over {
  box-shadow: var(--shadow-md);
  border-color: var(--color-selection-single, #417aed);
}

</style>