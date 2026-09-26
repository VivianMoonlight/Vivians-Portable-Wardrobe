import { Box, Button, Group, Stack, Switch, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { isForceSelfApplyEnabled } from '@/stores/workbenchStore.js'
import { getWb, useFsSelector, useWbSelector } from '@/stores/hooks'
import { useDialog } from '@/ui/dialog/DialogProvider'
import { useTheme } from '@/ui/theme/ThemeProvider'

export function WardrobeSettings() {
  const { t } = useTranslation()
  const theme = useTheme()
  const dialog = useDialog()
  useFsSelector((fs) => fs.character)
  useWbSelector((wb) => wb.forceSelfApplyRevision)

  const onForceSelfApplyChange = async (enabled: boolean) => {
    if (!getWb().setForceSelfApplyEnabled(enabled)) {
      await dialog.alert(t('fileManagerPanel.forceSelfApplySaveFailed'))
    }
  }

  return (
    <Stack gap="lg">
      <Box>
        <Text fw={600} mb="sm">{t('fileManagerPanel.themeSettings')}</Text>
        <Group>
          <Button variant={!theme.isDark ? 'filled' : 'default'} onClick={() => theme.setColorScheme('light')}>
            ☀ {t('fileManagerPanel.lightMode')}
          </Button>
          <Button variant={theme.isDark ? 'filled' : 'default'} onClick={() => theme.setColorScheme('dark')}>
            ☾ {t('fileManagerPanel.darkMode')}
          </Button>
        </Group>
      </Box>
      <Box>
        <Text fw={600} mb="sm">{t('fileManagerPanel.forceSelfApplyTitle')}</Text>
        <Switch
          color="red"
          checked={isForceSelfApplyEnabled()}
          onChange={(event) => { void onForceSelfApplyChange(event.currentTarget.checked) }}
          label={t('fileManagerPanel.forceSelfApplyLabel')}
          description={t('fileManagerPanel.forceSelfApplyDescription')}
        />
      </Box>
    </Stack>
  )
}
