<template>
  <div class="modal-panel">
    <button class="close" @click="$emit('close')">&times;</button>
    <!-- 这里可以放 FileManager 或任意内容 -->
    <slot>
      <p>我是新窗口内容！</p>
    </slot>
  </div>
</template>
<style scoped>
.modal-panel {
  background: var(--color-bg-base, #fff);
  border-radius: var(--radius-xl, 14px);
  box-shadow: var(--shadow-xl, 0 10px 36px rgba(90, 129, 221, 0.2));
  padding: var(--space-fluid-lg, 22px) var(--panel-inline-padding, 28px) var(--space-fluid-md, 18px);
  width: clamp(300px, 88vw, 520px);
  max-width: calc(100vw - var(--safe-area-left) - var(--safe-area-right) - 16px);
  max-height: calc(var(--dvh-safe, 100dvh) - 32px);
  min-height: clamp(160px, 30vh, 190px);
  position: relative;
  animation: fadeIn .22s;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}
.close {
  position: absolute; 
  top: var(--space-sm, 10px); 
  right: var(--space-md, 16px);
  width: 40px; 
  height: 40px; 
  border-radius: var(--radius-md, 8px);
  font-size: 22px; 
  border: none;
  background: var(--color-bg-panel, #f0f4fd);
  color: var(--color-text-primary, #0f172a);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast, 0.15s) ease;
}
.close:hover {
  background: var(--color-bg-hover, #e2e8f0);
}
</style>