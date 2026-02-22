<script setup>
/**
 * BaseWindow.vue
 * Reusable window shell with drag/resize behavior
 * Created for P0.1 modernization
 */
import { computed } from 'vue'
import { useWindowDragResize } from '@/services/WindowLayoutService'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: ''
  },
  minWidth: {
    type: Number,
    default: 320
  },
  minHeight: {
    type: Number,
    default: 220
  },
  defaultWidth: {
    type: Number,
    default: 1000
  },
  defaultHeight: {
    type: Number,
    default: 640
  },
  showResize: {
    type: Boolean,
    default: true
  },
  mobileClass: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['close', 'focus'])

const {
  isMobile,
  panelStyle,
  startDrag,
  startResize,
  bringToFront
} = useWindowDragResize({
  visible: computed(() => props.visible),
  minWidth: props.minWidth,
  minHeight: props.minHeight,
  defaultWidth: props.defaultWidth,
  defaultHeight: props.defaultHeight
})

function handleFocus() {
  bringToFront()
  emit('focus')
}

function handleClose() {
  emit('close')
}
</script>

<template>
  <transition name="fade-zoom">
    <div v-if="visible" 
         class="base-window"
         :class="{ 'is-mobile': isMobile, [mobileClass]: mobileClass }"
         :style="panelStyle"
         role="dialog"
         :aria-label="title"
         tabindex="0"
         @mousedown="handleFocus"
         @focus="handleFocus">
      
      <!-- Header slot -->
      <header class="base-window-header" @pointerdown.stop.prevent="startDrag">
        <slot name="header" :is-mobile="isMobile" :on-close="handleClose">
          <div class="base-window-title">{{ title }}</div>
          <button class="base-window-close" @click="handleClose" aria-label="Close">&times;</button>
        </slot>
      </header>

      <!-- Body slot -->
      <div class="base-window-body">
        <slot :is-mobile="isMobile" />
      </div>

      <!-- Footer slot (optional) -->
      <footer v-if="$slots.footer" class="base-window-footer">
        <slot name="footer" :is-mobile="isMobile" />
      </footer>

      <!-- Resize handles -->
      <template v-if="showResize">
        <div class="resize-handle top" @pointerdown.stop.prevent="startResize('top', $event)"></div>
        <div class="resize-handle right" @pointerdown.stop.prevent="startResize('right', $event)"></div>
        <div class="resize-handle bottom" @pointerdown.stop.prevent="startResize('bottom', $event)"></div>
        <div class="resize-handle left" @pointerdown.stop.prevent="startResize('left', $event)"></div>
        <div class="resize-handle corner top-left" @pointerdown.stop.prevent="startResize('top-left', $event)"></div>
        <div class="resize-handle corner top-right" @pointerdown.stop.prevent="startResize('top-right', $event)"></div>
        <div class="resize-handle corner bottom-right" @pointerdown.stop.prevent="startResize('bottom-right', $event)"></div>
        <div class="resize-handle corner bottom-left" @pointerdown.stop.prevent="startResize('bottom-left', $event)"></div>
      </template>
    </div>
  </transition>
</template>

<style scoped>
.base-window {
  position: fixed;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-base, #ffffff);
  border: 1px solid var(--color-border-base, #e2e8f0);
  border-radius: var(--radius-lg, 10px);
  box-shadow: var(--shadow-2xl, 0 10px 40px rgba(0, 0, 0, 0.2));
  overflow: hidden;
  outline: none;
}

.base-window-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-md, 12px) var(--space-lg, 16px);
  background: var(--color-bg-surface, #f8fafc);
  border-bottom: 1px solid var(--color-border-base, #e2e8f0);
  cursor: move;
  user-select: none;
  min-height: 56px;
}

.base-window-title {
  font-size: var(--font-size-lg, 16px);
  font-weight: var(--font-weight-semibold, 600);
  color: var(--color-text-primary, #0f172a);
}

.base-window-close {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-md, 8px);
  color: var(--color-text-secondary, #475569);
  font-size: 24px;
  cursor: pointer;
  transition: all var(--transition-fast, 0.15s) ease;
}

.base-window-close:hover {
  background: var(--color-bg-hover, #f1f5f9);
  color: var(--color-text-primary, #0f172a);
}

.base-window-body {
  flex: 1;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}

.base-window-footer {
  padding: var(--space-md, 12px) var(--space-lg, 16px);
  background: var(--color-bg-surface, #f8fafc);
  border-top: 1px solid var(--color-border-base, #e2e8f0);
}

/* Resize handles */
.resize-handle {
  position: absolute;
  z-index: 10;
}

.resize-handle.top,
.resize-handle.bottom {
  left: 8px;
  right: 8px;
  height: 8px;
  cursor: ns-resize;
}

.resize-handle.top { top: 0; }
.resize-handle.bottom { bottom: 0; }

.resize-handle.left,
.resize-handle.right {
  top: 8px;
  bottom: 8px;
  width: 8px;
  cursor: ew-resize;
}

.resize-handle.left { left: 0; }
.resize-handle.right { right: 0; }

.resize-handle.corner {
  width: 16px;
  height: 16px;
}

.resize-handle.top-left {
  top: 0;
  left: 0;
  cursor: nwse-resize;
}

.resize-handle.top-right {
  top: 0;
  right: 0;
  cursor: nesw-resize;
}

.resize-handle.bottom-right {
  bottom: 0;
  right: 0;
  cursor: nwse-resize;
}

.resize-handle.bottom-left {
  bottom: 0;
  left: 0;
  cursor: nesw-resize;
}

/* Transitions */
.fade-zoom-enter-active,
.fade-zoom-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.fade-zoom-enter-from {
  opacity: 0;
  transform: scale(0.95);
}

.fade-zoom-leave-to {
  opacity: 0;
  transform: scale(0.98);
}

/* Mobile adjustments */
.base-window.is-mobile {
  border-radius: var(--radius-md, 8px);
}

.base-window.is-mobile .base-window-header {
  padding: var(--space-sm, 8px) var(--space-md, 12px);
  min-height: 48px;
}
</style>
