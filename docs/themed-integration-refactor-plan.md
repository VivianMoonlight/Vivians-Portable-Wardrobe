# Themed BC 集成重构计划

## 问题分析

### 当前问题
1. **检测不一致**：运行时输出 `[vue-wardrobe] Themed BC not detected`，但实际上仍在使用 Themed BC 的颜色变量
2. **CSS 自动fallback**：`theme.css` 中使用了 CSS `var()` fallback 机制（如 `var(--tmd-accent, #2563eb)`），导致即使没有检测到 Themed BC，只要页面上存在 `--tmd-*` 变量就会被自动使用
3. **控制不明确**：无法明确控制何时使用 Themed BC 颜色，何时使用独立配色

### 根本原因
- CSS fallback 是声明式的，会自动查找 `--tmd-*` 变量，不受 JavaScript 检测逻辑控制
- 检测逻辑和实际颜色应用机制脱钩
- 缺少显式的颜色应用策略

## 重构目标

1. **准确检测**：修复 Themed BC 检测逻辑，确保检测结果与实际使用状态一致
2. **独立配色方案**：提供完全独立于 Themed BC 的深浅两套配色方案
3. **Themed 集成模式**：当 Themed BC 存在时，提供基于其颜色变量的配色方案
4. **清理冗余**：移除未使用的代码和不必要的复杂性

## 实现计划

### 阶段 1：修复 CSS 颜色变量机制

#### 1.1 移除 CSS 自动 Fallback
**文件**：`src/styles/theme.css`

**改动**：
- 移除所有 `.theme-light` 和 `.theme-dark` 中的 `var(--tmd-*, fallback)` 写法
- 改为纯色值定义，不自动引用 Themed BC 变量
- 保留 `:root` 中的默认值

**原因**：CSS 自动 fallback 会绕过 JavaScript 检测逻辑，需要改为显式控制

**示例**：
```css
/* 修改前 */
.theme-light {
  --color-primary: var(--tmd-accent, #2563eb);
}

/* 修改后 */
.theme-light {
  --color-primary: #2563eb;
}
```

#### 1.2 添加 Themed 模式类
**文件**：`src/styles/theme.css`

**新增**：
- 添加 `.theme-themed-light` 类：仅在 Themed BC 存在且为浅色主题时使用
- 添加 `.theme-themed-dark` 类：仅在 Themed BC 存在且为深色主题时使用
- 这些类中使用 `var(--tmd-*)` 但不提供 fallback（如果 Themed BC 不存在，应用会fallback到基础theme类）

**示例**：
```css
/* Themed BC 集成模式 - 浅色 */
.theme-themed-light {
  --color-primary: var(--tmd-accent);
  --color-primary-hover: var(--tmd-accent-hover);
  --color-bg-base: var(--tmd-main);
  --color-bg-surface: var(--tmd-element);
  --color-bg-hover: var(--tmd-element-hover);
  --color-text-primary: var(--tmd-text);
  --color-text-secondary: var(--tmd-text);
  --color-text-tertiary: var(--tmd-text);
  --color-border-base: var(--tmd-accent);
  --color-success: var(--tmd-equipped);
  --color-error: var(--tmd-blocked);
}

/* Themed BC 集成模式 - 深色 */
.theme-themed-dark {
  /* 同上，使用相同的 --tmd-* 变量 */
  /* Themed BC 会根据其自身的主题模式提供对应的颜色值 */
}
```

### 阶段 2：简化检测逻辑

#### 2.1 精简 themedBridge.js
**文件**：`src/utils/themedBridge.js`

**保留功能**：
- `detectThemedBC()` - 检测 Themed BC 是否存在
- `readThemedColors()` - 读取 Themed BC 颜色（用于调试/状态显示）
- `watchThemedReload()` - 监听 Themed BC 主题变化

**移除功能**：
- `mapThemedColors()` - 不再需要，改由 CSS 类控制
- `getThemedCSSVar()` - 功能已整合到 `readThemedColors()`
- `getThemedVersion()` - 如果未使用则移除
- `isGUIOverhaulMode()` - 如果未使用则移除

**改进检测逻辑**：
```javascript
export function detectThemedBC() {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return { installed: false, enabled: false }
    }

    // 检测 1: window.ColorsModule 存在
    const hasColorsModule = typeof window.ColorsModule !== 'undefined'
    
    // 检测 2: 特征 style 标签存在
    const hasThemedCSS = !!document.querySelector('style[data-themed-bc]')
    
    // 检测 3: CSS 变量值存在且不为空
    const themedVars = checkThemedVariables()
    
    const installed = hasColorsModule || hasThemedCSS
    const enabled = installed && themedVars
    
    return { installed, enabled }
  } catch (error) {
    console.debug('[vue-wardrobe] Themed BC detection failed:', error)
    return { installed: false, enabled: false }
  }
}

function checkThemedVariables() {
  try {
    if (!document.documentElement) return false
    
    const computedStyle = getComputedStyle(document.documentElement)
    const tmdMain = computedStyle.getPropertyValue('--tmd-main').trim()
    const tmdAccent = computedStyle.getPropertyValue('--tmd-accent').trim()
    
    // 必须同时存在主色和强调色
    return tmdMain !== '' && tmdAccent !== ''
  } catch (error) {
    return false
  }
}
```

