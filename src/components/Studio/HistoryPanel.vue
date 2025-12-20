<template>
  <div class="history-panel">
    <div class="history-header">
      <h4>{{ t('history.title') }}</h4>
      <button 
        class="clear-btn" 
        @click="handleClearHistory"
        :disabled="!hasHistory"
        :title="t('history.clearTitle')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
        {{ t('history.clear') }}
      </button>
    </div>

    <div class="history-stats">
      <div class="stat-item">
        <span class="stat-label">{{ t('history.undoCount') }}:</span>
        <span class="stat-value">{{ historyData.undoCount }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">{{ t('history.redoCount') }}:</span>
        <span class="stat-value">{{ historyData.redoCount }}</span>
      </div>
    </div>

    <div class="history-timeline" ref="timelineRef">
      <!-- Redo stack (future states) - reversed order for proper visual flow -->
      <div
        v-for="(item, index) in reversedRedoStack"
        :key="`redo-${index}`"
        class="history-item redo-item"
        @click="jumpToRedoState(reversedRedoStack.length - 1 - index)"
        :title="getItemTitle(item, 'redo')"
      >
        <div class="item-indicator">
          <div class="item-dot redo-dot"></div>
          <div class="item-line" v-if="index < reversedRedoStack.length - 1"></div>
        </div>
        <div class="item-content">
          <div class="item-description">{{ item.description }}</div>
          <div class="item-timestamp">{{ formatTimestamp(item.timestamp) }}</div>
        </div>
      </div>

      <!-- Current state marker -->
      <div class="history-item current-state">
        <div class="item-indicator">
          <div class="item-dot current-dot"></div>
          <div class="item-line" v-if="historyData.undoCount > 0"></div>
        </div>
        <div class="item-content">
          <div class="current-label">{{ t('history.currentState') }}</div>
        </div>
      </div>

      <!-- Undo stack (past states) -->
      <div
        v-for="(item, index) in undoStack"
        :key="`undo-${index}`"
        class="history-item undo-item"
        @click="jumpToUndoState(index)"
        :title="getItemTitle(item, 'undo')"
      >
        <div class="item-indicator">
          <div class="item-dot undo-dot"></div>
          <div class="item-line" v-if="index < undoStack.length - 1"></div>
        </div>
        <div class="item-content">
          <div class="item-description">{{ item.description }}</div>
          <div class="item-timestamp">{{ formatTimestamp(item.timestamp) }}</div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="!hasHistory" class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        <p>{{ t('history.emptyState') }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStudioStore } from '@/stores/studioStore'
import * as DialogService from '@/services/DialogService.js'

const { t } = useI18n()
const store = useStudioStore()

const timelineRef = ref(null)

// Get full history data
const historyData = computed(() => {
  try {
    return store.getFullHistory()
  } catch (e) {
    console.warn('[HistoryPanel] Failed to get history:', e)
    return {
      undoStack: [],
      redoStack: [],
      undoCount: 0,
      redoCount: 0,
      canUndo: false,
      canRedo: false
    }
  }
})

const undoStack = computed(() => historyData.value.undoStack || [])
const redoStack = computed(() => historyData.value.redoStack || [])
const reversedRedoStack = computed(() => [...redoStack.value].reverse())

const hasHistory = computed(() => {
  return historyData.value.undoCount > 0 || historyData.value.redoCount > 0
})

// Format timestamp
function formatTimestamp(timestamp) {
  if (!timestamp) return ''
  
  const now = Date.now()
  const diff = now - timestamp
  
  // Less than 1 minute
  if (diff < 60000) {
    return t('history.justNow')
  }
  
  // Less than 1 hour
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000)
    return t('history.minutesAgo', { count: minutes })
  }
  
  // Less than 24 hours
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000)
    return t('history.hoursAgo', { count: hours })
  }
  
  // Show date
  const date = new Date(timestamp)
  return date.toLocaleString()
}

// Get item title for tooltip
function getItemTitle(item, type) {
  const typeLabel = type === 'redo' ? t('history.redoItem') : t('history.undoItem')
  const time = item.timestamp ? new Date(item.timestamp).toLocaleString() : ''
  return `${typeLabel}: ${item.description}${time ? '\n' + time : ''}`
}

// Jump to a specific redo state
function jumpToRedoState(index) {
  if (index < 0 || index >= redoStack.value.length) return
  
  // Number of redo steps needed
  const steps = index + 1
  store.jumpToHistoryState(steps)
}

// Jump to a specific undo state
function jumpToUndoState(index) {
  if (index < 0 || index >= undoStack.value.length) return
  
  // Number of undo steps needed (index 0 is most recent, so we undo (undoStack.length - index) times)
  const steps = -(undoStack.value.length - index)
  store.jumpToHistoryState(steps)
}

// Clear history with confirmation
async function handleClearHistory() {
  if (!hasHistory.value) return
  
  const confirmed = await DialogService.confirm(
    t('history.clearConfirmMessage')
  )
  
  if (confirmed) {
    store.clearHistory()
  }
}

