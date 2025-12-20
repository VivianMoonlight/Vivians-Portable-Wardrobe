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
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 10px 36px #5a81dd30;
  padding: 30px 38px 20px 38px;
  min-width: 380px;
  min-height: 190px;
  position: relative;
  animation: fadeIn .22s;
}
.close {
  position: absolute; top: 11px; right: 19px;
  width: 32px; height: 32px; border-radius: 8px;
  font-size: 20px; border: none;
  background: #f0f4fd;
  cursor: pointer;
}
</style>