#### 2.2 简化 ThemedIntegrationService.js
**文件**：`src/services/ThemedIntegrationService.js`

**改动**：
- 移除 `applyThemedColors()` 方法（改由 CSS 类控制）
- 移除 `resetToDefaultColors()` 方法（改由 CSS 类控制）
- 移除 `useThemedColors` 状态（改为直接使用 `themedEnabled`）
- 简化 `syncWithThemed()` 方法，只负责更新检测状态

**新增**：
- `getThemeClass()` 方法：根据当前状态返回应该应用的 CSS 类名

```javascript
export function useThemedIntegration() {
  const themedDetected = ref(false)
  const themedEnabled = ref(false)
  const themedColors = ref({})
  let cleanupWatcher = null

  const initThemedIntegration = () => {
    const detection = detectThemedBC()
    themedDetected.value = detection.installed
    themedEnabled.value = detection.enabled

    if (themedEnabled.value) {
      themedColors.value = readThemedColors()
      setupThemedWatcher()
      console.info('[vue-wardrobe] Themed BC detected and enabled')
    } else if (themedDetected.value) {
      console.info('[vue-wardrobe] Themed BC detected but not enabled')
    } else {
      console.info('[vue-wardrobe] Themed BC not detected, using default themes')
    }
  }

  const setupThemedWatcher = () => {
    if (cleanupWatcher) cleanupWatcher()
    
    cleanupWatcher = watchThemedReload(() => {
      console.info('[vue-wardrobe] Themed BC theme changed, re-syncing...')
      themedColors.value = readThemedColors()
    })
  }

  const getThemeClass = (baseTheme) => {
    // baseTheme: 'light' | 'dark'
    if (themedEnabled.value) {
      return `theme-themed-${baseTheme}`
    }
    return `theme-${baseTheme}`
  }

  const refreshDetection = () => {
    const detection = detectThemedBC()
    const wasEnabled = themedEnabled.value
    
    themedDetected.value = detection.installed
    themedEnabled.value = detection.enabled
    
    if (themedEnabled.value && !wasEnabled) {
      themedColors.value = readThemedColors()
      setupThemedWatcher()
    } else if (!themedEnabled.value && wasEnabled) {
      if (cleanupWatcher) {
        cleanupWatcher()
        cleanupWatcher = null
      }
    }
  }

  // 返回接口
  return {
    themedDetected: computed(() => themedDetected.value),
    themedEnabled: computed(() => themedEnabled.value),
    initThemedIntegration,
    getThemeClass,
    refreshDetection,
    getThemedColors: () => ({ ...themedColors.value }),
  }
}
```

### 阶段 3：更新 ThemeService

#### 3.1 集成新的主题类生成逻辑
**文件**：`src/services/ThemeService.js`

**改动**：
- 更新 `themeClass()` 方法，使用 `themedIntegration.getThemeClass()`
- 移除对 `applyThemedColors()` 和 `resetToDefaultColors()` 的调用
- 简化 `syncWithThemed()` 为 `refreshThemedDetection()`

```javascript
export function useTheme() {
  // ... 其他代码保持不变

  const themeClass = () => {
    if (themedIntegration) {
      return themedIntegration.getThemeClass(currentTheme.value)
    }
    return `theme-${currentTheme.value}`
  }

  const setTheme = (theme) => {
    if (theme !== 'light' && theme !== 'dark') {
      console.warn(`Invalid theme: ${theme}. Must be 'light' or 'dark'.`)
      return
    }

    currentTheme.value = theme

    try {
      localStorage.setItem('app-theme', theme)
    } catch (error) {
      console.warn('Failed to save theme to localStorage:', error)
    }
    
    // 主题类会自动更新，因为 themeClass() 是响应式的
  }

  const refreshThemedDetection = () => {
    if (themedIntegration) {
      themedIntegration.refreshDetection()
    }
  }

  return {
    currentTheme,
    isInitialized,
    initTheme,
    setTheme,
    toggleTheme,
    themeClass,
    isDark,
    getCSSVar,
    detectThemedPlugin,
    refreshThemedDetection,
    getThemedStatus,
    tokensReference: themeTokensReference,
  }
}
```

### 阶段 4：清理冗余代码

#### 4.1 移除未使用的功能
**检查并移除**：
- `mapThemedColors()` 函数及其使用（`themedBridge.js`）
- `getThemedVersion()` - 如果只在日志中使用，可以移除或简化
- `isGUIOverhaulMode()` - 如果未实际使用，可以移除
- `toggleThemedIntegration()` - 如果不需要手动开关，可以移除
- ThemedStatusWidget 中未使用的功能

#### 4.2 更新相关组件
**需要更新的组件**：
- `ThemedStatusWidget.vue` - 移除已弃用的方法调用
- `FileManagerPanel.vue` - 确认主题切换正常工作
- 其他使用 `useTheme()` 的组件

