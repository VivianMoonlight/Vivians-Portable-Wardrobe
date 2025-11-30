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
      <div v-if="showPanel" class="outfit-panel-overlay" @click.self="closePanel">
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
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import OutfitPanel from './OutfitPanel.vue'

const showPanel = ref(false)
const emit = defineEmits(['import', 'export', 'save'])

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
  border-radius: 50%;
  background: #fff;
  border: 2px solid #ccc;
  box-shadow: 0 2px 10px rgba(65,80,100,0.13);
  font-size: 31px;
  cursor: pointer;
  outline: none;
  z-index: 3000;
  transition: background 0.2s, box-shadow 0.2s;
}
.outfit-entry-btn:hover {
  background: #e1f5fe;
  box-shadow: 0 4px 20px #00bfa550;
}

.outfit-panel-overlay {
  position: fixed;
  z-index: 9998;
  left: 0;
  top: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(40,40,65,0.22);
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>