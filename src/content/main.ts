import { createApp } from 'vue';
import FloatingVue from './FloatingVue.vue';



// 我们在页面上动态插入一个 div 作为挂载点
// Content Script 中创建挂载节点
const root = document.createElement('div');
root.id = 'vue-tampermonkey-root';
Object.assign(root.style, {
  position: 'fixed',
  bottom: '20px',
  right: '20px',
  zIndex: '9999'
});
document.body.appendChild(root);


console.log("Wardrobe monkey loaded!!");



// 创建 Vue 应用并挂载
const app = createApp(FloatingVue);
app.mount('#vue-floating-root');
