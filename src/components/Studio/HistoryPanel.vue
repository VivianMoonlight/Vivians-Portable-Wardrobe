<template>
  <div class="history-panel">
    <div class="history-header">
      <div class="history-heading">
        <h4>{{ t("history.title") }}</h4>
        <p class="history-subtitle">{{ t("history.timelineSubtitle") }}</p>
      </div>
      <button
        class="clear-btn"
        @click="handleClearHistory"
        :disabled="!hasHistory"
        :title="t('history.clearTitle')"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <polyline points="3 6 5 6 21 6"></polyline>
          <path
            d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
          ></path>
        </svg>
        {{ t("history.clear") }}
      </button>
    </div>

    <div class="history-stats">
      <div class="stat-item">
        <span class="legend-dot undo-dot"></span>
        <span class="stat-label">{{ t("history.undoCount") }}:</span>
        <span class="stat-value">{{ historyData.undoCount }}</span>
      </div>
      <div class="stat-item">
        <span class="legend-dot redo-dot"></span>
        <span class="stat-label">{{ t("history.redoCount") }}:</span>
        <span class="stat-value">{{ historyData.redoCount }}</span>
      </div>
      <div class="stat-item total-item">
        <span class="legend-dot current-dot"></span>
        <span class="stat-label">{{ t("history.totalStates") }}:</span>
        <span class="stat-value">{{ totalStates }}</span>
      </div>
    </div>

    <div
      v-if="hasHistory"
      class="timeline-shell"
      :class="{ 'has-left-fade': canScrollPrev, 'has-right-fade': canScrollNext }"
    >
      <div
        class="history-timeline"
        ref="timelineRef"
        @scroll.passive="onTimelineScroll"
        @wheel="onTimelineWheel"
      >
        <div class="history-sequence">
          <div
            v-for="(item, index) in pastStack"
            :key="`undo-${index}`"
            class="history-item undo-item"
            @click="jumpToUndoState(item)"
            @keydown.enter.prevent="jumpToUndoState(item)"
            @keydown.space.prevent="jumpToUndoState(item)"
            :title="getItemTitle(item, 'undo')"
            :aria-label="getItemTitle(item, 'undo')"
            tabindex="0"
            role="button"
          >
            <div class="item-indicator">
              <div class="item-dot undo-dot"></div>
            </div>
            <div class="item-content">
              <div class="item-chip">{{ t("history.pastTag") }}</div>
              <div class="item-description">{{ getLocalizedHistoryDescription(item) }}</div>
              <div
                v-if="getHistoryOperationChips(item).length > 0"
                class="item-operation-tags"
              >
                <span
                  v-for="chip in getHistoryOperationChips(item)"
                  :key="chip.key"
                  class="operation-chip"
                  :class="[`is-${chip.kind}`, `tone-${chip.tone}`]"
                >
                  {{ chip.label }}
                </span>
              </div>
              <div class="item-timestamp">{{ formatTimestamp(item.timestamp) }}</div>
            </div>
          </div>

          <div class="history-item current-state">
            <div class="item-indicator">
              <div class="item-dot current-dot"></div>
            </div>
            <div class="item-content">
              <div class="item-chip">{{ t("history.currentTag") }}</div>
              <div class="current-label">{{ t("history.currentState") }}</div>
            </div>
          </div>

          <div
            v-for="(item, index) in futureStack"
            :key="`redo-${index}`"
            class="history-item redo-item"
            @click="jumpToRedoState(item)"
            @keydown.enter.prevent="jumpToRedoState(item)"
            @keydown.space.prevent="jumpToRedoState(item)"
            :title="getItemTitle(item, 'redo')"
            :aria-label="getItemTitle(item, 'redo')"
            tabindex="0"
            role="button"
          >
            <div class="item-indicator">
              <div class="item-dot redo-dot"></div>
            </div>
            <div class="item-content">
              <div class="item-chip">{{ t("history.futureTag") }}</div>
              <div class="item-description">{{ getLocalizedHistoryDescription(item) }}</div>
              <div
                v-if="getHistoryOperationChips(item).length > 0"
                class="item-operation-tags"
              >
                <span
                  v-for="chip in getHistoryOperationChips(item)"
                  :key="chip.key"
                  class="operation-chip"
                  :class="[`is-${chip.kind}`, `tone-${chip.tone}`]"
                >
                  {{ chip.label }}
                </span>
              </div>
              <div class="item-timestamp">{{ formatTimestamp(item.timestamp) }}</div>
            </div>
          </div>
        </div>
      </div>
      <p v-if="showScrollHint" class="scroll-hint">{{ t("history.scrollHint") }}</p>
    </div>

    <div v-else class="empty-state">
      <svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
      <p>{{ t("history.emptyState") }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { useStudioDomainStores } from "@/stores/studio";
import { createStudioHistoryBridge } from "@/stores/studio/historyBridge";
import * as DialogService from "@/services/DialogService.js";

const { t, te } = useI18n();
const { studio: store, history } = useStudioDomainStores();
const historyBridge = createStudioHistoryBridge(store, history);

const timelineRef = ref(null);

const historyData = computed(() => {
  // Track history-store revision so this computed invalidates when stacks mutate.
  const revision = historyBridge.getRevision();
  void revision;

  try {
    return historyBridge.getFullHistory();
  } catch (e) {
    console.warn("[HistoryPanel] Failed to get history:", e);
    return {
      undoStack: [],
      redoStack: [],
      undoCount: 0,
      redoCount: 0,
      canUndo: false,
      canRedo: false,
    };
  }
});

const undoStack = computed(() => historyData.value.undoStack || []);
const redoStack = computed(() => historyData.value.redoStack || []);
const currentState = computed(
  () => historyData.value.current || undoStack.value[undoStack.value.length - 1] || null
);
const pastStack = computed(() => {
  if (undoStack.value.length <= 1) return [];
  const pastItems = undoStack.value.slice(0, -1);
  const pastCount = pastItems.length;

  // Keep timeline order as oldest -> latest -> current.
  // Steps are negative distance from current snapshot.
  return pastItems.map((item, index) => ({
    ...item,
    steps: -(pastCount - index),
  }));
});
const futureStack = computed(() =>
  [...redoStack.value]
    .reverse()
    .map((item, index) => ({ ...item, steps: index + 1 }))
);
const totalStates = computed(
  () => pastStack.value.length + futureStack.value.length + (currentState.value ? 1 : 0)
);

const hasHistory = computed(() => {
  return historyData.value.undoCount > 0 || historyData.value.redoCount > 0;
});

const canScrollPrev = ref(false);
const canScrollNext = ref(false);
const showScrollHint = ref(false);

const HISTORY_OPERATION_CONTENT_RULES = Object.freeze([
  {
    key: "color",
    tone: "color",
    test: (actionType) => actionType.includes("color"),
  },
  {
    key: "opacity",
    tone: "opacity",
    test: (actionType) => actionType.includes("opacity"),
  },
  {
    key: "shift",
    tone: "shift",
    test: (actionType) => actionType.includes("offset"),
  },
  {
    key: "order",
    tone: "order",
    test: (actionType) => actionType.includes("priority") || actionType.endsWith(".move"),
  },
  {
    key: "layer",
    tone: "layer",
    test: (actionType) => actionType.includes("layer"),
  },
  {
    key: "property",
    tone: "property",
    test: (actionType) =>
      actionType.includes("property") || actionType.includes("metadata"),
  },
  {
    key: "tag",
    tone: "tag",
    test: (actionType) => actionType.includes("tag"),
  },
]);

function formatTimestamp(timestamp) {
  if (!timestamp) return "";

  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) {
    return t("history.justNow");
  }

  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return t("history.minutesAgo", { count: minutes });
  }

  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return t("history.hoursAgo", { count: hours });
  }

  const date = new Date(timestamp);
  return date.toLocaleString();
}