// Auto-scroll to current state when history changes
watch(() => historyData.value.undoCount + historyData.value.redoCount, async () => {
  await nextTick()
  scrollToCurrentState()
}, { flush: 'post' })

function scrollToCurrentState() {
  if (!timelineRef.value) return
  
  const currentStateEl = timelineRef.value.querySelector('.current-state')
  if (currentStateEl) {
    currentStateEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}
</script>

<style scoped>
.history-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-base, #ffffff);
  overflow: hidden;
}

.history-header {
  padding: var(--space-md, 12px);
  border-bottom: 1px solid var(--color-border-base, #e2e8f0);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.history-header h4 {
  margin: 0;
  font-size: var(--font-size-md, 14px);
  font-weight: var(--font-weight-semibold, 600);
  color: var(--color-text-primary, #1e293b);
}

.clear-btn {
  display: flex;
  align-items: center;
  gap: var(--space-xs, 4px);
  padding: var(--space-xs, 4px) var(--space-sm, 8px);
  border: 1px solid var(--color-border-base, #e2e8f0);
  border-radius: var(--radius-sm, 6px);
  background: var(--color-bg-base, #ffffff);
  color: var(--color-text-secondary, #64748b);
  font-size: var(--font-size-sm, 12px);
  cursor: pointer;
  transition: all 0.15s ease;
}

.clear-btn:hover:not(:disabled) {
  background: var(--color-error-bg, #fee2e2);
  border-color: var(--color-error, #ef4444);
  color: var(--color-error, #ef4444);
}

.clear-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.history-stats {
  padding: var(--space-sm, 8px) var(--space-md, 12px);
  background: var(--color-bg-hover, #f1f5f9);
  border-bottom: 1px solid var(--color-border-base, #e2e8f0);
  display: flex;
  gap: var(--space-lg, 16px);
  flex-shrink: 0;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: var(--space-xs, 4px);
  font-size: var(--font-size-sm, 12px);
}

.stat-label {
  color: var(--color-text-secondary, #64748b);
}

.stat-value {
  font-weight: var(--font-weight-semibold, 600);
  color: var(--color-text-primary, #1e293b);
}

.history-timeline {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-md, 12px);
}

.history-item {
  display: flex;
  gap: var(--space-sm, 8px);
  padding: var(--space-sm, 8px);
  border-radius: var(--radius-sm, 6px);
  transition: all 0.15s ease;
  position: relative;
}

.history-item:not(.current-state) {
  cursor: pointer;
}

.history-item:not(.current-state):hover {
  background: var(--color-bg-hover, #f1f5f9);
}

.item-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  width: 16px;
  position: relative;
}

.item-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid;
  background: var(--color-bg-base, #ffffff);
  flex-shrink: 0;
  z-index: 1;
}

.undo-dot {
  border-color: var(--color-primary, #3b82f6);
}

.redo-dot {
  border-color: var(--color-text-tertiary, #94a3b8);
  opacity: 0.6;
}

.current-dot {
  border-color: var(--color-success, #10b981);
  background: var(--color-success, #10b981);
  box-shadow: 0 0 0 3px var(--color-success-bg, #d1fae5);
}

.item-line {
  position: absolute;
  top: 12px;
  width: 2px;
  height: calc(100% + 16px);
  background: var(--color-border-base, #e2e8f0);
}

.redo-item .item-line {
  background: var(--color-border-light, #f1f5f9);
}

.item-content {
  flex: 1;
  min-width: 0;
  padding-top: 1px;
}

.item-description {
  font-size: var(--font-size-sm, 12px);
  color: var(--color-text-primary, #1e293b);
  font-weight: var(--font-weight-medium, 500);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.redo-item .item-description {
  color: var(--color-text-tertiary, #94a3b8);
  font-style: italic;
}

.item-timestamp {
  font-size: var(--font-size-xs, 11px);
  color: var(--color-text-tertiary, #94a3b8);
  margin-top: 2px;
}

.current-state {
  margin: var(--space-sm, 8px) 0;
}

.current-label {
  font-size: var(--font-size-sm, 12px);
  font-weight: var(--font-weight-semibold, 600);
  color: var(--color-success, #10b981);
  padding-top: 1px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-2xl, 32px);
  text-align: center;
  color: var(--color-text-tertiary, #94a3b8);
  gap: var(--space-md, 12px);
}

.empty-state svg {
  opacity: 0.5;
}

.empty-state p {
  margin: 0;
  font-size: var(--font-size-sm, 12px);
}

/* Scrollbar styling */
.history-timeline::-webkit-scrollbar {
  width: 8px;
}

.history-timeline::-webkit-scrollbar-track {
  background: var(--color-bg-base, #ffffff);
}

.history-timeline::-webkit-scrollbar-thumb {
  background: var(--color-border-strong, #cbd5e1);
  border-radius: 4px;
}

.history-timeline::-webkit-scrollbar-thumb:hover {
  background: var(--color-border-strong, #94a3b8);
}
</style>
