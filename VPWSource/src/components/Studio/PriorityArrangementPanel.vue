
<template>
  <div class="priority-panel" role="region" aria-label="Priority Arrangement 面板">
    <div class="header">
      <h4>Priority Arrangement</h4>
      <div class="actions">
        <button @click="refresh" :disabled="!hasSelected">刷新</button>
      </div>
    </div>

    <div class="body" ref="bodyRef">
      <div v-if="!hasSelected" class="placeholder">请选择一个 element（stack）查看优先级分组</div>

      <div v-else>
        <div class="meta">
          <div><strong>Name:</strong> {{ selected?.name || '(unnamed)' }}</div>
          <div><strong>Parts:</strong> {{ (selected?.data?.length ?? 0) }}</div>
        </div>

        <div v-if="priorityList.length === 0" class="placeholder">当前 stack 中没有任何 layer overridePriority 设置</div>

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
                <div class="tag">Priority: <strong>{{ formatPriority(grp.priority) }}</strong></div>
                <div class="prio">Layers: {{ countLayersInGroup(grp) }}</div>
              </div>

              <div class="right">
                <span class="hint">将 layer/part 拖入此处以设置其 overridePriority</span>
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
import { useStudioStore } from '@/stores/studioStore'

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
.header h4 { margin:0; font-size:15px; color:#21314a; }
.header .actions button { margin-left:8px; padding:6px 10px; border-radius:8px; border:1px solid #e6eef6; background:#fff; cursor:pointer; font-size:13px; }

.body {
  flex:1;
  overflow:auto;
  padding:8px;
  border-radius:8px;
  background:linear-gradient(180deg,#fff,#fbfdff);
  border:1px solid rgba(220,230,240,0.6);
  min-height:0;
}
.placeholder { color:#7d8795; padding:12px; text-align:center; }

.meta { color:#31445b; font-size:13px; display:flex; gap:12px; margin-bottom:8px; }

.groups-list { display:flex; flex-direction:column; gap:10px; position:relative; padding:8px 0; }

/* group card */
.group-card {
  border-radius:8px;
  background:#fff;
  border:1px solid rgba(220,230,240,0.7);
  padding:8px;
  user-select: none;
}
.clear-card { border-style:dashed; background: linear-gradient(180deg,#fffefc,#fff); }
.group-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
.group-header .left { display:flex; align-items:center; gap:8px; min-width:0; }
.tag { font-weight:700; color:#21314a; }
.prio { font-size:12px; color:#6e7a8d; margin-left:4px; }

.fold-arrow { font-size:12px; color:#6e7a8d; width:18px; display:inline-flex; align-items:center; justify-content:center; }

/* part block */
.part-block { border-radius:6px; border:1px dashed rgba(230,235,240,0.6); padding:6px; background:linear-gradient(180deg,#fbfdff,#ffffff); margin-bottom:8px; }
.part-header { display:flex; justify-content:space-between; align-items:center; padding:4px 6px; cursor:grab; }
.part-title { font-weight:700; color:#21314a; }
.part-fold { color:#6e7a8d; font-size:12px; }

/* part body / layer rows */
.part-body { padding-top:6px; display:flex; flex-direction:column; gap:6px; }
.layer-row { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px; border-radius:6px; background:linear-gradient(180deg,#ffffff,#fbfdff); border:1px solid rgba(240,245,250,0.9); cursor:grab; }
.layer-name { font-weight:600; color:#1f334a; }
.layer-meta { font-size:12px; color:#6e7a8d; }

/* small placeholder inside clear bucket */
.placeholder.small { padding:6px; font-size:12px; color:#9aa3b2; }

/* visual drop hint */
.group-card.drag-over {
  box-shadow: 0 8px 24px rgba(80,120,200,0.06);
  border-color: rgba(90,140,255,0.6);
}

</style>