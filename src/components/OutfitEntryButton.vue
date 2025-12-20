<!-- src/components/OutfitEntryButton.vue -->
<template>
  <div>
    <!-- 浮动入口按钮 -->
    <button
      class="outfit-entry-btn"
      @click="openPanel"
      title="打开衣柜"
    >
      👗
    </button>
    <!-- 遮罩与OutfitPanel -->
    <teleport to="body">
      <div v-if="showPanel" class="outfit-panel-overlay" :class="themeClass" @click.self="closePanel">
        <OutfitPanel
          @close="closePanel"
          @import="emit('import')"
          @export="emit('export')"
          @save="emit('save')"
        >
          <slot />
        </OutfitPanel>
      </div>
    </teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import OutfitPanel from './OutfitPanel.vue'
import { injectTheme } from '@/composables/useTheme'

const showPanel = ref(false)
const emit = defineEmits(['import', 'export', 'save'])

// Inject theme for teleported overlay
const injectedTheme = injectTheme()
const themeClass = computed(() => injectedTheme.themeClass())

function openPanel() {
  showPanel.value = true
}
function closePanel() {
  showPanel.value = false
}

// ESC关闭
function escHandler(e) {
  if (e.key === 'Escape') closePanel()
}
onMounted(() => {
  window.addEventListener('keydown', escHandler)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', escHandler)
})
</script>

<style scoped>
.outfit-entry-btn {
  position: fixed;
  bottom: 48px;
  right: 48px;
  width: 56px;
  height: 56px;
  border-radius: var(--radius-round, 50%);
  background: var(--color-bg-base, #fff);
  border: 2px solid var(--color-border-base, #e2e8f0);
  box-shadow: var(--shadow-md, 0 4px 6px -1px rgba(0,0,0,0.1));
  font-size: 31px;
  cursor: pointer;
  outline: none;
  z-index: 3000;
  transition: background var(--transition-base, 0.2s), box-shadow var(--transition-base, 0.2s);
}
.outfit-entry-btn:hover {
  background: var(--color-bg-hover, #f1f5f9);
  box-shadow: var(--shadow-lg, 0 10px 15px -3px rgba(0,0,0,0.1));
  border-color: var(--color-primary, #3b82f6);
}

.outfit-panel-overlay {
  position: fixed;
  z-index: 9998;
  left: 0;
  top: 0;
  width: 100vw;
  height: 100vh;
  background: var(--color-overlay, rgba(15, 23, 42, 0.3));
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>