import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { ActionIcon, Box, Button, CloseButton, Divider, Flex, Group, Modal, Paper, Portal, Tabs, Text, Tooltip } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { hostWindow } from '@/utils/host-window.js'
import { isNativeItemEditorActive, subscribeNativeItemEditor } from '@/services/native-item-editor.js'
import { isNativeWardrobeEditorActive, subscribeNativeWardrobeEditor } from '@/services/native-wardrobe-editor.js'
import { getFs, getWb, useFsSelector, useWbSelector } from '@/stores/hooks'
import { useTheme } from '@/ui/theme/ThemeProvider'
import { useIsMobile } from '@/ui/hooks/useIsMobile'
import { WardrobeWorkspace } from './WardrobeWorkspace'
import { HistoryViewer } from './HistoryViewer'
import { OutfitAdjustmentsDialog } from './OutfitAdjustmentsDialog'
import { SidePreview } from './SidePreview'
import { MobileWardrobeShell } from './MobileWardrobeShell'
import { WardrobeSettings } from './WardrobeSettings'

interface FileManagerPanelProps {
  opened: boolean
  onClose: () => void
}

const PANEL_RECT_STORAGE_KEY = 'vpw-panel-rect-v1'
const PANEL_MIN_WIDTH = 760
const PANEL_MIN_HEIGHT = 480
const PANEL_MARGIN = 16
const PANEL_Z_INDEX = 2147483000
const HEADER_HEIGHT = 46

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function fitPanelHeight(value: number, top = PANEL_MARGIN): number {
  const available = Math.max(1, hostWindow.innerHeight - top - PANEL_MARGIN)
  return clamp(value, Math.min(PANEL_MIN_HEIGHT, available), available)
}

