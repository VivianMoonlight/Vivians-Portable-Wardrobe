<template>
  <div class="detail-panel" role="region" :aria-label="t('stackDetail.ariaLabel')">
    <div class="header">
      <h4>{{ t('stackDetail.title') }}</h4>
      <div class="actions">
        <button @click="downloadSelected" :disabled="!hasSelected" :title="t('stackDetail.downloadTitle')">{{ t('stackDetail.download') }}</button>
        <button @click="copyWhole" :disabled="!hasSelected" :title="t('stackDetail.copyTitle')">{{ t('stackDetail.copy') }}</button>
      </div>
    </div>

    <div class="body">
      <div v-if="!hasSelected" class="placeholder">
        {{ t('stackDetail.placeholder') }}
      </div>

      <div v-else class="items-list">
        <div v-for="(part, idx) in items" :key="idx" class="part-card">
          <div class="part-head">
            <div class="left">
              <div class="pname" :title="part.Name">{{ part.Name || t('stackDetail.unnamed') }}</div>
              <div class="pgroup">{{ part.Group || '-' }}</div>
            </div>
            <div class="right">
              <button class="small" @click="copyPart(part)">{{ t('stackDetail.copy') }}</button>
            </div>
          </div>

          <div class="part-body">
            <div class="row"><label>{{ t('stackDetail.name') }}</label><div class="val">{{ part.Name || '' }}</div></div>
            <div class="row"><label>{{ t('stackDetail.group') }}</label><div class="val">{{ part.Group || '' }}</div></div>
            <div class="row"><label>{{ t('stackDetail.color') }}</label>
              <div class="val color-list">
                <template v-if="Array.isArray(part.Color) && part.Color.length">
                  <span v-for="(c,i) in part.Color" :key="i" class="color-chip">{{ c }}</span>
                </template>
                <template v-else-if="part.Color">
                  <span class="color-chip">{{ part.Color }}</span>
                </template>
                <template v-else><span class="muted">—</span></template>
              </div>
            </div>

            <!-- Property group -->
            <div v-if="part.Property" class="prop-block">
              <div class="prop-title">{{ t('stackDetail.property') }}</div>

              <div v-if="part.Property.OverridePriority" class="prop-sub">
                <div class="sub-title">{{ t('stackDetail.overridePriority') }}</div>
                <div class="kv-list">
                  <div v-for="(v,k) in part.Property.OverridePriority" :key="k" class="kv">
                    <span class="k">{{ k }}</span><span class="v">{{ v }}</span>
                  </div>
                </div>
              </div>

              <div v-if="part.Property.Opacity !== undefined" class="prop-sub">
                <div class="sub-title">{{ t('stackDetail.opacity') }}</div>
                <div class="kv-list">
                  <div v-for="(v,i) in ensureArray(part.Property.Opacity)" :key="i" class="kv">
                    <span class="k">#{{ i + 1 }}</span><span class="v">{{ v }}</span>
                  </div>
                </div>
              </div>

              <div v-if="part.Property.TypeRecord" class="prop-sub">
                <div class="sub-title">{{ t('stackDetail.typeRecord') }}</div>
                <div class="kv-list">
                  <div v-for="(v,k) in part.Property.TypeRecord" :key="k" class="kv">
                    <span class="k">{{ k }}</span><span class="v">{{ v }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Craft or other fields: show abbreviated JSON -->
            <div v-if="part.Craft" class="prop-block">
              <div class="prop-title">{{ t('stackDetail.craftSummary') }}</div>
              <pre class="craft-json">{{ shortJson(part.Craft) }}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStudioDomainStores } from '@/stores/studio'

const { t } = useI18n()

const { studio: store } = useStudioDomainStores()
const selected = computed(() => store.selectedElement)
const hasSelected = computed(() => !!selected.value && Array.isArray(selected.value.data))
const items = computed(() => (selected.value?.data) || [])

// helpers
function ensureArray(v) {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}
function shortJson(obj) {
  try { return JSON.stringify(obj, null, 2) } catch (e) { return String(obj) }
}

