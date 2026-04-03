# 样式加载诊断指南

## ⚠️ 常见症状

### 症状 1: 样式完全没有应用
- 按钮、输入框等没有样式
- 颜色、字体、间距都是浏览器默认值

### 症状 2: 样式部分应用  
- 某些组件有样式，某些没有
- 通常是因为 scoped 样式覆盖了全局样式

### 症状 3: 响应式变量（CSS 变量）没有应用
- 检查浏览器开发工具是否看到 `var(--color-primary)` 显示为红色（未定义）

---

## 🔍 诊断步骤

### 1. 验证容器是否存在

在浏览器控制台运行：

```javascript
// 检查根容器是否存在
const root = document.getElementById('vue-tampermonkey-root');
console.log('Root container:', root);
console.log('Root ID:', root?.id);
console.log('Root innerHTML:', root?.innerHTML?.substring(0, 100));
```

**预期结果**: 应该看到 div 容器，ID 为 `vue-tampermonkey-root`

---

### 2. 检查样式表是否被注入

```javascript
// 查找所有 style 标签和 link 标签
const styles = document.querySelectorAll('style, link[rel="stylesheet"]');
console.log('Total stylesheets:', styles.length);

// 检查是否包含 normalize 或 vpw 相关样式
styles.forEach((style, index) => {
  const content = style.textContent || style.href || '';
  if (content.includes('normalize') || content.includes('vpw') || content.includes('box-sizing')) {
    console.log(`Style ${index}:`, content.substring(0, 200));
  }
});
```

**预期结果**: 应该看到包含 `box-sizing: border-box` 的样式表

---

### 3. 检查 CSS 变量是否定义

```javascript
// 获取根元素的计算样式
const root = document.getElementById('vue-tampermonkey-root');
const computed = getComputedStyle(root);

// 检查关键 CSS 变量
console.log('--color-primary:', computed.getPropertyValue('--color-primary'));
console.log('--space-md:', computed.getPropertyValue('--space-md'));
console.log('--font-family:', computed.getPropertyValue('--font-family'));

// 列出所有自定义属性（CSS 变量）
const allVars = Array.from(computed)
  .filter(prop => prop.startsWith('--'))
  .slice(0, 20); // 显示前 20 个
console.log('CSS Variables sample:', allVars);
```

**预期结果**: 应该看到变量值被正确定义，而不是空字符串

---

### 4. 检查特定元素是否应用了样式

```javascript
// 找到容器内的第一个按钮
const button = document.querySelector('#vue-tampermonkey-root button');
if (button) {
  const computed = getComputedStyle(button);
  
  console.log('Button styles:');
  console.log('  cursor:', computed.cursor);
  console.log('  background:', computed.backgroundColor);
  console.log('  padding:', computed.padding);
  console.log('  border:', computed.border);
  console.log('  display:', computed.display);
  
  // 检查是否应用了 normalize 样式
  console.log('  margin:', computed.margin);
  console.log('  box-sizing:', computed.boxSizing);
}
```

**预期结果：**
- `cursor: pointer`（来自 normalize.css）
- `border: none`（来自 normalize.css）
- `background: none`（来自 normalize.css）

---

### 5. 检查类名和属性

```javascript
// 检查根元素的类
const root = document.getElementById('vue-tampermonkey-root');
console.log('Root classes:', root?.className);

// 检查是否有 data-v-* 属性（Vue scoped）
const allElements = document.querySelectorAll('#vue-tampermonkey-root *');
let hasVueScoped = false;
allElements.forEach(el => {
  if (el.hasAttributes()) {
    Array.from(el.attributes).forEach(attr => {
      if (attr.name.startsWith('data-v-')) {
        hasVueScoped = true;
        console.log('Vue scoped attribute found:', attr.name);
      }
    });
  }
});
console.log('Has Vue scoped styles:', hasVueScoped);
```

**预期结果**: 应该看到 `data-v-*` 属性（这是 Vue scoped 样式的标记，这是正常的）

---

### 6. 查看计算样式继承链

```javascript
// 详细检查按钮样式的来源
const button = document.querySelector('#vue-tampermonkey-root button');
if (button) {
  // 打印所有样式规则
  const rules = getMatchedCSSRules(button);
  if (rules) {
    console.log('CSS Rules applied to button:');
    Array.from(rules).forEach((rule, i) => {
      console.log(`  ${i}: ${rule.selectorText} - ${rule.cssText.substring(0, 100)}`);
    });
  } else {
    console.log('getMatchedCSSRules not available (可能在跨域环境中)');
    // 备选方案：检查 DevTools
    console.log('请在浏览器 DevTools 中检查该元素的 Styles 面板');
  }
}
```

---

## 🛠️ 修复步骤

