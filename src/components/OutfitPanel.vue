<template>
  <div class="outfit-panel">
    <div class="outfit-panel-header">
      <h2 class="outfit-title">Outfits 管理</h2>
      <div class="outfit-buttons">
        <button @click="$emit('import')">导入</button>
        <button @click="$emit('export')">导出</button>
        <button @click="$emit('save')">保存当前</button>
        <button class="close-btn" @click="$emit('close')" title="关闭">&times;</button>
      </div>
    </div>
    <div class="outfit-panel-body">
      <slot />
    </div>
  </div>
</template>

<script setup>
// 事件通过 $emit 暴露给父组件
</script>

<style scoped>
.outfit-panel {
  position: fixed;
  z-index: 9999;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: clamp(320px, 92vw, 620px);
  max-width: calc(100vw - var(--safe-area-left) - var(--safe-area-right) - 16px);
  max-height: calc(var(--dvh-safe, 100dvh) - 16px);
  min-height: clamp(280px, 60vh, 340px);
  background: var(--color-bg-base, #fff);
  border-radius: var(--radius-xl, 12px);
  box-shadow: var(--shadow-2xl, 0 8px 32px rgba(0,0,0,0.15));
  display: flex;
  flex-direction: column;
}
.outfit-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-fluid-md, 14px) var(--panel-inline-padding, 18px) var(--space-sm, 8px);
  border-bottom: 1px solid var(--color-border-base, #eee);
}
.outfit-title {
  font-size: var(--font-size-fluid-lg, 18px);
  font-weight: var(--font-weight-bold, 700);
  margin: 0;
  color: var(--color-text-primary, #0f172a);
}
.outfit-buttons {
  display: flex;
  gap: var(--space-fluid-sm, 8px);
  flex-wrap: wrap;
}
.outfit-buttons button {
  padding: clamp(8px, 1.5vw, 10px) 14px;
  min-height: 36px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-base, #cbd5e1);
  background: var(--color-bg-base, #fafafa);
  color: var(--color-text-primary, #0f172a);
  cursor: pointer;
  font-size: var(--font-size-fluid-sm, 13px);
  transition: all var(--transition-fast, 0.15s) ease;
}
.outfit-buttons .close-btn {
  font-size: 20px;
  padding: 2px 10px;
  background: none;
  border: none;
  color: #666;
}
.outfit-buttons .close-btn:hover {
  background: #eee;
}
.outfit-panel-body {
  flex: 1;
  padding: var(--panel-inline-padding, 18px);
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-gutter: stable;
  max-height: var(--panel-max-height-safe, calc(100dvh - 160px));
}
</style>