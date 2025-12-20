<template>
  <div class="themed-status-widget" v-if="showWidget">
    <div class="widget-header">
      <span class="widget-title">Themed BC Status</span>
      <button 
        class="widget-close-btn" 
        @click="showWidget = false"
        aria-label="Close widget"
      >
        ×
      </button>
    </div>
    
    <div class="widget-content">
      <div class="status-item">
        <span class="status-label">Detected:</span>
        <span class="status-value" :class="{ 'status-yes': status.detected, 'status-no': !status.detected }">
          {{ status.detected ? 'Yes' : 'No' }}
        </span>
      </div>
      
      <div class="status-item" v-if="status.detected">
        <span class="status-label">Enabled:</span>
        <span class="status-value" :class="{ 'status-yes': status.enabled, 'status-no': !status.enabled }">
          {{ status.enabled ? 'Yes' : 'No' }}
        </span>
      </div>
      
      <div class="status-item" v-if="status.version">
        <span class="status-label">Version:</span>
        <span class="status-value">{{ status.version }}</span>
      </div>
      
      <div class="status-item" v-if="status.detected">
        <span class="status-label">GUI Overhaul:</span>
        <span class="status-value" :class="{ 'status-yes': status.guiOverhaul, 'status-no': !status.guiOverhaul }">
          {{ status.guiOverhaul ? 'Yes' : 'No' }}
        </span>
      </div>
      
      <div class="status-item" v-if="status.detected">
        <span class="status-label">Using Themed Colors:</span>
        <span class="status-value" :class="{ 'status-yes': status.usingThemedColors, 'status-no': !status.usingThemedColors }">
          {{ status.usingThemedColors ? 'Yes' : 'No' }}
        </span>
      </div>
      
      <div class="status-item" v-if="status.detected && status.enabled">
        <span class="status-label">Available Colors:</span>
        <span class="status-value">{{ status.availableColors }}</span>
      </div>
      
      <div class="widget-actions" v-if="status.detected">
        <button 
          class="action-btn"
          @click="handleToggleIntegration"
          :disabled="!status.enabled"
        >
          {{ status.usingThemedColors ? 'Disable' : 'Enable' }} Integration
        </button>
        
        <button 
          class="action-btn"
          @click="handleSync"
          :disabled="!status.enabled"
        >
          Sync Colors
        </button>
      </div>
      
      <div class="info-message" v-if="!status.detected">
        <p>Themed BC plugin is not detected. vue-wardrobe is using default themes.</p>
      </div>
      
      <div class="info-message" v-else-if="!status.enabled">
        <p>Themed BC is installed but not active. Enable it to use custom colors.</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useTheme } from '../composables/useTheme'

const showWidget = ref(true)
const status = ref({
  detected: false,
  enabled: false,
  version: null,
  guiOverhaul: false,
  usingThemedColors: false,
  availableColors: 0,
})

const { getThemedStatus, toggleThemedIntegration, syncWithThemed } = useTheme()

onMounted(() => {
  updateStatus()
})

const updateStatus = () => {
  status.value = getThemedStatus()
}

const handleToggleIntegration = () => {
  toggleThemedIntegration(!status.value.usingThemedColors)
  setTimeout(updateStatus, 100)
}

const handleSync = () => {
  syncWithThemed()
  setTimeout(updateStatus, 100)
}
</script>

<style scoped>
.themed-status-widget {
  position: fixed;
  top: 20px;
  right: 20px;
  width: 320px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-base);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  z-index: 9999;
  font-size: var(--font-size-sm);
  overflow: hidden;
}

.widget-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-md);
  background: var(--color-bg-panel);
  border-bottom: 1px solid var(--color-border-base);
}

.widget-title {
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.widget-close-btn {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}

.widget-close-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.widget-content {
  padding: var(--space-md);
}

.status-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-sm) 0;
  border-bottom: 1px solid var(--color-border-light);
}

.status-item:last-child {
  border-bottom: none;
}

.status-label {
  color: var(--color-text-secondary);
  font-weight: var(--font-weight-medium);
}

.status-value {
  color: var(--color-text-primary);
  font-weight: var(--font-weight-semibold);
}

.status-yes {
  color: var(--color-success);
}

.status-no {
  color: var(--color-text-tertiary);
}

.widget-actions {
  display: flex;
  gap: var(--space-sm);
  margin-top: var(--space-md);
  padding-top: var(--space-md);
  border-top: 1px solid var(--color-border-light);
}

.action-btn {
  flex: 1;
  padding: var(--space-sm) var(--space-md);
  background: var(--color-primary);
  color: var(--color-text-inverse);
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.action-btn:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.info-message {
  margin-top: var(--space-md);
  padding: var(--space-md);
  background: var(--color-info-bg);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
}

.info-message p {
  margin: 0;
  line-height: 1.5;
}
</style>
