import { useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { Box, Button, Group, Modal, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { OVERLAY_Z_INDEX } from '@/ui/z-index'
import { hostWindow } from '@/utils/host-window.js'
import { FilterManager } from './FilterManager'
import { SidePreview } from './SidePreview'
import dialogStyles from './OutfitAdjustmentsDialog.css?inline'

interface OutfitAdjustmentsDialogProps {
  opened: boolean
  onClose: () => void
}

function exitOnEscape(event: KeyboardEvent<HTMLElement>, onExit: () => void) {
  if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented) return
  const target = event.nativeEvent.composedPath().find((node): node is HTMLElement => node instanceof HTMLElement)
  if (target?.closest('[role="listbox"], [role="menu"], [role="combobox"][aria-expanded="true"], [aria-haspopup][aria-expanded="true"], [aria-haspopup][aria-controls]')) return
  event.stopPropagation()
  event.preventDefault()
  onExit()
}

function OutfitAdjustmentsContent({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  return (
    <>
      <style>{dialogStyles}</style>
      <Box className="vpw-adjustments-layout">
        <Box className="vpw-adjustments-preview">
          <SidePreview />
        </Box>
        <Box className="vpw-adjustments-controls">
          <FilterManager />
        </Box>
      </Box>
      <Group className="vpw-adjustments-footer" justify="space-between" gap="xs" wrap="nowrap">
        <Text size="xs" c="dimmed">{t('outfitFlow.adjustmentPreviewHint', { defaultValue: '修改会实时更新预览。' })}</Text>
        <Button onClick={onDone}>{t('outfitFlow.doneAdjusting', { defaultValue: '完成微调' })}</Button>
      </Group>
    </>
  )
}

export function OutfitAdjustmentsPage({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation()
  const backButton = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => { backButton.current?.focus({ preventScroll: true }) }, [])

  return (
    <Box
      component="section"
      className="vpw-adjustments-page"
      aria-label={t('outfitFlow.dialogTitle', { defaultValue: '微调部位' })}
      onKeyDownCapture={(event) => exitOnEscape(event, onBack)}
      onKeyDown={(event) => { if (event.key === 'Escape') event.stopPropagation() }}
    >
      <Group className="vpw-adjustments-header" gap="xs" wrap="nowrap">
        <Button ref={backButton} variant="subtle" size="compact-sm" px={4} onClick={onBack} leftSection={<span aria-hidden="true">←</span>}>
          {t('outfitFlow.backToPreview', { defaultValue: '返回预览' })}
        </Button>
        <Text size="sm" fw={600}>{t('outfitFlow.dialogTitle', { defaultValue: '微调部位' })}</Text>
      </Group>
      <Box className="vpw-adjustments-body">
        <OutfitAdjustmentsContent onDone={onBack} />
      </Box>
    </Box>
  )
}

export function OutfitAdjustmentsDialog({ opened, onClose }: OutfitAdjustmentsDialogProps) {
  const { t } = useTranslation()
  const returnFocusTo = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    if (!opened) return
    let active = hostWindow.document.activeElement
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
    returnFocusTo.current = active instanceof HTMLElement ? active : null
  }, [opened])

  const restoreFocus = () => {
    const target = returnFocusTo.current
    if (!opened && target?.isConnected && target.getClientRects().length) target.focus({ preventScroll: true })
  }

  return (
    <Modal
      opened={opened}
      lockScroll={false}
      onClose={onClose}
      title={<Text fw={600}>{t('outfitFlow.dialogTitle', { defaultValue: '微调部位' })}</Text>}
      closeButtonProps={{ 'aria-label': t('outfitFlow.closeAdjustments', { defaultValue: '关闭微调' }) }}
      size={920}
      centered
      radius="md"
      padding="sm"
      zIndex={OVERLAY_Z_INDEX}
      overlayProps={{ backgroundOpacity: 0.4 }}
      classNames={{ content: 'vpw-adjustments-dialog', body: 'vpw-adjustments-body', header: 'vpw-adjustments-header' }}
      // Let open pickers handle Escape; passive tooltips close with the dialog.
      closeOnEscape={false}
      onKeyDownCapture={(event) => exitOnEscape(event, onClose)}
      returnFocus={false}
      onExitTransitionEnd={restoreFocus}
    >
      <OutfitAdjustmentsContent onDone={onClose} />
    </Modal>
  )
}