function getItemTitle(item, type) {
  const typeLabel = type === "redo" ? t("history.redoItem") : t("history.undoItem");
  const description = getLocalizedHistoryDescription(item);
  const operationTags = getHistoryOperationChips(item)
    .map((chip) => chip.label)
    .join(" / ");
  const time = item.timestamp ? new Date(item.timestamp).toLocaleString() : "";
  const operationHint = operationTags ? ` [${operationTags}]` : "";
  return `${typeLabel}: ${description}${operationHint}${time ? "\n" + time : ""}`;
}

function resolveHistoryActionType(item) {
  const fromMeta = String(item?.historyMeta?.actionType || "").trim();
  if (fromMeta) return fromMeta;

  const fromDescription = String(item?.description || "").trim();
  if (/^[a-z]+(\.[a-zA-Z]+)+$/.test(fromDescription)) {
    return fromDescription;
  }

  return "";
}

function getLocalizedHistoryDescription(item) {
  const actionType = resolveHistoryActionType(item);
  if (actionType) {
    const key = `history.actionTypeLabels.${actionType}`;
    if (te(key)) return t(key);
  }

  const description = String(item?.description || "").trim();
  if (!description || description === "State Change") return t("history.stateChange");
  if (description === "Initial State") return t("history.initialState");
  return description;
}

