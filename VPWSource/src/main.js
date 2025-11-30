import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { setupI18n } from './i18n.js';
import App from './App.vue';
import { registerModWithSdk, hookDrawCharacter } from './utils/register.js';
import './style.css';

// 🔥 使用统一的真实页面 window
import { hostWindow, doc, setTimeoutHost } from './utils/host-window.js';

console.log("Monkey Main.js loaded");

// 等待游戏环境准备好（Player、bcModSdk）
function waitForGameReady(callback) {
  if (
    hostWindow.Player &&
    typeof hostWindow.Player.MemberNumber !== "undefined" &&
    hostWindow.bcModSdk?.registerMod
  ) {
    callback();
  } else {
    setTimeoutHost(() => waitForGameReady(callback), 500);
  }
}

async function injectVueApp() {

  const VERSION_NUMBER = hostWindow.VPW_Version || "0.12dev";

  // 使用 hostWindow 内的数据
  const modApi = registerModWithSdk(VERSION_NUMBER);
  hookDrawCharacter(modApi);

  // 防止重复 mount
  if (doc.getElementById('vue-tampermonkey-root')) return;

  // 尝试调用外部环境的 ItemColorLoad（若可用）
  try {
    hostWindow.ItemColorLoad(
      hostWindow.Player,
      hostWindow.Player.Appearance?.[0],
      10000,
      10000,
      0,
      0,
      true
    );
  } catch (e) {
    // ignore
  }

  // i18n 初始化
  const i18n = await setupI18n();

  // 创建 root
  const root = doc.createElement('div');
  root.id = 'vue-tampermonkey-root';
  doc.body.appendChild(root);

  const app = createApp(App);
  const pinia = createPinia();

  app.use(pinia);

  // 将 i18n 全局挂到 hostWindow（真实 window）
  try {
    if (i18n?.global) {
      hostWindow.__APP_I18N__ = i18n.global;
      hostWindow.__VUE_I18N_GLOBAL__ = i18n.global;
      hostWindow.__VUE_I18N__ = i18n.global;
      hostWindow.APP_I18N = i18n.global;
    }
  } catch (e) {}

  app.use(i18n);
  app.mount('#vue-tampermonkey-root');
}

// 等待游戏初始化
setTimeoutHost(() => {
  console.log("开始等待游戏逻辑就绪...");
  waitForGameReady(injectVueApp);
}, 1000);
