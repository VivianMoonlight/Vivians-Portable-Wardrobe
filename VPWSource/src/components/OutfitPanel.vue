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
  min-width: 520px;
  min-height: 340px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 32px #2222;
  display: flex;
  flex-direction: column;
}
.outfit-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 22px 8px 22px;
  border-bottom: 1px solid #eee;
}
.outfit-title {
  font-size: 21px;
  font-weight: bold;
  margin: 0;
}
.outfit-buttons {
  display: flex;
  gap: 10px;
}
.outfit-buttons button {
  padding: 6px 12px;
  border-radius: 7px;
  border: 1px solid #bbb;
  background: #fafafa;
  cursor: pointer;
  font-size: 14px;
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
  padding: 22px;
  overflow: auto;
}
</style>