function getHistoryOperationChips(item) {
  const actionType = resolveHistoryActionType(item);
  if (!actionType) return [];

  const chips = [];
  const normalizedActionType = actionType.toLowerCase();
  const [scope] = actionType.split(".");

  if (scope) {
    const scopeKey = `history.actionScopeLabels.${scope}`;
    if (te(scopeKey)) {
      chips.push({
        key: `scope:${scope}`,
        label: t(scopeKey),
        kind: "scope",
        tone: "scope",
      });
    }
  }

  const seen = new Set();
  for (const rule of HISTORY_OPERATION_CONTENT_RULES) {
    if (seen.has(rule.key) || !rule.test(normalizedActionType, actionType)) continue;

    const labelKey = `history.operationContentLabels.${rule.key}`;
    if (!te(labelKey)) continue;

    chips.push({
      key: `content:${rule.key}`,
      label: t(labelKey),
      kind: "content",
      tone: rule.tone,
    });
    seen.add(rule.key);
  }

  if (chips.length > 0) return chips;

  const fallbackKey = "history.operationContentLabels.general";
  if (!te(fallbackKey)) return [];
  return [
    {
      key: "content:general",
      label: t(fallbackKey),
      kind: "content",
      tone: "general",
    },
  ];
}

function jumpToRedoState(item) {
  const steps = Number(item?.steps);
  if (!Number.isFinite(steps) || steps <= 0) return;
  store.execute({
    type: "history.jump",
    payload: { steps },
  });
}

function jumpToUndoState(item) {
  const steps = Number(item?.steps);
  if (!Number.isFinite(steps) || steps >= 0) return;
  store.execute({
    type: "history.jump",
    payload: { steps },
  });
}

async function handleClearHistory() {
  if (!hasHistory.value) return;

  const confirmed = await DialogService.confirm(t("history.clearConfirmMessage"));

  if (confirmed) {
    store.execute({
      type: "history.clear",
      payload: {},
    });
  }
}

function scrollToCurrentState() {
  if (!timelineRef.value) return;

  const currentStateEl = timelineRef.value.querySelector(".current-state");
  if (currentStateEl) {
    currentStateEl.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "end",
    });
  }
}

function updateScrollAffordance() {
  const timelineEl = timelineRef.value;
  if (!timelineEl) {
    canScrollPrev.value = false;
    canScrollNext.value = false;
    showScrollHint.value = false;
    return;
  }

  const maxScrollLeft = Math.max(0, timelineEl.scrollWidth - timelineEl.clientWidth);
  const hasHorizontalOverflow = maxScrollLeft > 6;

  showScrollHint.value = hasHorizontalOverflow;
  canScrollPrev.value = hasHorizontalOverflow && timelineEl.scrollLeft > 4;
  canScrollNext.value =
    hasHorizontalOverflow && timelineEl.scrollLeft < maxScrollLeft - 4;
}

