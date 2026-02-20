# CSS 样式现代化改造方案

## 一、现状分析

### 1.1 已有的设计系统

项目已有**完善的 CSS 设计系统**，位于 `src/styles/` 目录：

| 文件 | 作用 |
|------|------|
| `theme.css` | 设计令牌（Design Tokens）- 颜色、间距、圆角、字体、阴影、过渡 |
| `components.css` | 通用组件样式 - 按钮、输入框、面板、卡片、状态类 |
| `responsive.css` | 响应式断点 |
| `style.css` | 全局样式引入 |

### 1.2 theme.css 已有的变量

```css
/* 间距系统 */
--space-xs: 4px; --space-sm: 8px; --space-md: 12px; --space-lg: 16px; --space-xl: 24px;

/* 圆角系统 */
--radius-sm: 6px; --radius-md: 8px; --radius-lg: 10px; --radius-xl: 12px;

/* 字体系统 */
--font-size-xs/sm/base/md/lg/xl
--font-weight-normal/medium/semibold/bold

/* 阴影系统 */
--shadow-sm/md/lg/xl/2xl

/* 过渡 */
--transition-fast: 0.15s; --transition-base: 0.2s;
```

### 1.3 components.css 已有的通用类

- `.btn-base`, `.btn-primary`, `.btn-secondary`, `.btn-icon`
- `.input-base`, `.input-number`, `.input-slider`
- `.panel-base`, `.panel-header`, `.panel-body`, `.panel-glassmorphism`
- `.card-base`, `.card-interactive`
- `.state-focused`, `.state-selected`, `.state-disabled`
- `.mode-toggle-btn`, `.badge`

---

## 二、问题诊断

### 2.1 主要问题

| # | 问题 | 示例 |
|---|------|------|
| 1 | **CSS变量命名不一致** | `DialogModal.vue` 使用 `--primary-color`, `--bg-tertiary` 而非标准 `--color-primary` |
| 2 | **硬编码值存在** | 部分组件仍使用 `border-radius: 8px` 而非 `var(--radius-md)` |
| 3 | **未使用全局CSS类** | 组件内定义了重复样式，而非复用 `components.css` 中的 `.btn-base` |
| 4 | **缺少Vue组件封装** | 只有全局CSS类，没有 `BaseButton.vue`, `BaseInput.vue` 等可复用组件 |
| 5 | **变量覆盖问题** | `theme.css` 中部分变量缺少 `:root` 级别的默认值 |

### 2.2 具体问题组件

| 组件文件 | 问题 |
|----------|------|
| `Dialog/DialogModal.vue` | 使用非标准变量 `--primary-color`, `--bg-tertiary`, `--text-primary` |
| `HelloWorld.vue` | 硬编码颜色值 `#888` |
| `FileManager.vue` | 部分使用硬编码圆角 `border-radius: 10px` |
| `FilterManager.vue` | 混用硬编码和变量 |

---

## 三、改造方案

### 3.1 修复变量不一致问题

**目标**: 统一所有组件使用 `theme.css` 定义的变量

#### 步骤1: 修复 DialogModal.vue

将非标准变量替换为标准变量：

```css
/* 之前 (非标准) */
--primary-color, --bg-tertiary, --text-primary

/* 之后 (标准) */
--color-primary, --color-bg-panel, --color-text-primary
```

#### 步骤2: 清理硬编码值

将所有硬编码值替换为 CSS 变量，保留 fallback：

```css
/* 之前 */
border-radius: 8px;
color: #333;

/* 之后 */
border-radius: var(--radius-md, 8px);
color: var(--color-text-primary, #333);
```

### 3.2 创建 Vue UI 组件库

创建 `src/components/ui/` 目录，实现可复用组件：

```
src/components/ui/
├── BaseButton.vue      # 基础按钮
├── BaseInput.vue       # 基础输入框
├── BasePanel.vue       # 基础面板
├── BaseCard.vue        # 基础卡片
└── index.js            # 统一导出
```

#### BaseButton.vue

```vue
<template>
  <button :class="['btn-base', variantClass, sizeClass]">
    <slot />
  </button>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  variant: { type: String, default: 'primary' }, // primary, secondary, ghost
  size: { type: String, default: 'md' } // sm, md, lg
})

const variantClass = computed(() => props.variant === 'primary' ? 'btn-primary' : '')
const sizeClass = computed(() => `btn-${props.size}`)
</script>
```

### 3.3 补充缺失的设计变量

在 `theme.css` 的 `:root` 中补充缺失变量：

