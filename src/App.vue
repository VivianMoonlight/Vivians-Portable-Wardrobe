<template>
  <div class="fm-launcher-root" :class="themeClass">
   
      <button
        class="open-fm-btn"
        @click="openPanel"
        @keydown.space.prevent="openPanel"
        @keydown.enter.prevent="openPanel"
        :aria-expanded="showPanel"
        aria-controls="file-manager-panel"
        aria-label="打开文件管理器"
        title="打开文件管理器"
      >
        <img :src="logo" alt="" class="logo" />
        <span class="visually-hidden">打开文件管理器</span>
      </button>

      <!-- Theme Toggle Button >
      <button
        class="theme-toggle-btn"
        @click="toggleTheme"
        :title="currentTheme === 'light' ? '切换到深色模式' : '切换到浅色模式'"
        aria-label="切换主题"
      >
        <svg v-if="currentTheme === 'light'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
        <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5"></circle>
          <line x1="12" y1="1" x2="12" y2="3"></line>
          <line x1="12" y1="21" x2="12" y2="23"></line>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
          <line x1="1" y1="12" x2="3" y2="12"></line>
          <line x1="21" y1="12" x2="23" y2="12"></line>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>
      </button-->

    <!-- 挂载主窗体组件 -->
    <FileManagerPanel
      id="file-manager-panel"
      :visible="showPanel"
      @close="closePanel"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useTheme, provideTheme } from './services/ThemeService'
import FileManagerPanel from './components/FileManagerPanel.vue'
import { hostWindow } from './utils/host-window.js'
import logo from './assets/logo.png'

const showPanel = ref(false)
const isMobile = ref(false)
const MOBILE_BREAKPOINT = 640

// Initialize theme
const theme = useTheme()
const { initTheme, themeClass: getThemeClass, toggleTheme, currentTheme } = theme
const themeClass = computed(() => getThemeClass())

// Provide theme context to all descendants
provideTheme(theme)

function updateIsMobile() {
  isMobile.value = hostWindow.innerWidth < MOBILE_BREAKPOINT
}

function onWindowResize() {
  updateIsMobile()
}

onMounted(() => {
  initTheme()
  updateIsMobile()
  hostWindow.addEventListener('resize', onWindowResize)
})

onBeforeUnmount(() => {
  hostWindow.removeEventListener('resize', onWindowResize)
})

function openPanel() {
  showPanel.value = true
}

function closePanel() {
  showPanel.value = false
}
</script>

<style scoped>
/* 根容器保持简单，避免创建 stacking context */
.fm-launcher-root {
  width: 100%;
  position: relative;
}

/* top bar 用于布局（如果未来需要扩展可修改） */
.top-bar {
  padding: 14px 20px;
}

