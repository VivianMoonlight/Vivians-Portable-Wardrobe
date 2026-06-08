import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { ActionIcon, Box, Button, Divider, Flex, Group, Modal, Tabs, Text, Tooltip } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { hostWindow } from '@/utils/host-window.js'
import { getFs, useWb } from '@/stores/hooks'
import { useTheme } from '@/ui/theme/ThemeProvider'
import { useIsMobile } from '@/ui/hooks/useIsMobile'
import { FileManager } from './FileManager'
import { HistoryViewer } from './HistoryViewer'
import { FilterManager } from './FilterManager'
import { SidePreview } from './SidePreview'
import { MobileWardrobeShell } from './MobileWardrobeShell'

interface FileManagerPanelProps {
  opened: boolean
  onClose: () => void
}

const PANEL_RECT_STORAGE_KEY = 'vpw-panel-rect-v1'
const PANEL_MIN_WIDTH = 760
const PANEL_MIN_HEIGHT = 480
const PANEL_MARGIN = 16

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function FileManagerPanel({ opened, onClose }: FileManagerPanelProps) {
  const { t } = useTranslation()
  const wb = useWb()
  const theme = useTheme()
  const isMobile = useIsMobile()
  const [showFilters, setShowFilters] = useState(true)
  const [panelRect, setPanelRect] = useState(() => ({
    width: Math.min(1180, Math.max(PANEL_MIN_WIDTH, Math.round((hostWindow.innerWidth || 1280) * 0.82))),
    height: Math.min(760, Math.max(PANEL_MIN_HEIGHT, Math.round((hostWindow.innerHeight || 800) * 0.74))),
    x: Math.max(PANEL_MARGIN, Math.round(((hostWindow.innerWidth || 1280) - Math.min(1180, Math.max(PANEL_MIN_WIDTH, Math.round((hostWindow.innerWidth || 1280) * 0.82)))) / 2)),
    y: Math.max(PANEL_MARGIN, Math.round(((hostWindow.innerHeight || 800) - Math.min(760, Math.max(PANEL_MIN_HEIGHT, Math.round((hostWindow.innerHeight || 800) * 0.74)))) / 2)),
  }))
  const [draggingPanel, setDraggingPanel] = useState(false)
  const [resizingPanel, setResizingPanel] = useState(false)
  const panelDrag = useRef({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0 })
  const panelResize = useRef({ active: false, startX: 0, startY: 0, baseWidth: 0, baseHeight: 0 })

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
        setPanelRect({
          width: clamp(parsed.width, PANEL_MIN_WIDTH, Math.max(PANEL_MIN_WIDTH, hostWindow.innerWidth - PANEL_MARGIN * 2)),
          height: clamp(parsed.height, PANEL_MIN_HEIGHT, Math.max(PANEL_MIN_HEIGHT, hostWindow.innerHeight - PANEL_MARGIN * 2)),
          x: clamp(parsed.x, PANEL_MARGIN, Math.max(PANEL_MARGIN, hostWindow.innerWidth - parsed.width - PANEL_MARGIN)),
          y: clamp(parsed.y, PANEL_MARGIN, Math.max(PANEL_MARGIN, hostWindow.innerHeight - parsed.height - PANEL_MARGIN)),
        })
      }
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    const onResize = () => {
      setPanelRect((rect) => ({
        width: clamp(rect.width, PANEL_MIN_WIDTH, Math.max(PANEL_MIN_WIDTH, hostWindow.innerWidth - PANEL_MARGIN * 2)),
        height: clamp(rect.height, PANEL_MIN_HEIGHT, Math.max(PANEL_MIN_HEIGHT, hostWindow.innerHeight - PANEL_MARGIN * 2)),
        x: clamp(rect.x, PANEL_MARGIN, Math.max(PANEL_MARGIN, hostWindow.innerWidth - rect.width - PANEL_MARGIN)),
        y: clamp(rect.y, PANEL_MARGIN, Math.max(PANEL_MARGIN, hostWindow.innerHeight - rect.height - PANEL_MARGIN)),
      }))
    }
    hostWindow.addEventListener('resize', onResize)
    return () => hostWindow.removeEventListener('resize', onResize)
  }, [])

  const onPanelPointerMove = useCallback(
    (event: globalThis.PointerEvent) => {
      if (panelDrag.current.active) {
        const dx = event.clientX - panelDrag.current.startX
        const dy = event.clientY - panelDrag.current.startY
        setPanelRect((rect) => ({
          ...rect,
          x: clamp(panelDrag.current.baseX + dx, PANEL_MARGIN, Math.max(PANEL_MARGIN, hostWindow.innerWidth - rect.width - PANEL_MARGIN)),
          y: clamp(panelDrag.current.baseY + dy, PANEL_MARGIN, Math.max(PANEL_MARGIN, hostWindow.innerHeight - rect.height - PANEL_MARGIN)),
        }))
      } else if (panelResize.current.active) {
        const dx = event.clientX - panelResize.current.startX
        const dy = event.clientY - panelResize.current.startY
        setPanelRect((rect) => ({
          ...rect,
          width: clamp(panelResize.current.baseWidth + dx, PANEL_MIN_WIDTH, Math.max(PANEL_MIN_WIDTH, hostWindow.innerWidth - rect.x - PANEL_MARGIN)),
          height: clamp(panelResize.current.baseHeight + dy, PANEL_MIN_HEIGHT, Math.max(PANEL_MIN_HEIGHT, hostWindow.innerHeight - rect.y - PANEL_MARGIN)),
        }))
      }
    },
    [],
  )

  const onPanelPointerUp = useCallback(() => {
    if (!panelDrag.current.active && !panelResize.current.active) return
    panelDrag.current.active = false
    panelResize.current.active = false
    setDraggingPanel(false)
    setResizingPanel(false)
    hostWindow.removeEventListener('pointermove', onPanelPointerMove)
    hostWindow.removeEventListener('pointerup', onPanelPointerUp)
    setPanelRect((rect) => {
      persistPanelRect(rect)
      return rect
    })
  }, [onPanelPointerMove, persistPanelRect])

  const startPanelDrag = (event: ReactPointerEvent) => {
    if (isMobile || event.button !== 0) return
    panelDrag.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      baseX: panelRect.x,
      baseY: panelRect.y,
    }
    setDraggingPanel(true)
    hostWindow.addEventListener('pointermove', onPanelPointerMove)
    hostWindow.addEventListener('pointerup', onPanelPointerUp)
  }

  const startPanelResize = (event: ReactPointerEvent) => {
    if (isMobile || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    panelResize.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      baseWidth: panelRect.width,
      baseHeight: panelRect.height,
    }
    setResizingPanel(true)
    hostWindow.addEventListener('pointermove', onPanelPointerMove)
    hostWindow.addEventListener('pointerup', onPanelPointerUp)
  }

  const activeTab = wb.activeTab === 'studio' ? 'wardrobe' : wb.activeTab
  const showSidebars = activeTab === 'wardrobe' || activeTab === 'history'

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      fullScreen={isMobile}
      size={isMobile ? '100%' : panelRect.width}
      radius={isMobile ? 0 : 'md'}
      withCloseButton={!isMobile}
      title={
        !isMobile ? (
          <Text fw={700} onPointerDown={startPanelDrag} style={{ cursor: draggingPanel ? 'grabbing' : 'grab', userSelect: 'none' }}>
            {t('fileManagerPanel.title')}
          </Text>
        ) : undefined
      }
      styles={{
        content: isMobile
          ? undefined
          : {
              position: 'fixed',
              left: panelRect.x,
              top: panelRect.y,
              width: panelRect.width,
              maxWidth: 'none',
              margin: 0,
            },
        body: {
          height: isMobile ? '100%' : panelRect.height,
          display: 'flex',
          flexDirection: 'column',
          padding: isMobile ? 0 : undefined,
          position: 'relative',
        },
      }}
    >
      {isMobile ? (
        <MobileWardrobeShell onClose={onClose} />
      ) : (
        <Tabs
          value={activeTab}
          onChange={(value) => value && wb.setActiveTab(value)}
          style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
        >
          <Group justify="space-between">
            <Tabs.List>
              <Tabs.Tab value="wardrobe">{t('fileManagerPanel.tabWardrobe')}</Tabs.Tab>
              <Tabs.Tab value="history">{t('fileManagerPanel.tabHistory')}</Tabs.Tab>
              <Tabs.Tab value="settings">{t('fileManagerPanel.tabSettings')}</Tabs.Tab>
            </Tabs.List>
            <Group gap="xs">
              {showSidebars && (
                <Tooltip label={t('filterManager.ariaLabel')}>
                  <Button
                    size="compact-sm"
                    variant={showFilters ? 'filled' : 'default'}
                    onClick={() => setShowFilters((v) => !v)}
                    aria-label={t('filterManager.ariaLabel')}
                    aria-pressed={showFilters}
                    leftSection="▼"
                  >
                    {t('fileManagerPanel.toggleFilters')}
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
            <ThreeColumn showFilters={showFilters} showApply>
              <FileManager />
            </ThreeColumn>
          </Tabs.Panel>

          <Tabs.Panel value="history" style={{ flex: 1, minHeight: 0, paddingTop: 12 }}>
            <ThreeColumn showFilters={showFilters}>
              <HistoryViewer />
            </ThreeColumn>
          </Tabs.Panel>

          <Tabs.Panel value="settings" style={{ flex: 1, paddingTop: 12 }}>
            <SettingsPanel />
          </Tabs.Panel>
        </Tabs>
      )}
      {!isMobile && (
        <Box
          title="Resize"
          onPointerDown={startPanelResize}
          style={{
            position: 'absolute',
            right: 8,
            bottom: 8,
            width: 18,
            height: 18,
            cursor: 'nwse-resize',
            borderRight: '2px solid var(--mantine-color-dimmed)',
            borderBottom: '2px solid var(--mantine-color-dimmed)',
            opacity: resizingPanel ? 0.95 : 0.55,
            zIndex: 2,
            touchAction: 'none',
          }}
        />
      )}
    </Modal>
  )
}