### 问题 1: 样式表没有被注入

**症状**: 控制台看不到任何包含 `box-sizing` 的样式表

**解决方案**:
```javascript
// 检查 main.js 中是否有: import './style.css'
// 如果没有，在 main.js 最顶部添加:
import './style.css';
```

---

### 问题 2: CSS 变量没有定义

**症状**: `computed.getPropertyValue('--color-primary')` 返回空字符串

**解决方案**:
1. 检查 theme.css 是否导入了
2. 验证 theme.css 中的 `:root, #vue-tampermonkey-root { }` 块是否存在
3. 检查是否有拼写错误

---

### 问题 3: 样式被 scoped 样式覆盖

**症状**: normalize 样式有应用，但被组件样式覆盖

**解决方案**:
```css
/* 在 normalize.css 中使用 !important */
#vue-tampermonkey-root button {
  cursor: pointer !important;
  background: none !important;
  border: none !important;
}
```

---

### 问题 4: 容器 ID 不匹配

**症状**: CSS 选择器中的 `#vue-tampermonkey-root` 与实际的容器 ID 不符

**解决方案**:
```javascript
// 在 main.js 中检查
const root = doc.createElement('div');
root.id = 'vue-tampermonkey-root';  // 必须完全匹配
doc.body.appendChild(root);
```

确保 CSS 中的 ID 与这里的 ID 完全一致。

---

## 📊 完整诊断脚本

复制这个脚本到浏览器控制台运行，获得完整的诊断报告：

```javascript
console.log('=== VPW Style Diagnosis ===\n');

// 1. 容器检查
const root = document.getElementById('vue-tampermonkey-root');
console.log('1. Container:', {
  exists: !!root,
  id: root?.id,
  childCount: root?.children?.length,
  innerHTML_length: root?.innerHTML?.length
});

// 2. 样式表检查
const stylesheets = Array.from(document.styleSheets)
  .filter(sheet => {
    try {
      return sheet.cssRules.toString().includes('vpw') || 
             sheet.cssRules.toString().includes('box-sizing');
    } catch (e) {
      return false;
    }
  });
console.log('2. Stylesheets:', stylesheets.length);

// 3. CSS 变量检查
if (root) {
  const computed = getComputedStyle(root);
  const colorPrimary = computed.getPropertyValue('--color-primary').trim();
  const spacemd = computed.getPropertyValue('--space-md').trim();
  console.log('3. CSS Variables:', {
    '--color-primary': colorPrimary || '❌ NOT DEFINED',
    '--space-md': spacemd || '❌ NOT DEFINED'
  });
}

// 4. 按钮样式检查
const button = document.querySelector('#vue-tampermonkey-root button');
if (button) {
  const computed = getComputedStyle(button);
  console.log('4. Button Styles:', {
    cursor: computed.cursor,
    background: computed.backgroundColor,
    border: computed.border,
    'box-sizing': computed.boxSizing
  });
} else {
  console.log('4. Button Styles:', '❌ No button found');
}

// 5. Vue Scoped 检查
let scopedCount = 0;
document.querySelectorAll('#vue-tampermonkey-root *').forEach(el => {
  if (Array.from(el.attributes).some(attr => attr.name.startsWith('data-v-'))) {
    scopedCount++;
  }
});
console.log('5. Vue Scoped Elements:', scopedCount);

console.log('\n=== End Diagnosis ===');
```

---

## 📋 检查清单

在使用诊断脚本后，检查以下项目：

- [ ] 容器 `#vue-tampermonkey-root` 存在
- [ ] 有多个样式表被注入
- [ ] CSS 变量被正确定义
- [ ] 按钮有 normalize 样式（`cursor: pointer`, `border: none`）
- [ ] 有 `data-v-*` 属性（这是正常的）

---

## 🚀 快速修复

如果样式还是不工作，尝试这个快速修复：

1. **清理浏览器缓存**
   ```javascript
   // Tampermonkey → 脚本管理 → 脚本编辑器
   // 或重新加载页面 (Ctrl+Shift+R 硬刷新)
   ```

2. **重新构建项目**
   ```bash
   npm run build
   ```

3. **检查构建输出**
   ```bash
   # 检查 dist 目录中的文件大小
   # 如果太小，说明 CSS 没有被打包
   ls -lh dist/
   ```

4. **验证 vite.config.js**
   - 确保 `assetsInlineLimit` 足够大
   - 确保 `inlineDynamicImports: true`

---

## 📞 获取帮助

如果上述诊断都通过了但样式仍未显示，请提供：

1. 诊断脚本的完整输出
2. 浏览器开发工具中 Elements 面板的截图
3. 构建输出日志

---

**最后更新**: 2026-03-01
