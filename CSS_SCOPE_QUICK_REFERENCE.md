# CSS 样式隔离快速参考

## 📋 核心原则

本项目作为 Tampermonkey 脚本注入宿主页面，所有样式必须限定在 `#vue-tampermonkey-root` 容器内，避免污染宿主页面。

## ✅ DO - 正确做法

### 1. 使用命名空间前缀

```css
/* ✅ 好 */
.vpw-button { }
.vpw-panel { }
.vpw-card { }
.vpw-u-fluid-padding { }
.vpw-u-sticky-top { }
```

### 2. 在容器内定义全局样式

```css
/* ✅ 好 - 在容器内重置 */
#vue-tampermonkey-root {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

#vue-tampermonkey-root button {
  cursor: pointer;
}

#vue-tampermonkey-root * {
  font-family: var(--font-family);
}
```

### 3. 在容器内定义 CSS 变量

```css
/* ✅ 好 */
:root,
#vue-tampermonkey-root {
  --color-primary: #2563eb;
  --spacing-base: 8px;
}

/* 使用变量 */
#vue-tampermonkey-root button {
  color: var(--color-primary);
}
```

## ❌ DON'T - 禁止做法

### 1. 全局无限制选择器

```css
/* ❌ 不要 - 会污染整个页面 */
* {
  box-sizing: border-box;
}

body {
  background: white;
}

button {
  cursor: pointer;
}
```

### 2. 直接使用 HTML 元素选择器

```css
/* ❌ 不要 */
a { color: blue; }
input { padding: 8px; }
div { display: flex; }
```

### 3. 只在 :root 定义 CSS 变量

```css
/* ❌ 不要（单独 :root 无法在容器内应用） */
:root {
  --primary: #2563eb;
}

/* ✅ 要这样 */
:root,
#vue-tampermonkey-root {
  --primary: #2563eb;
}
```

## 📁 文件规范

### normalize.css
- **用途**: CSS reset，确保跨浏览器一致性
- **范围**: 仅在 `#vue-tampermonkey-root` 内应用
- **示例**:
  ```css
  #vue-tampermonkey-root * {
    margin: 0;
    padding: 0;
  }
  ```

### theme.css
- **用途**: 设计系统变量（颜色、间距、排版等）
- **范围**: 在 `:root` 和 `#vue-tampermonkey-root` 上定义
- **示例**:
  ```css
  :root,
  #vue-tampermonkey-root {
    --color-primary: #2563eb;
    --space-md: 12px;
  }
  ```

### components.css
- **用途**: 可复用组件样式
- **范围**: 使用 `.vpw-*` 前缀
- **示例**:
  ```css
  .vpw-btn-primary {
    background: var(--color-primary);
  }
  ```

### responsive.css
- **用途**: 响应式工具类
- **范围**: 使用 `.vpw-u-*` 前缀（utility）
- **示例**:
  ```css
  .vpw-u-fluid-padding {
    padding: clamp(12px, 3vw, 20px);
  }
  ```

## 🔍 检查清单

新增样式时，请检查：

- [ ] 是否使用了 `.vpw-*` 前缀？
- [ ] 是否避免了无限制通用选择器（`*`）？
- [ ] 是否避免了直接的 `body` / `html` / `button` 等选择器？
- [ ] CSS 变量是否既在 `:root` 又在 `#vue-tampermonkey-root` 定义？
- [ ] 是否在本地测试后对宿主页面的其他元素确没有样式影响？

## 🧪 本地测试方法

### 1. 检查宿主页面元素是否被污染

```javascript
// 在浏览器控制台运行
const hostButton = document.querySelector('button:not(#vue-tampermonkey-root button)');
const computed = getComputedStyle(hostButton);

// 检查是否有意外的样式继承
console.log(computed.cursor);        // 应该是 'default' 或原始值，不应该是 'pointer'
console.log(computed.backgroundColor); // 应该是原始值，不应该是 VPW 的颜色
```

### 2. 验证 VPW 容器内样式正常

```javascript
// VPW 容器内的按钮应该正常应用样式
const vpwButton = document.querySelector('#vue-tampermonkey-root button');
const computed = getComputedStyle(vpwButton);

console.log(computed.cursor);  // 应该是 'pointer'（由 normalize.css 设置）
```

### 3. 浏览器开发工具验证

1. 打开 DevTools → Elements
2. 检查宿主页面元素 → 样式不应包含 `.vpw-*` 规则
3. 检查 VPW 容器内元素 → 应包含 normalize 样式规则

## 📚 常见问题

### Q: 为什么需要 `#vue-tampermonkey-root` 前缀？

A: Tampermonkey 脚本直接注入到宿主页面，所有全局样式都会影响宿主页面。添加前缀确保隔离。

### Q: CSS 变量可以只在 `:root` 定义吗？

A: 不可以。虽然 `:root` 定义的变量可以被继承，但为了确保在 `#vue-tampermonkey-root` 容器内也能正常应用，应该同时在两个地方定义。

### Q: 什么时候可以使用全局选择器？

A: 仅限以下情况：
- 在 `#vue-tampermonkey-root` 容器内（如 `#vue-tampermonkey-root *`）
- 已经过充分测试，确认不会污染宿主页面

### Q: 能使用 Shadow DOM 完全隔离吗？

A: 可以，但需要重新构建整个应用。当前方案（选择器隔离）已足够有效，且维护成本更低。

## 🔗 相关文档

- [完整分析文档](./NORMALIZED_CSS_SCOPE_ANALYSIS.md)
- [项目架构](./ARCHITECTURE.md)
- [开发指南](./README.md)

---

**最后更新**: 2026-03-01  
**快速参考版本**: 1.0