// copy individual part JSON
async function copyPart(part) {
  try {
    await navigator.clipboard.writeText(JSON.stringify(part, null, 2))
    console.info('Part JSON copied')
  } catch (e) {
    // fallback: select + execCommand
    const ta = document.createElement('textarea')
    ta.value = JSON.stringify(part, null, 2)
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
}

// copy entire selected element JSON
async function copyWhole() {
  if (!selected.value) return
  try {
    await navigator.clipboard.writeText(JSON.stringify(selected.value, null, 2))
    console.info('Element JSON copied')
  } catch (e) {
    const ta = document.createElement('textarea')
    ta.value = JSON.stringify(selected.value, null, 2)
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
}

// download selected element as file
function downloadSelected() {
  if (!selected.value) return
  const data = JSON.stringify(selected.value, null, 2)
  const blob = new Blob([data], { type: 'application/json;charset=utf-8' })
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
</script>

<style scoped>
.detail-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
}

/* header */
.header {
  display:flex;
  align-items:center;
  justify-content:space-between;
}
.header h4 { margin:0; font-size:15px; color:var(--color-text-primary, #0f172a); }
.header .actions button {
  margin-left:8px;
  padding:6px 8px;
  border-radius: var(--radius-md, 8px);
  border:1px solid var(--color-border-light, #f1f5f9);
  background:var(--color-bg-base, #fff);
  cursor:pointer;
  font-size:13px;
}

/* body */
.body {
  flex:1;
  overflow:auto;
  padding:8px;
  border-radius: var(--radius-md, 8px);
  background:linear-gradient(180deg,var(--color-bg-base, #fff),var(--color-bg-surface, #f8fafc));
  border:1px solid var(--color-border-base, #e2e8f0);
}

/* placeholder */
.placeholder {
  color:var(--color-text-tertiary, #64748b);
  padding:12px;
  text-align:center;
}

/* items list */
.items-list { display:flex; flex-direction:column; gap:10px; padding-bottom:12px; }

/* part card */
.part-card {
  border-radius: var(--radius-md, 8px);
  background:var(--color-bg-base, #fff);
  border:1px solid var(--color-border-base, #e2e8f0);
  padding:8px;
  box-shadow:var(--shadow-sm);
}
.part-head {
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:8px;
  margin-bottom:8px;
}
.part-head .left { display:flex; flex-direction:column; gap:2px; }
.pname { font-weight:700; font-size:13px; color:var(--color-text-primary, #0f172a); max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pgroup { font-size:12px; color:var(--color-text-tertiary, #64748b); }

.part-head .right .small {
  padding:6px 8px;
  border-radius: var(--radius-md, 8px);
  border:1px solid var(--color-border-light, #f1f5f9);
  background:var(--color-bg-base, #fff);
  cursor:pointer;
  font-size:12px;
}

/* body rows: label/value with narrow labels */
.part-body { display:flex; flex-direction:column; gap:6px; }
.row { display:flex; gap:8px; align-items:flex-start; }
.row label { width:86px; flex:0 0 86px; font-weight:600; color:var(--color-text-secondary, #475569); font-size:12px; }
.row .val { flex:1; font-size:13px; color:var(--color-text-primary, #0f172a); word-break:break-word; }

/* color chips small */
.color-list { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
.color-chip {
  padding:4px 6px;
  font-size:12px;
  border-radius: var(--radius-sm, 6px);
  background:var(--color-bg-surface, #f8fafc);
  border:1px solid var(--color-border-light, #f1f5f9);
  color:var(--color-text-primary, #0f172a);
}

/* property block */
.prop-block { margin-top:6px; padding-top:6px; border-top:1px dashed var(--color-border-light, #f1f5f9); }
.prop-title { font-weight:700; color:var(--color-text-primary, #0f172a); margin-bottom:6px; font-size:13px; }
.prop-sub { margin-bottom:6px; }
.sub-title { font-weight:600; color:var(--color-text-secondary, #475569); margin-bottom:6px; font-size:12px; }
.kv-list { display:flex; flex-direction:column; gap:4px; }
.kv { display:flex; justify-content:space-between; gap:12px; padding:4px 6px; background:var(--color-bg-surface, #f8fafc); border-radius: var(--radius-sm, 6px); border:1px solid var(--color-border-base, #e2e8f0); }
.k { font-weight:600; color:var(--color-text-primary, #0f172a); width:110px; flex:0 0 110px; font-size:12px; }
.v { color:var(--color-text-primary, #0f172a); font-size:13px; text-align:right; flex:1; }

/* craft JSON small */
.craft-json { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Courier New", monospace; font-size:11px; padding:6px; background:var(--color-bg-surface, #f8fafc); color:var(--color-text-primary, #0f172a); border-radius: var(--radius-sm, 6px); overflow:auto; max-height:120px; }
.muted { color:var(--color-text-muted, #94a3b8); }
</style>