function ThreeColumn({
  showFilters,
  showApply = false,
  children,
}: {
  showFilters: boolean
  showApply?: boolean
  children: ReactNode
}) {
  return (
    <Flex gap="md" h="100%" style={{ minHeight: 0 }}>
      <Box style={{ flex: 1, minWidth: 0, minHeight: 0 }}>{children}</Box>
      <Box w={280} style={{ flex: '0 0 auto' }}>
        <SidePreview showApply={showApply} />
      </Box>
      {showFilters && (
        <Box w={420} style={{ flex: '0 0 auto', minHeight: 0 }}>
          <FilterManager />
        </Box>
      )}
    </Flex>
  )
}

function SettingsPanel() {
  const { t } = useTranslation()
  const theme = useTheme()
  return (
    <Box>
      <Text fw={600} mb="sm">
        {t('fileManagerPanel.themeSettings')}
      </Text>
      <Group>
        <Button variant={!theme.isDark ? 'filled' : 'default'} onClick={() => theme.setColorScheme('light')}>
          ☀ {t('fileManagerPanel.lightMode')}
        </Button>
        <Button variant={theme.isDark ? 'filled' : 'default'} onClick={() => theme.setColorScheme('dark')}>
          ☾ {t('fileManagerPanel.darkMode')}
        </Button>
      </Group>
    </Box>
  )
}