### 阶段 5：优化和完善

#### 5.1 主题判断逻辑
**决策**：Themed BC 的主题模式（深色/浅色）如何确定？

**选项 1**：跟随应用自身的主题设置
```javascript
// 用户在应用中选择 light/dark，Themed BC 只提供颜色值
getThemeClass(currentTheme.value) // 'light' or 'dark' from user selection
```

**选项 2**：自动检测 Themed BC 的主题模式
```javascript
// 通过检测 --tmd-main 的亮度判断 Themed BC 是深色还是浅色主题
function detectThemedThemeMode() {
  const mainColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--tmd-main').trim()
  
  // 计算亮度，判断是深色还是浅色
  const brightness = calculateBrightness(mainColor)
  return brightness > 128 ? 'light' : 'dark'
}
```

**推荐**：选项 1 - 简单且可控，用户明确选择主题模式

#### 5.2 配色方案审查
**任务**：
1. 审查 `theme.css` 中 `.theme-light` 和 `.theme-dark` 的配色
2. 确保两套主题在没有 Themed BC 时视觉效果良好
3. 确保主要、次要、第三颜色的对比度符合可访问性要求
4. 测试边界情况（如只设置了部分 Themed BC 变量）

## 实施步骤

### Step 1: CSS 重构（不破坏现有功能）
1. 备份 `theme.css`
2. 移除 `.theme-light` 和 `.theme-dark` 中的 `var(--tmd-*)`
3. 添加新的 `.theme-themed-light` 和 `.theme-themed-dark` 类
4. 测试独立配色方案显示正常

### Step 2: JavaScript 逻辑更新
1. 更新 `themedBridge.js` 的检测逻辑
2. 重构 `ThemedIntegrationService.js`
3. 更新 `ThemeService.js`
4. 确保主题类名正确应用到 DOM

### Step 3: 组件更新
1. 更新 `ThemedStatusWidget.vue`
2. 检查 `FileManagerPanel.vue` 主题切换
3. 测试其他使用主题的组件

### Step 4: 清理和优化
1. 移除废弃的函数和方法
2. 更新相关注释和文档
3. 移除未使用的导入和变量

### Step 5: 测试
1. **无 Themed BC 环境**：测试深浅两套主题
2. **有 Themed BC 环境**：测试 Themed 集成模式
3. **Themed BC 主题切换**：测试热更新
4. **边界情况**：测试 Themed BC 部分变量缺失的情况

## 预期结果

### 功能改进
1. ✅ 检测结果与实际使用状态一致
2. ✅ 独立配色方案不受 Themed BC 影响
3. ✅ Themed BC 集成模式正确工作
4. ✅ 代码更清晰，逻辑更简单

### 配色方案
1. **独立浅色主题**（`.theme-light`）
   - 白色背景，深色文字
   - 蓝色系主色调
   - 清晰的层次感

2. **独立深色主题**（`.theme-dark`）
   - 深色背景，浅色文字
   - 蓝色系主色调
   - 适合夜间使用

3. **Themed 浅色集成**（`.theme-themed-light`）
   - 完全使用 Themed BC 的颜色变量
   - 假设主色、次要色等同为浅色，文字为深色

4. **Themed 深色集成**（`.theme-themed-dark`）
   - 完全使用 Themed BC 的颜色变量
   - 假设主色、次要色等同为深色，文字为浅色

### 兼容性
- 向后兼容现有的 Themed BC 版本
- 优雅降级（Themed BC 不存在时使用独立配色）
- 不影响非主题相关功能

## 相关文件清单

### 需要修改的文件
1. `src/styles/theme.css` - 核心CSS变量定义
2. `src/utils/themedBridge.js` - 检测和读取逻辑
3. `src/services/ThemedIntegrationService.js` - 集成服务
4. `src/services/ThemeService.js` - 主题服务
5. `src/components/ThemedStatusWidget.vue` - 状态组件

### 需要审查的文件
1. `src/components/FileManagerPanel.vue` - 主题切换
2. `src/components/*.vue` - 所有使用主题的组件
3. `src/style.css` - 全局样式

## 风险和注意事项

### 风险
1. **破坏现有 Themed BC 集成**：需要充分测试
2. **CSS 类名冲突**：确保新类名不与现有类冲突
3. **性能影响**：频繁的主题检测可能影响性能

### 缓解措施
1. 分步实施，每步都要测试
2. 保留旧代码作为备份（使用 git）
3. 添加详细的日志输出，方便调试
4. 使用防抖（debounce）限制检测频率

## 后续优化

1. **主题预览**：在设置中提供主题预览功能
2. **自定义配色**：允许用户自定义配色方案
3. **主题导出/导入**：支持主题配置的导出和导入
4. **A11y 增强**：确保所有配色方案符合 WCAG 标准

---

**文档版本**：1.0  
**创建日期**：2026-02-22  
**最后更新**：2026-02-22  
**状态**：待审核