/* 圆形悬浮按钮主样式 */
.open-fm-btn {
  position: fixed;
  left: calc(var(--safe-area-left) + clamp(16px, 3vw, 20px));
  bottom: calc(var(--safe-area-bottom) + clamp(80px, 12vh, 100px));

  width: clamp(56px, 12vw, 64px);
  height: clamp(56px, 12vw, 64px);
  min-width: 56px;
  min-height: 56px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  background: linear-gradient(135deg, #ffffff 0%, #cfcfcf 55%, #e5e5e5 100%);
  color: #07213a;

  box-shadow:
    0 10px 30px rgba(7, 33, 58, 0.18),
    inset 0 1px 0 rgba(255,255,255,0.35);
  z-index: 2147483647;

  transition: transform 180ms cubic-bezier(.2,.9,.2,1), box-shadow 180ms, filter 180ms;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  pointer-events: auto;
  outline: none;
}

/* Mobile: center button at bottom */
@media (max-width: 640px) {
  .open-fm-btn {
    left: 50%;
    bottom: calc(var(--safe-area-bottom) + 20px);
    transform: translateX(-50%);
  }
  
  .open-fm-btn:hover {
    transform: translateX(-50%) translateY(-6px);
  }
  
  .open-fm-btn:active {
    transform: translateX(-50%) translateY(-2px) scale(0.985);
  }
}

/* 内部 logo，使用相对导入的图片资源 */
.open-fm-btn .logo {
  width: 56%;
  height: 56%;
  object-fit: contain;
  display: block;
  border-radius: 50%;
  filter: drop-shadow(0 3px 8px rgba(7,33,58,0.14));
}

/* Hover/active 状态以增强交互感知 */
@media (hover: hover) and (pointer: fine) {
  .open-fm-btn:hover {
    transform: translateY(-6px);
    box-shadow:
      0 18px 42px rgba(7, 33, 58, 0.26),
      inset 0 1px 0 rgba(255,255,255,0.38);
    filter: saturate(1.05);
  }

  @media (max-width: 640px) {
    .open-fm-btn:hover {
      transform: translateX(-50%) translateY(-6px);
    }
  }
}

.open-fm-btn:active {
  transform: translateY(-2px) scale(0.985);
  box-shadow:
    0 8px 20px rgba(7, 33, 58, 0.18),
    inset 0 1px 0 rgba(255,255,255,0.25);
}

/* Focus-visible 优化，便于键盘用户 */
.open-fm-btn:focus-visible {
  box-shadow:
    0 12px 36px rgba(7,33,58,0.22),
    0 0 0 6px rgba(95, 180, 255, 0.18);
  outline: none;
}

/* 简洁的 tooltip（桌面设备） */
.open-fm-btn::after {
  content: "打开文件管理器";
  position: absolute;
  left: calc(100% + 12px);
  bottom: 50%;
  transform: translateY(50%) translateX(0);
  background: rgba(8, 20, 34, 0.95);
  color: #fff;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 13px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 160ms, transform 160ms;
  box-shadow: 0 8px 28px rgba(8, 20, 34, 0.32);
  z-index: 2147483647;
}

.open-fm-btn::before {
  content: "";
  position: absolute;
  left: calc(100% + 6px);
  bottom: 50%;
  transform: translateY(50%) rotate(45deg);
  width: 10px;
  height: 10px;
  background: rgba(8, 20, 34, 0.95);
  opacity: 0;
  transition: opacity 160ms;
  z-index: 2147483647;
}

@media (hover: hover) and (pointer: fine) {
  .open-fm-btn:hover::after,
  .open-fm-btn:focus-visible::after {
    opacity: 1;
    transform: translateY(50%) translateX(6px);
  }
  .open-fm-btn:hover::before,
  .open-fm-btn:focus-visible::before {
    opacity: 1;
    transform: translateY(50%) rotate(45deg) translateX(4px);
  }
}

/* 小屏或触摸设备上隐藏 tooltip */
@media (max-width: 480px) {
  .open-fm-btn::after,
  .open-fm-btn::before {
    display: none;
  }
}

/* 屏幕阅读器隐藏文本 */
.visually-hidden {
  position: absolute !important;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

/* Theme toggle button */
.theme-toggle-btn {
  position: fixed;
  left: calc(var(--safe-area-left) + clamp(16px, 3vw, 20px));
  bottom: calc(var(--safe-area-bottom) + clamp(20px, 4vh, 30px));
  width: clamp(44px, 10vw, 48px);
  height: clamp(44px, 10vw, 48px);
  min-width: 44px;
  min-height: 44px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-round, 50%);
  border: none;
  cursor: pointer;
  background: var(--color-bg-surface, #ffffff);
  color: var(--color-text-primary, #07213a);
  box-shadow: var(--shadow-lg, 0 6px 20px rgba(7, 33, 58, 0.16));
  z-index: 2147483647;
  transition: transform 180ms cubic-bezier(.2,.9,.2,1), box-shadow var(--transition-base, 180ms), filter var(--transition-base, 180ms);
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  pointer-events: auto;
  outline: none;
}

/* Mobile: position theme toggle near launcher */
@media (max-width: 640px) {
  .theme-toggle-btn {
    left: calc(50% + 48px);
    bottom: calc(var(--safe-area-bottom) + 24px);
  }
}

@media (hover: hover) and (pointer: fine) {
  .theme-toggle-btn:hover {
    transform: translateY(-4px) scale(1.05);
    box-shadow: var(--shadow-xl, 0 12px 28px rgba(7, 33, 58, 0.22));
    filter: saturate(1.05);
  }
}

.theme-toggle-btn:active {
  transform: translateY(-1px) scale(0.98);
  box-shadow: var(--shadow-md, 0 4px 12px rgba(7, 33, 58, 0.16));
}

.theme-toggle-btn:focus-visible {
  box-shadow:
    var(--shadow-lg, 0 8px 24px rgba(7,33,58,0.18)),
    0 0 0 4px rgba(95, 180, 255, 0.18);
  outline: none;
}
</style>