import { useEffect, useState } from 'react'
import { Alert, Box, Button, Group, PasswordInput, Stack, Switch, Text, TextInput } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { isForceSelfApplyEnabled } from '@/stores/workbenchStore.js'
import { getFs, getWb, useFsSelector, useWbSelector } from '@/stores/hooks'
import { useDialog } from '@/ui/dialog/DialogProvider'
import { useTheme } from '@/ui/theme/ThemeProvider'
import { hostWindow } from '@/utils/host-window.js'
import { configuredCloudflareUrl } from '@/services/cloudflare-wardrobe-client.js'
import { cloudflareSyncErrorKey } from '@/ui/cloudflare-sync-error'

const dashboardUrl = (() => {
  try { return new URL(configuredCloudflareUrl()).origin } catch { return '' }
})()

export function WardrobeSettings() {
  const { t, i18n } = useTranslation()
  const theme = useTheme()
  const dialog = useDialog()
  const member = useFsSelector((fs) => fs.character?.MemberNumber)
  const cloudflare = useFsSelector((fs) => fs.cloudflareSyncStatus)
  const cloudflareErrorKey = cloudflareSyncErrorKey(cloudflare.errorCode)
  const activeTab = useWbSelector((wb) => wb.activeTab)
  useWbSelector((wb) => wb.forceSelfApplyRevision)
  const [cloudflareBusy, setCloudflareBusy] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState('')
  const [showRestore, setShowRestore] = useState(false)
  const [restoreKey, setRestoreKey] = useState('')
  const [copyResult, setCopyResult] = useState<'copied' | 'manual' | null>(null)

  useEffect(() => {
    setRecoveryKey('')
    setRestoreKey('')
    setShowRestore(false)
    setCopyResult(null)
  }, [member])

  useEffect(() => {
    if (activeTab !== 'settings') setRecoveryKey('')
  }, [activeTab])

  const onForceSelfApplyChange = async (enabled: boolean) => {
    if (!getWb().setForceSelfApplyEnabled(enabled)) {
      await dialog.alert(t('fileManagerPanel.forceSelfApplySaveFailed'))
    }
  }

  const onCloudflareChange = async (enabled: boolean) => {
    setCloudflareBusy(true)
    setRecoveryKey('')
    try {
      const saved = enabled ? await getFs().enableCloudflareSync() : await getFs().disableCloudflareSync()
      if (!saved && !getFs().cloudflareSyncStatus.error) await dialog.alert(t('cloudflareSync.changeFailed'))
    } catch {
      await dialog.alert(t('cloudflareSync.changeFailed'))
    } finally {
      setCloudflareBusy(false)
    }
  }

  const onSyncCloudflare = async () => {
    setCloudflareBusy(true)
    try {
      const synced = await getFs().syncCloudflareNow()
      if (!synced && !getFs().cloudflareSyncStatus.error) await dialog.alert(t('cloudflareSync.syncFailed'))
    } catch {
      await dialog.alert(t('cloudflareSync.syncFailed'))
    } finally {
      setCloudflareBusy(false)
    }
  }

  const onShowRecoveryKey = async () => {
    try {
      const key = await getFs().exportCloudflareKey()
      if (!key) throw new Error('Recovery key unavailable')
      setRecoveryKey(key)
      setCopyResult(null)
    } catch {
      await dialog.alert(t('cloudflareSync.keyUnavailable'))
    }
  }

  const onCopyRecoveryKey = async () => {
    try {
      if (!hostWindow.navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await hostWindow.navigator.clipboard.writeText(recoveryKey)
      setCopyResult('copied')
    } catch {
      setCopyResult('manual')
    }
  }

  const onDownloadRecoveryKey = async () => {
    try {
      const key = await getFs().exportCloudflareKey()
      if (!key) throw new Error('Recovery key unavailable')
      const url = URL.createObjectURL(new Blob([`${key}\n`], { type: 'text/plain;charset=utf-8' }))
      const anchor = hostWindow.document.createElement('a')
      try {
        anchor.href = url
        anchor.download = `vpw-cloud-recovery-key-${new Date().toISOString().slice(0, 10)}.txt`
        hostWindow.document.body.appendChild(anchor)
        anchor.click()
      } finally {
        anchor.remove()
        hostWindow.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      }
    } catch {
      await dialog.alert(t('cloudflareSync.keyDownloadFailed'))
    }
  }

  const onRestoreKey = async () => {
    if (!restoreKey.trim()) return
    setCloudflareBusy(true)
    try {
      const restored = await getFs().importCloudflareKey(restoreKey.trim())
      if (restored) {
        setRecoveryKey('')
        setCopyResult(null)
        setRestoreKey('')
        setShowRestore(false)
      } else if (!getFs().cloudflareSyncStatus.error) {
        await dialog.alert(t('cloudflareSync.restoreFailed'))
      }
    } catch {
      await dialog.alert(t('cloudflareSync.restoreFailed'))
    } finally {
      setCloudflareBusy(false)
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
        <Text fw={600} mb="sm">{t('cloudflareSync.title')}</Text>
        <Stack gap="xs">
          <Switch
            checked={cloudflare.enabled}
            disabled={(!cloudflare.ready && !cloudflare.enabled) || cloudflareBusy || cloudflare.syncing}
            onChange={(event) => { void onCloudflareChange(event.currentTarget.checked) }}
            label={t('cloudflareSync.enable')}
            description={t('cloudflareSync.description')}
          />
          {cloudflare.enabled && <Text size="xs" c="dimmed">{t('cloudflareSync.allDevicesHint')}</Text>}
          {!cloudflare.ready && <Alert color="orange">{t(cloudflare.enabled
            ? 'cloudflareSync.serviceUnavailable' : 'cloudflareSync.notConfigured')}</Alert>}
          {cloudflare.enabled && <Group gap="xs" align="center">
            <Text size="sm" c={cloudflare.error ? 'red' : 'dimmed'}>
              {cloudflare.syncing ? t('cloudflareSync.syncing')
                : cloudflare.error ? t('cloudflareSync.needsAttention')
                  : cloudflare.pending ? t('cloudflareSync.pending')
                    : cloudflare.lastSyncedAt ? t('cloudflareSync.lastSynced', {
                    time: new Date(cloudflare.lastSyncedAt).toLocaleString(i18n.language === 'zh' ? 'zh-CN' : 'en-US'),
                  })
                    : t('cloudflareSync.waiting')}
            </Text>
            <Button size="compact-sm" variant="light" disabled={!cloudflare.ready || cloudflareBusy || cloudflare.syncing}
              onClick={() => { void onSyncCloudflare() }}>{t('cloudflareSync.syncNow')}</Button>
          </Group>}
          {cloudflare.error && <Text size="xs" c="red" style={{ overflowWrap: 'anywhere' }}>
            {cloudflareErrorKey ? t(cloudflareErrorKey) : cloudflare.error}
          </Text>}
          {cloudflare.enabled && cloudflare.bcLegacyChanged && <Alert color="orange">
            {t('cloudflareSync.bcLegacyChanged')}
          </Alert>}
          {cloudflare.enabled && !cloudflare.bcLegacyChanged && cloudflare.bcLegacyRetained === true && <Text size="xs" c="orange">
            {t('cloudflareSync.bcCleanupPending')}
          </Text>}
          {cloudflare.enabled && !cloudflare.bcLegacyChanged && cloudflare.bcLegacyRetained == null && <Text size="xs" c="dimmed">
            {t('cloudflareSync.bcCleanupUnknown')}
          </Text>}
          {cloudflare.enabled && !cloudflare.bcLegacyChanged && cloudflare.bcLegacyRetained === false && <Text size="xs" c="dimmed">
            {t('cloudflareSync.bcCleanupVerified')}
          </Text>}
          {cloudflare.enabled && !cloudflare.keyAvailable && <Text size="xs" c="orange">
            {t('cloudflareSync.keyMissing')}
          </Text>}
          {cloudflare.keyAvailable && <>
            <Text size="xs" c={cloudflare.keySavedToBC ? 'dimmed' : 'orange'}>
              {t(cloudflare.keySavedToBC ? 'cloudflareSync.keyStorage' : 'cloudflareSync.keyNotSaved')}
            </Text>
            {!showRestore && (!recoveryKey ? <Group gap="xs">
              <Button size="compact-sm" variant="subtle"
                onClick={() => { void onShowRecoveryKey() }}>{t('cloudflareSync.showKey')}</Button>
              <Button size="compact-sm" variant="subtle"
                onClick={() => { void onDownloadRecoveryKey() }}>{t('cloudflareSync.downloadKey')}</Button>
            </Group> : <Stack gap={4}>
              <TextInput label={t('cloudflareSync.recoveryKey')} value={recoveryKey} readOnly
                onFocus={(event) => event.currentTarget.select()} autoComplete="off" />
              <Group gap="xs">
                <Button size="compact-sm" onClick={() => { void onCopyRecoveryKey() }}>{t('cloudflareSync.copyKey')}</Button>
                <Button size="compact-sm" variant="subtle" onClick={() => { void onDownloadRecoveryKey() }}>
                  {t('cloudflareSync.downloadKey')}
                </Button>
                <Button size="compact-sm" variant="subtle" onClick={() => { setRecoveryKey(''); setCopyResult(null) }}>
                  {t('cloudflareSync.hideKey')}
                </Button>
              </Group>
              <Text size="xs" c={copyResult === 'manual' ? 'orange' : 'dimmed'}>
                {t(copyResult === 'copied' ? 'cloudflareSync.keyCopied'
                  : copyResult === 'manual' ? 'cloudflareSync.copyManually' : 'cloudflareSync.keepKeySafe')}
              </Text>
            </Stack>)}
          </>}
          {!cloudflare.enabled && cloudflare.ready && <>
            {!showRestore ? <Button size="compact-sm" variant="subtle" style={{ alignSelf: 'flex-start' }}
              onClick={() => { setRecoveryKey(''); setCopyResult(null); setShowRestore(true) }}>{t(cloudflare.keyAvailable
                ? 'cloudflareSync.changeKey' : 'cloudflareSync.restoreKey')}</Button> : <Stack gap="xs">
              <PasswordInput label={t('cloudflareSync.recoveryKey')} value={restoreKey}
                onChange={(event) => setRestoreKey(event.currentTarget.value)} autoComplete="off" />
              <Text size="xs" c="dimmed">{t('cloudflareSync.restoreHint')}</Text>
              <Group gap="xs">
                <Button size="compact-sm" disabled={!restoreKey.trim() || cloudflareBusy}
                  onClick={() => { void onRestoreKey() }}>{t('cloudflareSync.restore')}</Button>
                <Button size="compact-sm" variant="subtle" onClick={() => { setShowRestore(false); setRestoreKey('') }}>
                  {t('dialog.cancel')}
                </Button>
              </Group>
            </Stack>}
          </>}
          {dashboardUrl && <>
            <Button component="a" href={dashboardUrl} target="_blank" rel="noopener noreferrer"
              size="compact-sm" variant="subtle" style={{ alignSelf: 'flex-start' }}>
              {t('cloudflareSync.openDashboard')}
            </Button>
            <Text size="xs" c="dimmed">{t('cloudflareSync.dashboardHint')}</Text>
          </>}
        </Stack>
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
