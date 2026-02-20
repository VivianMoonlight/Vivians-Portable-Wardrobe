# List Interaction Standards

> Unified interaction patterns for all list components in Studio
> 
> Created: 2026-02-20 (P1.5 Implementation)

## Goals

1. **Predictable interaction grammar** across all list-based components
2. **Consistent visual feedback** for selection, drag operations, and actions
3. **Unified arm-confirm delete pattern** for destructive operations
4. **Standard drag handle placement and feedback** for reorderable lists

## Components in Scope

- `Studio/StackList.vue` - Stack management list
- `Studio/PartListPanel.vue` - Part browsing and editing list
- `Studio/LayerManagerWidget.vue` - Layer priority management list

## Unified Standards

### 1. Selection Feedback

**Standard class name:** `.active`

**Visual treatment:**
- Border: `--color-border-focus` (blue focus color)
- Background: Subtle highlight `--color-bg-base`
- Box-shadow: `--shadow-md` for elevation
- Transition: `var(--transition-fast, 0.15s)`

**Implementation:**
```css
.list-item.active {
  box-shadow: var(--shadow-md, 0 4px 12px rgba(20, 30, 60, 0.08));
  border-color: var(--color-border-focus, rgba(120, 160, 215, 0.6));
  background: var(--color-bg-base, #fdfdfd);
}
```

**Rationale:** Consistent with `BaseButton` active state and other UI primitives.

### 2. Drag Handle Location

**For reorderable lists only:**
- Position: Far left of row (before primary content)
- Visual: `⋮⋮` icon in muted color
- Cursor: `grab` (default), `grabbing` (active)
- Size: 20px width, consistent padding

**Implementation:**
```html
<div class="drag-handle" 
     draggable="true" 
     @dragstart="onDragStart"
     @click.stop
     title="Drag to reorder">
  ⋮⋮
</div>
```

```css
.drag-handle {
  cursor: grab;
  color: var(--color-text-muted, #94a3b8);
  padding: 4px;
  margin-right: 4px;
  font-size: 16px;
  line-height: 1;
  flex-shrink: 0;
  width: 20px;
  text-align: center;
}

.drag-handle:active {
  cursor: grabbing;
}
```

**For non-reorderable lists:**
- No drag handle displayed
- Entire row may be draggable if needed for other purposes (e.g., LayerManager visual move)

### 3. Drag Feedback Classes

**Standard class names:**
- `.drag-over-top` - Drop zone above current item
- `.drag-over-bottom` - Drop zone below current item
- `.drag-over-middle` - Drop zone replacing/grouping with current item

**Visual treatment:**
```css
.list-item.drag-over-top {
  border-top: 2px solid var(--color-primary, #2563eb);
  margin-top: -2px; /* prevent layout shift */
}

.list-item.drag-over-bottom {
  border-bottom: 2px solid var(--color-primary, #2563eb);
  margin-bottom: -2px;
}

.list-item.drag-over-middle {
  background: var(--color-selection-single-bg, rgba(65, 122, 237, 0.08));
  outline: 2px dashed var(--color-selection-single, #417aed);
  outline-offset: -2px;
}
```

**Rationale:** Provides clear visual feedback for where dropped item will be placed.

### 4. Arm-Confirm Delete Pattern

**Interaction flow:**
1. First click: Arm delete (button shows warning state)
2. Second click on same button: Confirm delete (execute action)
3. Click outside or on different item: Disarm (cancel)

**Visual states:**
- Default: `✖` icon, neutral color
- Armed: `⚠` icon, danger color with background

**Implementation:**
```vue
<template>
  <button 
    class="icon-btn delete-btn" 
    :class="{ armed: isArmed(item) }"
    @click.stop="toggleArmDelete(item)"
    :title="isArmed(item) ? t('confirmDelete') : t('deleteItem')">
    {{ isArmed(item) ? '⚠' : '✖' }}
  </button>
</template>

<script setup>
const armedItems = ref(new Set())

function isArmed(item) {
  return armedItems.value.has(item.id)
}

function toggleArmDelete(item) {
  if (armedItems.value.has(item.id)) {
    // Second click: confirm
    confirmDelete(item)
  } else {
    // First click: arm
    armedItems.value = new Set([item.id])
  }
}

function confirmDelete(item) {
  // Execute deletion
  store.deleteItem(item.id)
  armedItems.value.clear()
}

// Clear armed state when clicking outside
onMounted(() => {
  document.addEventListener('click', (e) => {
    if (!rootEl.value?.contains(e.target)) {
      armedItems.value.clear()
    }
  }, true)
})
</script>

<style scoped>
.icon-btn.armed {
  background: var(--color-danger, #dc2626) !important;
  color: white !important;
  box-shadow: var(--shadow-md);
}

.icon-btn.armed:hover {
  background: var(--color-danger-hover, #b91c1c) !important;
}
</style>
```

