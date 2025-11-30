<template>
  <div class="floating-panel">
    <h3>这是一个浮窗 (Vue 3)</h3>
    <p>当前时间：{{ time }}</p>
    <button @click="close">关闭浮窗</button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

const time = ref<string>(new Date().toLocaleTimeString());

let timer: number;

onMounted(() => {
  // 每秒更新一次时间
  timer = window.setInterval(() => {
    time.value = new Date().toLocaleTimeString();
  }, 1000);
});

function close() {
  const root = document.getElementById('vue-floating-root');
  if (root && root.parentNode) {
    root.parentNode.removeChild(root);
  }
  // 停止定时器
  window.clearInterval(timer);
}
</script>

<style scoped>
.floating-panel {
  background: white;
  border: 1px solid #ccc;
  padding: 1rem;
  box-shadow: 0 0 10px rgba(0,0,0,0.2);
  border-radius: 4px;
  min-width: 200px;
  font-family: Arial, sans-serif;
}
.floating-panel h3 {
  margin: 0 0 0.5rem;
}
.floating-panel button {
  margin-top: 0.5rem;
  padding: 0.3rem 0.6rem;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 3px;
  cursor: pointer;
}
.floating-panel button:hover {
  background-color: #0056b3;
}
</style>
