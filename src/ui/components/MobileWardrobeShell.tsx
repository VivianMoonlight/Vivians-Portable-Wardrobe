import { useState } from 'react'
import { ActionIcon, Box, Button, Group, SegmentedControl, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { getWb, useWbSelector } from '@/stores/hooks'
import { useTheme } from '@/ui/theme/ThemeProvider'
import { WardrobeWorkspace } from './WardrobeWorkspace'
import { HistoryViewer } from './HistoryViewer'
import { FilterManager } from './FilterManager'
import { SidePreview } from './SidePreview'

interface MobileWardrobeShellProps {
  onClose: () => void
}

type Pane = 'preview' | 'list' | 'filter'

export function MobileWardrobeShell({ onClose }: MobileWardrobeShellProps) {
  const { t } = useTranslation()
  const rawActiveTab = useWbSelector((wb) => wb.activeTab)
  const theme = useTheme()
  const [pane, setPane] = useState<Pane>('list')

  const mainTab = rawActiveTab === 'studio' ? 'wardrobe' : rawActiveTab

  return (
    <Stack gap="xs" style={{ height: '100dvh', minHeight: 0, overflow: 'hidden' }} p="xs">
      <Group justify="space-between">
        <Text fw={700}>{t('fileManagerPanel.title')}</Text>
        <ActionIcon variant="subtle" onClick={onClose} aria-label={t('studio.closeTitle')}>
          ✕
        </ActionIcon>
      </Group>

      <SegmentedControl
        fullWidth
        value={mainTab}
        onChange={(v) => getWb().setActiveTab(v)}
        data={[
          { value: 'wardrobe', label: t('fileManagerPanel.tabWardrobe') },
          { value: 'history', label: t('fileManagerPanel.tabHistory') },
          { value: 'settings', label: t('fileManagerPanel.tabSettings') },
        ]}
      />

      <Box style={{ display: mainTab === 'wardrobe' ? 'block' : 'none', flex: 1, minHeight: 0 }}>
        <WardrobeWorkspace />
      </Box>

      {mainTab === 'settings' && (
        <Stack gap="sm" pt="md">
          <Text fw={600}>{t('fileManagerPanel.themeSettings')}</Text>
          <Group>
            <Button
              variant={!theme.isDark ? 'filled' : 'default'}
              onClick={() => theme.setColorScheme('light')}
            >
              ☀ {t('fileManagerPanel.lightMode')}
            </Button>
            <Button
              variant={theme.isDark ? 'filled' : 'default'}
              onClick={() => theme.setColorScheme('dark')}
            >
              ☾ {t('fileManagerPanel.darkMode')}
            </Button>
          </Group>
        </Stack>
      )}
      {mainTab === 'history' && (
        <>
          <SegmentedControl
            fullWidth
            size="xs"
            value={pane}
            onChange={(v) => setPane(v as Pane)}
            data={[
              { value: 'preview', label: t('sidePreview.ariaLabel') },
              { value: 'list', label: mainTab === 'history' ? t('fileManagerPanel.tabHistory') : t('fileManagerPanel.tabWardrobe') },
              { value: 'filter', label: t('filterManager.ariaLabel') },
            ]}
          />

          <Box style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {pane === 'preview' && <SidePreview showApply />}
            {pane === 'list' && <HistoryViewer />}
            {pane === 'filter' && <FilterManager />}
          </Box>
        </>
      )}
    </Stack>
  )
}