function onTimelineScroll() {
  updateScrollAffordance();
}

function onTimelineWheel(e) {
  if (!timelineRef.value) return;
  // If the user uses Shift+Wheel, deltaX is usually populated natively, so handle vertical wheel (deltaY) only
  if (Math.abs(e.deltaY) > 0 && e.deltaX === 0) {
    const el = timelineRef.value;
    const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);

    // Only prevent default and hijack scroll if we can actually scroll horizontally
    if (
      (e.deltaY < 0 && el.scrollLeft > 0) ||
      (e.deltaY > 0 && el.scrollLeft < maxScrollLeft)
    ) {
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    }
  }
}

watch(
  () => historyBridge.getRevision(),
  async () => {
    await nextTick();
    scrollToCurrentState();
    updateScrollAffordance();
  },
  { flush: "post" }
);

onMounted(async () => {
  await nextTick();
  updateScrollAffordance();
  if (typeof window !== "undefined") {
    window.addEventListener("resize", updateScrollAffordance, { passive: true });
  }
});

onBeforeUnmount(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("resize", updateScrollAffordance);
  }
});
</script>

<style scoped>
.history-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  height: 100%;
  background: var(--color-bg-base, #ffffff);
  overflow-x: hidden;
  overflow-y: hidden;
}

.history-panel > * {
  max-width: 100%;
  min-width: 0;
}

