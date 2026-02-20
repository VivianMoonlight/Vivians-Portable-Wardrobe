# Button Usage Guidelines

## Overview

`BaseButton` provides a consistent button primitive across the application with semantic variants, sizes, and states.

## Variants

### Primary (`variant="primary"`)

**Visual**: Blue background, white text  
**Semantics**: Primary action, completion, or confirmation

**Use for:**
- Apply/Confirm/Save buttons in forms
- Submit actions
- Main CTA (Call-to-Action)
- Final step in multi-step flows

**Examples:**
```vue
<BaseButton variant="primary">{{ t('apply') }}</BaseButton>
<BaseButton variant="primary">{{ t('save') }}</BaseButton>
<BaseButton variant="primary">{{ t('confirm') }}</BaseButton>
```

### Secondary (`variant="secondary"`)

**Visual**: White background, gray border, dark text  
**Semantics**: Alternative action, navigation, or utility

**Use for:**
- Cancel buttons
- Refresh/Reload actions
- Toggle/Filter buttons
- Secondary navigation

**Examples:**
```vue
<BaseButton variant="secondary">{{ t('cancel') }}</BaseButton>
<BaseButton variant="secondary">{{ t('refresh') }}</BaseButton>
<BaseButton variant="secondary">{{ t('toggle') }}</BaseButton>
```

### Ghost (`variant="ghost"`)

**Visual**: Transparent background, dark text  
**Semantics**: Subtle action, low priority, or inline controls

**Use for:**
- Toolbar icon buttons (with `iconOnly`)
- Inline actions within lists
- Tertiary actions
- Overflow menu triggers

**Examples:**
```vue
<BaseButton variant="ghost" icon-only>
  <IconRefresh />
</BaseButton>
<BaseButton variant="ghost">{{ t('showMore') }}</BaseButton>
```

### Danger (`variant="danger"`)

**Visual**: Red background, white text  
**Semantics**: Destructive action, requires confirmation

**Use for:**
- Delete/Remove actions
- Clear all operations
- Irreversible actions
- Data loss warnings

**Examples:**
```vue
<BaseButton variant="danger">{{ t('delete') }}</BaseButton>
<BaseButton variant="danger">{{ t('clearAll') }}</BaseButton>
<BaseButton variant="danger">{{ t('remove') }}</BaseButton>
```

## Sizes

### Small (`size="sm"`)
- **Height**: 28px
- **Use for**: Compact toolbars, inline actions, dense lists

### Medium (`size="md"`) - Default
- **Height**: 32px
- **Use for**: Standard forms, dialogs, panels

### Large (`size="lg"`)
- **Height**: 36px
- **Use for**: Hero CTAs, high-prominence actions, touch targets

## Modifiers

### Icon-Only (`icon-only`)

**Purpose**: Square buttons for toolbars and icon-based actions

**Usage:**
```vue
<BaseButton variant="ghost" icon-only size="sm">
  <IconSearch />
</BaseButton>
```

**Rules:**
- Always provide accessible label (aria-label or tooltip)
- Icon size should match button size (16px for sm, 18px for md, 20px for lg)
- Prefer `ghost` variant for toolbars

### Loading State (`loading`)

**Purpose**: Disable and indicate async operation

**Usage:**
```vue
<BaseButton :loading="isSaving" variant="primary">
  {{ t('save') }}
</BaseButton>
```

**Behavior:**
- Button becomes disabled
- Reduced opacity (0.7)
- Prevents click events

## Action Hierarchy in UI

### Dialog Footer Pattern
```vue
<BasePanelFooter align="right">
  <BaseButton variant="secondary" @click="onCancel">
    {{ t('cancel') }}
  </BaseButton>
  <BaseButton variant="primary" @click="onConfirm">
    {{ t('confirm') }}
  </BaseButton>
</BasePanelFooter>
```

### Toolbar with Danger Action
```vue
<div class="toolbar">
  <BaseButton variant="ghost" icon-only @click="onRefresh">
    <IconRefresh />
  </BaseButton>
  <BaseButton variant="ghost" icon-only @click="onSettings">
    <IconSettings />
  </BaseButton>
  <div style="margin-left: auto;">
    <BaseButton variant="danger" size="sm" @click="onClearAll">
      {{ t('clearAll') }}
    </BaseButton>
  </div>
</div>
```

### List Item Actions
```vue
<div class="list-item-actions">
  <BaseButton variant="ghost" size="sm">
    {{ t('edit') }}
  </BaseButton>
  <BaseButton variant="danger" size="sm">
    {{ t('delete') }}
  </BaseButton>
</div>
```