export function FileManagerPanel({ opened, onClose }: FileManagerPanelProps) {
  const { t } = useTranslation()
  const rawActiveTab = useWbSelector((wb) => wb.activeTab)
  const historyStorageStatus = useFsSelector((fs) => fs.historyStorageStatus)
  const historyNeedsAttention = historyStorageStatus === 'error'
    || historyStorageStatus === 'conflict' || historyStorageStatus === 'archived'
  const theme = useTheme()
  const isMobile = useIsMobile()
  const nativeItemEditorActive = useSyncExternalStore(subscribeNativeItemEditor, isNativeItemEditorActive)
  const nativeWardrobeEditorActive = useSyncExternalStore(subscribeNativeWardrobeEditor, isNativeWardrobeEditorActive)
  const [adjustmentsOpen, setAdjustmentsOpen] = useState(false)
  const [panelRect, setPanelRect] = useState(() => {
    const width = Math.min(1180, Math.max(PANEL_MIN_WIDTH, Math.round((hostWindow.innerWidth || 1280) * 0.82)))
    const height = fitPanelHeight(Math.min(760, Math.max(PANEL_MIN_HEIGHT, Math.round((hostWindow.innerHeight || 800) * 0.74))))
    return {
      width,
      height,
      x: Math.max(PANEL_MARGIN, Math.round(((hostWindow.innerWidth || 1280) - width) / 2)),
      y: Math.max(PANEL_MARGIN, Math.round(((hostWindow.innerHeight || 800) - height) / 2)),
    }
  })
  const [draggingPanel, setDraggingPanel] = useState(false)

  // Live mirror of the committed rect so pointer handlers read current values
  // without being re-created or depending on render state.
  const rectRef = useRef(panelRect)
  useEffect(() => {
    rectRef.current = panelRect
  }, [panelRect])

  // Ref to the floating window element — drag/resize mutate its style directly
  // (no per-move React state) so the interaction stays smooth/native; the final
  // value is committed to state once on pointer-up.
  const winRef = useRef<HTMLDivElement>(null)
  const panelDrag = useRef({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0, x: 0, y: 0 })
  const panelResize = useRef({ active: false, startX: 0, startY: 0, baseW: 0, baseH: 0, w: 0, h: 0 })

  const persistPanelRect = useCallback((rect: typeof panelRect) => {
    try {
      hostWindow.localStorage.setItem(PANEL_RECT_STORAGE_KEY, JSON.stringify(rect))
    } catch {
      /* ignore */
    }
  }, [])

  // Initialize the wardrobe store the first time the panel is opened.
  useEffect(() => {
    if (!opened) return
    void getFs().initialize()
  }, [opened])

  // Restore persisted rect once.
  useEffect(() => {
    try {
      const raw = hostWindow.localStorage.getItem(PANEL_RECT_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (
        typeof parsed?.width === 'number' &&
        typeof parsed?.height === 'number' &&
        typeof parsed?.x === 'number' &&
        typeof parsed?.y === 'number'
      ) {
        const width = clamp(parsed.width, PANEL_MIN_WIDTH, Math.max(PANEL_MIN_WIDTH, hostWindow.innerWidth - PANEL_MARGIN * 2))
        const height = fitPanelHeight(parsed.height)
        setPanelRect({
          width,
          height,
          x: clamp(parsed.x, PANEL_MARGIN, Math.max(PANEL_MARGIN, hostWindow.innerWidth - width - PANEL_MARGIN)),
          y: clamp(parsed.y, PANEL_MARGIN, Math.max(PANEL_MARGIN, hostWindow.innerHeight - height - PANEL_MARGIN)),
        })
      }
    } catch {
      /* ignore */
    }
  }, [])

  // Keep the window within the viewport on browser resize.
  useEffect(() => {
    const onResize = () => {
      setPanelRect((rect) => {
        const width = clamp(rect.width, PANEL_MIN_WIDTH, Math.max(PANEL_MIN_WIDTH, hostWindow.innerWidth - PANEL_MARGIN * 2))
        const height = fitPanelHeight(rect.height)
        return {
          width,
          height,
          x: clamp(rect.x, PANEL_MARGIN, Math.max(PANEL_MARGIN, hostWindow.innerWidth - width - PANEL_MARGIN)),
          y: clamp(rect.y, PANEL_MARGIN, Math.max(PANEL_MARGIN, hostWindow.innerHeight - height - PANEL_MARGIN)),
        }
      })
    }
    hostWindow.addEventListener('resize', onResize)
    return () => hostWindow.removeEventListener('resize', onResize)
  }, [])

  // Use the original Shadow DOM target so Escape dismisses the innermost layer.
  // Mantine's window capture handler sees the shadow host as event.target.
  useEffect(() => {
    if (!opened) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return
      const target = e.composedPath().find((node): node is HTMLElement => node instanceof HTMLElement)
      const layer = target?.closest('[role="menu"], [role="listbox"], [role="dialog"]')
      if (layer && !layer.classList.contains('vpw-main-wardrobe-dialog')) return
      onClose()
    }
    hostWindow.addEventListener('keydown', onKey)
    return () => hostWindow.removeEventListener('keydown', onKey)
  }, [opened, onClose])

  const onPanelPointerMove = useCallback((event: globalThis.PointerEvent) => {
    const el = winRef.current
    const r = rectRef.current
    if (panelDrag.current.active) {
      const dx = event.clientX - panelDrag.current.startX
      const dy = event.clientY - panelDrag.current.startY
      const x = clamp(panelDrag.current.baseX + dx, PANEL_MARGIN, Math.max(PANEL_MARGIN, hostWindow.innerWidth - r.width - PANEL_MARGIN))
      const y = clamp(panelDrag.current.baseY + dy, PANEL_MARGIN, Math.max(PANEL_MARGIN, hostWindow.innerHeight - r.height - PANEL_MARGIN))
      panelDrag.current.x = x
      panelDrag.current.y = y
      if (el) el.style.transform = `translate3d(${x}px, ${y}px, 0)`
    } else if (panelResize.current.active) {
      const dx = event.clientX - panelResize.current.startX
      const dy = event.clientY - panelResize.current.startY
      const w = clamp(panelResize.current.baseW + dx, PANEL_MIN_WIDTH, Math.max(PANEL_MIN_WIDTH, hostWindow.innerWidth - r.x - PANEL_MARGIN))
      const h = fitPanelHeight(panelResize.current.baseH + dy, r.y)
      panelResize.current.w = w
      panelResize.current.h = h
      if (el) {
        el.style.width = `${w}px`
        el.style.height = `${h}px`
      }
    }
  }, [])

  const onPanelPointerUp = useCallback(() => {
    if (!panelDrag.current.active && !panelResize.current.active) return
    const commit = { ...rectRef.current }
    if (panelDrag.current.active) {
      commit.x = panelDrag.current.x
      commit.y = panelDrag.current.y
    }
    if (panelResize.current.active) {
      commit.width = panelResize.current.w
      commit.height = panelResize.current.h
    }
    panelDrag.current.active = false
    panelResize.current.active = false
    setDraggingPanel(false)
    hostWindow.removeEventListener('pointermove', onPanelPointerMove)
    hostWindow.removeEventListener('pointerup', onPanelPointerUp)
    setPanelRect(commit)
    persistPanelRect(commit)
  }, [onPanelPointerMove, persistPanelRect])

  const startPanelDrag = (event: ReactPointerEvent) => {
    if (isMobile || event.button !== 0) return
    const r = rectRef.current
    panelDrag.current = { active: true, startX: event.clientX, startY: event.clientY, baseX: r.x, baseY: r.y, x: r.x, y: r.y }
    setDraggingPanel(true)
    hostWindow.addEventListener('pointermove', onPanelPointerMove)
    hostWindow.addEventListener('pointerup', onPanelPointerUp)
  }

  const startPanelResize = (event: ReactPointerEvent) => {
    if (isMobile || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const r = rectRef.current
    panelResize.current = { active: true, startX: event.clientX, startY: event.clientY, baseW: r.width, baseH: r.height, w: r.width, h: r.height }
    hostWindow.addEventListener('pointermove', onPanelPointerMove)
    hostWindow.addEventListener('pointerup', onPanelPointerUp)
  }

  const activeTab = rawActiveTab === 'studio' ? 'wardrobe' : rawActiveTab
  const showSidebars = activeTab === 'history'

  // ---- Mobile: full-screen modal (no drag/resize) ----
  if (isMobile) {
    return (
      <Modal opened={opened} onClose={onClose} fullScreen radius={0} withCloseButton={false} padding={0} lockScroll={false}
        trapFocus={!nativeItemEditorActive && !nativeWardrobeEditorActive}
        closeOnEscape={false} classNames={{ content: 'vpw-main-wardrobe-dialog' }}>
        <MobileWardrobeShell onClose={onClose} />
      </Modal>
    )
  }

  if (!opened) return null

  // ---- Desktop: free-floating, non-blocking window ----
  return (
    <Portal>
      <Paper
        ref={winRef}
        withBorder
        shadow="xl"
        radius="md"
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          transform: `translate3d(${panelRect.x}px, ${panelRect.y}px, 0)`,
          width: panelRect.width,
          height: panelRect.height,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          zIndex: PANEL_Z_INDEX,
          willChange: 'transform',
        }}
      >
        {/* Title bar — the whole bar is the drag handle */}
        <Group
          justify="space-between"
          wrap="nowrap"
          px="md"
          gap="sm"
          onPointerDown={startPanelDrag}
          style={{
            flex: '0 0 auto',
            height: HEADER_HEIGHT,
            borderBottom: '1px solid var(--vpw-color-default-border)',
            cursor: draggingPanel ? 'grabbing' : 'grab',
            userSelect: 'none',
            touchAction: 'none',
          }}
        >
          <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
            <Text aria-hidden c="dimmed" style={{ letterSpacing: 2, lineHeight: 1 }}>
              ⠿
            </Text>
            <Text fw={700} truncate>
              {t('fileManagerPanel.title')}
            </Text>
          </Group>
          <CloseButton
            aria-label={t('studio.closeTitle')}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onClose}
          />
        </Group>

        {/* Body */}
        <Box style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 'var(--vpw-spacing-md)' }}>
          <Tabs
            value={activeTab}
            onChange={(value) => value && getWb().setActiveTab(value)}
            style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
          >
            <Group justify="space-between">
              <Tabs.List>
                <Tabs.Tab value="wardrobe">{t('fileManagerPanel.tabWardrobe')}</Tabs.Tab>
                <Tabs.Tab value="history">
                  {t('fileManagerPanel.tabHistory')}
                  {historyNeedsAttention && <Text span c={historyStorageStatus === 'archived' ? 'blue' : 'red'} aria-label={t(historyStorageStatus === 'archived' ? 'historyViewer.archivedReminder' : 'historyViewer.attentionRequired')}> ●</Text>}
                </Tabs.Tab>
                <Tabs.Tab value="settings">{t('fileManagerPanel.tabSettings')}</Tabs.Tab>
              </Tabs.List>
              <Group gap="xs">
                {showSidebars && (
                  <Tooltip label={t('outfitFlow.openAdjustments')}>
                    <Button
                      size="compact-sm"
                      variant="default"
                      onClick={() => setAdjustmentsOpen(true)}
                      aria-label={t('outfitFlow.openAdjustments')}
                      aria-haspopup="dialog"
                    >
                      {t('outfitFlow.openAdjustments', { defaultValue: '微调部位' })}
                    </Button>
                  </Tooltip>
                )}
                {showSidebars && <Divider orientation="vertical" />}
                <Tooltip label={t('fileManagerPanel.toggleTheme')}>
                  <ActionIcon variant="default" onClick={theme.toggle} aria-label={t('fileManagerPanel.toggleTheme')}>
                    {theme.isDark ? '☀' : '☾'}
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>

            <Tabs.Panel value="wardrobe" style={{ flex: 1, minHeight: 0, paddingTop: 12 }}>
              <WardrobeWorkspace />
            </Tabs.Panel>

            <Tabs.Panel value="history" style={{ flex: 1, minHeight: 0, paddingTop: 12 }}>
              <HistoryColumns showApply>
                <HistoryViewer />
              </HistoryColumns>
            </Tabs.Panel>

            <Tabs.Panel value="settings" style={{ flex: 1, paddingTop: 12 }}>
              <WardrobeSettings />
            </Tabs.Panel>
          </Tabs>
        </Box>

        {/* Resize handle (bottom-right) */}
        <Box
          title="Resize"
          onPointerDown={startPanelResize}
          style={{
            position: 'absolute',
            right: 4,
            bottom: 4,
            width: 16,
            height: 16,
            cursor: 'nwse-resize',
            borderRight: '2px solid var(--vpw-color-dimmed)',
            borderBottom: '2px solid var(--vpw-color-dimmed)',
            opacity: 0.55,
            touchAction: 'none',
          }}
        />
      </Paper>
      <OutfitAdjustmentsDialog opened={adjustmentsOpen} onClose={() => setAdjustmentsOpen(false)} />
    </Portal>
  )
}

