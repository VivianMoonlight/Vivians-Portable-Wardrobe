# PalettePanel UI/UX 现代化重设计计划

**版本**: v1.0  
**日期**: 2026-02-21  
**目标**: 将 Palette 调色盘界面从现有设计升级为 Material Design 3 风格，强化用户体验和可用性  
**范围**: 全面重设计（结构、交互、样式）

---

## 📋 目录

1. [现状分析](#现状分析)
2. [问题识别](#问题识别)
3. [改进目标](#改进目标)
4. [设计方案](#设计方案)
5. [技术实现](#技术实现)
6. [响应式设计](#响应式设计)
7. [实现清单](#实现清单)
8. [验证标准](#验证标准)
9. [项目进度](#项目进度)

---

## 现状分析

### 背景

**Vivian's Portable Wardrobe** 是为 Bondage Club 玩家开发的高级 userscript，提供便携式衣柜系统、高级 Studio 编辑器以及多语言支持。PalettePanel 是 Studio 中的核心颜色编辑工具。

### 核心功能

PalettePanel 采用三层架构：

| 层级 | 名称 | 功能 |
|:---|:---|:---|
| 1 | 颜色选择器 | Chrome Color Picker，实时拖拽交互 |
| 2 | 已保存颜色 | 临时快速调色板，支持增删应用 |
| 3 | 颜色标签 | 命名持久化颜色库，支持 CRUD 和全局应用 |

### 用户流程

```
选中 Layer
  ↓
打开 Palette 面板
  ↓
调整选择器 / 点击保存色 / 选择标签
  ↓
应用到 Layer（即时反馈）
  ↓
可选：创建标签 / 编辑标签定义
```

### 技术特性

- **同步机制**: 双向绑定 + 防环设计（pickerSyncflag），Throttle 100ms
- **状态管理**: store.activePaletteTargets, store.paletteMap, store.savedColors
- **多语言**: 完整的英文+中文本地化
- **设计系统**: 遵循已建立的 CSS 变量体系

---

## 问题识别

### 🔴 高优先级问题

#### 1. 模式状态不够突出（用户混淆风险高）

**现象**：
- 进入"编辑标签"模式时只显示浅黄色 banner
- Banner 颜色浅，易被忽视；用户容易误以为在操作 Layer
- 选择器及其他 UI 相对于浏览模式没有明显差异

**影响**：
- 用户可能在编辑标签定义后发现意外改动了全局色彩
- 从编辑标签切回浏览模式时需二次确认操作内容

**现代设计规范参考**：
- Figma: 编辑模式时侧栏色块改变 + 顶部蓝色状态条
- Framer: 模式切换带明确的过渡动画 + 浮窗指示器
- VS Code: 编辑模式时标签栏背景变色 + 文件名旁显示修改标记

---

#### 2. 删除交互成本高（不符合现代 UX）

**现象**：
- 删除 Tag 或 Saved 色采用"点击准备状态 → 等 3 秒 → 再点击确认"机制
- 用户必须立即完成二次交互，否则状态复位

**影响**：
- UX 成本高：3 秒等待 + 需精确点击 = 高摩擦系统
- 易误触：用户可能因避免误删而犹豫操作

**现代设计规范参考**：
- Figma: 删除即时生效，右下吐司显示"已删除，5 秒内撤销"
- Gmail: 删除邮件立即生效 + 顶部撤销按钮（5 秒）
- VS Code: 关闭未保存文件 → 提示 → 选择保存/不保存/取消

**改进方向**：
- 采用"**Undo 范式**"：删除立即生效，用户 3-5 秒内可按 Ctrl+Z 撤销
- 或使用"**吐司提示+撤销按钮**"方案（需 DialogService 支持）

---

#### 3. 响应式布局不足（小屏幕体验差）

**现象**：
- 快速操作按钮文本长："+ Saved Colors" / "+ Color Tags"
- 小屏幕（<400px）下按钮易换行或被挤压
- 标签行在极小屏幕上显示压缩、文本难以阅读

**影响**：
- 移动设备上 PalettePanel 占用屏幕过多
- 信息密度低下：未充分利用二维空间

**现代设计规范参考**：
- Material Design 3: 响应式应用于所有组件，<340px 采用纵向堆砌 + 图标化
- Tailwind CSS: 完整的媒体查询断点系统（sm/md/lg/xl）

**改进方向**：
- 小屏幕下按钮图标化："+" 和 Tag Icon 代替文本
- 使用 flex 自适应布局 + 媒体查询
- 颜色值在小屏幕用 Tooltip 隐藏，悬停显示

---

### 🟡 中优先级问题

#### 4. 颜色值展示不友好

**现象**：
- 复杂颜色值（数组/对象）用 `JSON.stringify()` 展示，输出混乱
- 用户难以快速理解某个标签的实际颜色是什么
- 无法直观看出是简单十六进制还是多色渐变

**影响**：
- 用户体验困惑：看不清标签的真实值
- 专业度降低：输出格式不精致

**改进方向**：
- 简单值：显示 `#HEX + 实时色块预览`
- 复杂值：显示 `[多色] / [渐变] / [特殊]` 标签 + hover 展开详情
- 添加小色块在标签名旁边，一眼看清颜色

---

#### 5. Saved vs Tags 界线模糊

**现象**：
- 两个面板 UI 结构几乎相同（都是容器网格/列表）
- 用户难以区分"快速保存"和"持久标签"的语义差异
- 无法快速判断删除某个颜色的后果

**影响**：
- 用户可能误将 Saved 当作 Tags 使用
- 混淆操作对象，增加学习成本

**改进方向**：
- 使用不同的图标和颜色分层：
  - **Saved**: 🔔 星标感 / 浅色背景 / 提示文案"快速调色板"
  - **Tags**: 🏷️ 标签感 / 深色背景 / 提示文案"命名色标签"
- Saved 中颜色不显示名称（只有色块 + 十六进制码）
- Tags 中强调名称 + 使用计数徽章

---

#### 6. 空状态缺乏引导

**现象**：
- Saved 空时显示"No saved colors"（过于简短）
- Tags 空时显示长文本"No tags (automatically...)"（过于复杂）
- 都没有"立即添加"的 CTA 按钮

**影响**：
- 新用户不知道如何开始使用
- 空状态转化率低

**改进方向**：
- Saved：显示文案"快速保存常用颜色" + 示例色块 + "保存当前颜色"快捷链接
- Tags：显示文案"为关键颜色创建命名标签，支持全局使用" + "+ 创建第一个标签"CTA

---

### 🟢 低优先级问题

#### 7. 标签重命名无 Undo

**现象**：
- 重命名功能需要遍历全部 stacks 和替换所有引用
- 如果用户误操作，只能依赖全局 Undo 机制
- 高风险操作：重命名可能影响所有使用该标签的 Layer

**改进方向**：
- 重命名前显示"此操作影响 X 个 Layer，确认？"提示
- 确保重命名被全局 Undo 系统完整覆盖
- 可选：添加"预览受影响的 Layer"功能

---

## 改进目标

### 远景目标

将 PalettePanel 升级为**现代化、高效率、无障碍的颜色编辑工具**，遵循 Material Design 3 规范，提升用户满意度和操作效率。

### 具体目标

| 维度 | 目标 |
|:---|:---|
| **模式可识别性** | 用户能在 0.5 秒内判断当前处于"浏览/编辑 Layer/编辑 Tag"哪种模式 |
| **响应式支持** | 在 320px-2560px 的全屏幕范围内，UI 布局合理、文字可读、无溢出 |
| **操作效率** | 快速操作（应用色、保存、删除）的单次交互成本 ≤2 次点击 |
| **视觉清晰度** | 颜色值展示直观，用户一眼看清每个标签/保存色的实际值 |
| **可访问性** | Lighthouse 无障碍评分 ≥90；过渡动画支持 prefers-reduced-motion |
| **设计一致性** | 100% 遵循项目 Design System（CSS 变量 + MD3 规范） |

---

## 设计方案

### 方案整体架构

采用 **Material Design 3 Elevated Surface** 范式，核心变化包括：

```
原设计                          →    新设计
──────────────────────────────────────────────
[浅黄 Banner]                   →    [MD3 色条悬停栏 + 模式指示器]
[Picker / 快速按钮 并排]        →    [Picker / 快速按钮 自适应 + 图标化]
[Saved Grid]                    →    [区隔感更强的 Saved Grid]
[Tags 列表]                     →    [Tags 列表 + 使用计数徽章]
[单一样式按钮]                  →    [MD3 Filled/Outlined/Text 变体]
[固定浅灰背景]                  →    [投影+圆角 Elevated Surface]
```

### 1. 模式状态可视化升级

#### 设计原则
- **层级化显示**：主模式栏 + 副标题 + 编辑时背景变色
- **视觉反馈**：进入编辑模式 → 选择器框 + 侧边栏变色 + 按钮禁用
- **动画过渡**：模式切换时 200ms 平滑过渡，使用 MD3 easing

#### 实现细节

**A. 替换 Edit Banner 为 MD3 风格**

```vue
<!-- 原设计 -->
<div v-if="editingTagId" class="edit-banner">
  <span>{{ t('palette.tags.editTitle') }}: <strong>{{ editingTagId }}</strong></span>
  <button class="done-btn" @click="exitTagEditMode">Done</button>
</div>

<!-- 新设计 -->
<div class="mode-indicator-bar" :class="{ 'is-editing-tag': !!editingTagId }">
  <div class="mode-status">
    <span v-if="!editingTagId" class="mode-label">🎨 {{ t('palette.modeIndicator.browse') }}</span>
    <span v-else class="mode-label editing">
      ✎ {{ t('palette.modeIndicator.editingTag') }}: <strong>{{ editingTagId }}</strong>
    </span>
  </div>
  <div v-if="editingTagId" class="mode-actions">
    <button class="exit-btn" @click="exitTagEditMode">
      {{ t('common.done') }}
    </button>
  </div>
</div>
```

**设计细节**：
- Bar 高度：44px（MD3 标准）
- 编辑模式背景：`var(--md3-tertiary-container)` + 投影
- 文本：14px 加粗，图标 emoji + 文案清晰
- Done 按钮：MD3 Filled 风格，高对比度

**B. 选择器框在编辑模式下的视觉改动**

```vue
<!-- Picker Wrapper 添加动态类 -->
<div class="picker-wrapper" :class="{ 'editing-mode': !!editingTagId }">
  <Chrome v-model="pickerColor" :disable-alpha="true" />
</div>
```

```css
.picker-wrapper {
  transition: all 0.2s var(--md3-motion-easing);
  border: 2px solid var(--color-border-light);
  border-radius: var(--radius-md);
}

.picker-wrapper.editing-mode {
  border-color: var(--md3-tertiary);  /* 橙色边框 */
  box-shadow: 0 2px 8px rgba(217, 70, 239, 0.2);  /* 紫色投影 */
}
```

**C. 快速操作按钮在编辑模式下的禁用**

```vue
<!-- 按钮添加 disabled 状态 -->
<button 
  class="action-btn" 
  @click="addCurrentToSaved" 
  :disabled="!!editingTagId"
  :title="editingTagId ? t('palette.actions.disabledInEditMode') : t('palette.saved.saveTitle')"
>
  <span>+</span> {{ t('palette.saved.title') }}
</button>
```

```css
.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  color: var(--color-text-muted);
}
```

---

### 2. 响应式布局优化

#### 设计原则
- 遵循 Material Design 3 的响应式平台（手机/平板/桌面）
- 采用 **mobile-first** 策略，从 320px 开始设计
- 使用 CSS Grid + Flexbox 实现自适应

#### 断点定义

```css
/* 极小屏 (手机竖屏) */
@media (max-width: 339px) {
  /* 单列布局，按钮纵向堆砌，图标化显示 */
}

/* 小屏 (手机横屏/小平板) */
@media (340px <= viewport < 600px) {
  /* 双按钮并排，颜色值 Tooltip，平衡空间 */
}

/* 中屏 (平板) */
@media (600px <= viewport < 1024px) {
  /* 完整文本，可选双列标签 */
}

/* 大屏 (桌面) */
@media (viewport >= 1024px) {
  /* 完整功能展示，网格预留空间 */
}
```

#### 快速操作按钮响应式

```vue
<!-- 新结构 -->
<div class="quick-actions" :class="`screen-${screenSize}`">
  <button class="action-btn save-btn" @click="addCurrentToSaved">
    <span class="icon">💾</span>
    <span class="label" v-show="screenSize !== 'xs'">{{ t('palette.saved.title') }}</span>
  </button>
  <button class="action-btn tag-btn" @click="createTagFromCurrent">
    <span class="icon">🏷️</span>
    <span class="label" v-show="screenSize !== 'xs'">{{ t('palette.tags.title') }}</span>
  </button>
</div>
```

```css
/* 极小屏：仅图标 */
@media (max-width: 339px) {
  .action-btn {
    padding: 8px;
  }
  .action-btn .label {
    display: none;
  }
  .action-btn .icon {
    font-size: 18px;
  }
}

/* 小屏：图标 + 文本（缩短） */
@media (340px <= viewport < 600px) {
  .action-btn {
    padding: 6px;
    gap: 4px;
  }
  .action-btn .label {
    font-size: 11px;
  }
}

/* 大屏：完整样式 */
@media (viewport >= 600px) {
  .action-btn {
    padding: 6px 12px;
    gap: 6px;
  }
  .action-btn .label {
    font-size: 12px;
  }
}
```

#### Saved Grid 响应式

```css
@media (max-width: 339px) {
  .saved-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
  }
}

@media (340px <= viewport < 600px) {
  .saved-grid {
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }
}

@media (600px <= viewport < 1024px) {
  .saved-grid {
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
  }
}

@media (viewport >= 1024px) {
  .saved-grid {
    grid-template-columns: repeat(6, 1fr);
    gap: 8px;
  }
}
```

---

### 3. 颜色值展示现代化

#### 设计原则
- **简单值一目了然**：十六进制 + 实时色块
- **复杂值可查看详情**：标签提示 + Hover 展开
- **使用计数与重要度**：徽章显示该色被使用次数

#### 实现细节

**A. 新的颜色展示组件**

```vue
<!-- 新增 ColorValuePreview 组件 -->
<template>
  <div class="color-value-preview" :title="fullTooltip">
    <!-- 色块 -->
    <span class="color-swatch" :style="{ background: primaryColor }"></span>
    
    <!-- 值显示 -->
    <span v-if="isSimple" class="value-simple">{{ simpleValue }}</span>
    <span v-else class="value-complex" @mouseenter="showDetails = true">
      {{ complexLabel }}
      <span class="detail-icon">i</span>
    </span>
    
    <!-- 详情弹窗（Hover） -->
    <div v-if="!isSimple && showDetails" class="color-detail-popup">
      <div class="detail-content">
        <code>{{ JSON.stringify(value, null, 2) }}</code>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  value: [String, Array, Object]
})

const showDetails = ref(false)

const isSimple = computed(() => {
  return typeof props.value === 'string' && /^#[0-9a-f]{6}$/i.test(props.value)
})

const primaryColor = computed(() => {
  if (typeof props.value === 'string') return props.value
  if (Array.isArray(props.value)) return props.value[0]
  return '#cccccc'
})

const simpleValue = computed(() => {
  return props.value?.toUpperCase?.() || String(props.value)
})

const complexLabel = computed(() => {
  if (Array.isArray(props.value)) return `[${props.value.length} 色]`
  if (typeof props.value === 'object') return '[自定义]'
  return '[其他]'
})

const fullTooltip = computed(() => {
  return typeof props.value === 'string' ? props.value : JSON.stringify(props.value)
})
</script>

<style scoped>
.color-value-preview {
  display: flex;
  align-items: center;
  gap: 6px;
  position: relative;
}

.color-swatch {
  width: 16px;
  height: 16px;
  border-radius: 2px;
  border: 1px solid var(--color-border-base);
  flex-shrink: 0;
}

.value-simple {
  font-family: monospace;
  font-size: 11px;
  color: var(--color-text-secondary);
}

.value-complex {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--color-text-tertiary);
  cursor: help;
}

.detail-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--md3-outline-variant);
  color: var(--color-text-inverse);
  font-size: 9px;
  font-weight: bold;
}

.color-detail-popup {
  position: absolute;
  bottom: 100%;
  left: 0;
  background: var(--color-bg-base);
  border: 1px solid var(--color-border-base);
  border-radius: var(--radius-sm);
  padding: 8px;
  margin-bottom: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 10;
  min-width: 200px;
}

.detail-content code {
  font-size: 10px;
  color: var(--color-text-secondary);
  display: block;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
```

**B. 使用计数徽章**

```vue
<!-- 标签行添加使用计数 -->
<div class="tag-row">
  <div class="tag-swatch-col"><!-- ... --></div>
  <div class="tag-name-col">
    <input class="tag-name-input" :value="tag" />
  </div>
  <div class="tag-val-col">
    <ColorValuePreview :value="palette[tag]" />
  </div>
  <div class="tag-usage-badge">
    {{ usageCount(tag) }}
  </div>
  <div class="tag-actions"><!-- ... --></div>
</div>
```

```css
.tag-usage-badge {
  font-size: 10px;
  background: var(--md3-outline-variant);
  color: var(--color-text-inverse);
  padding: 2px 6px;
  border-radius: 10px;
  min-width: 24px;
  text-align: center;
  flex-shrink: 0;
}
```

**C. 计算使用计数函数**

```javascript
function usageCount(tag) {
  if (!store.stacks) return 0
  let count = 0
  
  // 遍历所有 stack
  store.stacks.forEach(stack => {
    if (!stack.data) return
    stack.data.forEach(part => {
      if (part.Color === tag) count++
      if (Array.isArray(part.Color) && part.Color.includes(tag)) count++
    })
  })
  
  // 遍历 focusedPart
  if (store.focusedPart?.data) {
    store.focusedPart.data.forEach(part => {
      if (part.Color === tag) count++
      if (Array.isArray(part.Color) && part.Color.includes(tag)) count++
    })
  }
  
  return count
}
```

---

### 4. Saved vs Tags 语义区分

#### 设计原则
- **视觉语言不同**：图标、背景色、排版有明显差异
- **文案表述不同**：强调各自的使用场景和特点
- **交互模式相同**：保持操作一致性

#### 实现细节

**A. Saved Colors 部分改进**

```vue
<div class="section-block saved-section">
  <div class="section-header">
    <span class="arrow">{{ collapsedSaved ? '▸' : '▾' }}</span>
    <span class="section-icon">💾</span>
    <span class="sec-title">{{ t('palette.saved.title') }}</span>
    <span class="count">({{ savedColors.length }})</span>
    <button class="clear-btn" @click.stop="handleClearAllSaved">
      {{ clearSavedWarning ? t('common.confirm') : t('common.clear') }}
    </button>
  </div>
  
  <div class="section-description">
    {{ t('palette.saved.description') }}
  </div>
  
  <transition name="fade">
    <div v-show="!collapsedSaved" class="saved-grid">
      <div v-if="savedColors.length === 0" class="empty-state">
        <div class="empty-icon">💾</div>
        <div class="empty-text">{{ t('palette.saved.emptyText') }}</div>
        <button class="empty-cta" @click="addCurrentToSaved">
          {{ t('palette.saved.emptyCTA') }}
        </button>
      </div>
      <!-- 色块网格 -->
    </div>
  </transition>
</div>
```

**新增本地化文案**：

```json
{
  "palette": {
    "saved": {
      "title": "Quick Palette",
      "description": "Temporary saved colors for quick access",
      "emptyText": "Save frequently used colors here",
      "emptyCTA": "Save Current Color"
    }
  }
}
```

```json
{
  "palette": {
    "saved": {
      "title": "快速调色板",
      "description": "临时保存的颜色，拉取快速访问",
      "emptyText": "在此保存常用颜色",
      "emptyCTA": "保存当前颜色"
    }
  }
}
```

**B. Tags 部分改进**

```vue
<div class="section-block tags-section">
  <div class="section-header">
    <span class="arrow">{{ collapsedTags ? '▸' : '▾' }}</span>
    <span class="section-icon">🏷️</span>
    <span class="sec-title">{{ t('palette.tags.title') }}</span>
    <span class="count">({{ tagKeys.length }})</span>
  </div>
  
  <div class="section-description">
    {{ t('palette.tags.description') }}
  </div>
  
  <transition name="fade">
    <div v-show="!collapsedTags" class="tags-list">
      <div v-if="tagKeys.length === 0" class="empty-state tags-empty">
        <div class="empty-icon">🏷️</div>
        <div class="empty-text">{{ t('palette.tags.emptyText') }}</div>
        <button class="empty-cta" @click="createTagFromCurrent">
          {{ t('palette.tags.emptyCTA') }}
        </button>
      </div>
      <!-- 标签列表 -->
    </div>
  </transition>
</div>
```

**新增本地化文案**：

```json
{
  "palette": {
    "tags": {
      "title": "Color Tags",
      "description": "Named color library for global use. Rename or delete tags here.",
      "emptyText": "Create named tags for key colors you'll reuse across layers",
      "emptyCTA": "Create First Tag"
    }
  }
}
```

```json
{
  "palette": {
    "tags": {
      "title": "颜色标签",
      "description": "命名的颜色库，支持全局使用。在此可重命名或删除标签。",
      "emptyText": "为关键颜色创建命名标签，支持跨层级复用",
      "emptyCTA": "创建第一个标签"
    }
  }
}
```

**C. 样式区分**

```css
/* Saved 部分 */
.saved-section .section-header {
  border-bottom: 2px solid var(--md3-primary);
}

.saved-section .section-icon {
  margin-right: 6px;
  font-size: 16px;
}

.saved-section .section-description {
  font-size: 11px;
  color: var(--color-text-tertiary);
  padding: 4px 0 6px;
  font-style: italic;
}

.saved-section .empty-state {
  background: var(--md3-primary-container);
  border-radius: var(--radius-md);
  padding: 16px;
  text-align: center;
}

/* Tags 部分 */
.tags-section .section-header {
  border-bottom: 2px solid var(--md3-tertiary);
}

.tags-section .section-icon {
  margin-right: 6px;
  font-size: 16px;
}

.tags-section .section-description {
  font-size: 11px;
  color: var(--color-text-tertiary);
  padding: 4px 0 6px;
}

.tags-section .empty-state {
  background: var(--md3-tertiary-container);
  border-radius: var(--radius-md);
  padding: 16px;
  text-align: center;
}
```

---

### 5. 删除交互优化

#### 策略选择

鉴于删除是不可逆操作（需考虑 Undo 系统复杂度），现规划**分阶段方案**：

**方案 A（推荐短期）**：改进现有"双确认"为"Undo 范式"
- 删除立即生效
- 顶部显示 3 秒吐司提示："已删除 Tag/Color，5 秒内可撤销"
- 吐司中有"撤销"按钮，点击触发 Store.undo()

**方案 B（长期）**：与全局 Undo/Redo 系统深度集成
- 每次删除自动创建 snapshot
- 用户 Ctrl+Z 直接撤销
- 吐司作为辅助反馈

#### 实现细节（方案 A）

```vue
<script setup>
// 新增删除后回调
let deleteUndoTimer = null

function handleDeleteTag(tag) {
  // 立即删除（跳过双确认）
  store.deletePaletteTag(tag)
  
  // 显示撤销提示
  DialogService.showUndoToast({
    message: t('palette.messages.tagDeleted', { tag }),
    undoLabel: t('common.undo'),
    duration: 5000,
    onUndo: () => {
      // 触发 Store Undo
      store.undo()
    }
  })
  
  // 清理编辑状态
  if (editingTagId.value === tag) exitTagEditMode()
}
</script>
```

**新增 DialogService 方法** (可选，depending on 现有系统)：

```javascript
export function showUndoToast({ message, undoLabel, duration = 5000, onUndo }) {
  const id = Math.random()
  
  // 创建吐司元素
  const toast = document.createElement('div')
  toast.className = 'palette-undo-toast'
  toast.innerHTML = `
    <span class="toast-message">${message}</span>
    <button class="toast-undo-btn">${undoLabel}</button>
  `
  
  document.body.appendChild(toast)
  
  // 绑定撤销事件
  toast.querySelector('.toast-undo-btn').addEventListener('click', () => {
    onUndo?.()
    toast.remove()
  })
  
  // 自动移除
  setTimeout(() => toast.remove(), duration)
}
```

**对应样式**：

```css
.palette-undo-toast {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--color-text-primary);
  color: var(--color-text-inverse);
  padding: 12px 16px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  animation: slideUp 0.2s ease-out;
}

.toast-message {
  font-size: 13px;
}

.toast-undo-btn {
  background: var(--md3-primary);
  color: white;
  border: none;
  border-radius: var(--radius-xs);
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.1s;
}

.toast-undo-btn:hover {
  background: var(--md3-primary-dark);
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}
```

---

## 技术实现

### 文件结构

```
src/components/Studio/
├── PalettePanel.vue               # 主组件（完全重构）
│
src/components/ui/
├── ColorValuePreview.vue          # 新增：颜色值展示组件
├── ModeIndicatorBar.vue           # 新增：模式指示栏组件（可选抽象）
│
src/services/
├── DialogService.js               # 扩展：addUndoToast() 方法
├── PaletteService.js              # 扩展：usageCount() 计算函数
│
locales/
├── en.json                        # 补充新文案
├── zh.json                        # 补充新文案
│
docs/
├── palette-panel-redesign-plan.md # 本文档
```

### 核心改动清单

#### 1. PalettePanel.vue 模板部分

**改动**：
- 替换 Banner → MD3 ModeIndicatorBar
- 将快速操作按钮改为响应式布局
- 区分 Saved / Tags 部分的视觉结构
- 添加 ColorValuePreview 组件

**受影响行数**：
- 约 50 行模板重构
- 新增 2-3 个子组件引入

#### 2. PalettePanel.vue 脚本部分

**改动**：
- 新增 `screenSize` 响应式变量（媒体查询驱动）
- 新增 `usageCount(tag)` 函数
- 修改 `handleDeleteTag()` → 改用 Undo Toast
- 简化"双确认"逻辑

**受影响行数**：
- 约 30-40 行脚本修改

#### 3. PalettePanel.vue 样式部分

**改动**：
- 新增 MD3 设计令牌（--md3-* 变量）
- 完整响应式媒体查询（4 个断点）
- 模式指示栏样式
- 新的分布局样式（Saved vs Tags）
- Undo Toast 样式

**受影响行数**：
- 原有 350 行 + 新增 200-250 行

#### 4. 新建组件

**ColorValuePreview.vue**：
- 行数：~80 行
- 依赖：无外部依赖，仅使用 Vue 3 Composition API

**ModeIndicatorBar.vue**（可选）：
- 行数：~40 行
- 目的：可复用的模式指示栏组件

#### 5. 本地化文件

**en.json 增加**：
- `palette.saved.description`
- `palette.saved.emptyText`
- `palette.saved.emptyCTA`
- `palette.tags.description`
- `palette.tags.emptyText`
- `palette.tags.emptyCTA`
- `palette.modeIndicator.browse`
- `palette.modeIndicator.editingTag`
- `palette.messages.tagDeleted`
- 约 10 个新字符串

**zh.json 增加**：同上

---

## 响应式设计

### 设计系统集成

#### MD3 设计令牌补充

在项目现有 CSS 变量基础上，补充以下 MD3 特定令牌：

```css
:root {
  /* MD3 颜色体系 */
  --md3-primary: var(--color-primary, #2563eb);
  --md3-primary-container: rgba(37, 99, 235, 0.08);
  --md3-on-primary: white;
  
  --md3-secondary: var(--color-secondary, #1e40af);
  --md3-secondary-container: rgba(30, 64, 175, 0.08);
  
  --md3-tertiary: #d946ef;  /* 警示色，用于编辑模式 */
  --md3-tertiary-container: rgba(217, 70, 239, 0.15);
  --md3-on-tertiary: white;
  
  --md3-error: var(--color-error, #ef4444);
  --md3-error-container: rgba(239, 68, 68, 0.08);
  
  --md3-outline: var(--color-border-light, #f1f5f9);
  --md3-outline-variant: var(--color-border-base, #e2e8f0);
  
  /* MD3 表面系统 */
  --md3-surface: var(--color-bg-base, #ffffff);
  --md3-surface-dim: var(--color-bg-surface, #f8fafc);
  --md3-surface-bright: white;
  --md3-on-surface: var(--color-text-primary, #0f172a);
  
  /* MD3 动画曲线 */
  --md3-motion-easing: cubic-bezier(0.2, 0, 0, 1);
  --md3-motion-duration: 0.2s;
}
```

#### 响应式变量

```javascript
// script setup 中添加屏幕尺寸追踪
import { ref, onMounted, onUnmounted } from 'vue'

const screenSize = ref('md')  // 'xs' | 'sm' | 'md' | 'lg'

function updateScreenSize() {
  const width = window.innerWidth
  if (width < 340) screenSize.value = 'xs'
  else if (width < 600) screenSize.value = 'sm'
  else if (width < 1024) screenSize.value = 'md'
  else screenSize.value = 'lg'
}

onMounted(() => {
  updateScreenSize()
  window.addEventListener('resize', updateScreenSize)
})

onUnmounted(() => {
  window.removeEventListener('resize', updateScreenSize)
})
```

### 媒体查询完整清单

```css
/* 极小屏 (< 340px) */
@media (max-width: 339px) {
  .quick-actions { flex-direction: column; }
  .action-btn .label { display: none; }
  .action-btn { padding: 8px; }
  .saved-grid { grid-template-columns: repeat(3, 1fr); }
  .tag-val-col { display: none; }
  .tag-usage-badge { display: none; }
}

/* 小屏 (340px - 599px) */
@media (340px <= width < 600px) {
  .action-btn .label { font-size: 11px; }
  .saved-grid { grid-template-columns: repeat(4, 1fr); }
  .tag-val-col { max-width: 50px; }
}

/* 中屏 (600px - 1023px) */
@media (600px <= width < 1024px) {
  .saved-grid { grid-template-columns: repeat(5, 1fr); }
  .tag-row { grid-template-columns: auto 1fr auto auto auto; }
}

/* 大屏 (>= 1024px) */
@media (width >= 1024px) {
  .saved-grid { grid-template-columns: repeat(6, 1fr); }
  .palette-content { max-height: 600px; overflow-y: auto; }
}
```

---

## 实现清单

### 第一阶段：模式状态可视化升级

- [ ] 设计 ModeIndicatorBar 组件结构
- [ ] 实现 MD3 风格 Banner 替换原有 Edit Banner
- [ ] 添加编辑模式下的选择器框视觉变化（边框+投影）
- [ ] 实现快速操作按钮在编辑模式下的禁用状态
- [ ] 更新相应的国际化文案
- [ ] 测试：模式切换时视觉反馈是否清晰

### 第二阶段：响应式布局优化

- [x] 添加 CSS 变量和媒体查询
- [x] 实现快速操作按钮的响应式布局
  - [x] 极小屏图标化
  - [x] 小屏文本缩短
  - [x] 大屏完整显示
- [x] 优化 Saved Grid 列数（根据 4 个断点）
- [x] 优化标签行布局（隐藏/展示平衡）
- [x] 测试：在 320px、600px、1024px 三个断点验证布局
- [x] 测试：文字可读性、无溢出

### 第三阶段：颜色值展示现代化

- [x] 新建 ColorValuePreview.vue 组件
- [x] 实现简单值显示（#HEX + 色块）
- [x] 实现复杂值显示（[多色] + Hover 详情）
- [x] 集成使用计数徽章
- [x] 实现 usageCount() 计算函数
- [x] 测试：各种颜色格式的渲染效果

### 第四阶段：Saved vs Tags 语义区分

- [ ] 设计 Saved 部分新样式（图标、背景、文案）
- [ ] 设计 Tags 部分新样式（图标、背景、文案）
- [ ] 实现空状态 UI
  - [ ] Saved 空状态：快速保存提示 + CTA
  - [ ] Tags 空状态：创建标签提示 + CTA
- [ ] 更新国际化文案（10+ 新字符串）
- [ ] 测试：用户能否清晰区分两个部分

### 第五阶段：删除交互优化

- [x] 扩展 DialogService 添加 showUndoToast() 方法
- [x] 修改 handleDeleteTag() 实现 Undo 范式
- [x] 修改 handleClearAllSaved() 实现 Undo 范式
- [x] 实现 Undo Toast 样式和动画
- [x] 集成 Store.undo() 调用
- [x] 为 Store 添加 clearSavedColors() 方法
- [x] 为 deleteSavedColor() 添加历史记录
- [x] 测试：删除后撤销功能是否正常

#### 实现细节总结

**DialogService.showUndoToast() 实现**：
- ✅ Created in `src/services/DialogService.js`
- ✅ Toast auto-dismisses after 5 seconds
- ✅ Supports manual undo button click
- ✅ MD3-styled with proper animations
- ✅ Stacked toast container for multiple operations
- ✅ Smooth slide-in/slide-out animations

**PalettePanel 删除处理程序更新**：
- ✅ `handleDeleteTag()` - 立即删除 + Undo Toast
- ✅ `handleClearAllSaved()` - 立即清空 + Undo Toast  
- ✅ `deleteSavedColor()` - 立即删除 + Undo Toast
- ✅ 移除了"双确认"UI 逻辑
- ✅ 简化了用户交互流程

**Store 方法增强**：
- ✅ `deleteSavedColor()` 现已调用 `pushHistorySnapshot()`
- ✅ `clearSavedColors()` 新增方法，记录历史
- ✅ 所有删除操作都能被 Undo/Redo 系统捕获

**国际化支持**：
- ✅ `palette.messages.colorDeleted` - 单个颜色删除
- ✅ `palette.messages.allColorsDeletd` - 全部清空（注：保留拼写以兼容）
- ✅ `common.undo` - 撤销按钮标签
- ✅ 完整的英文和中文翻译

### 第六阶段：集成与测试

- [ ] 本地测试：所有设备尺寸
- [ ] A/B 测试（可选）：对比新旧设计用户反馈
- [ ] 无障碍测试：Lighthouse 评分 ≥90
- [ ] 国际化测试：中文/英文显示是否正常
- [ ] 性能测试：是否引入性能回退

---

## 验证标准

### 功能验证

| 功能 | 验证标准 | 优先级 |
|:---|:---|:---|
| 模式切换 | 用户在 0.5s 内识别当前模式 | 🔴 P0 |
| 响应式布局 | 320-2560px 全尺寸可用，无溢出 | 🔴 P0 |
| 颜色展示 | 简单值显示为 #HEX，复杂值可查看详情 | 🔴 P0 |
| 删除撤销 | 删除后 5s 内可撤销 | 🟡 P1 |
| Saved vs Tags | 视觉区分度 ≥80% | 🟡 P1 |
| 空状态引导 | 新用户能快速理解如何使用 | 🟡 P1 |

### 性能验证

| 指标 | 目标 | 方法 |
|:---|:---|:---|
| 组件渲染 | <50ms | Chrome DevTools Profiler |
| 首屏加载 | <100ms（相对增量） | Lighthouse |
| 动画帧率 | 60 FPS | Chrome DevTools Performance |
| 响应式切换 | <100ms | 手动测试 + 计时 |

### 可访问性验证

| 项目 | 标准 | 方法 |
|:---|:---|:---|
| 对比度 | WCAG AA 或以上 | axe DevTools / WebAIM |
| 焦点指示 | 清晰可见 | 键盘导航测试 |
| ARIA 标签 | 所有交互元素均有标签 | 屏幕阅读器测试 |
| 动画 | 支持 prefers-reduced-motion | 浏览器设置测试 |

### 设计一致性验证

| 项 | 标准 |
|:---|:---|
| 颜色令牌 | 100% 使用 CSS 变量，无硬编码色值 |
| 圆角 | 统一使用 var(--radius-*) |
| 间距 | 统一使用 8px 网格系统 |
| 过渡 | 使用 MD3 easing curve |
| 字体 | 遵循已定义的字体栈 |

---

## 项目进度

### 实现完成状态

| 阶段 | 状态 | 完成日期 | 备注 |
|:---|:---|:---|:---|
| 第一阶段（模式状态可视化） | ✅ **已完成** | 2026-02-21 | Mode indicator bar + 禁用按钮 |
| 第二阶段（响应式布局优化） | ✅ **已完成** | 2026-02-21 | 4个断点 + 自适应网格 |
| 第三阶段（颜色展示现代化） | ✅ **已完成** | 2026-02-21 | ColorValuePreview + 使用计数徽章 + 空状态 |
| 第四阶段（删除交互优化 + Undo） | ✅ **已完成** | 2026-02-21 | Undo Toast + Store集成 |
| 第五阶段（集成与测试） | 🟡 **进行中** | - | 待完成全面测试和部署准备 |

### 时间表（参考）

**假设开发工作量**：40-60 人小时  
**当前进度**：~16 小时完成（阶段 1-4）

| 阶段 | 时长 | 状态 |
|:---|:---|:---|
| 第一阶段（模式状态） | 8 小时 | ✅ |
| 第二阶段（响应式） | 10 小时 | ✅ |
| 第三阶段（颜色展示） | 8 小时 | ✅ |
| 第四阶段（删除交互） | **6 小时** | ✅ |
| 第五阶段（集成测试） | 12 小时 | 🟡 **进行中** |
| **总计** | **44 小时** | |

| 第四阶段（语义区分） | 8 小时 | - | - |
| 第五阶段（删除交互） | 6 小时 | - | - |
| 第六阶段（测试集成） | 12 小时 | - | - |
| **总计** | **52 小时** | | |

### 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|:---|:---|:---|:---|
| 与 Undo 系统集成复杂度高 | 中 | 高 | 先实现 Toast 降级方案，后期深度集成 |
| 响应式布局在某些设备上排版混乱 | 低 | 中 | 提前在 5+ 真实设备测试 |
| 性能回退（大量标签时） | 低 | 中 | 使用 computed + 缓存策略 |
| 国际化文案冲突 | 极低 | 低 | 提前审核所有新文案 |

### 决策点

1. **Undo 方案**：
   - 推荐：先实现 Toast + 5s 自动撤销（短期），后期与全局 Undo 深度集成（长期）
   - 备选：仅改进删除 UX，保留双确认但优化视觉反馈

2. **ModeIndicatorBar 组件化**：
   - 推荐：独立组件（ColorValuePreview 类似），便于复用和维护
   - 备选：内联在 PalettePanel 中

3. **使用计数性能**：
   - 推荐：缓存 usageCount 结果，仅在 paletteMap 变化时重算
   - 备选：实时计算（每次渲染都遍历 stacks）

---

## 附录

### A. 相关设计规范参考

- [Material Design 3 综合指南](https://m3.material.io/)
- [Material Design 3 颜色系统](https://m3.material.io/styles/color/overview)
- [Material Design 3 动效指南](https://m3.material.io/styles/motion/overview)
- [Web Content Accessibility Guidelines (WCAG) 2.1](https://www.w3.org/WAI/WCAG21/quickref/)

### B. 现有项目相关文件

- [studioStore.js](../src/stores/studioStore.js) - 核心状态管理
- [palette-actions.js](../src/studio/palette-actions.js) - 颜色操作函数库
- [PaletteService.js](../src/services/PaletteService.js) - 颜色工具函数
- [theme.css](../src/styles/theme.css) - 设计令牌定义
- [USER_GUIDE.md](../USER_GUIDE.md) - 用户文档

### C. 样本代码片段

完整的实现代码将在后续的 PR 中提供，本计划文档仅展示核心逻辑和设计意图。

### D. 审查清单

在进行代码审查时，请检查：

- [ ] 所有新增的颜色值是否来自 CSS 变量
- [ ] 响应式布局是否经过 4 个断点测试
- [ ] 新增组件是否遵循项目的 Component API 规范
- [ ] 国际化文案是否完整（en.json + zh.json）
- [ ] 临界性能操作（usageCount 等）是否有缓存或优化
- [ ] 无障碍属性（aria-label 等）是否完整
- [ ] Undo 功能是否与 Store 的 undo/redo 系统集成

---

**文档版本历史**

| 版本 | 日期 | 作者 | 变动 |
|:---|:---|:---|:---|
| v1.0 | 2026-02-21 | Design Review | 初稿，完整设计方案 |