.history-header {
  width: 100%;
  padding: var(--space-sm, 8px) var(--space-md, 12px) var(--space-xs, 4px);
  border-bottom: 1px solid var(--color-border-base, #e2e8f0);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-md, 12px);
  min-width: 0;
  flex-shrink: 0;
  box-sizing: border-box;
}

.history-heading {
  display: flex;
  flex-direction: column;
  flex: 1 1 180px;
  gap: 2px;
  min-width: 0;
}

.history-header h4 {
  margin: 0;
  font-size: var(--font-size-md, 14px);
  font-weight: var(--font-weight-semibold, 600);
  color: var(--color-text-primary, #1e293b);
}

.history-subtitle {
  margin: 0;
  font-size: var(--font-size-xs, 11px);
  color: var(--color-text-tertiary, #64748b);
}

.clear-btn {
  display: flex;
  align-items: center;
  gap: var(--space-xs, 4px);
  padding: 5px var(--space-sm, 8px);
  border: 1px solid var(--color-border-base, #e2e8f0);
  border-radius: var(--radius-md, 8px);
  background: var(--color-bg-base, #ffffff);
  color: var(--color-text-secondary, #64748b);
  font-size: var(--font-size-sm, 12px);
  cursor: pointer;
  transition: all var(--transition-fast, 0.15s) var(--transition-easing, ease);
  margin-left: auto;
  flex-shrink: 0;
}

.clear-btn:hover:not(:disabled) {
  background: var(--color-error-bg, #fee2e2);
  border-color: var(--color-error, #ef4444);
  color: var(--color-error, #ef4444);
}

.clear-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.history-stats {
  width: 100%;
  padding: 6px var(--space-md, 12px) 8px;
  background: var(--color-bg-surface, #f8fafc);
  border-bottom: 1px solid var(--color-border-base, #e2e8f0);
  display: flex;
  align-items: center;
  gap: var(--space-md, 12px);
  flex-wrap: wrap;
  flex-shrink: 0;
  min-width: 0;
  box-sizing: border-box;
}

.stat-item {
  height: 24px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border-radius: var(--radius-full, 9999px);
  border: 1px solid var(--color-border-light, #f1f5f9);
  background: var(--color-bg-base, #ffffff);
  font-size: var(--font-size-sm, 12px);
}

.total-item {
  margin-left: auto;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1.5px solid;
  flex-shrink: 0;
}

.stat-label {
  color: var(--color-text-secondary, #64748b);
}

.stat-value {
  font-weight: var(--font-weight-semibold, 600);
  color: var(--color-text-primary, #1e293b);
}

.timeline-shell {
  position: relative;
  flex: 1;
  width: 100%;
  max-width: 100%;
  min-height: 0;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: hidden;
}

.timeline-shell::before,
.timeline-shell::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 26px;
  width: 18px;
  z-index: 2;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--transition-fast, 0.15s) var(--transition-easing, ease);
}

.timeline-shell::before {
  left: 0;
  background: linear-gradient(
    90deg,
    var(--color-bg-base, #ffffff) 20%,
    rgba(255, 255, 255, 0)
  );
}

.timeline-shell::after {
  right: 0;
  background: linear-gradient(
    270deg,
    var(--color-bg-base, #ffffff) 20%,
    rgba(255, 255, 255, 0)
  );
}

.timeline-shell.has-left-fade::before {
  opacity: 1;
}

.timeline-shell.has-right-fade::after {
  opacity: 1;
}

.history-timeline {
  width: 100%;
  inline-size: 100%;
  max-inline-size: 100%;
  min-inline-size: 0;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 10px 12px 6px;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  overscroll-behavior-x: contain;
  -webkit-overflow-scrolling: touch;
  scrollbar-gutter: stable;
}

.history-sequence {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: stretch;
  gap: 10px;
  width: max-content;
  min-width: max-content;
  max-width: none;
  margin-left: 0;
  padding-right: 2px;
  min-height: 100%;
}

.history-item {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  width: 126px;
  min-width: 126px;
  min-height: 178px;
  padding: 9px 7px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-surface, #f8fafc);
  transition: background-color var(--transition-fast, 0.15s)
      var(--transition-easing, ease),
    border-color var(--transition-fast, 0.15s) var(--transition-easing, ease),
    box-shadow var(--transition-fast, 0.15s) var(--transition-easing, ease),
    transform var(--transition-fast, 0.15s) var(--transition-easing, ease);
  position: relative;
  overflow: hidden;
}

.history-item:not(.current-state) {
  cursor: pointer;
}

.history-item:not(.current-state):hover {
  background: var(--color-bg-base, #ffffff);
  border-color: var(--color-border-base, #cbd5e1);
  box-shadow: var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.08));
  transform: translateY(-1px);
}

.history-item:focus-visible {
  outline: 2px solid var(--color-border-focus, #3b82f6);
  outline-offset: 1px;
}

.item-indicator {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 12px;
  flex-shrink: 0;
}

.item-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid;
  background: var(--color-bg-base, #ffffff);
  margin-top: 2px;
}

.undo-dot {
  border-color: var(--color-primary, #3b82f6);
  background: rgba(59, 130, 246, 0.12);
}

.redo-dot {
  border-color: var(--color-text-tertiary, #94a3b8);
  background: rgba(148, 163, 184, 0.08);
}

.current-dot {
  border-color: var(--color-success, #10b981);
  background: var(--color-success, #10b981);
  box-shadow: 0 0 0 3px var(--color-success-bg, #d1fae5);
}

.item-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.item-chip {
  display: inline-flex;
  align-self: flex-start;
  max-width: 100%;
  padding: 1px 8px;
  border-radius: var(--radius-full, 9999px);
  font-size: 10px;
  line-height: 1.5;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  border: 1px solid var(--color-border-base, #e2e8f0);
  background: var(--color-bg-base, #ffffff);
  color: var(--color-text-secondary, #64748b);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.undo-item .item-chip {
  border-color: rgba(59, 130, 246, 0.25);
  color: var(--color-primary, #3b82f6);
  background: rgba(59, 130, 246, 0.08);
}

.redo-item .item-chip {
  border-color: rgba(148, 163, 184, 0.35);
  color: var(--color-text-secondary, #64748b);
  background: rgba(148, 163, 184, 0.08);
}

.current-state .item-chip {
  border-color: rgba(16, 185, 129, 0.35);
  color: var(--color-success, #10b981);
  background: rgba(16, 185, 129, 0.1);
}

.item-description {
  font-size: var(--font-size-sm, 12px);
  color: var(--color-text-primary, #1e293b);
  font-weight: var(--font-weight-medium, 500);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  line-clamp: 3;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow-wrap: anywhere;
  word-break: break-word;
  line-height: 1.35;
}

.item-operation-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-height: 18px;
}

.operation-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: var(--radius-full, 9999px);
  font-size: 10px;
  line-height: 1.4;
  border: 1px solid transparent;
  white-space: nowrap;
}

.operation-chip.is-scope {
  color: var(--color-text-secondary, #64748b);
  border-color: rgba(148, 163, 184, 0.35);
  background: rgba(148, 163, 184, 0.12);
}

.operation-chip.is-content {
  color: var(--color-primary, #3b82f6);
  border-color: rgba(59, 130, 246, 0.28);
  background: rgba(59, 130, 246, 0.1);
}

.operation-chip.tone-color {
  color: #b45309;
  border-color: rgba(245, 158, 11, 0.35);
  background: rgba(245, 158, 11, 0.12);
}

.operation-chip.tone-opacity {
  color: #0369a1;
  border-color: rgba(14, 165, 233, 0.35);
  background: rgba(14, 165, 233, 0.12);
}

.operation-chip.tone-shift {
  color: #0f766e;
  border-color: rgba(20, 184, 166, 0.35);
  background: rgba(20, 184, 166, 0.12);
}

.operation-chip.tone-order {
  color: #6d28d9;
  border-color: rgba(139, 92, 246, 0.32);
  background: rgba(139, 92, 246, 0.12);
}

.operation-chip.tone-layer {
  color: #1d4ed8;
  border-color: rgba(59, 130, 246, 0.35);
  background: rgba(59, 130, 246, 0.12);
}

.operation-chip.tone-property,
.operation-chip.tone-tag,
.operation-chip.tone-general {
  color: var(--color-text-secondary, #64748b);
  border-color: rgba(148, 163, 184, 0.35);
  background: rgba(148, 163, 184, 0.12);
}

.redo-item .item-description {
  color: var(--color-text-secondary, #64748b);
  font-style: italic;
}

.item-timestamp {
  font-size: var(--font-size-xs, 11px);
  color: var(--color-text-tertiary, #94a3b8);
}

.current-state {
  border-color: var(--color-success, #10b981);
  background: var(--color-success-bg, #ecfdf5);
}

.current-label {
  font-size: var(--font-size-sm, 12px);
  font-weight: var(--font-weight-semibold, 600);
  color: var(--color-success, #10b981);
}

.scroll-hint {
  margin: 0;
  padding: 0 12px 8px;
  font-size: 11px;
  color: var(--color-text-tertiary, #94a3b8);
  text-align: right;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 20px;
  text-align: center;
  color: var(--color-text-tertiary, #94a3b8);
  gap: 10px;
}

.empty-state svg {
  opacity: 0.5;
}

.empty-state p {
  margin: 0;
  font-size: var(--font-size-sm, 12px);
}

.history-timeline::-webkit-scrollbar {
  height: 8px;
  width: 8px;
}

.history-timeline::-webkit-scrollbar-track {
  background: var(--color-bg-base, #ffffff);
}

.history-timeline::-webkit-scrollbar-thumb {
  background: var(--color-border-strong, #cbd5e1);
  border-radius: var(--radius-xs, 4px);
}

.history-timeline::-webkit-scrollbar-thumb:hover {
  background: var(--color-border-strong, #94a3b8);
}

@media (max-width: 900px) {
  .history-header {
    align-items: center;
  }

  .clear-btn {
    min-width: 70px;
    justify-content: center;
  }

  .history-stats {
    gap: 8px;
  }

  .total-item {
    margin-left: 0;
  }

  .timeline-shell::before,
  .timeline-shell::after {
    display: none;
  }

  .history-timeline {
    overflow-x: auto;
    overflow-y: hidden;
    padding-bottom: 8px;
  }

  .history-item {
    width: 118px;
    min-width: 118px;
    min-height: 168px;
  }
}
</style>