const COL_WEIGHTS_STORAGE_KEY = 'vpw-col-weights-v1'
const MIN_COL_WEIGHT = 0.4
// Reserve enough room to browse several outfits beside the preview.
const DEFAULT_COL_WEIGHTS: ColWeights = { list: 1.65, preview: 1 }

type ColKey = 'list' | 'preview'
type ColWeights = Record<ColKey, number>

/** Thin draggable divider used between the resizable columns. */
function ColumnSplitter({ onStart }: { onStart: (e: ReactPointerEvent) => void }) {
  return (
    <Box
      onPointerDown={onStart}
      style={{
        flex: '0 0 auto',
        width: 10,
        alignSelf: 'stretch',
        cursor: 'col-resize',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        touchAction: 'none',
      }}
    >
      <Box
        style={{
          width: 3,
          height: '36%',
          minHeight: 24,
          borderRadius: 3,
          background: 'var(--vpw-color-default-border)',
        }}
      />
    </Box>
  )
}

function HistoryColumns({
  showApply = false,
  children,
}: {
  showApply?: boolean
  children: ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [weights, setWeights] = useState<ColWeights>(() => {
    try {
      const raw = hostWindow.localStorage.getItem(COL_WEIGHTS_STORAGE_KEY)
      if (raw) {
        const p = JSON.parse(raw)
        if (typeof p?.list === 'number' && typeof p?.preview === 'number') {
          return { list: p.list, preview: p.preview }
        }
      }
    } catch {
      /* ignore */
    }
    return { ...DEFAULT_COL_WEIGHTS }
  })

  useEffect(() => {
    try {
      hostWindow.localStorage.setItem(COL_WEIGHTS_STORAGE_KEY, JSON.stringify(weights))
    } catch {
      /* ignore */
    }
  }, [weights])

  const drag = useRef<{
    leftKey: ColKey
    rightKey: ColKey
    startX: number
    baseLeft: number
    pairTotal: number
    sumAll: number
    containerW: number
  } | null>(null)

  const onSplitMove = useCallback((event: globalThis.PointerEvent) => {
    const d = drag.current
    if (!d) return
    // Convert pixel movement into a weight delta and trade it between the two
    // neighbours, keeping their sum (and every other column) constant.
    const delta = ((event.clientX - d.startX) / d.containerW) * d.sumAll
    const newLeft = clamp(d.baseLeft + delta, MIN_COL_WEIGHT, d.pairTotal - MIN_COL_WEIGHT)
    setWeights((w) => ({ ...w, [d.leftKey]: newLeft, [d.rightKey]: d.pairTotal - newLeft }))
  }, [])

  const onSplitUp = useCallback(() => {
    drag.current = null
    hostWindow.removeEventListener('pointermove', onSplitMove)
    hostWindow.removeEventListener('pointerup', onSplitUp)
  }, [onSplitMove])

  const startSplit = (leftKey: ColKey, rightKey: ColKey) => (event: ReactPointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    drag.current = {
      leftKey,
      rightKey,
      startX: event.clientX,
      baseLeft: weights[leftKey],
      pairTotal: weights[leftKey] + weights[rightKey],
      sumAll: weights.list + weights.preview,
      containerW: containerRef.current?.getBoundingClientRect().width || 1,
    }
    hostWindow.addEventListener('pointermove', onSplitMove)
    hostWindow.addEventListener('pointerup', onSplitUp)
  }

  const col = (grow: number, content: ReactNode) => (
    <Box style={{ flexGrow: grow, flexBasis: 0, minWidth: 0, minHeight: 0 }}>{content}</Box>
  )

  return (
    <Flex ref={containerRef} h="100%" style={{ minHeight: 0 }}>
      {col(weights.list, children)}
      <ColumnSplitter onStart={startSplit('list', 'preview')} />
      {col(weights.preview, <SidePreview showApply={showApply} />)}
    </Flex>
  )
}