```css
:root {
  /* 补充缺失变量 */
  --color-primary: #2563eb;
  --color-primary-hover: #1d4ed8;
  --color-bg-panel: #f1f5f9;
  --color-text-primary: #0f172a;
  --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
  /* ... */
}
```

### 3.4 创建全局 Reset

创建 `src/styles/normalize.css`：

```css
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  font-family: var(--font-family);
  line-height: 1.5;
}

img, svg { display: block; max-width: 100%; }
button, input, select, textarea { font: inherit; color: inherit; }
a { color: inherit; text-decoration: none; }
```

---

## 四、实施计划

### 当前进度（2026-02-20）

- ✅ 已完成：变量命名统一、主题 token 补齐、基础 UI 组件库补齐、normalize 接入
- ✅ 已完成：`Studio` 子目录硬编码圆角批量迁移（保留语义性 `border-radius: 0px`）
- 🔄 持续优化：逐步将局部样式继续收敛到 `components.css` 与 `ui` 基础组件

### 阶段一：修复变量问题（优先级：高）

| 任务 | 文件 | 状态 |
|------|------|------|
| 修复 DialogModal.vue 变量 | `components/Dialog/DialogModal.vue` | 已完成 |
| 清理 HelloWorld.vue 硬编码 | `components/HelloWorld.vue` | 已完成 |
| 统一 FileManager.vue 圆角 | `components/FileManager.vue` | 已完成 |

### 阶段二：创建 UI 组件库（优先级：中）

| 任务 | 文件 | 状态 |
|------|------|------|
| 创建 BaseButton.vue | `components/ui/BaseButton.vue` | 已完成 |
| 创建 BaseInput.vue | `components/ui/BaseInput.vue` | 已完成 |
| 创建 BasePanel.vue | `components/ui/BasePanel.vue` | 已完成 |
| 创建 BaseCard.vue | `components/ui/BaseCard.vue` | 已完成 |
| 创建 index.js 导出 | `components/ui/index.js` | 已完成 |

### 阶段三：完善设计系统（优先级：中）

| 任务 | 文件 | 状态 |
|------|------|------|
| 补充缺失的 CSS 变量 | `styles/theme.css` | 已完成 |
| 创建全局 Reset | `styles/normalize.css` | 已完成 |
| 更新全局引入 | `style.css` | 已完成 |

### 阶段四：组件迁移（优先级：低）

已完成第一轮批量迁移（含 `Studio` 目录关键组件）；后续按业务节奏继续将局部样式收敛到全局类与 `ui` 组件

---

## 五、关键文件清单

### 需要修改的文件

| 文件路径 | 操作 |
|----------|------|
| `src/styles/theme.css` | 已补充缺失变量与兼容别名 |
| `src/styles/components.css` | 已增强圆角 token 使用 |
| `src/components/Dialog/DialogModal.vue` | 已完成变量命名统一 |
| `src/components/HelloWorld.vue` | 已清理硬编码 |
| `src/components/FileManager.vue` | 已统一圆角 token |
| `src/components/Studio/*.vue` | 已完成批量圆角 token 迁移（保留 `0px` 语义值） |

### 需要创建的文件

| 文件路径 | 说明 |
|----------|------|
| `src/styles/normalize.css` | 全局 Reset（已创建并接入） |
| `src/components/ui/BaseButton.vue` | 按钮组件（已创建） |
| `src/components/ui/BaseInput.vue` | 输入框组件（已创建） |
| `src/components/ui/BasePanel.vue` | 面板组件（已创建） |
| `src/components/ui/BaseCard.vue` | 卡片组件（已创建） |
| `src/components/ui/index.js` | 统一导出（已更新） |

---

## 六、验证方法

1. **开发环境验证**
   ```bash
   npm run dev
   ```
   - 检查各组件是否正常渲染
   - 切换明暗主题，验证样式正确应用

2. **样式一致性检查**
   - 使用浏览器开发者工具检查 CSS 变量是否正确解析
   - 确认无 "variable not defined" 警告

3. **功能测试**
   - 对话框弹出/关闭动画正常
   - 按钮 hover/active 状态正常
   - 输入框 focus 状态正常

---

## 七、总结

项目已有**优秀的设计系统基础**，主要需要：
1. 修复变量命名不一致问题
2. 清理硬编码值
3. 创建 Vue 组件封装
4. 补充缺失变量

改造后项目将具备：
- 统一的 CSS 变量系统
- 可复用的 Vue UI 组件
- 一致的组件样式
- 完善的明暗主题支持