## Accessibility

### Required Attributes
- `type="button"` (default) - Use `type="submit"` for form submissions
- `aria-label` for icon-only buttons
- `disabled` state prevents interaction and is announced by screen readers

### Best Practices
- Maintain 4:5:1 contrast ratio (WCAG AA)
- Minimum touch target: 32px (already enforced in md/lg sizes)
- Clear visual feedback on hover/active/focus states
- Descriptive labels (avoid "Click here" or "Button")

## Migration Checklist

When migrating existing buttons to `BaseButton`:

1. **Identify button semantics**
   - [ ] Primary action → `variant="primary"`
   - [ ] Destructive action → `variant="danger"`
   - [ ] Alternative action → `variant="secondary"`
   - [ ] Subtle/toolbar action → `variant="ghost"`

2. **Apply size modifier**
   - [ ] Default to `size="md"`
   - [ ] Use `size="sm"` for toolbars/compact layouts
   - [ ] Use `size="lg"` for hero CTAs

3. **Handle icon-only buttons**
   - [ ] Add `icon-only` prop
   - [ ] Add `aria-label` attribute
   - [ ] Verify icon size matches button size

4. **Replace custom styles**
   - [ ] Remove inline styles
   - [ ] Remove custom classes (except layout utilities)
   - [ ] Use design tokens for any additional styling

5. **Test states**
   - [ ] Verify hover/active/disabled states
   - [ ] Test with light/dark themes
   - [ ] Validate keyboard navigation (Tab, Enter, Space)

## Design Token Reference

### Colors
```css
--color-primary: #2563eb;
--color-primary-hover: #1d4ed8;
--color-danger: #dc2626;
--color-danger-hover: #b91c1c;
--color-text-inverse: #ffffff;
--color-border-base: #e2e8f0;
```

### Sizing
```css
--button-height-sm: 28px;
--button-height-md: 32px;
--button-height-lg: 36px;
--space-sm: 8px;
--space-lg: 16px;
--space-xl: 24px;
--radius-md: 8px;
```

### Transitions
```css
--transition-fast: 0.15s;
```

## Anti-Patterns

### ❌ Do Not
- Mix multiple primary buttons in the same context (causes confusion)
- Use danger variant for non-destructive actions
- Override BaseButton styles with inline CSS
- Create custom button classes when BaseButton suffices

### ✅ Do Instead
- One primary action per context (others are secondary/ghost)
- Reserve danger only for delete/clear/remove
- Extend via composition or wrapper components
- Use BaseButton for consistency, extend only when necessary

## Examples by Context

### File Manager Panel
```vue
<template>
  <div class="file-manager">
    <!-- Toolbar -->
    <div class="toolbar">
      <BaseButton variant="ghost" icon-only size="sm" aria-label="Refresh">
        <IconRefresh />
      </BaseButton>
      <BaseButton variant="ghost" icon-only size="sm" aria-label="Upload">
        <IconUpload />
      </BaseButton>
    </div>

    <!-- File actions -->
    <div class="file-actions">
      <BaseButton variant="secondary" size="sm">
        {{ t('select') }}
      </BaseButton>
      <BaseButton variant="primary" size="sm">
        {{ t('apply') }}
      </BaseButton>
      <BaseButton variant="danger" size="sm">
        {{ t('delete') }}
      </BaseButton>
    </div>
  </div>
</template>
```

### Studio Toolbar
```vue
<template>
  <div class="studio-toolbar">
    <BaseButton variant="ghost" icon-only aria-label="Undo">
      <IconUndo />
    </BaseButton>
    <BaseButton variant="ghost" icon-only aria-label="Redo">
      <IconRedo />
    </BaseButton>
    <div class="separator" />
    <BaseButton variant="secondary" size="sm">
      {{ t('preview') }}
    </BaseButton>
    <BaseButton variant="primary" size="sm">
      {{ t('save') }}
    </BaseButton>
  </div>
</template>
```

### Confirmation Dialog
```vue
<template>
  <div class="dialog">
    <BasePanelHeader>
      <template #title>{{ t('confirmDelete') }}</template>
    </BasePanelHeader>
    <BasePanelBody>
      <p>{{ t('deleteConfirmMessage') }}</p>
    </BasePanelBody>
    <BasePanelFooter align="right">
      <BaseButton variant="secondary" @click="onCancel">
        {{ t('cancel') }}
      </BaseButton>
      <BaseButton variant="danger" @click="onConfirm">
        {{ t('delete') }}
      </BaseButton>
    </BasePanelFooter>
  </div>
</template>
```