**Rationale:** Prevents accidental deletions while keeping interaction fast (no modal dialogs).

### 5. Rename Affordance (Optional)

**Note:** Only applicable where renaming makes semantic sense (e.g., StackList).

**Interaction:**
- Inline editing with dedicated rename button (`✎` icon)
- Click button → show input → blur or Enter to commit → Escape to cancel
- Input styled with focus border for clarity

**Implementation pattern:**
```vue
<template>
  <!-- Normal display -->
  <div v-if="renamingIndex !== index" class="item-name">
    {{ item.name }}
  </div>
  
  <!-- Rename mode -->
  <div v-else class="rename-container">
    <input 
      ref="renameInputRef"
      v-model="renamingValue"
      class="rename-input"
      @blur="commitRename"
      @keydown.enter="commitRename"
      @keydown.esc="cancelRename"
      @click.stop
    />
  </div>
  
  <!-- Rename button -->
  <button 
    class="icon-btn rename-btn"
    @click.stop="startRename(index, item.name)"
    :title="t('rename')">
    ✎
  </button>
</template>
```

## Component-Specific Adaptations

### StackList.vue
- ✅ Has rename functionality
- ✅ Has drag handle for reordering
- ✅ Has arm-confirm delete
- 🔄 Update: Use `.active` instead of `.active` (already correct!)
- 🔄 Update: Use `.drag-over-*` classes consistently

### PartListPanel.vue
- ❌ No rename (parts are asset references)
- ❌ No drag reordering (parts are grouped by slots)
- ✅ Has arm-confirm delete
- 🔄 Update: Use `.active` instead of `.focused` for selection
- Additional: Keep replace-btn and eye-btn as domain-specific actions

### LayerManagerWidget.vue
- ❌ No rename (layers are part properties)
- ⚠️ Special drag: Entire row draggable for priority reordering
- ❌ No delete (layers are managed through PartInspector)
- 🔄 Update: Use `.active` instead of `.is-active`
- 🔄 Update: Consider adding subtle drag handle if UX feedback warrants it

## Migration Checklist

For each component:

- [ ] Selection feedback uses `.active` class
- [ ] Drag feedback uses `.drag-over-top/middle/bottom` classes
- [ ] Delete buttons use arm-confirm pattern (where applicable)
- [ ] Drag handles positioned consistently (where applicable)
- [ ] Hover states use `--color-bg-hover` token
- [ ] Transitions use `--transition-fast` token
- [ ] Focus states use `--color-border-focus` token
- [ ] All icon buttons have proper `aria-label` or `title` attributes

## Design Tokens Usage

All list components must use these standard tokens:

```css
/* Colors */
--color-bg-base
--color-bg-hover
--color-bg-panel
--color-text-primary
--color-text-secondary
--color-text-tertiary
--color-text-muted
--color-border-base
--color-border-focus
--color-selection-single
--color-selection-single-bg
--color-primary
--color-danger
--color-danger-hover

/* Spacing */
--space-xs: 4px
--space-sm: 8px
--space-md: 12px
--space-lg: 16px

/* Border radius */
--radius-sm: 6px
--radius-md: 8px
--radius-lg: 10px

/* Shadows */
--shadow-sm
--shadow-md

/* Transitions */
--transition-fast: 0.15s
--transition-base: 0.2s
```

## Validation Criteria

After implementing unified patterns:

1. **Visual consistency**: All lists should have similar selection/hover/drag feedback
2. **Interaction consistency**: Delete operations follow same arm-confirm flow
3. **Accessibility**: All interactive elements have proper labels
4. **Performance**: Transitions are smooth, no layout shift during drag operations
5. **Maintainability**: CSS patterns are duplicated minimally, using shared tokens

## Future Enhancements

Potential improvements for P2:

- Create `BaseListItem.vue` component to encapsulate common list row patterns
- Extract arm-confirm delete logic into `useArmConfirmDelete` composable
- Create `useDragReorder` composable for list reordering behavior
- Add keyboard navigation support (arrow keys, Enter to select)
- Add multi-select interaction pattern (Shift+click, Ctrl+click)

---

**Status:** P1.5 Implementation in progress (2026-02-20)
